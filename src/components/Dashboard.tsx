import { useMemo, useState } from "react"
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import type { EmployeeSummary, PayPeriod } from "../types"
import {
  DAY_TYPE_META,
  DAY_TYPES,
  calcTotals,
  fmt,
  fmtHours,
  initials,
  pct,
} from "../utils/calculations"
import { exportPayslip } from "../utils/exportPayslip"
import Icon from "./Icon"
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  IconButton,
  SectionTitle,
  Segmented,
} from "./ui"
import type { Tone } from "./ui"

interface Props {
  summaries: EmployeeSummary[]
  period: PayPeriod
  companyName: string
  closed: boolean
  onNotify: (text: string, tone?: Tone) => void
}

type SortKey = "net" | "hours" | "name"

export default function Dashboard({
  summaries,
  period,
  companyName,
  closed,
  onNotify,
}: Props) {
  const [sort, setSort] = useState<SortKey>("net")
  const totals = useMemo(() => calcTotals(summaries), [summaries])

  const prof = summaries.filter((s) => s.employee.category === "profesional")
  const emp = summaries.filter((s) => s.employee.category === "empleado")
  const profTotal = prof.reduce((a, s) => a + s.netSalary, 0)
  const empTotal = emp.reduce((a, s) => a + s.netSalary, 0)

  const sorted = useMemo(() => {
    const copy = [...summaries]
    if (sort === "net") return copy.sort((a, b) => b.netSalary - a.netSalary)
    if (sort === "hours")
      return copy.sort(
        (a, b) =>
          b.regularHours + b.overtimeHours - (a.regularHours + a.overtimeHours),
      )
    return copy.sort((a, b) =>
      a.employee.name.localeCompare(b.employee.name, "es"),
    )
  }, [summaries, sort])

  // Solo los que efectivamente cobran: una barra de $0 no dice nada y roba altura.
  const barData = useMemo(
    () =>
      [...summaries]
        .filter((s) => s.netSalary > 0)
        .sort((a, b) => b.netSalary - a.netSalary)
        .slice(0, 10)
        .map((s) => ({
          name: s.employee.name.split(" ")[0],
          neto: +s.netSalary.toFixed(2),
        })),
    [summaries],
  )

  const pieData = [
    {
      name: "Serv. profesional",
      value: +profTotal.toFixed(2),
      color: "var(--violet)",
    },
    { name: "Empleados", value: +empTotal.toFixed(2), color: "var(--ok)" },
  ].filter((d) => d.value > 0)

  const dayTotals = useMemo(() => {
    const counts = {
      trabajo: 0,
      feriado: 0,
      vacaciones: 0,
      incapacidad: 0,
      ausencia: 0,
    }
    for (const s of summaries) {
      for (const t of DAY_TYPES) counts[t] += s.dayCounts[t]
    }
    return counts
  }, [summaries])

  function downloadPayslip(s: EmployeeSummary) {
    exportPayslip(s, period, companyName)
    onNotify(`Comprobante de ${s.employee.name.split(" ")[0]} descargado`)
  }

  if (summaries.length === 0) {
    return (
      <div className="space-y-6">
        <SectionTitle
          title="Dashboard"
          subtitle="Resumen de la quincena seleccionada"
        />
        <EmptyState
          icon="dashboard"
          title="Sin datos para este período"
          message="Agrega colaboradores y registra horas en la pestaña Registro Diario para ver el resumen."
        />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Dashboard"
        subtitle={
          <>
            {summaries.length} colaboradores · {totals.days} días trabajados
            {closed && (
              <Badge tone="amber" className="ml-2">
                <Icon name="lock" className="w-3 h-3" />
                Cerrada
              </Badge>
            )}
          </>
        }
      />

      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi
          label="Neto a pagar"
          value={`$${fmt(totals.net)}`}
          tone="ok"
          sub="Lo que sale de caja"
          emphasis
        />
        <Kpi
          label="Salario bruto"
          value={`$${fmt(totals.gross)}`}
          tone="brand"
          sub={`Base $${fmt(totals.regularPay)}`}
        />
        <Kpi
          label="Descuentos"
          value={`−$${fmt(totals.deductions)}`}
          tone="danger"
          sub={`SS $${fmt(totals.socialSecurity)} · Ed $${fmt(totals.education)}`}
        />
        <Kpi
          label="Horas totales"
          value={fmtHours(totals.hours)}
          tone="amber"
          sub={
            totals.overtimeHours > 0
              ? `${fmtHours(totals.overtimeHours)} en extras`
              : "Sin horas extra"
          }
        />
      </div>

      {/* Composición del costo: una barra apilada se lee de un vistazo. */}
      <Card>
        <CardHeader
          title="Composición del costo"
          subtitle={`Total bruto $${fmt(totals.gross)}`}
        />
        <div className="flex h-3 rounded-full overflow-hidden bg-sunken">
          <Segment
            value={totals.regularPay}
            total={totals.gross}
            className="bg-brand"
          />
          <Segment
            value={totals.overtimePay}
            total={totals.gross}
            className="bg-amber"
          />
          <Segment
            value={totals.holidayPay}
            total={totals.gross}
            className="bg-violet"
          />
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-3 text-xs">
          <LegendItem
            dot="bg-brand"
            label="Salario base"
            value={totals.regularPay}
            total={totals.gross}
          />
          <LegendItem
            dot="bg-amber"
            label="Horas extra"
            value={totals.overtimePay}
            total={totals.gross}
          />
          <LegendItem
            dot="bg-violet"
            label="Recargo feriado"
            value={totals.holidayPay}
            total={totals.gross}
          />
        </div>
      </Card>

      {/* Categorías + días */}
      <div className="grid gap-3 md:grid-cols-3">
        <CategoryCard
          label="Servicio profesional"
          tone="violet"
          amount={profTotal}
          count={prof.length}
          share={pct(profTotal, totals.net)}
          note="Sin descuentos"
        />
        <CategoryCard
          label="Empleados regulares"
          tone="ok"
          amount={empTotal}
          count={emp.length}
          share={pct(empTotal, totals.net)}
          note="Con descuentos de ley"
        />
        <Card>
          <CardHeader title="Días del período" />
          <ul className="space-y-1.5">
            {DAY_TYPES.filter((t) => dayTotals[t] > 0).map((t) => (
              <li key={t} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 text-muted">
                  <span className={`w-2 h-2 rounded-full ${DOT[t]}`} />
                  {DAY_TYPE_META[t].label}
                </span>
                <span className="font-mono font-bold text-fg">
                  {dayTotals[t]}
                </span>
              </li>
            ))}
            {DAY_TYPES.every((t) => dayTotals[t] === 0) && (
              <li className="text-xs text-subtle">
                Sin registros en el período
              </li>
            )}
          </ul>
        </Card>
      </div>

      {/* Gráficos */}
      <div className="grid gap-3 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader
            title="Neto por colaborador"
            subtitle="Los 10 mayores del período"
          />
          <ResponsiveContainer
            width="100%"
            height={Math.max(180, barData.length * 34)}
          >
            <BarChart
              data={barData}
              layout="vertical"
              margin={{ top: 0, right: 12, left: 0, bottom: 0 }}
            >
              <XAxis
                type="number"
                tick={{ fontSize: 10, fill: "var(--muted)" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={78}
                tick={{ fontSize: 11, fill: "var(--fg)" }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                content={<ChartTooltip />}
                cursor={{ fill: "var(--sunken)" }}
              />
              <Bar
                dataKey="neto"
                name="Neto"
                fill="var(--brand)"
                radius={[0, 5, 5, 0]}
                barSize={16}
              />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Distribución por tipo"
            subtitle="Sobre el neto a pagar"
          />
          {pieData.length >= 2 ? (
            <>
              <ResponsiveContainer width="100%" height={190}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={52}
                    outerRadius={78}
                    paddingAngle={2}
                    dataKey="value"
                    stroke="var(--surface)"
                    strokeWidth={2}
                  >
                    {pieData.map((d) => (
                      <Cell key={d.name} fill={d.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1.5 mt-1">
                {pieData.map((d) => (
                  <div
                    key={d.name}
                    className="flex items-center justify-between text-xs"
                  >
                    <span className="flex items-center gap-2 text-muted">
                      <span
                        className="w-2.5 h-2.5 rounded-sm"
                        style={{ background: d.color }}
                      />
                      {d.name}
                    </span>
                    <span className="font-mono font-bold text-fg">
                      ${fmt(d.value)}{" "}
                      <span className="text-subtle font-normal">
                        {pct(d.value, totals.net).toFixed(0)}%
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted py-8 text-center">
              Necesitas colaboradores de ambas categorías con pago en el
              período.
            </p>
          )}
        </Card>
      </div>

      {/* Tabla */}
      <Card padded={false}>
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-line flex-wrap">
          <h3 className="text-sm font-bold text-fg">Resumen por colaborador</h3>
          <Segmented
            value={sort}
            onChange={setSort}
            size="sm"
            options={[
              { value: "net" as SortKey, label: "Neto" },
              { value: "hours" as SortKey, label: "Horas" },
              { value: "name" as SortKey, label: "A–Z" },
            ]}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-raised">
                {[
                  "Colaborador",
                  "Días",
                  "H. reg.",
                  "H. extra",
                  "Base",
                  "Extras",
                  "Feriado",
                  "Descuentos",
                  "Neto",
                  "",
                ].map((h, i) => (
                  <th
                    key={h || i}
                    scope="col"
                    className={`px-3 py-2.5 text-xs font-bold text-muted uppercase tracking-wide whitespace-nowrap ${
                      i === 0 ? "text-left" : "text-right"
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((s) => (
                <tr
                  key={s.employee.id}
                  className="border-t border-line hover:bg-raised"
                >
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`w-7 h-7 rounded-full shrink-0 grid place-items-center text-white text-[10px] font-bold ${
                          s.employee.category === "profesional"
                            ? "bg-violet"
                            : "bg-ok"
                        }`}
                      >
                        {initials(s.employee.name)}
                      </span>
                      <span className="min-w-0">
                        <span className="block font-semibold text-fg truncate">
                          {s.employee.name}
                        </span>
                        <span className="block text-[11px] text-muted truncate">
                          {s.employee.position ||
                            (s.employee.category === "profesional"
                              ? "Serv. profesional"
                              : "Empleado")}
                        </span>
                      </span>
                    </div>
                  </td>
                  <Num>{s.daysWorked || "—"}</Num>
                  <Num>{fmtHours(s.regularHours)}</Num>
                  <Num tone={s.overtimeHours > 0 ? "text-amber" : undefined}>
                    {s.overtimeHours > 0 ? fmtHours(s.overtimeHours) : "—"}
                  </Num>
                  <Num>${fmt(s.regularPay)}</Num>
                  <Num
                    tone={
                      s.overtimePay > 0 ? "text-amber font-semibold" : undefined
                    }
                  >
                    {s.overtimePay > 0 ? `$${fmt(s.overtimePay)}` : "—"}
                  </Num>
                  <Num
                    tone={
                      s.holidayPay > 0 ? "text-violet font-semibold" : undefined
                    }
                  >
                    {s.holidayPay > 0 ? `$${fmt(s.holidayPay)}` : "—"}
                  </Num>
                  <Num tone={s.totalDeductions > 0 ? "text-danger" : undefined}>
                    {s.totalDeductions > 0
                      ? `−$${fmt(s.totalDeductions)}`
                      : "—"}
                  </Num>
                  <Num tone="text-ok font-bold">${fmt(s.netSalary)}</Num>
                  <td className="px-2 py-2.5 text-right">
                    <IconButton
                      icon="document"
                      tone="brand"
                      label={`Comprobante de pago de ${s.employee.name}`}
                      onClick={() => downloadPayslip(s)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-nav text-nav-fg">
                <td className="px-3 py-3 font-bold text-sm">TOTALES</td>
                <td className="px-3 py-3 text-right font-mono font-bold">
                  {totals.days}
                </td>
                <td className="px-3 py-3 text-right font-mono font-bold">
                  {fmtHours(totals.regularHours)}
                </td>
                <td className="px-3 py-3 text-right font-mono font-bold text-amber">
                  {fmtHours(totals.overtimeHours)}
                </td>
                <td className="px-3 py-3 text-right font-mono font-bold">
                  ${fmt(totals.regularPay)}
                </td>
                <td className="px-3 py-3 text-right font-mono font-bold text-amber">
                  ${fmt(totals.overtimePay)}
                </td>
                <td className="px-3 py-3 text-right font-mono font-bold text-violet">
                  ${fmt(totals.holidayPay)}
                </td>
                <td className="px-3 py-3 text-right font-mono font-bold text-danger">
                  −${fmt(totals.deductions)}
                </td>
                <td className="px-3 py-3 text-right font-mono font-bold text-ok">
                  ${fmt(totals.net)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </div>
  )
}

/* --------------------------------------------------------------------- */

const DOT: Record<string, string> = {
  trabajo: "bg-brand",
  feriado: "bg-violet",
  vacaciones: "bg-teal",
  incapacidad: "bg-amber",
  ausencia: "bg-danger",
}

const KPI_TONE: Record<Tone, string> = {
  brand: "text-brand",
  ok: "text-ok",
  danger: "text-danger",
  amber: "text-amber",
  violet: "text-violet",
  teal: "text-teal",
  muted: "text-fg",
}

function Kpi({
  label,
  value,
  sub,
  tone,
  emphasis,
}: {
  label: string
  value: string
  sub: string
  tone: Tone
  emphasis?: boolean
}) {
  return (
    <Card className={emphasis ? "ring-2 ring-ok/25" : ""}>
      <p className="text-[11px] text-muted uppercase tracking-wider font-semibold">
        {label}
      </p>
      <p
        className={`num mt-1.5 font-extrabold ${
          emphasis ? "text-3xl" : "text-2xl"
        } ${KPI_TONE[tone]}`}
      >
        {value}
      </p>
      <p className="text-[11px] text-subtle mt-1 truncate">{sub}</p>
    </Card>
  )
}

function Segment({
  value,
  total,
  className,
}: {
  value: number
  total: number
  className: string
}) {
  const width = pct(value, total)
  if (width <= 0) return null
  return <div className={className} style={{ width: `${width}%` }} />
}

function LegendItem({
  dot,
  label,
  value,
  total,
}: {
  dot: string
  label: string
  value: number
  total: number
}) {
  return (
    <span className="flex items-center gap-2">
      <span className={`w-2.5 h-2.5 rounded-sm ${dot}`} />
      <span className="text-muted">{label}</span>
      <span className="font-mono font-bold text-fg">${fmt(value)}</span>
      <span className="text-subtle">{pct(value, total).toFixed(0)}%</span>
    </span>
  )
}

function CategoryCard({
  label,
  tone,
  amount,
  count,
  share,
  note,
}: {
  label: string
  tone: Tone
  amount: number
  count: number
  share: number
  note: string
}) {
  return (
    <Card>
      <div className="flex items-center gap-2 mb-2">
        <span
          className={`w-2.5 h-2.5 rounded-full ${
            tone === "violet" ? "bg-violet" : "bg-ok"
          }`}
        />
        <span
          className={`text-[11px] font-bold uppercase tracking-wide ${KPI_TONE[tone]}`}
        >
          {label}
        </span>
      </div>
      <div className="num text-2xl font-extrabold text-fg">${fmt(amount)}</div>
      <div className="text-xs text-muted mt-1">
        {count} {count === 1 ? "colaborador" : "colaboradores"} · {note}
      </div>
      <div className="mt-3 h-1.5 rounded-full bg-sunken overflow-hidden">
        <div
          className={tone === "violet" ? "bg-violet h-full" : "bg-ok h-full"}
          style={{ width: `${Math.min(100, share)}%` }}
        />
      </div>
      <div className="text-[11px] text-subtle mt-1.5">
        {share.toFixed(1)}% del neto total
      </div>
    </Card>
  )
}

interface NumProps {
  children: React.ReactNode
  tone?: string
}

function Num({ children, tone }: NumProps) {
  return (
    <td
      className={`px-3 py-2.5 text-right font-mono whitespace-nowrap ${tone ?? "text-fg"}`}
    >
      {children}
    </td>
  )
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-surface border border-line rounded-xl px-3 py-2 shadow-modal text-xs">
      {label && <p className="font-bold text-fg mb-1">{label}</p>}
      {payload.map((p: any) => (
        <p key={p.name} className="font-mono text-muted">
          <span className="text-fg font-semibold">
            {p.name ?? p.payload?.name}
          </span>
          : ${fmt(p.value)}
        </p>
      ))}
    </div>
  )
}
