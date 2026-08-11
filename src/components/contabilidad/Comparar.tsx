import { useMemo, useState } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { fmt } from "../../utils/calculations"
import type { MonthSummary } from "../../utils/accounting"
import { monthKey } from "../../utils/accounting"
import {
  COMPARE_LABEL,
  comparePeriods,
  groupTransactions,
  type CompareMode,
} from "../../utils/finance"
import Icon from "../Icon"
import { Card, CardHeader, Segmented } from "../ui"
import type { ViewProps } from "../Contabilidad"
import { AXIS_TICK, ChartTooltip, compactMoney } from "./shared"

interface Props extends ViewProps {
  series: MonthSummary[]
}

const MODES: CompareMode[] = ["mes", "trimestre", "semestre", "anio"]

export default function Comparar({ data, series }: Props) {
  const [mode, setMode] = useState<CompareMode>("mes")
  const cmp = useMemo(() => comparePeriods(series, mode), [series, mode])

  const chartData = [
    {
      name: "Ingresos",
      Anterior: +cmp.previous.ingresos.toFixed(2),
      Actual: +cmp.current.ingresos.toFixed(2),
    },
    {
      name: "Gastos",
      Anterior: +cmp.previous.gastosTotal.toFixed(2),
      Actual: +cmp.current.gastosTotal.toFixed(2),
    },
    {
      name: "Utilidad",
      Anterior: +cmp.previous.balance.toFixed(2),
      Actual: +cmp.current.balance.toFixed(2),
    },
  ]

  // Qué categorías explican el cambio: lo primero que uno quiere saber.
  const categoryShift = useMemo(() => {
    const inRange = (keys: string[]) =>
      data.transactions.filter(
        (t) => t.type === "gasto" && keys.includes(monthKey(t.date)),
      )
    const now = groupTransactions(
      inRange(cmp.current.months),
      "category",
      (k) => k || "Sin categoría",
    )
    const before = groupTransactions(
      inRange(cmp.previous.months),
      "category",
      (k) => k || "Sin categoría",
    )
    const beforeMap = new Map(before.map((g) => [g.key, g.amount]))
    const keys = new Set([
      ...now.map((g) => g.key),
      ...before.map((g) => g.key),
    ])

    return [...keys]
      .map((key) => {
        const actual = now.find((g) => g.key === key)?.amount ?? 0
        const anterior = beforeMap.get(key) ?? 0
        return {
          key,
          label: key || "Sin categoría",
          actual,
          anterior,
          diff: actual - anterior,
        }
      })
      .filter((r) => Math.abs(r.diff) > 0.005)
      .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
      .slice(0, 8)
  }, [data.transactions, cmp])

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Segmented
          value={mode}
          onChange={setMode}
          options={MODES.map((m) => ({ value: m, label: COMPARE_LABEL[m] }))}
        />
        <p className="text-xs text-muted">
          <strong className="text-fg">{cmp.current.label}</strong> contra{" "}
          <strong className="text-fg">{cmp.previous.label}</strong>
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <CompareCard
          label="Ingresos"
          current={cmp.current.ingresos}
          previous={cmp.previous.ingresos}
          delta={cmp.delta.ingresos}
          goodDirection="up"
        />
        <CompareCard
          label="Gastos"
          current={cmp.current.gastosTotal}
          previous={cmp.previous.gastosTotal}
          delta={cmp.delta.gastosTotal}
          goodDirection="down"
        />
        <CompareCard
          label="Utilidad"
          current={cmp.current.balance}
          previous={cmp.previous.balance}
          delta={cmp.delta.balance}
          goodDirection="up"
        />
      </div>

      <Card>
        <CardHeader
          title={`Comparación por ${COMPARE_LABEL[mode].toLowerCase()}`}
          subtitle="Período actual contra el inmediatamente anterior"
        />
        <ResponsiveContainer width="100%" height={280}>
          <BarChart
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
            <Bar
              dataKey="Anterior"
              fill="var(--line-strong)"
              radius={[4, 4, 0, 0]}
            />
            <Bar dataKey="Actual" fill="var(--brand)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card padded={false}>
        <div className="px-4 py-3 border-b border-line">
          <h3 className="text-sm font-bold text-fg">
            Qué explica el cambio en gastos
          </h3>
          <p className="text-xs text-muted mt-0.5">
            Categorías ordenadas por cuánto se movieron
          </p>
        </div>
        {categoryShift.length === 0 ? (
          <p className="px-4 py-8 text-sm text-muted text-center">
            No hay gastos registrados en ninguno de los dos períodos.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-raised">
                  {["Categoría", "Anterior", "Actual", "Diferencia"].map(
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
                {categoryShift.map((r) => (
                  <tr
                    key={r.key}
                    className="border-t border-line hover:bg-raised"
                  >
                    <td className="px-3 py-2.5 text-fg">{r.label}</td>
                    <td className="px-3 py-2.5 text-right num text-muted">
                      ${fmt(r.anterior)}
                    </td>
                    <td className="px-3 py-2.5 text-right num text-fg">
                      ${fmt(r.actual)}
                    </td>
                    <td
                      className={`px-3 py-2.5 text-right num font-bold whitespace-nowrap ${
                        r.diff > 0 ? "text-danger" : "text-ok"
                      }`}
                    >
                      <span className="inline-flex items-center gap-1">
                        <Icon
                          name={r.diff > 0 ? "trendUp" : "trendDown"}
                          className="w-3 h-3"
                        />
                        {r.diff > 0 ? "+" : "−"}${fmt(Math.abs(r.diff))}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function CompareCard({
  label,
  current,
  previous,
  delta,
  goodDirection,
}: {
  label: string
  current: number
  previous: number
  delta: number | null
  goodDirection: "up" | "down"
}) {
  const good =
    delta == null ? null : goodDirection === "up" ? delta >= 0 : delta <= 0

  return (
    <Card>
      <p className="text-[11px] text-muted uppercase tracking-wider font-semibold">
        {label}
      </p>
      <p className="num text-2xl font-extrabold text-fg mt-1.5">
        {current < 0 ? "−" : ""}${fmt(Math.abs(current))}
      </p>
      <p className="text-[11px] text-subtle mt-1">
        antes {previous < 0 ? "−" : ""}${fmt(Math.abs(previous))}
      </p>
      {delta != null ? (
        <p
          className={`flex items-center gap-1 text-xs mt-2 font-bold ${
            good ? "text-ok" : "text-danger"
          }`}
        >
          <Icon
            name={delta >= 0 ? "trendUp" : "trendDown"}
            className="w-3.5 h-3.5"
          />
          {delta >= 0 ? "+" : ""}
          {delta.toFixed(1)}%
        </p>
      ) : (
        <p className="text-xs mt-2 text-subtle">Sin base para comparar</p>
      )}
    </Card>
  )
}
