import { useMemo, useState } from "react"
import type { AppData } from "../types"
import type { PayrollRules } from "../utils/calculations"
import { fmt, pct } from "../utils/calculations"
import {
  addMonths,
  buildMonthlySeries,
  currentMonthKey,
  monthKey,
  monthLabel,
} from "../utils/accounting"
import { groupTransactions } from "../utils/finance"
import { costsMonthTotal } from "../utils/costs"
import Icon from "./Icon"
import { Card, CardHeader, Segmented } from "./ui"

interface Props {
  data: AppData
  rules: PayrollRules
}

type Basis = "devengado" | "caja"

/**
 * Estado de resultados del mes: qué entró, qué costó y qué quedó.
 *
 * Se ofrece en dos bases porque responden preguntas distintas y confundirlas es
 * el error clásico: **devengado** cuenta todo lo facturado del mes aunque no se
 * haya cobrado —dice si el negocio es rentable—, y **caja** cuenta solo el
 * dinero que se movió de verdad —dice si alcanza para pagar—. Un mes puede ser
 * rentable y aun así dejarte sin efectivo.
 */
export default function EstadoResultados({ data, rules }: Props) {
  const [basis, setBasis] = useState<Basis>("devengado")

  // Dos meses: el corriente y el anterior, para poder comparar.
  const series = useMemo(
    () => buildMonthlySeries(data, rules, 2),
    [data, rules],
  )
  const previous = series[0]
  const current = series[1]

  const key = currentMonthKey()
  const monthTransactions = useMemo(
    () => data.transactions.filter((t) => monthKey(t.date) === key),
    [data.transactions, key],
  )

  const accrued = basis === "devengado"
  const ingresos = accrued ? current.ingresos : current.ingresosCobrados
  const gastosOperativos = accrued
    ? current.gastosManual
    : current.gastosManualPagados
  const nomina = current.gastosNomina
  // Los pagos a terceros (módulo Costos) no tienen estado pendiente/pagado
  // como los movimientos manuales: cada renglón ya es dinero entregado, así
  // que cuentan igual en devengado y en caja.
  const costosTerceros = costsMonthTotal(data.costs, key)
  const utilidad = ingresos - gastosOperativos - nomina - costosTerceros
  const margen = pct(utilidad, ingresos)

  const prevKey = addMonths(key, -1)
  const costosTercerosPrev = costsMonthTotal(data.costs, prevKey)
  const ingresosPrev = accrued ? previous.ingresos : previous.ingresosCobrados
  const gastosPrev =
    (accrued ? previous.gastosManual : previous.gastosManualPagados) +
    previous.gastosNomina +
    costosTercerosPrev
  const utilidadPrev = ingresosPrev - gastosPrev

  // El desglose por categoría solo tiene sentido sobre los movimientos que la
  // base seleccionada realmente cuenta.
  const visible = accrued
    ? monthTransactions
    : monthTransactions.filter((t) => t.status === "pagado")

  const ingresoCats = useMemo(
    () =>
      groupTransactions(
        visible.filter((t) => t.type === "ingreso"),
        "category",
        (c) => c || "Sin categoría",
      ),
    [visible],
  )
  const gastoCats = useMemo(
    () =>
      groupTransactions(
        visible.filter((t) => t.type === "gasto"),
        "category",
        (c) => c || "Sin categoría",
      ),
    [visible],
  )

  const sinDatos =
    ingresos === 0 &&
    gastosOperativos === 0 &&
    nomina === 0 &&
    costosTerceros === 0

  return (
    <Card>
      <CardHeader
        title="Estado de resultados"
        subtitle={`${monthLabel(key)} · comparado con ${monthLabel(addMonths(key, -1))}`}
        action={
          <Segmented
            value={basis}
            onChange={(v) => setBasis(v as Basis)}
            options={[
              { value: "devengado", label: "Devengado" },
              { value: "caja", label: "Caja" },
            ]}
            size="sm"
          />
        }
      />

      {sinDatos ? (
        <p className="text-sm text-muted py-6 text-center">
          Todavía no hay ingresos, gastos ni nómina registrados en{" "}
          {monthLabel(key)}.
        </p>
      ) : (
        <>
          <div className="divide-y divide-line">
            <Line
              label="Ingresos"
              hint={
                accrued ? "Todo lo facturado del mes" : "Solo lo ya cobrado"
              }
              amount={ingresos}
              previous={ingresosPrev}
              tone="ok"
              polarity="beneficio"
            />
            <Line
              label="Costo de nómina"
              hint="Neto pagado a colaboradores en las dos quincenas"
              amount={-nomina}
              previous={-previous.gastosNomina}
              tone="danger"
              polarity="costo"
            />
            <Line
              label="Gastos operativos"
              hint={
                accrued
                  ? "Todo lo devengado del mes"
                  : "Solo lo efectivamente pagado"
              }
              amount={-gastosOperativos}
              previous={
                -(accrued
                  ? previous.gastosManual
                  : previous.gastosManualPagados)
              }
              tone="danger"
              polarity="costo"
            />
            {costosTerceros > 0 || costosTercerosPrev > 0 ? (
              <Line
                label="Costos a terceros"
                hint="Pagos a empresas y personas registrados en Costos"
                amount={-costosTerceros}
                previous={-costosTercerosPrev}
                tone="danger"
                polarity="costo"
              />
            ) : null}
            <Line
              label="Utilidad neta"
              hint={
                ingresos > 0
                  ? `Margen ${margen.toFixed(1)}%`
                  : "Sin ingresos que medir"
              }
              amount={utilidad}
              previous={utilidadPrev}
              tone={utilidad >= 0 ? "ok" : "danger"}
              polarity="beneficio"
              emphasis
            />
          </div>

          {(ingresoCats.length > 0 || gastoCats.length > 0) && (
            <div className="grid sm:grid-cols-2 gap-4 mt-5 pt-5 border-t border-line">
              <Breakdown
                title="Ingresos por categoría"
                rows={ingresoCats}
                total={ingresos}
                tone="ok"
              />
              <Breakdown
                title="Gastos por categoría"
                rows={gastoCats}
                total={gastosOperativos}
                tone="danger"
                extra={[
                  ...(nomina > 0 ? [{ label: "Nómina", amount: nomina }] : []),
                  ...(costosTerceros > 0
                    ? [{ label: "Costos a terceros", amount: costosTerceros }]
                    : []),
                ]}
                extraTotal={gastosOperativos + nomina + costosTerceros}
              />
            </div>
          )}

          {costosTerceros > 0 && (
            <p className="flex items-start gap-1.5 text-[11px] text-subtle mt-4 pt-4 border-t border-line">
              <Icon name="alert" className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              Los pagos a terceros se registran una sola vez, en Costos: evita
              anotarlos también como gasto en Movimientos para no contarlos
              dos veces.
            </p>
          )}
        </>
      )}
    </Card>
  )
}

/* --------------------------------------------------------------------- */

function Line({
  label,
  hint,
  amount,
  previous,
  tone,
  polarity,
  emphasis = false,
}: {
  label: string
  hint: string
  amount: number
  previous: number
  tone: "ok" | "danger"
  /** `costo`: crecer es malo y la flecha sigue la magnitud, no el signo. */
  polarity: "beneficio" | "costo"
  emphasis?: boolean
}) {
  // En una línea de costo se guardan montos negativos, así que comparar con
  // signo diría que gastar más "bajó". La magnitud es lo que el usuario lee.
  const delta =
    polarity === "costo"
      ? Math.abs(amount) - Math.abs(previous)
      : amount - previous

  // Un cambio de menos de un centavo es ruido de redondeo, no una variación.
  const changed = Math.abs(delta) >= 0.005 && Math.abs(previous) >= 0.005
  const grew = delta > 0
  const better = polarity === "costo" ? !grew : grew

  return (
    <div className="flex items-baseline gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div
          className={`${emphasis ? "text-sm font-bold text-fg" : "text-sm font-semibold text-fg"}`}
        >
          {label}
        </div>
        <div className="text-[11px] text-subtle">{hint}</div>
      </div>

      {changed && (
        <span
          className={`hidden sm:flex items-center gap-0.5 text-[11px] font-semibold ${
            better ? "text-ok" : "text-danger"
          }`}
          title={`Mes anterior: $${fmt(Math.abs(previous))}`}
        >
          <Icon name={grew ? "trendUp" : "trendDown"} className="w-3 h-3" />
          {pct(Math.abs(delta), Math.abs(previous)).toFixed(0)}%
        </span>
      )}

      <div
        className={`tabular-nums shrink-0 ${
          emphasis ? "text-lg font-bold" : "text-sm font-semibold"
        } ${tone === "ok" ? "text-ok" : "text-danger"}`}
      >
        {amount < 0 ? "−" : ""}${fmt(Math.abs(amount))}
      </div>
    </div>
  )
}

function Breakdown({
  title,
  rows,
  total,
  tone,
  extra,
  extraTotal,
}: {
  title: string
  rows: { key: string; label: string; amount: number }[]
  total: number
  tone: "ok" | "danger"
  extra?: { label: string; amount: number }[]
  extraTotal?: number
}) {
  const base = extraTotal ?? total
  const all = [
    ...(extra ?? []).map((e) => ({ key: `__extra-${e.label}`, ...e })),
    ...rows,
  ]
  if (all.length === 0) return null

  return (
    <div>
      <div className="text-[10px] font-bold text-subtle uppercase tracking-widest mb-2">
        {title}
      </div>
      <div className="space-y-1.5">
        {all.slice(0, 6).map((row) => {
          const share = pct(row.amount, base)
          return (
            <div key={row.key} className="flex items-center gap-2 text-xs">
              <span className="flex-1 truncate text-muted">{row.label}</span>
              <span className="text-subtle tabular-nums w-10 text-right">
                {share.toFixed(0)}%
              </span>
              <span
                className={`tabular-nums font-semibold w-20 text-right ${
                  tone === "ok" ? "text-ok" : "text-fg"
                }`}
              >
                ${fmt(row.amount)}
              </span>
            </div>
          )
        })}
        {all.length > 6 && (
          <div className="text-[11px] text-subtle pt-0.5">
            y {all.length - 6} categorías más
          </div>
        )}
      </div>
    </div>
  )
}
