import type { AppData, PayPeriod, Transaction } from "../types"
import {
  calcPeriodSummaries,
  calcTotals,
  type PayrollRules,
} from "./calculations"
import { getPeriodDates, periodKey, shiftPeriod } from "../store"
import { todayISO } from "./dates"
import {
  addMonths,
  cashDate,
  currentMonthKey,
  monthEnd,
  monthKey,
  monthLabel,
  monthStart,
  occurrenceDates,
  payrollCommitted,
  payrollPaidThrough,
  type MonthSummary,
} from "./accounting"
import { totalOutstanding } from "./loans"

/* ==================================================== Flujo de caja */

export interface CashFlow {
  /** Dinero disponible hoy: saldo inicial más todo lo que ya se movió. */
  saldoActual: number
  openingBalance: number
  cobrado: number
  pagado: number
  nominaPagada: number

  /** Cuentas por cobrar. */
  porEntrar: number
  porEntrarVencido: number
  /** Cuentas por pagar más la nómina comprometida. */
  porSalir: number
  porSalirVencido: number
  gastosPendientes: number
  nominaComprometida: number

  /** Saldo si todo lo pendiente se cobra y se paga. */
  saldoProyectado: number
  /** Préstamos a colaboradores aún sin recuperar. */
  prestamosPorCobrar: number
}

export function calcCashFlow(
  data: AppData,
  rules: PayrollRules,
  today = todayISO(),
): CashFlow {
  let cobrado = 0
  let pagado = 0
  let porEntrar = 0
  let porEntrarVencido = 0
  let gastosPendientes = 0
  let porSalirVencido = 0

  for (const t of data.transactions) {
    const when = cashDate(t)
    if (t.status === "pagado") {
      // Un movimiento marcado como pagado con fecha futura todavía no movió
      // dinero: no puede inflar el saldo de hoy.
      if (when > today) continue
      if (t.type === "ingreso") cobrado += t.amount
      else pagado += t.amount
    } else {
      if (t.type === "ingreso") {
        porEntrar += t.amount
        if (when < today) porEntrarVencido += t.amount
      } else {
        gastosPendientes += t.amount
        if (when < today) porSalirVencido += t.amount
      }
    }
  }

  const nominaPagada = payrollPaidThrough(data, rules, today)
  const nominaComprometida = payrollCommitted(data, rules, today)
  const saldoActual = data.openingBalance + cobrado - pagado - nominaPagada
  const porSalir = gastosPendientes + nominaComprometida

  return {
    saldoActual,
    openingBalance: data.openingBalance,
    cobrado,
    pagado,
    nominaPagada,
    porEntrar,
    porEntrarVencido,
    porSalir,
    porSalirVencido,
    gastosPendientes,
    nominaComprometida,
    saldoProyectado: saldoActual + porEntrar - porSalir,
    prestamosPorCobrar: totalOutstanding(data.loans, data.currentPeriod),
  }
}

/* ============================================== Indicadores de salud */

export type HealthLevel = "bueno" | "atencion" | "riesgo" | "sindatos"

export interface Indicator {
  id: string
  label: string
  /** Valor ya formateado para mostrar. */
  display: string
  /** Valor numérico crudo, por si hace falta ordenar o graficar. */
  value: number
  hint: string
  level: HealthLevel
}

export interface HealthReport {
  indicators: Indicator[]
  /** 0–100. Promedio ponderado de los indicadores con datos. */
  score: number
  level: HealthLevel
  gastoMensualPromedio: number
  nominaMensualPromedio: number
}

/** Promedio de los últimos meses cerrados; el mes en curso va incompleto. */
function averageOfClosedMonths(
  series: MonthSummary[],
  pick: (m: MonthSummary) => number,
  months = 3,
): number {
  const cur = currentMonthKey()
  const closed = series.filter((m) => m.key < cur && !m.projected)
  const sample = closed.slice(-months)
  if (sample.length === 0) return 0
  return sample.reduce((a, m) => a + pick(m), 0) / sample.length
}

const LEVEL_SCORE: Record<HealthLevel, number> = {
  bueno: 100,
  atencion: 60,
  riesgo: 20,
  sindatos: 0,
}

export function calcHealth(
  data: AppData,
  series: MonthSummary[],
  cash: CashFlow,
  rules: PayrollRules,
): HealthReport {
  const cur = currentMonthKey()
  const prev = addMonths(cur, -1)
  const mCur = series.find((m) => m.key === cur)
  const mPrev = series.find((m) => m.key === prev)

  const gastoMensualPromedio =
    averageOfClosedMonths(series, (m) => m.gastosTotal) ||
    (mCur?.gastosTotal ?? 0)
  const nominaMensualPromedio =
    averageOfClosedMonths(series, (m) => m.gastosNomina) ||
    (mCur?.gastosNomina ?? 0)

  const indicators: Indicator[] = []

  // 1. Liquidez: cuántos meses aguanta la caja al ritmo de gasto actual.
  if (gastoMensualPromedio > 0) {
    const meses = cash.saldoActual / gastoMensualPromedio
    indicators.push({
      id: "liquidez",
      label: "Liquidez",
      display: meses >= 0 ? `${meses.toFixed(1)} meses` : "En negativo",
      value: meses,
      hint: "Cuánto aguanta la caja al ritmo de gasto actual",
      level: meses >= 3 ? "bueno" : meses >= 1 ? "atencion" : "riesgo",
    })
  } else {
    indicators.push(
      sinDatos("liquidez", "Liquidez", "Faltan gastos registrados"),
    )
  }

  // 2. Capacidad de cubrir la nómina con la caja disponible.
  if (nominaMensualPromedio > 0) {
    const veces = cash.saldoActual / nominaMensualPromedio
    indicators.push({
      id: "nomina",
      label: "Cobertura de nómina",
      display: veces >= 0 ? `${veces.toFixed(1)}×` : "Insuficiente",
      value: veces,
      hint: "Cuántas nóminas mensuales cubre la caja de hoy",
      level: veces >= 2 ? "bueno" : veces >= 1 ? "atencion" : "riesgo",
    })
  } else {
    indicators.push(
      sinDatos("nomina", "Cobertura de nómina", "Sin nómina registrada"),
    )
  }

  // 3. Rentabilidad: margen sobre los últimos meses cerrados.
  const ingresosProm = averageOfClosedMonths(series, (m) => m.ingresos)
  const balanceProm = averageOfClosedMonths(series, (m) => m.balance)
  if (ingresosProm > 0) {
    const margen = (balanceProm / ingresosProm) * 100
    indicators.push({
      id: "margen",
      label: "Margen de utilidad",
      display: `${margen.toFixed(1)}%`,
      value: margen,
      hint: "Utilidad sobre ingresos, promedio de meses cerrados",
      level: margen >= 15 ? "bueno" : margen >= 0 ? "atencion" : "riesgo",
    })
  } else {
    indicators.push(
      sinDatos("margen", "Margen de utilidad", "Sin ingresos registrados"),
    )
  }

  // 4. Crecimiento de ingresos mes contra mes.
  if (mPrev && mPrev.ingresos > 0 && mCur) {
    const crec = ((mCur.ingresos - mPrev.ingresos) / mPrev.ingresos) * 100
    indicators.push({
      id: "crecimiento",
      label: "Crecimiento de ingresos",
      display: `${crec >= 0 ? "+" : ""}${crec.toFixed(1)}%`,
      value: crec,
      hint: `${monthLabel(cur)} contra ${monthLabel(prev)}`,
      level: crec >= 0 ? "bueno" : crec >= -10 ? "atencion" : "riesgo",
    })
  } else {
    indicators.push(
      sinDatos(
        "crecimiento",
        "Crecimiento de ingresos",
        "Falta el mes anterior para comparar",
      ),
    )
  }

  // 5. Peso de la nómina sobre los ingresos.
  if (ingresosProm > 0 && nominaMensualPromedio > 0) {
    const carga = (nominaMensualPromedio / ingresosProm) * 100
    indicators.push({
      id: "carga",
      label: "Carga de nómina",
      display: `${carga.toFixed(1)}%`,
      value: carga,
      hint: "Parte de los ingresos que se va en salarios",
      level: carga <= 35 ? "bueno" : carga <= 55 ? "atencion" : "riesgo",
    })
  } else {
    indicators.push(
      sinDatos("carga", "Carga de nómina", "Faltan ingresos o nómina"),
    )
  }

  // 6. Cobranza: cuánto de lo facturado sigue sin cobrarse.
  const facturado = cash.cobrado + cash.porEntrar
  if (facturado > 0) {
    const pct = (cash.porEntrar / facturado) * 100
    indicators.push({
      id: "cobranza",
      label: "Pendiente de cobro",
      display: `${pct.toFixed(1)}%`,
      value: pct,
      hint: "Parte de lo facturado que aún no entra a caja",
      level: pct <= 15 ? "bueno" : pct <= 35 ? "atencion" : "riesgo",
    })
  } else {
    indicators.push(
      sinDatos("cobranza", "Pendiente de cobro", "Sin ingresos registrados"),
    )
  }

  const withData = indicators.filter((i) => i.level !== "sindatos")
  const score = withData.length
    ? Math.round(
        withData.reduce((a, i) => a + LEVEL_SCORE[i.level], 0) /
          withData.length,
      )
    : 0

  return {
    indicators,
    score,
    level:
      withData.length === 0
        ? "sindatos"
        : score >= 75
          ? "bueno"
          : score >= 45
            ? "atencion"
            : "riesgo",
    gastoMensualPromedio,
    nominaMensualPromedio,
  }
}

function sinDatos(id: string, label: string, hint: string): Indicator {
  return {
    id,
    label,
    display: "—",
    value: 0,
    hint,
    level: "sindatos",
  }
}

/* ============================================ Comparación de períodos */

export type CompareMode = "mes" | "trimestre" | "semestre" | "anio"

const COMPARE_MONTHS: Record<CompareMode, number> = {
  mes: 1,
  trimestre: 3,
  semestre: 6,
  anio: 12,
}

export const COMPARE_LABEL: Record<CompareMode, string> = {
  mes: "Mes",
  trimestre: "Trimestre",
  semestre: "Semestre",
  anio: "Año",
}

export interface AggregatedRange {
  label: string
  months: string[]
  ingresos: number
  gastosManual: number
  gastosNomina: number
  gastosTotal: number
  balance: number
  flujoNeto: number
}

function aggregate(
  series: MonthSummary[],
  keys: string[],
  label: string,
): AggregatedRange {
  const sel = series.filter((m) => keys.includes(m.key))
  const sum = (pick: (m: MonthSummary) => number) =>
    sel.reduce((a, m) => a + pick(m), 0)
  const ingresos = sum((m) => m.ingresos)
  const gastosManual = sum((m) => m.gastosManual)
  const gastosNomina = sum((m) => m.gastosNomina)
  return {
    label,
    months: keys,
    ingresos,
    gastosManual,
    gastosNomina,
    gastosTotal: gastosManual + gastosNomina,
    balance: ingresos - gastosManual - gastosNomina,
    flujoNeto: sum((m) => m.flujoNeto),
  }
}

export interface Comparison {
  current: AggregatedRange
  previous: AggregatedRange
  /** Variación porcentual por métrica; `null` cuando el período previo es 0. */
  delta: {
    ingresos: number | null
    gastosTotal: number | null
    balance: number | null
  }
}

function pctChange(curr: number, prev: number): number | null {
  if (prev === 0) return null
  return ((curr - prev) / Math.abs(prev)) * 100
}

/**
 * Compara el bloque de meses que termina en el mes actual contra el bloque
 * inmediatamente anterior del mismo tamaño.
 */
export function comparePeriods(
  series: MonthSummary[],
  mode: CompareMode,
): Comparison {
  const n = COMPARE_MONTHS[mode]
  const cur = currentMonthKey()

  const currentKeys: string[] = []
  for (let i = n - 1; i >= 0; i--) currentKeys.push(addMonths(cur, -i))
  const previousKeys: string[] = []
  for (let i = n * 2 - 1; i >= n; i--) previousKeys.push(addMonths(cur, -i))

  const label = (keys: string[]) =>
    keys.length === 1
      ? monthLabel(keys[0])
      : `${monthLabel(keys[0])} – ${monthLabel(keys[keys.length - 1])}`

  const current = aggregate(series, currentKeys, label(currentKeys))
  const previous = aggregate(series, previousKeys, label(previousKeys))

  return {
    current,
    previous,
    delta: {
      ingresos: pctChange(current.ingresos, previous.ingresos),
      gastosTotal: pctChange(current.gastosTotal, previous.gastosTotal),
      balance: pctChange(current.balance, previous.balance),
    },
  }
}

/* ==================================================== Presupuestos */

export interface BudgetStatus {
  id: string
  category: string
  limit: number
  spent: number
  remaining: number
  pct: number
  level: HealthLevel
}

/** Gasto real contra el techo definido, para un mes concreto. */
export function budgetStatuses(
  data: AppData,
  key = currentMonthKey(),
): BudgetStatus[] {
  return data.budgets.map((b) => {
    const spent = data.transactions
      .filter(
        (t) =>
          t.type === "gasto" &&
          t.category === b.category &&
          monthKey(t.date) === key,
      )
      .reduce((a, t) => a + t.amount, 0)
    const pct = b.monthlyLimit > 0 ? (spent / b.monthlyLimit) * 100 : 0
    return {
      id: b.id,
      category: b.category,
      limit: b.monthlyLimit,
      spent,
      remaining: b.monthlyLimit - spent,
      pct,
      level: pct <= 80 ? "bueno" : pct <= 100 ? "atencion" : "riesgo",
    }
  })
}

/* ================================================ Calendario financiero */

export type CalendarKind = "ingreso" | "gasto" | "nomina"

export interface CalendarEvent {
  id: string
  date: string
  kind: CalendarKind
  label: string
  amount: number
  /** `true` cuando es una repetición proyectada, no un registro real. */
  projected: boolean
  overdue: boolean
}

/**
 * Todo lo que mueve dinero entre dos fechas: movimientos pendientes, las
 * repeticiones de lo recurrente y el cierre de cada quincena de nómina.
 */
export function buildCalendar(
  data: AppData,
  rules: PayrollRules,
  from: string,
  to: string,
  today = todayISO(),
): CalendarEvent[] {
  const events: CalendarEvent[] = []

  for (const t of data.transactions) {
    const when = cashDate(t)
    if (t.status === "pendiente" && when >= from && when <= to) {
      events.push({
        id: `tx-${t.id}`,
        date: when,
        kind: t.type,
        label: t.description || t.category,
        amount: t.amount,
        projected: false,
        overdue: when < today,
      })
    }

    if (t.recurrence !== "ninguna") {
      for (const d of occurrenceDates(t, from, to)) {
        // La primera ocurrencia es el propio movimiento ya registrado.
        if (d === when) continue
        events.push({
          id: `rec-${t.id}-${d}`,
          date: d,
          kind: t.type,
          label: `${t.description || t.category} (recurrente)`,
          amount: t.amount,
          projected: true,
          overdue: false,
        })
      }
    }
  }

  // Nómina: una salida por quincena, el día en que cierra.
  let period = data.currentPeriod
  for (let i = -4; i <= 12; i++) {
    const p = shiftPeriod(period, i)
    const { end } = getPeriodDates(p)
    if (end < from || end > to) continue
    const key = periodKey(p)
    const closed = data.closedPeriods.find((c) => c.key === key)
    const amount = payrollForPeriod(data, rules, p)
    if (amount <= 0) continue
    events.push({
      id: `nom-${key}`,
      date: end,
      kind: "nomina",
      label: `Nómina ${key.slice(0, 7)} · Q${p.half}${
        closed ? " (cerrada)" : ""
      }`,
      amount,
      projected: end > today,
      overdue: false,
    })
  }

  return events.sort((a, b) => a.date.localeCompare(b.date))
}

/** Neto de una quincena concreta; 0 si no tiene registros. */
function payrollForPeriod(
  data: AppData,
  rules: PayrollRules,
  period: PayPeriod,
): number {
  const closed = data.closedPeriods.find((c) => c.key === periodKey(period))
  if (closed) return calcTotals(closed.summaries).totalPay

  const { start, end } = getPeriodDates(period)
  const hasEntries = data.timeEntries.some(
    (e) => e.date >= start && e.date <= end,
  )
  if (!hasEntries) return 0

  return calcTotals(
    calcPeriodSummaries(
      data.employees,
      data.timeEntries,
      period,
      rules,
      data.loans,
      data.manualAdjustments,
    ),
  ).totalPay
}

/* ======================================================== Alertas */

export type AlertLevel = "critico" | "aviso" | "info" | "bueno"

export interface FinancialAlert {
  id: string
  level: AlertLevel
  title: string
  detail: string
}

/**
 * Detecta problemas y oportunidades sobre los datos ya calculados. Cada regla
 * es independiente y solo se dispara cuando hay base para afirmarla: una alerta
 * que aparece con datos insuficientes enseña al usuario a ignorarlas todas.
 */
export function buildAlerts(
  data: AppData,
  series: MonthSummary[],
  projected: MonthSummary[],
  cash: CashFlow,
  health: HealthReport,
): FinancialAlert[] {
  const alerts: FinancialAlert[] = []
  const cur = currentMonthKey()
  const prev = addMonths(cur, -1)
  const mCur = series.find((m) => m.key === cur)
  const mPrev = series.find((m) => m.key === prev)

  // Caja en negativo: lo más grave que puede pasar.
  if (cash.saldoActual < 0) {
    alerts.push({
      id: "caja-negativa",
      level: "critico",
      title: "La caja está en negativo",
      detail:
        "Los pagos registrados superan lo cobrado más el saldo inicial. Revisa el saldo inicial en Configuración si falta declararlo.",
    })
  }

  // Liquidez insuficiente para la próxima nómina.
  if (
    health.nominaMensualPromedio > 0 &&
    cash.saldoActual >= 0 &&
    cash.saldoActual < health.nominaMensualPromedio
  ) {
    alerts.push({
      id: "nomina-riesgo",
      level: "critico",
      title: "La caja no cubre una nómina mensual",
      detail: `Hay $${fmtNum(cash.saldoActual)} disponibles y la nómina mensual promedia $${fmtNum(health.nominaMensualPromedio)}. Acelera la cobranza o pospón gastos no esenciales.`,
    })
  }

  // Proyección: el primer mes que cierra en rojo.
  const runningOut = firstNegativeMonth(cash.saldoActual, projected)
  if (runningOut) {
    alerts.push({
      id: "proyeccion-negativa",
      level: "aviso",
      title: `La liquidez se agotaría en ${runningOut.label}`,
      detail:
        "Según los compromisos ya registrados y el ritmo reciente, el saldo llegaría a negativo ese mes.",
    })
  }

  // Gastos disparados contra el mes anterior.
  if (mCur && mPrev && mPrev.gastosTotal > 0) {
    const change =
      ((mCur.gastosTotal - mPrev.gastosTotal) / mPrev.gastosTotal) * 100
    if (change >= 15) {
      alerts.push({
        id: "gastos-suben",
        level: "aviso",
        title: `Los gastos subieron ${change.toFixed(0)}% este mes`,
        detail: `Pasaron de $${fmtNum(mPrev.gastosTotal)} en ${monthLabel(prev)} a $${fmtNum(mCur.gastosTotal)} en ${monthLabel(cur)}.`,
      })
    } else if (change <= -15) {
      alerts.push({
        id: "gastos-bajan",
        level: "bueno",
        title: `Los gastos bajaron ${Math.abs(change).toFixed(0)}% este mes`,
        detail: `De $${fmtNum(mPrev.gastosTotal)} a $${fmtNum(mCur.gastosTotal)}. Buen momento para consolidar el ahorro.`,
      })
    }
  }

  // Ingresos cayendo.
  if (mCur && mPrev && mPrev.ingresos > 0) {
    const change = ((mCur.ingresos - mPrev.ingresos) / mPrev.ingresos) * 100
    if (change <= -20) {
      alerts.push({
        id: "ingresos-bajan",
        level: "aviso",
        title: `Los ingresos cayeron ${Math.abs(change).toFixed(0)}%`,
        detail: `De $${fmtNum(mPrev.ingresos)} en ${monthLabel(prev)} a $${fmtNum(mCur.ingresos)} en ${monthLabel(cur)}.`,
      })
    }
  }

  // Cobros vencidos.
  if (cash.porEntrarVencido > 0) {
    alerts.push({
      id: "cobros-vencidos",
      level: "aviso",
      title: `$${fmtNum(cash.porEntrarVencido)} vencidos sin cobrar`,
      detail:
        "Hay ingresos pendientes cuya fecha de cobro ya pasó. Reclamarlos es la vía más rápida de mejorar la caja.",
    })
  }

  // Pagos vencidos.
  if (cash.porSalirVencido > 0) {
    alerts.push({
      id: "pagos-vencidos",
      level: "critico",
      title: `$${fmtNum(cash.porSalirVencido)} vencidos sin pagar`,
      detail: "Hay gastos con fecha de pago ya cumplida que siguen pendientes.",
    })
  }

  // Presupuestos excedidos.
  for (const b of budgetStatuses(data)) {
    if (b.limit > 0 && b.pct > 100) {
      alerts.push({
        id: `presupuesto-${b.id}`,
        level: "aviso",
        title: `Presupuesto excedido: ${b.category}`,
        detail: `Llevas $${fmtNum(b.spent)} de un techo de $${fmtNum(b.limit)} (${b.pct.toFixed(0)}%).`,
      })
    }
  }

  // Concentración de ingresos en un solo cliente.
  const concentration = topClientShare(data)
  if (concentration && concentration.share >= 50) {
    alerts.push({
      id: "concentracion",
      level: "info",
      title: `${concentration.name} concentra el ${concentration.share.toFixed(0)}% de los ingresos`,
      detail:
        "Depender de un solo cliente es un riesgo: si se va, el golpe es inmediato.",
    })
  }

  // Buen margen sostenido.
  const margen = health.indicators.find((i) => i.id === "margen")
  if (margen && margen.level === "bueno" && alerts.length === 0) {
    alerts.push({
      id: "margen-bueno",
      level: "bueno",
      title: `Margen saludable de ${margen.display}`,
      detail:
        "El negocio genera utilidad de forma sostenida. Considera destinar parte al fondo de reserva.",
    })
  }

  return alerts
}

function firstNegativeMonth(
  startBalance: number,
  projected: MonthSummary[],
): MonthSummary | null {
  let running = startBalance
  for (const m of projected) {
    running += m.flujoNeto
    if (running < 0) return m
  }
  return null
}

interface ClientShare {
  name: string
  share: number
}

function topClientShare(data: AppData): ClientShare | null {
  const totals = new Map<string, number>()
  let grand = 0
  for (const t of data.transactions) {
    if (t.type !== "ingreso" || !t.counterpartyId) continue
    totals.set(t.counterpartyId, (totals.get(t.counterpartyId) ?? 0) + t.amount)
    grand += t.amount
  }
  if (grand <= 0 || totals.size < 2) return null

  let bestId = ""
  let best = 0
  for (const [id, amount] of totals) {
    if (amount > best) {
      best = amount
      bestId = id
    }
  }
  const cp = data.counterparties.find((c) => c.id === bestId)
  if (!cp) return null
  return { name: cp.name, share: (best / grand) * 100 }
}

function fmtNum(n: number): string {
  return new Intl.NumberFormat("es-PA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0)
}

/* ========================================================= Metas */

export interface GoalProgress {
  id: string
  title: string
  kind: string
  target: number
  achieved: number
  pct: number
  monthsLeft: number
  onTrack: boolean
}

/**
 * Avance de cada meta desde su creación hasta hoy. El "logrado" depende del
 * tipo: ahorrar mide el flujo neto acumulado, reducir gastos mide cuánto
 * bajaron contra el mes de partida, y aumentar ingresos mide el crecimiento.
 */
export function goalProgress(
  data: AppData,
  series: MonthSummary[],
): GoalProgress[] {
  const cur = currentMonthKey()

  return data.goals.map((g) => {
    const from = g.createdAt ? monthKey(g.createdAt) : cur
    const window = series.filter((m) => m.key >= from && m.key <= cur)
    const baseline = series.find((m) => m.key === from)

    let achieved = 0
    if (g.kind === "ahorro") {
      achieved = window.reduce((a, m) => a + m.flujoNeto, 0)
    } else if (g.kind === "reducir-gastos") {
      const last = window[window.length - 1]
      achieved =
        baseline && last
          ? Math.max(0, baseline.gastosTotal - last.gastosTotal)
          : 0
    } else {
      const last = window[window.length - 1]
      achieved =
        baseline && last ? Math.max(0, last.ingresos - baseline.ingresos) : 0
    }

    const pct = g.target > 0 ? (achieved / g.target) * 100 : 0
    const monthsLeft = g.deadline ? monthsUntil(cur, g.deadline) : 0
    const elapsed = window.length || 1
    const expectedPct =
      monthsLeft > 0 ? (elapsed / (elapsed + monthsLeft)) * 100 : 100

    return {
      id: g.id,
      title: g.title,
      kind: g.kind,
      target: g.target,
      achieved,
      pct,
      monthsLeft,
      onTrack: pct >= expectedPct,
    }
  })
}

function monthsUntil(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number)
  const [ty, tm] = to.split("-").map(Number)
  return Math.max(0, (ty - fy) * 12 + (tm - fm))
}

/* ============================================ Agrupaciones auxiliares */

export interface GroupTotal {
  key: string
  label: string
  amount: number
  count: number
}

/** Agrupa movimientos por categoría, contraparte o etiqueta. */
export function groupTransactions(
  transactions: Transaction[],
  by: "category" | "counterparty" | "tag" | "method",
  labelFor: (key: string) => string,
): GroupTotal[] {
  const map = new Map<string, GroupTotal>()

  const add = (key: string, amount: number) => {
    const existing = map.get(key)
    if (existing) {
      existing.amount += amount
      existing.count += 1
    } else {
      map.set(key, { key, label: labelFor(key), amount, count: 1 })
    }
  }

  for (const t of transactions) {
    if (by === "tag") {
      // Un movimiento sin etiquetas no debe desaparecer del agrupado.
      if (t.tags.length === 0) add("", t.amount)
      else for (const tag of t.tags) add(tag, t.amount)
    } else if (by === "category") add(t.category, t.amount)
    else if (by === "counterparty") add(t.counterpartyId, t.amount)
    else add(t.paymentMethod, t.amount)
  }

  return [...map.values()].sort((a, b) => b.amount - a.amount)
}

export { monthStart, monthEnd }
