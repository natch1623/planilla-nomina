import type { EmployeeSummary, Loan, PayPeriod } from "../types"
import { periodFromIndex, periodIndex, periodKey } from "../store"

/**
 * Préstamos y adelantos a colaboradores.
 *
 * El saldo se reconstruye recorriendo las quincenas desde la primera cuota.
 * Cada una aporta lo que `charges` registró al cerrarse, y si no hay registro
 * —porque la quincena sigue abierta o es futura— aporta la cuota teórica.
 *
 * Derivarlo así, en vez de guardar un saldo mutable, hace que consultar el
 * pasado siempre dé el mismo número; y consultar `charges` en vez de multiplicar
 * la cuota por las quincenas transcurridas evita dar por saldado un préstamo al
 * que se le descontó de menos porque el neto de alguna quincena no alcanzaba.
 */

function startIndexOf(loan: Loan): number {
  const [year, month, half] = loan.startPeriodKey.split("-").map(Number)
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(half)
  ) {
    return 0
  }
  return periodIndex({ year, month, half: half === 2 ? 2 : 1 })
}

/** Cuántas cuotas hacen falta para cubrir el préstamo completo. */
export function installmentCount(loan: Loan): number {
  if (loan.installment <= 0) return 0
  return Math.ceil(loan.amount / loan.installment)
}

interface Progress {
  /** Descontado hasta el final de la quincena consultada, inclusive. */
  paid: number
  /** Lo que aporta esa última quincena. */
  current: number
}

/**
 * Recorre las quincenas desde la primera cuota hasta `upTo` acumulando lo
 * cobrado. La última cuota se recorta a lo que queda, para no cobrar de más por
 * el redondeo: un préstamo de $100 en cuotas de $30 descuenta 30/30/30/10.
 */
function progressUpTo(loan: Loan, upTo: PayPeriod): Progress {
  const empty = { paid: 0, current: 0 }
  if (loan.installment <= 0 || loan.amount <= 0) return empty

  const from = startIndexOf(loan)
  const to = periodIndex(upTo)
  if (to < from) return empty

  let paid = 0
  let current = 0

  for (let index = from; index <= to; index++) {
    const remaining = loan.amount - paid
    if (remaining <= 0) break

    const recorded = loan.charges[periodKey(periodFromIndex(index))]
    const charge =
      recorded === undefined
        ? Math.min(loan.installment, remaining)
        : Math.min(Math.max(0, recorded), remaining)

    paid += charge
    if (index === to) current = charge
  }

  return { paid, current }
}

/**
 * Cuota que le toca a este préstamo en una quincena concreta.
 *
 * Un préstamo inactivo —condonado o suspendido— deja de descontar, pero lo ya
 * cobrado sigue contando para el saldo.
 */
export function loanInstallmentFor(loan: Loan, period: PayPeriod): number {
  if (!loan.active) return 0
  return progressUpTo(loan, period).current
}

/** Total a descontar a un colaborador en la quincena, sumando sus préstamos. */
export function loanDeductionFor(
  employeeId: string,
  period: PayPeriod,
  loans: Loan[],
): number {
  return loansOf(employeeId, loans).reduce(
    (sum, l) => sum + loanInstallmentFor(l, period),
    0,
  )
}

/** Los préstamos de un colaborador, en orden estable para repartir el tope. */
function loansOf(employeeId: string, loans: Loan[]): Loan[] {
  return loans.filter((l) => l.employeeId === employeeId)
}

export interface LoanStatus {
  loan: Loan
  /** Cuánto se ha descontado hasta el final de `upTo`, inclusive. */
  paid: number
  balance: number
  /** Cuota que corresponde en `upTo`; 0 si ya está saldado o aún no empieza. */
  currentInstallment: number
  settled: boolean
  /** Quincena en la que termina de pagarse, si tiene cuota definida. */
  finalPeriodKey: string
}

export function loanStatus(loan: Loan, upTo: PayPeriod): LoanStatus {
  const { paid, current } = progressUpTo(loan, upTo)
  const balance = Math.max(0, loan.amount - paid)
  const count = installmentCount(loan)

  return {
    loan,
    paid: Math.min(paid, loan.amount),
    balance,
    currentInstallment: loan.active ? current : 0,
    settled: balance <= 0.005,
    finalPeriodKey:
      count > 0
        ? periodKey(periodFromIndex(startIndexOf(loan) + count - 1))
        : "",
  }
}

/** Saldo total pendiente de cobro a los colaboradores. */
export function totalOutstanding(loans: Loan[], upTo: PayPeriod): number {
  return loans.reduce((sum, l) => sum + loanStatus(l, upTo).balance, 0)
}

/**
 * Reparte entre los préstamos de un colaborador el monto que la planilla logró
 * descontarle de verdad.
 *
 * `calcEmployeeSummary` recorta la cuota cuando el neto no alcanza, y devuelve
 * un único total. Para saber a qué préstamo se le abonó qué, se reparte en el
 * mismo orden en que `loanDeductionFor` los sumó: cada uno toma lo suyo hasta
 * donde llegue el monto disponible.
 */
export function distributeLoanCharge(
  employeeId: string,
  period: PayPeriod,
  loans: Loan[],
  appliedTotal: number,
): Record<string, number> {
  const charges: Record<string, number> = {}
  let available = Math.max(0, appliedTotal)

  for (const loan of loansOf(employeeId, loans)) {
    const due = loanInstallmentFor(loan, period)
    if (due <= 0) continue
    // Se registra también el cero: "esta quincena no le abonó nada" es un dato,
    // y distinto de "esta quincena no tiene registro", que usa la cuota teórica.
    const charge = Math.min(due, available)
    charges[loan.id] = charge
    available -= charge
  }

  return charges
}

/**
 * Fija en los préstamos lo que la quincena descontó realmente. Se llama al
 * cerrar el período: hasta ese momento el monto todavía puede cambiar.
 */
export function recordLoanCharges(
  loans: Loan[],
  summaries: EmployeeSummary[],
  period: PayPeriod,
): Loan[] {
  const key = periodKey(period)
  const byLoan: Record<string, number> = {}

  for (const summary of summaries) {
    Object.assign(
      byLoan,
      distributeLoanCharge(
        summary.employee.id,
        period,
        loans,
        summary.loanDeduction,
      ),
    )
  }

  return loans.map((loan) => {
    const charge = byLoan[loan.id]
    if (charge === undefined) return loan
    return { ...loan, charges: { ...loan.charges, [key]: charge } }
  })
}

/** Borra el registro de una quincena al reabrirla: vuelve a ser hipotética. */
export function clearLoanCharges(loans: Loan[], period: PayPeriod): Loan[] {
  const key = periodKey(period)
  return loans.map((loan) => {
    if (loan.charges[key] === undefined) return loan
    const charges = { ...loan.charges }
    delete charges[key]
    return { ...loan, charges }
  })
}
