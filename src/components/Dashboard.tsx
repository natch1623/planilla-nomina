import { useMemo, useState } from "react"
import type { Dispatch, ReactNode, SetStateAction } from "react"
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
import type { AppData, EmployeeSummary, PayPeriod, PayrollAdjustmentKind } from "../types"
import type { PayrollRules } from "../utils/calculations"
import { periodKey, shiftPeriod } from "../store"
import {
  DAY_TYPE_META,
  DAY_TYPES,
  calcPeriodSummaries,
  calcTotals,
  fmt,
  fmtHours,
  initials,
  pct,
} from "../utils/calculations"
import { currentMonthKey, monthKey, monthLabel } from "../utils/accounting"
import { costsMonthTotal } from "../utils/costs"
import { AnimatedNumber, Sparkline } from "./Metricas"
import TendenciaMensual from "./TendenciaMensual"
import EstadoResultados from "./EstadoResultados"
import Icon from "./Icon"
import {
  Button,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  IconButton,
  Modal,
  Field,
  SectionTitle,
  Segmented,
  inputClass,
  inputNumClass,
} from "./ui"
import type { Tone } from "./ui"

interface Props {
  summaries: EmployeeSummary[]
  period: PayPeriod
  companyName: string
  closed: boolean
  /** Datos completos, solo para el estado de resultados. */
  data: AppData
  rules: PayrollRules
  onNotify: (text: string, tone?: Tone) => void
  onChange: Dispatch<SetStateAction<AppData>>
}

type SortKey = "net" | "hours" | "name"

export default function Dashboard({
  summaries,
  period,
  companyName,
  closed,
  data,
  rules,
  onNotify,
  onChange,
}: Props) {
  const [sort, setSort] = useState<SortKey>("net")
  const [adjustingId, setAdjustingId] = useState<string | null>(null)
  const [adjustmentKind, setAdjustmentKind] = useState<PayrollAdjustmentKind>("bono")
  const [adjustmentAmount, setAdjustmentAmount] = useState("")
  const [adjustmentNote, setAdjustmentNote] = useState("")
  const totals = useMemo(() => calcTotals(summaries), [summaries])
  /** Todo lo devengado en la quincena: salario bruto más horas extra. */
  const earned = totals.gross + totals.overtimePay
  const periodAdjustments = useMemo(
    () =>
      data.manualAdjustments.filter(
        (a) => a.periodKey === periodKey(period),
      ),
    [data.manualAdjustments, period],
  )

  /**
   * Las ocho quincenas que terminan en la actual, para las minigráficas.
   *
   * Una quincena cerrada aporta su foto congelada y no un recálculo: si hoy
   * cambia una tarifa, el histórico tiene que seguir mostrando lo que se pagó.
   */
  const history = useMemo(() => {
    const rows: { pay: number; gross: number; hours: number }[] = []
    for (let back = 7; back >= 0; back--) {
      const p = shiftPeriod(period, -back)
      const frozen = data.closedPeriods.find((c) => c.key === periodKey(p))
      const sums =
        frozen?.summaries ??
        calcPeriodSummaries(
          data.employees,
          data.timeEntries,
          p,
          rules,
          data.loans,
          data.manualAdjustments,
        )
      const t = calcTotals(sums)
      rows.push({ pay: t.totalPay, gross: t.gross, hours: t.hours })
    }
    return rows
  }, [
    data.employees,
    data.timeEntries,
    data.closedPeriods,
    data.loans,
    data.manualAdjustments,
    period,
    rules,
  ])

  // Una serie con un solo punto útil no es una tendencia: sería una línea plana
  // con un salto al final, que sugiere una caída que nunca ocurrió.
  const trendOf = (pick: (r: (typeof history)[number]) => number): number[] => {
    const values = history.map(pick)
    return values.filter((v) => v > 0).length >= 2 ? values : []
  }

  const payTrend = trendOf((r) => r.pay)
  const grossTrend = trendOf((r) => r.gross)
  const hoursTrend = trendOf((r) => r.hours)

  const prof = summaries.filter((s) => s.employee.category === "profesional")
  const emp = summaries.filter((s) => s.employee.category === "empleado")
  const profTotal = prof.reduce((a, s) => a + s.totalPay, 0)
  const empTotal = emp.reduce((a, s) => a + s.totalPay, 0)

  const sorted = useMemo(() => {
    const copy = [...summaries]
    if (sort === "net") return copy.sort((a, b) => b.totalPay - a.totalPay)
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
        .filter((s) => s.totalPay > 0)
        .sort((a, b) => b.totalPay - a.totalPay)
        .slice(0, 10)
        .map((s) => ({
          name: s.employee.name.split(" ")[0],
          neto: +s.totalPay.toFixed(2),
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

  // Dinámico igual que en `App`: importarlo aquí arrastraba jsPDF al chunk
  // inicial y anulaba la división que hace el menú de exportación.
  async function downloadPayslip(s: EmployeeSummary) {
    try {
      const { exportPayslip } = await import("../utils/exportPayslip")
      exportPayslip(
        s,
        period,
        companyName,
        data.timeEntries,
        data.manualAdjustments,
        rules,
      )
      onNotify(`Comprobante de ${s.employee.name.split(" ")[0]} descargado`)
    } catch (err) {
      console.error("Falló el comprobante", err)
      onNotify("No se pudo generar el comprobante.", "danger")
    }
  }

  function openAdjustment(employeeId: string) {
    if (closed) {
      onNotify("La quincena está cerrada; no se pueden añadir ajustes.", "amber")
      return
    }
    setAdjustingId(employeeId)
    setAdjustmentKind("bono")
    setAdjustmentAmount("")
    setAdjustmentNote("")
  }

  function closeAdjustment() {
    setAdjustingId(null)
  }

  function saveAdjustment() {
    if (!adjustingId) return
    const amount = Number.parseFloat(adjustmentAmount)
    const note = adjustmentNote.trim()
    if (!Number.isFinite(amount) || amount <= 0) {
      onNotify("Escribe un monto válido para el ajuste.", "danger")
      return
    }
    if (!note) {
      onNotify("Agrega una nota para dejar claro el motivo.", "amber")
      return
    }

    const nextAmount = Math.round(amount * 100) / 100
    onChange((d) => ({
      ...d,
      manualAdjustments: [
        ...d.manualAdjustments,
        {
          id: crypto.randomUUID(),
          employeeId: adjustingId,
          periodKey: periodKey(period),
          kind: adjustmentKind,
          amount: nextAmount,
          note,
          createdAt: new Date().toISOString(),
        },
      ],
    }))
    closeAdjustment()
    onNotify(
      `${adjustmentKind === "bono" ? "Bono" : "Descuento"} manual guardado`,
      adjustmentKind === "bono" ? "ok" : "danger",
    )
  }

  function removeAdjustment(id: string) {
    onChange((d) => ({
      ...d,
      manualAdjustments: d.manualAdjustments.filter((a) => a.id !== id),
    }))
  }

  const activeEmployee = useMemo(
    () => summaries.find((s) => s.employee.id === adjustingId) ?? null,
    [adjustingId, summaries],
  )

  const activeEmployeeAdjustments = useMemo(() => {
    if (!adjustingId) return []
    return periodAdjustments
      .filter((a) => a.employeeId === adjustingId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }, [adjustingId, periodAdjustments])

  // El estado de resultados vive del mes calendario y de los movimientos, no de
  // la quincena: sigue teniendo algo que decir aunque la planilla vaya vacía.
  const estadoResultados = data.accountingEnabled ? (
    <>
      <EstadoResultados data={data} rules={rules} />
      <TendenciaMensual data={data} rules={rules} />
    </>
  ) : null

  // Sin Contabilidad activa no hay "utilidad" que mezclar: Caja se muestra
  // aparte, para no confundirla con el pago de planilla que domina el resto
  // del dashboard.
  const costosResumen =
    !data.accountingEnabled && data.costs.length > 0 ? (
      <CostosResumenCard costs={data.costs} />
    ) : null

  if (summaries.length === 0) {
    return (
      <div className="space-y-5">
        <SectionTitle
          title="Dashboard"
          subtitle={
            data.accountingEnabled
              ? "Resultado del mes y resumen de la quincena"
              : "Resumen de la quincena seleccionada"
          }
        />
        {estadoResultados}
        {costosResumen}
        <EmptyState
          icon="dashboard"
          title="Sin planilla para este período"
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

      {estadoResultados}
      {costosResumen}

      {data.accountingEnabled && (
        <div className="text-[10px] font-bold text-subtle uppercase tracking-widest pt-1">
          Planilla de la quincena
        </div>
      )}

      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi
          label="Total a pagar"
          amount={totals.totalPay}
          format={(n) => `$${fmt(n)}`}
          tone="ok"
          sub={`Neto $${fmt(totals.net)} + extras $${fmt(totals.overtimePay)}`}
          emphasis
          trend={payTrend}
          trendColor="var(--ok)"
        />
        <Kpi
          label="Salario bruto"
          amount={totals.gross}
          format={(n) => `$${fmt(n)}`}
          tone="brand"
          sub={`Base $${fmt(totals.regularPay)} · sin horas extra`}
          trend={grossTrend}
          trendColor="var(--brand)"
        />
        <Kpi
          label="Salario de horas extra"
          amount={totals.overtimePay}
          format={(n) => `$${fmt(n)}`}
          tone="amber"
          sub={
            totals.overtimeHours > 0
              ? `${fmtHours(totals.overtimeHours)} sobre la jornada`
              : "Sin horas extra"
          }
          trend={hoursTrend}
          trendColor="var(--amber)"
        />
        <Kpi
          label="Descuentos"
          amount={totals.deductions}
          format={(n) => `−$${fmt(n)}`}
          tone="danger"
          sub={
            // Cada descuento por su nombre: «SS $12 · Ed $2» obligaba a saberse
            // las siglas para leer la única cifra que el colaborador reclama.
            <span className="block">
              <span className="block">
                Seguro social −${fmt(totals.socialSecurity)}
              </span>
              <span className="block">
                Seguro educativo −${fmt(totals.education)}
              </span>
              {totals.loans > 0 && (
                <span className="block">Préstamos −${fmt(totals.loans)}</span>
              )}
            </span>
          }
        />
      </div>

      {/* Composición del costo: una barra apilada se lee de un vistazo. El
          denominador es lo devengado —salario más extras— y no el bruto: si no,
          la barra de horas extra se compararía contra un total que no las
          contiene y los porcentajes pasarían del 100 %. */}
      <Card>
        <CardHeader
          title="Composición del costo"
          subtitle={`Devengado $${fmt(earned)}`}
        />
        <div className="flex h-3 rounded-full overflow-hidden bg-sunken">
          <Segment
            value={totals.regularPay}
            total={earned}
            className="bg-brand"
          />
          <Segment
            value={totals.overtimePay}
            total={earned}
            className="bg-amber"
          />
          <Segment
            value={totals.holidayPay}
            total={earned}
            className="bg-violet"
          />
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-3 text-xs">
          <LegendItem
            dot="bg-brand"
            label="Salario base"
            value={totals.regularPay}
            total={earned}
          />
          <LegendItem
            dot="bg-amber"
            label="Horas extra"
            value={totals.overtimePay}
            total={earned}
          />
          <LegendItem
            dot="bg-violet"
            label="Recargo feriado"
            value={totals.holidayPay}
            total={earned}
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
          share={pct(profTotal, totals.totalPay)}
          note="Sin descuentos"
        />
        <CategoryCard
          label="Empleados regulares"
          tone="ok"
          amount={empTotal}
          count={emp.length}
          share={pct(empTotal, totals.totalPay)}
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
            title="Total a pagar por colaborador"
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
            subtitle="Sobre el total a pagar"
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
                        {pct(d.value, totals.totalPay).toFixed(0)}%
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
                  "Feriado",
                  "Seguro social",
                  "Seguro educativo",
                  "Otros desc.",
                  "Neto",
                  "Horas extra",
                  "Total a pagar",
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
                    <button
                      type="button"
                      onClick={() => openAdjustment(s.employee.id)}
                      className="flex items-center gap-2.5 text-left w-full"
                    >
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
                        {(() => {
                          // El monto aplicado, no el registrado: un descuento
                          // mayor que el neto se cobra recortado, y la fila
                          // tiene que decir lo mismo que el comprobante.
                          const total = s.manualAdjustment || 0
                          if (total === 0) return null
                          return (
                            <span
                              className={`block text-[11px] font-semibold ${total > 0 ? "text-ok" : "text-danger"}`}
                            >
                              {total > 0
                                ? `Bono manual +$${fmt(total)}`
                                : `Descuento manual −$${fmt(Math.abs(total))}`}
                            </span>
                          )
                        })()}
                      </span>
                    </button>
                  </td>
                  <Num>{s.daysWorked || "—"}</Num>
                  <Num>{fmtHours(s.regularHours)}</Num>
                  <Num tone={s.overtimeHours > 0 ? "text-amber" : undefined}>
                    {s.overtimeHours > 0 ? fmtHours(s.overtimeHours) : "—"}
                  </Num>
                  <Num>${fmt(s.regularPay)}</Num>
                  <Num
                    tone={
                      s.holidayPay > 0 ? "text-violet font-semibold" : undefined
                    }
                  >
                    {s.holidayPay > 0 ? `$${fmt(s.holidayPay)}` : "—"}
                  </Num>
                  <Num tone={s.socialSecurityDeduction > 0 ? "text-danger" : undefined}>
                    {s.socialSecurityDeduction > 0
                      ? `−$${fmt(s.socialSecurityDeduction)}`
                      : "—"}
                  </Num>
                  <Num tone={s.educationDeduction > 0 ? "text-danger" : undefined}>
                    {s.educationDeduction > 0
                      ? `−$${fmt(s.educationDeduction)}`
                      : "—"}
                  </Num>
                  <Num tone={s.loanDeduction > 0 ? "text-danger" : undefined}>
                    {s.loanDeduction > 0 ? `−$${fmt(s.loanDeduction)}` : "—"}
                  </Num>
                  <Num>${fmt(s.netSalary)}</Num>
                  <Num
                    tone={
                      s.overtimePay > 0 ? "text-amber font-semibold" : undefined
                    }
                  >
                    {s.overtimePay > 0 ? `$${fmt(s.overtimePay)}` : "—"}
                  </Num>
                  <Num tone="text-ok font-bold">${fmt(s.totalPay)}</Num>
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
                <td className="px-3 py-3 text-right font-mono font-bold text-violet">
                  ${fmt(totals.holidayPay)}
                </td>
                <td className="px-3 py-3 text-right font-mono font-bold text-danger">
                  −${fmt(totals.socialSecurity)}
                </td>
                <td className="px-3 py-3 text-right font-mono font-bold text-danger">
                  −${fmt(totals.education)}
                </td>
                <td className="px-3 py-3 text-right font-mono font-bold text-danger">
                  {totals.loans > 0 ? `−$${fmt(totals.loans)}` : "—"}
                </td>
                <td className="px-3 py-3 text-right font-mono font-bold">
                  ${fmt(totals.net)}
                </td>
                <td className="px-3 py-3 text-right font-mono font-bold text-amber">
                  ${fmt(totals.overtimePay)}
                </td>
                <td className="px-3 py-3 text-right font-mono font-bold text-ok">
                  ${fmt(totals.totalPay)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {adjustingId && activeEmployee && (
        <Modal
          title={`Ajuste manual · ${activeEmployee.employee.name}`}
          subtitle={
            closed
              ? "La quincena está cerrada y no admite cambios."
              : `Se aplicará a ${period.year}-${String(period.month).padStart(2, "0")}-${period.half}`
          }
          onClose={closeAdjustment}
          width="max-w-2xl"
          footer={
            <>
              <Button onClick={closeAdjustment} className="flex-1">
                Cancelar
              </Button>
              <Button
                onClick={saveAdjustment}
                variant="primary"
                className="flex-1"
                disabled={closed}
              >
                Guardar ajuste
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            {closed && (
              <div className="rounded-xl border border-amber/30 bg-amber-soft px-3 py-2 text-xs text-amber font-semibold">
                Esta quincena está cerrada; puedes revisar los ajustes, pero no
                añadir ni borrar.
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
              <Field label="Tipo de ajuste">
                <Segmented
                  value={adjustmentKind}
                  onChange={setAdjustmentKind}
                  options={[
                    { value: "bono" as const, label: "Bono" },
                    { value: "descuento" as const, label: "Descuento" },
                  ]}
                />
              </Field>
              <Field label="Monto">
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={adjustmentAmount}
                  onChange={(e) => setAdjustmentAmount(e.target.value)}
                  placeholder="0.00"
                  className={inputNumClass}
                />
              </Field>
            </div>
            <Field label="Nota" hint="Deja claro por qué se hizo el ajuste.">
              <textarea
                value={adjustmentNote}
                onChange={(e) => setAdjustmentNote(e.target.value)}
                placeholder="Ej. Bono por meta cumplida / Descuento por salida anticipada no justificada"
                rows={3}
                className={`${inputClass} min-h-[96px] resize-y`}
              />
            </Field>

            <div className="pt-2 border-t border-line">
              <div className="flex items-center justify-between gap-2 mb-2">
                <h4 className="text-sm font-bold text-fg">Ajustes de esta quincena</h4>
                <span className="text-xs text-muted">
                  {activeEmployeeAdjustments.length} registro(s)
                </span>
              </div>
              {activeEmployeeAdjustments.length > 0 ? (
                <div className="space-y-2">
                  {activeEmployeeAdjustments.map((adj) => (
                    <div
                      key={adj.id}
                      className="flex items-start gap-3 rounded-xl border border-line bg-raised px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge tone={adj.kind === "bono" ? "ok" : "danger"}>
                            {adj.kind === "bono" ? "Bono" : "Descuento"}
                          </Badge>
                          <span className="font-mono text-sm font-semibold text-fg">
                            {adj.kind === "bono" ? "+" : "-"}${fmt(adj.amount)}
                          </span>
                        </div>
                        <p className="text-sm text-muted mt-1">{adj.note}</p>
                      </div>
                      <IconButton
                        icon="trash"
                        label="Eliminar ajuste"
                        tone="danger"
                        onClick={() => removeAdjustment(adj.id)}
                        disabled={closed}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted">Todavía no hay ajustes para este colaborador.</p>
              )}
            </div>
          </div>
        </Modal>
      )}
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
  amount,
  format,
  sub,
  tone,
  emphasis,
  trend,
  trendColor,
}: {
  label: string
  amount: number
  /** Cómo se pinta la cifra; se aplica también a los valores intermedios. */
  format: (n: number) => string
  /** Pie de la tarjeta: admite varias líneas cuando hay que desglosar. */
  sub: ReactNode
  tone: Tone
  emphasis?: boolean
  /** Serie histórica opcional para la minigráfica del pie de la tarjeta. */
  trend?: number[]
  trendColor?: string
}) {
  return (
    <Card
      className={`relative overflow-hidden transition-shadow hover:shadow-pop ${
        emphasis ? "ring-2 ring-ok/25" : ""
      }`}
    >
      <p className="text-[11px] text-muted uppercase tracking-wider font-semibold">
        {label}
      </p>
      <AnimatedNumber
        value={amount}
        format={format}
        className={`num mt-1.5 block font-extrabold ${
          emphasis ? "text-3xl" : "text-2xl"
        } ${KPI_TONE[tone]}`}
      />
      <div className="text-[11px] text-subtle mt-1">{sub}</div>
      {trend && trend.length >= 2 && (
        <div className="-mx-4 -mb-4 mt-2 opacity-70">
          <Sparkline values={trend} color={trendColor} height={26} />
        </div>
      )}
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
        {share.toFixed(1)}% del total a pagar
      </div>
    </Card>
  )
}

/**
 * Aparece solo con Contabilidad apagada, y separado del bloque de planilla:
 * Caja es un registro aparte y no debe leerse mezclado con el pago a
 * colaboradores.
 */
function CostosResumenCard({ costs }: { costs: AppData["costs"] }) {
  const key = currentMonthKey()
  const month = costs.filter((c) => monthKey(c.date) === key)
  const cobros = month
    .filter((c) => c.kind === "cobro")
    .reduce((a, c) => a + c.amount, 0)
  const pagos = costsMonthTotal(costs, key)
  const balance = cobros - pagos

  return (
    <Card>
      <CardHeader
        title="Caja"
        subtitle={`${monthLabel(key)} · ${month.length} ${month.length === 1 ? "movimiento" : "movimientos"}`}
      />
      <div className="grid grid-cols-3 gap-3">
        <div>
          <span className="block text-xs text-muted">Cobros</span>
          <span className="num text-lg font-extrabold text-ok">
            +${fmt(cobros)}
          </span>
        </div>
        <div>
          <span className="block text-xs text-muted">Pagos</span>
          <span className="num text-lg font-extrabold text-danger">
            −${fmt(pagos)}
          </span>
        </div>
        <div>
          <span className="block text-xs text-muted">Balance</span>
          <span
            className={`num text-lg font-extrabold ${balance < 0 ? "text-danger" : "text-ok"}`}
          >
            {balance < 0 ? "−" : "+"}${fmt(Math.abs(balance))}
          </span>
        </div>
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
