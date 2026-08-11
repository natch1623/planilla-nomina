import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { fmt } from "../../utils/calculations"
import { currentMonthKey, addMonths, monthLabel } from "../../utils/accounting"
import type { MonthSummary } from "../../utils/accounting"
import type {
  CashFlow,
  FinancialAlert,
  HealthReport,
} from "../../utils/finance"
import Icon from "../Icon"
import { Badge, Card, CardHeader } from "../ui"
import type { ViewProps } from "../Contabilidad"
import type { View } from "../Contabilidad"
import {
  ALERT_ICON,
  ALERT_TONE,
  AXIS_TICK,
  BarSegment,
  ChartTooltip,
  Kpi,
  LEVEL_TONE,
  LegendItem,
  TONE_FG,
  TONE_SOFT,
  compactMoney,
} from "./shared"

interface Props extends ViewProps {
  series: MonthSummary[]
  projected: MonthSummary[]
  cash: CashFlow
  health: HealthReport
  alerts: FinancialAlert[]
  onGoTo: (view: View) => void
}

export default function Resumen({
  series,
  cash,
  health,
  alerts,
  onGoTo,
}: Props) {
  const cur = currentMonthKey()
  const prev = addMonths(cur, -1)
  const mCur = series.find((m) => m.key === cur)
  const mPrev = series.find((m) => m.key === prev)

  const delta = (curr: number, previous: number) =>
    previous === 0 ? null : ((curr - previous) / Math.abs(previous)) * 100

  const chartData = series
    .filter((m) => m.key <= cur)
    .slice(-8)
    .map((m) => ({
      name: m.label,
      Ingresos: +m.ingresos.toFixed(2),
      Gastos: +m.gastosTotal.toFixed(2),
      Utilidad: +m.balance.toFixed(2),
    }))

  const ingresos = mCur?.ingresos ?? 0
  const gastos = mCur?.gastosTotal ?? 0
  const utilidad = mCur?.balance ?? 0

  return (
    <div className="space-y-5">
      {alerts.length > 0 && <Alertas alerts={alerts} />}

      {/* Indicadores principales del mes en curso */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi
          label="Dinero disponible"
          value={`${
            cash.saldoActual < 0 ? "−" : ""
          }$${fmt(Math.abs(cash.saldoActual))}`}
          tone={cash.saldoActual >= 0 ? "ok" : "danger"}
          icon="wallet"
          emphasis
          sub={
            <button
              onClick={() => onGoTo("flujo")}
              className="underline underline-offset-2 hover:no-underline"
            >
              Ver flujo de caja
            </button>
          }
        />
        <Kpi
          label={`Ingresos · ${monthLabel(cur)}`}
          value={`$${fmt(ingresos)}`}
          tone="ok"
          icon="trendUp"
          delta={delta(ingresos, mPrev?.ingresos ?? 0)}
          sub="Sin mes anterior para comparar"
        />
        <Kpi
          label={`Gastos · ${monthLabel(cur)}`}
          value={`$${fmt(gastos)}`}
          tone="danger"
          icon="trendDown"
          delta={delta(gastos, mPrev?.gastosTotal ?? 0)}
          deltaGoodDirection="down"
          sub="Sin mes anterior para comparar"
        />
        <Kpi
          label="Utilidad del mes"
          value={`${utilidad < 0 ? "−" : ""}$${fmt(Math.abs(utilidad))}`}
          tone={utilidad >= 0 ? "ok" : "danger"}
          icon="scale"
          sub={
            ingresos > 0
              ? `Margen ${((utilidad / ingresos) * 100).toFixed(1)}%`
              : "Sin ingresos este mes"
          }
        />
      </div>

      <Salud health={health} />

      <Card>
        <CardHeader
          title="Evolución del negocio"
          subtitle="Ingresos, gastos y utilidad de los últimos meses"
        />
        {chartData.length === 0 ? (
          <p className="text-sm text-muted py-8 text-center">
            Sin datos suficientes todavía.
          </p>
        ) : (
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
              <Bar dataKey="Ingresos" fill="var(--ok)" radius={[4, 4, 0, 0]} />
              <Bar
                dataKey="Gastos"
                fill="var(--danger)"
                radius={[4, 4, 0, 0]}
              />
              <Line
                type="monotone"
                dataKey="Utilidad"
                stroke="var(--brand)"
                strokeWidth={2.5}
                dot={{ r: 3 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Composición del gasto del mes"
          subtitle={`Total $${fmt(gastos)}`}
        />
        <div className="flex h-3 rounded-full overflow-hidden bg-sunken">
          <BarSegment
            value={mCur?.gastosNomina ?? 0}
            total={gastos}
            className="bg-amber"
          />
          <BarSegment
            value={mCur?.gastosManual ?? 0}
            total={gastos}
            className="bg-danger"
          />
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-3 text-xs">
          <LegendItem
            dot="bg-amber"
            label="Nómina"
            value={mCur?.gastosNomina ?? 0}
            total={gastos}
          />
          <LegendItem
            dot="bg-danger"
            label="Gastos operativos"
            value={mCur?.gastosManual ?? 0}
            total={gastos}
          />
        </div>
        {gastos === 0 && (
          <p className="text-xs text-subtle mt-3">
            Todavía no hay gastos registrados este mes.
          </p>
        )}
      </Card>
    </div>
  )
}

/* ------------------------------------------------------------ Alertas */

function Alertas({ alerts }: { alerts: FinancialAlert[] }) {
  return (
    <div className="space-y-2">
      {alerts.map((a) => {
        const tone = ALERT_TONE[a.level]
        return (
          <div
            key={a.id}
            className={`flex items-start gap-3 rounded-2xl border border-line p-3.5 ${TONE_SOFT[tone]}`}
            role={a.level === "critico" ? "alert" : undefined}
          >
            <Icon
              name={ALERT_ICON[a.level]}
              className="w-4 h-4 mt-0.5 shrink-0"
            />
            <div className="min-w-0">
              <p className="text-sm font-bold">{a.title}</p>
              <p className="text-xs opacity-90 mt-0.5 leading-relaxed">
                {a.detail}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* -------------------------------------------------- Salud del negocio */

function Salud({ health }: { health: HealthReport }) {
  const tone = LEVEL_TONE[health.level]
  const label: Record<string, string> = {
    bueno: "Saludable",
    atencion: "Requiere atención",
    riesgo: "En riesgo",
    sindatos: "Sin datos suficientes",
  }

  return (
    <Card>
      <CardHeader
        title="Salud del negocio"
        subtitle="Seis indicadores calculados sobre los meses ya cerrados"
        action={
          <div className="text-right shrink-0">
            <div className={`num text-3xl font-extrabold ${TONE_FG[tone]}`}>
              {health.level === "sindatos" ? "—" : health.score}
            </div>
            <Badge tone={tone}>{label[health.level]}</Badge>
          </div>
        }
      />
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {health.indicators.map((i) => {
          const t = LEVEL_TONE[i.level]
          return (
            <div
              key={i.id}
              className="rounded-xl border border-line p-3 bg-raised"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-muted uppercase tracking-wide">
                  {i.label}
                </span>
                <span className={`w-2 h-2 rounded-full shrink-0 ${DOT[t]}`} />
              </div>
              <div className={`num text-lg font-extrabold mt-1 ${TONE_FG[t]}`}>
                {i.display}
              </div>
              <p className="text-[11px] text-subtle mt-0.5 leading-snug">
                {i.hint}
              </p>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

const DOT: Record<string, string> = {
  brand: "bg-brand",
  ok: "bg-ok",
  danger: "bg-danger",
  amber: "bg-amber",
  violet: "bg-violet",
  teal: "bg-teal",
  muted: "bg-subtle",
}
