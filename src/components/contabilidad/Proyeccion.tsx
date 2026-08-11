import { useMemo } from "react"
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { fmt } from "../../utils/calculations"
import {
  cashDate,
  currentMonthKey,
  monthKey,
  occurrencesInMonth,
  type MonthSummary,
} from "../../utils/accounting"
import type { CashFlow } from "../../utils/finance"
import { todayISO } from "../../utils/dates"
import { Badge, Card, CardHeader } from "../ui"
import type { ViewProps } from "../Contabilidad"
import { AXIS_TICK, ChartTooltip, Kpi, compactMoney } from "./shared"

interface Props extends ViewProps {
  series: MonthSummary[]
  projected: MonthSummary[]
  cash: CashFlow
}

export default function Proyeccion({ data, series, projected, cash }: Props) {
  const cur = currentMonthKey()
  const today = todayISO()

  const history = series.filter((m) => m.key <= cur).slice(-6)
  const chartData = [...history, ...projected].map((m) => ({
    name: m.label,
    Ingresos: +m.ingresos.toFixed(2),
    Gastos: +m.gastosTotal.toFixed(2),
    Utilidad: +m.balance.toFixed(2),
    projected: m.projected,
  }))

  const next = projected[0]

  // Desglose de qué sostiene la proyección del próximo mes.
  const sources = useMemo(() => {
    if (!next) return { comprometido: 0, recurrente: 0 }
    const comprometido = data.transactions
      .filter((t) => t.status === "pendiente")
      .filter((t) => {
        const due = cashDate(t)
        return due > today && monthKey(due) === next.key
      })
      .reduce((a, t) => a + (t.type === "ingreso" ? t.amount : -t.amount), 0)

    const recurrente = data.transactions
      .filter((t) => t.recurrence !== "ninguna")
      .reduce((a, t) => {
        const times = occurrencesInMonth(t, next.key)
        return a + (t.type === "ingreso" ? 1 : -1) * t.amount * times
      }, 0)

    return { comprometido, recurrente }
  }, [data.transactions, next, today])

  if (!next) {
    return (
      <p className="text-sm text-muted py-8 text-center">
        No hay datos suficientes para proyectar.
      </p>
    )
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi
          label={`Balance proyectado · ${next.label}`}
          value={`${
            next.balance < 0 ? "−" : ""
          }$${fmt(Math.abs(next.balance))}`}
          tone={next.balance >= 0 ? "ok" : "danger"}
          icon="trendUp"
          emphasis
          sub="Ingresos menos gastos del próximo mes"
        />
        <Kpi
          label="Ingresos proyectados"
          value={`$${fmt(next.ingresos)}`}
          tone="ok"
          sub="Compromisos + recurrentes + promedio"
        />
        <Kpi
          label="Gastos proyectados"
          value={`$${fmt(next.gastosTotal)}`}
          tone="danger"
          sub={`Nómina estimada $${fmt(next.gastosNomina)}`}
        />
        <Kpi
          label="Caja al cierre del período"
          value={`${
            cierre(cash.saldoActual, projected) < 0 ? "−" : ""
          }$${fmt(Math.abs(cierre(cash.saldoActual, projected)))}`}
          tone={cierre(cash.saldoActual, projected) >= 0 ? "ok" : "danger"}
          icon="wallet"
          sub={`Tras ${projected.length} meses proyectados`}
        />
      </div>

      <Card>
        <CardHeader
          title="Histórico y proyección"
          subtitle="Las barras claras son estimaciones, no cierres reales"
        />
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart
            data={chartData}
            margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--line)"
              vertical={false}
            />
            <XAxis
              dataKey="name"
              tick={AXIS_TICK}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={AXIS_TICK}
              axisLine={false}
              tickLine={false}
              tickFormatter={compactMoney}
              width={62}
            />
            <Tooltip
              content={<ChartTooltip />}
              cursor={{ fill: "var(--sunken)" }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="Ingresos" radius={[4, 4, 0, 0]}>
              {chartData.map((d, i) => (
                <Cell
                  key={i}
                  fill="var(--ok)"
                  fillOpacity={d.projected ? 0.4 : 1}
                />
              ))}
            </Bar>
            <Bar dataKey="Gastos" radius={[4, 4, 0, 0]}>
              {chartData.map((d, i) => (
                <Cell
                  key={i}
                  fill="var(--danger)"
                  fillOpacity={d.projected ? 0.4 : 1}
                />
              ))}
            </Bar>
            <Line
              type="monotone"
              dataKey="Utilidad"
              stroke="var(--brand)"
              strokeWidth={2.5}
              strokeDasharray="0"
              dot={{ r: 3 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </Card>

      <Card>
        <CardHeader
          title={`En qué se apoya la proyección de ${next.label}`}
          subtitle="De lo más firme a lo más incierto"
        />
        <ul className="space-y-2.5">
          <SourceRow
            title="Compromisos ya registrados"
            detail="Movimientos pendientes con vencimiento en ese mes"
            value={sources.comprometido}
            strength="Firme"
            tone="ok"
          />
          <SourceRow
            title="Movimientos recurrentes"
            detail="Alquileres, cuotas y cobros que se repiten"
            value={sources.recurrente}
            strength="Probable"
            tone="brand"
          />
          <SourceRow
            title="Promedio de meses recientes"
            detail="Lo puntual que no está cubierto por lo anterior"
            value={
              next.ingresos -
              next.gastosTotal -
              sources.comprometido -
              sources.recurrente
            }
            strength="Estimado"
            tone="amber"
          />
        </ul>
      </Card>

      <Card padded={false}>
        <div className="px-4 py-3 border-b border-line">
          <h3 className="text-sm font-bold text-fg">
            Próximos {projected.length} meses
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-raised">
                {["Mes", "Ingresos", "Gastos", "Balance", "Caja acumulada"].map(
                  (h, i) => (
                    <th
                      key={h}
                      scope="col"
                      className={`px-3 py-2.5 text-xs font-bold text-muted uppercase tracking-wide whitespace-nowrap ${
                        i === 0 ? "text-left" : "text-right"
                      }`}
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {runningRows(cash.saldoActual, projected).map((r) => (
                <tr key={r.key} className="border-t border-line">
                  <td className="px-3 py-2.5 font-semibold text-fg whitespace-nowrap">
                    {r.label}
                    <Badge tone="brand" className="ml-2">
                      Estimado
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5 text-right num text-ok">
                    ${fmt(r.ingresos)}
                  </td>
                  <td className="px-3 py-2.5 text-right num text-danger">
                    ${fmt(r.gastosTotal)}
                  </td>
                  <td
                    className={`px-3 py-2.5 text-right num font-bold ${
                      r.balance >= 0 ? "text-ok" : "text-danger"
                    }`}
                  >
                    {r.balance >= 0 ? "" : "−"}${fmt(Math.abs(r.balance))}
                  </td>
                  <td
                    className={`px-3 py-2.5 text-right num font-bold ${
                      r.running >= 0 ? "text-fg" : "text-danger"
                    }`}
                  >
                    {r.running >= 0 ? "" : "−"}${fmt(Math.abs(r.running))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-3 text-[11px] text-subtle border-t border-line leading-relaxed">
          La proyección suma los compromisos ya registrados con vencimiento
          futuro, expande los movimientos recurrentes a sus fechas reales y
          completa con el promedio de los meses recientes. Ajústala registrando
          movimientos o marcando su recurrencia en la pestaña Movimientos.
        </p>
      </Card>
    </div>
  )
}

function runningRows(start: number, projected: MonthSummary[]) {
  let running = start
  return projected.map((m) => {
    running += m.flujoNeto
    return { ...m, running }
  })
}

function cierre(start: number, projected: MonthSummary[]): number {
  return projected.reduce((acc, m) => acc + m.flujoNeto, start)
}

function SourceRow({
  title,
  detail,
  value,
  strength,
  tone,
}: {
  title: string
  detail: string
  value: number
  strength: string
  tone: "ok" | "brand" | "amber"
}) {
  return (
    <li className="flex items-start justify-between gap-3 rounded-xl border border-line p-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-fg">{title}</span>
          <Badge tone={tone}>{strength}</Badge>
        </div>
        <p className="text-[11px] text-subtle mt-0.5">{detail}</p>
      </div>
      <span
        className={`num font-bold shrink-0 ${
          value >= 0 ? "text-ok" : "text-danger"
        }`}
      >
        {value >= 0 ? "+" : "−"}${fmt(Math.abs(value))}
      </span>
    </li>
  )
}
