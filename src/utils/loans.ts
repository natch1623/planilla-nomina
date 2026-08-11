import type { Loan, PayPeriod } from "../types"
import { periodFromIndex, periodIndex, periodKey } from "../store"

/**
 * Préstamos y adelantos a colaboradores.
 *
 * El saldo no se guarda: se deriva del número de quincenas transcurridas desde
 * la primera cuota. Guardar un saldo mutable obligaría a "rehacer los pagos"
 * cada vez que se corrige una fecha o se reabre una quincena, y bastaría un
 * recálculo perdido para que un préstamo quedara cobrado de más o de menos.
 * Derivarlo hace que consultar el pasado siempre dé el mismo número.
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

/**
 * Cuota que le toca a este préstamo en una quincena concreta.
 *
 * La última cuota se recorta a lo que queda, para no cobrar de más por el
 * redondeo: un préstamo de $100 en cuotas de $30 descuenta 30/30/30/10.
 */
export function loanInstallmentFor(loan: Loan, period: PayPeriod): number {
  if (!loan.active || loan.installment <= 0 || loan.amount <= 0) return 0

  const elapsed = periodIndex(period) - startIndexOf(loan)
  if (elapsed < 0) return 0

  const alreadyCharged = loan.installment * elapsed
  const remaining = loan.amount - alreadyCharged
  if (remaining <= 0) return 0

  return Math.min(loan.installment, remaining)
}

/** Total a descontar a un colaborador en la quincena, sumando sus préstamos. */
export function loanDeductionFor(
  employeeId: string,
  period: PayPeriod,
  loans: Loan[],
): number {
  return loans
    .filter((l) => l.employeeId === employeeId)
    .reduce((sum, l) => sum + loanInstallmentFor(l, period), 0)
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
  const elapsed = periodIndex(upTo) - startIndexOf(loan) + 1
  const charged =
    loan.installment > 0 ? loan.installment * Math.max(0, elapsed) : 0
  const paid = Math.min(loan.amount, Math.max(0, charged))
  const balance = Math.max(0, loan.amount - paid)
  const count = installmentCount(loan)

  return {
    loan,
    paid,
    balance,
    currentInstallment: loanInstallmentFor(loan, upTo),
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
