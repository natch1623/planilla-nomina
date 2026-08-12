import { useMemo, useState } from "react"
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import type { AppData } from "../types"
import type { PayrollRules } from "../utils/calculations"
import { fmt } from "../utils/calculations"
import { buildMonthlySeries } from "../utils/accounting"
import { Card, CardHeader, Segmented } from "./ui"
import { Sparkline } from "./Metricas"

interface Props {
  data: AppData
  rules: PayrollRules
}

type Window = 6 | 12

/**
 * Cómo viene el negocio mes a mes: ingresos contra costos, y la utilidad
 * encima.
 *
 * El estado de resultados responde «cómo fue este mes»; esto responde «hacia
 * dónde va», que es la pregunta que un solo mes nunca contesta. Se dibuja sobre
 * base devengada, la misma con la que abre el estado de resultados, para que
 * ambos cuenten lo mismo.
 */
export default function TendenciaMensual({ data, rules }: Props) {
  const [window, setWindow] = useState<Window>(6)

  const series = useMemo(
    () => buildMonthlySeries(data, rules, window),
    [data, rules, window],
  )

  const rows = useMemo(
    () =>
      series.map((m) => ({
        // «Ago 2026» es demasiado ancho para doce columnas: basta el mes.
        mes: m.label.split(" ")[0],
        etiqueta: m.label,
        ingresos: +m.ingresos.toFixed(2),
        costos: +m.gastosTotal.toFixed(2),
        utilidad: +m.balance.toFixed(2),
      })),
    [series],
  )

  const conDatos = rows.some(
    (r) => r.ingresos !== 0 || r.costos !== 0 || r.utilidad !== 0,
  )

  const utilidades = rows.map((r) => r.utilidad)
  const ultima = utilidades[utilidades.length - 1] ?? 0
  const mejorMes = useMemo(
    () => rows.reduce((best, r) => (r.utilidad > best.utilidad ? r : best), rows[0]),
    [rows],
  )

  return (
    <Card>
      <CardHeader
        title="Cómo viene el negocio"
        subtitle={
          conDatos
            ? `Ingresos, costos y utilidad de los últimos ${window} meses`
            : "Aún sin movimientos que graficar"
        }
        action={
          <Segmented
            value={window}
            onChange={(v) => setWindow(v as Window)}
            options={[
              { value: 6, label: "6 m" },
              { value: 12, label: "12 m" },
            ]}
            size="sm"
          />
        }
      />

      {!conDatos ? (
        <p className="text-sm text-muted py-8 text-center">
          Registra ingresos y gastos en Contabilidad, o una planilla en Registro
          Diario, para ver la evolución.
        </p>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={210}>
            <ComposedChart
              data={rows}
              margin={{ top: 6, right: 4, left: -18, bottom: 0 }}
            >
              <defs>
                <linearGradient id="gIngresos" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--ok)" stopOpacity="0.30" />
                  <stop offset="100%" stopColor="var(--ok)" stopOpacity="0" />
                </linearGradient>
                <linearGradient id="gCostos" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor="var(--danger)"
                    stopOpacity="0.22"
                  />
                  <stop
                    offset="100%"
                    stopColor="var(--danger)"
                    stopOpacity="0"
                  />
                </linearGradient>
              </defs>

              <CartesianGrid
                strokeDasharray="2 4"
                stroke="var(--line)"
                vertical={false}
              />
              <XAxis
                dataKey="mes"
                tick={{ fontSize: 10, fill: "var(--muted)" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "var(--muted)" }}
                axisLine={false}
                tickLine={false}
                width={58}
                tickFormatter={(v: number) =>
                  Math.abs(v) >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`
                }
              />
              <Tooltip content={<TrendTooltip />} />

              <Area
                type="monotone"
                dataKey="ingresos"
                name="Ingresos"
                stroke="var(--ok)"
                strokeWidth={2}
                fill="url(#gIngresos)"
              />
              <Area
                type="monotone"
                dataKey="costos"
                name="Costos"
                stroke="var(--danger)"
                strokeWidth={2}
                fill="url(#gCostos)"
              />
              <Line
                type="monotone"
                dataKey="utilidad"
                name="Utilidad"
                stroke="var(--brand)"
                strokeWidth={2.4}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </ComposedChart>
          </ResponsiveContainer>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-3 pt-3 border-t border-line text-xs">
            <Legend color="var(--ok)" label="Ingresos" />
            <Legend color="var(--danger)" label="Costos" />
            <Legend color="var(--brand)" label="Utilidad" />
            <div className="flex-1" />
            {mejorMes && mejorMes.utilidad > 0 && (
              <span className="text-subtle">
                Mejor mes:{" "}
                <strong className="text-fg font-semibold">
                  {mejorMes.etiqueta}
                </strong>{" "}
                (${fmt(mejorMes.utilidad)})
              </span>
            )}
          </div>

          <div className="mt-3">
            <Sparkline
              values={utilidades}
              color={ultima >= 0 ? "var(--ok)" : "var(--danger)"}
              height={26}
              label="Tendencia de la utilidad mensual"
            />
          </div>
        </>
      )}
    </Card>
  )
}

/* --------------------------------------------------------------------- */

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-muted">
      <span
        className="w-2.5 h-2.5 rounded-full shrink-0"
        style={{ background: color }}
      />
      {label}
    </span>
  )
}

interface TooltipPayloadItem {
  name?: string
  value?: number
  color?: string
  payload?: { etiqueta?: string }
}

function TrendTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: TooltipPayloadItem[]
}) {
  if (!active || !payload || payload.length === 0) return null

  return (
    <div className="bg-surface border border-line rounded-xl shadow-modal px-3 py-2">
      <div className="text-[11px] font-bold text-fg mb-1">
        {payload[0]?.payload?.etiqueta}
      </div>
      {payload.map((item) => (
        <div
          key={item.name}
          className="flex items-center gap-2 text-[11px] text-muted"
        >
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ background: item.color }}
          />
          <span className="flex-1">{item.name}</span>
          <span className="tabular-nums font-semibold text-fg">
            ${fmt(item.value ?? 0)}
          </span>
        </div>
      ))}
    </div>
  )
}
