import { describe, expect, it } from "vitest"
import type { EmployeeSummary, Loan, PayPeriod } from "../types"
import {
  clearLoanCharges,
  distributeLoanCharge,
  installmentCount,
  loanDeductionFor,
  loanInstallmentFor,
  loanStatus,
  recordLoanCharges,
  totalOutstanding,
} from "./loans"

const ENERO_Q1: PayPeriod = { year: 2026, month: 1, half: 1 }
const ENERO_Q2: PayPeriod = { year: 2026, month: 1, half: 2 }
const FEBRERO_Q1: PayPeriod = { year: 2026, month: 2, half: 1 }
const FEBRERO_Q2: PayPeriod = { year: 2026, month: 2, half: 2 }

/** Préstamo de $100 en cuotas de $30 desde la primera quincena de enero. */
function loan(overrides: Partial<Loan> = {}): Loan {
  return {
    id: "loan-1",
    employeeId: "emp-1",
    date: "2026-01-05",
    amount: 100,
    installment: 30,
    startPeriodKey: "2026-01-1",
    charges: {},
    notes: "",
    active: true,
    ...overrides,
  }
}

describe("installmentCount", () => {
  it("redondea hacia arriba la última cuota parcial", () => {
    expect(installmentCount(loan())).toBe(4) // 30/30/30/10
  })

  it("devuelve cero sin cuota definida", () => {
    expect(installmentCount(loan({ installment: 0 }))).toBe(0)
  })
})

describe("loanInstallmentFor", () => {
  it("no descuenta antes de la quincena inicial", () => {
    expect(loanInstallmentFor(loan(), { year: 2025, month: 12, half: 2 })).toBe(
      0,
    )
  })

  it("descuenta la cuota completa mientras haya saldo", () => {
    expect(loanInstallmentFor(loan(), ENERO_Q1)).toBe(30)
    expect(loanInstallmentFor(loan(), ENERO_Q2)).toBe(30)
    expect(loanInstallmentFor(loan(), FEBRERO_Q1)).toBe(30)
  })

  it("recorta la última cuota a lo que queda", () => {
    expect(loanInstallmentFor(loan(), FEBRERO_Q2)).toBe(10)
  })

  it("deja de descontar una vez saldado", () => {
    expect(loanInstallmentFor(loan(), { year: 2026, month: 3, half: 1 })).toBe(0)
  })

  it("no descuenta si está inactivo", () => {
    expect(loanInstallmentFor(loan({ active: false }), ENERO_Q1)).toBe(0)
  })

  it("no descuenta sin cuota definida", () => {
    expect(loanInstallmentFor(loan({ installment: 0 }), ENERO_Q1)).toBe(0)
  })
})

describe("loanStatus", () => {
  it("acumula lo pagado quincena a quincena", () => {
    expect(loanStatus(loan(), ENERO_Q1).paid).toBe(30)
    expect(loanStatus(loan(), ENERO_Q2).paid).toBe(60)
    expect(loanStatus(loan(), FEBRERO_Q2).paid).toBe(100)
  })

  it("nunca reporta pagado de más", () => {
    const s = loanStatus(loan(), { year: 2027, month: 1, half: 1 })
    expect(s.paid).toBe(100)
    expect(s.balance).toBe(0)
    expect(s.settled).toBe(true)
  })

  it("calcula la quincena en que termina de pagarse", () => {
    expect(loanStatus(loan(), ENERO_Q1).finalPeriodKey).toBe("2026-02-2")
  })

  it("mantiene el saldo de un préstamo suspendido", () => {
    // Inactivo deja de cobrar, pero lo ya cobrado sigue contando.
    const suspendido = loan({ active: false })
    expect(loanStatus(suspendido, FEBRERO_Q2).currentInstallment).toBe(0)
  })
})

/* ------------------------------------------------------------------ */
/* El bug corregido: saldo real vs. saldo teórico                      */
/* ------------------------------------------------------------------ */

describe("saldo con cuotas cobradas de menos", () => {
  it("no da por saldado un préstamo al que se le descontó menos", () => {
    // La quincena de enero Q1 cerró descontando solo $5 de los $30 previstos
    // porque el neto no daba para más. Antes se asumía la cuota completa y el
    // préstamo quedaba saldado con $25 pendientes.
    const parcial = loan({ charges: { "2026-01-1": 5 } })

    expect(loanStatus(parcial, ENERO_Q1).paid).toBe(5)
    expect(loanStatus(parcial, ENERO_Q1).balance).toBe(95)
  })

  it("arrastra el faltante a las quincenas siguientes", () => {
    const parcial = loan({ charges: { "2026-01-1": 5 } })

    // 5 + 30 + 30 = 65 tras tres quincenas, no 90.
    expect(loanStatus(parcial, FEBRERO_Q1).paid).toBe(65)
    expect(loanStatus(parcial, FEBRERO_Q1).balance).toBe(35)
    // Y sigue cobrando donde antes ya se habría dado por saldado.
    expect(loanInstallmentFor(parcial, FEBRERO_Q2)).toBe(30)
  })

  it("respeta una quincena en la que no se descontó nada", () => {
    const sinCobro = loan({ charges: { "2026-01-1": 0 } })

    expect(loanStatus(sinCobro, ENERO_Q1).paid).toBe(0)
    expect(loanStatus(sinCobro, ENERO_Q2).paid).toBe(30)
  })

  it("ignora un registro corrupto que exceda el saldo", () => {
    const excesivo = loan({ charges: { "2026-01-1": 500 } })

    expect(loanStatus(excesivo, ENERO_Q1).paid).toBe(100)
    expect(loanStatus(excesivo, ENERO_Q1).balance).toBe(0)
  })
})

/* ------------------------------------------------------------------ */
/* Agregación entre varios préstamos                                   */
/* ------------------------------------------------------------------ */

describe("loanDeductionFor", () => {
  it("suma las cuotas de todos los préstamos del colaborador", () => {
    const loans = [loan(), loan({ id: "loan-2", installment: 20, amount: 40 })]
    expect(loanDeductionFor("emp-1", ENERO_Q1, loans)).toBe(50)
  })

  it("ignora los préstamos de otros colaboradores", () => {
    const loans = [loan(), loan({ id: "loan-2", employeeId: "emp-2" })]
    expect(loanDeductionFor("emp-1", ENERO_Q1, loans)).toBe(30)
  })

  it("devuelve cero sin préstamos", () => {
    expect(loanDeductionFor("emp-1", ENERO_Q1, [])).toBe(0)
  })
})

describe("totalOutstanding", () => {
  it("suma el saldo de toda la cartera", () => {
    const loans = [loan(), loan({ id: "loan-2", amount: 60, installment: 60 })]
    // enero Q1: al primero le quedan 70, el segundo se salda completo.
    expect(totalOutstanding(loans, ENERO_Q1)).toBe(70)
  })
})

/* ------------------------------------------------------------------ */
/* Registro de lo efectivamente descontado                             */
/* ------------------------------------------------------------------ */

function summary(loanDeduction: number, employeeId = "emp-1"): EmployeeSummary {
  return {
    employee: { id: employeeId } as EmployeeSummary["employee"],
    loanDeduction,
  } as EmployeeSummary
}

describe("distributeLoanCharge", () => {
  it("reparte el tope entre los préstamos en orden", () => {
    const loans = [loan(), loan({ id: "loan-2", installment: 20, amount: 40 })]
    // La planilla solo alcanzó a descontar 35 de los 50 previstos.
    expect(distributeLoanCharge("emp-1", ENERO_Q1, loans, 35)).toEqual({
      "loan-1": 30,
      "loan-2": 5,
    })
  })

  it("registra cero en todos los préstamos cuando no se descontó nada", () => {
    // Un cero explícito no es lo mismo que no tener registro: dice que esa
    // quincena ya se calculó y no abonó, en vez de asumir la cuota teórica.
    const loans = [loan(), loan({ id: "loan-2", installment: 20, amount: 40 })]
    expect(distributeLoanCharge("emp-1", ENERO_Q1, loans, 0)).toEqual({
      "loan-1": 0,
      "loan-2": 0,
    })
  })
})

describe("recordLoanCharges", () => {
  it("fija en el préstamo lo que la quincena descontó", () => {
    const loans = [loan()]
    const updated = recordLoanCharges(loans, [summary(12)], ENERO_Q1)

    expect(updated[0].charges).toEqual({ "2026-01-1": 12 })
    // No muta el original.
    expect(loans[0].charges).toEqual({})
  })

  it("no toca préstamos de colaboradores sin descuento", () => {
    const loans = [loan(), loan({ id: "loan-2", employeeId: "emp-2" })]
    const updated = recordLoanCharges(loans, [summary(30)], ENERO_Q1)

    expect(updated[0].charges).toEqual({ "2026-01-1": 30 })
    expect(updated[1].charges).toEqual({})
  })

  it("hace que el saldo refleje el cobro parcial", () => {
    const updated = recordLoanCharges([loan()], [summary(5)], ENERO_Q1)
    expect(loanStatus(updated[0], ENERO_Q1).balance).toBe(95)
  })
})

describe("clearLoanCharges", () => {
  it("borra el registro al reabrir la quincena", () => {
    const conCargo = loan({ charges: { "2026-01-1": 5, "2026-01-2": 30 } })
    const updated = clearLoanCharges([conCargo], ENERO_Q1)

    expect(updated[0].charges).toEqual({ "2026-01-2": 30 })
  })

  it("deja intactos los préstamos sin registro de esa quincena", () => {
    const loans = [loan()]
    expect(clearLoanCharges(loans, ENERO_Q1)[0]).toBe(loans[0])
  })
})
