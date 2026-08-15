import { describe, expect, it } from "vitest"
import type { Employee, TimeEntry } from "../types"
import type { PayrollRules } from "./calculations"
import {
  calcEmployeeSummary,
  calcTotals,
  calcWorkedHours,
  fmtHours,
  pct,
  spanHours,
  splitHours,
} from "./calculations"
import { defaultWeeklySchedule } from "../store"

/* ------------------------------------------------------------------ */
/* Ayudantes                                                           */
/* ------------------------------------------------------------------ */

const RULES: PayrollRules = {
  overtimeThreshold: 8,
  standardDayHours: 8,
  holidayRate: 1.5,
  payVacations: true,
  payHolidays: true,
  paySickLeave: false,
}

function employee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: "emp-1",
    name: "Juan Pérez",
    idNumber: "8-123-456",
    position: "Técnico",
    startDate: "2026-01-01",
    category: "empleado",
    paymentType: "hourly",
    hourlyRate: 10,
    dailyRate: 0,
    fixedSalary: 0,
    schedule: defaultWeeklySchedule(),
    socialSecurityRate: 9.75,
    educationRate: 1.25,
    active: true,
    ...overrides,
  }
}

function entry(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: "te-1",
    employeeId: "emp-1",
    date: "2026-08-03",
    dayType: "trabajo",
    entryTime: "08:00",
    exitTime: "17:00",
    lunchBreak: true,
    lunchDuration: 60,
    overtimeRate: 1.5,
    notes: "",
    ...overrides,
  }
}

/* ------------------------------------------------------------------ */
/* spanHours                                                           */
/* ------------------------------------------------------------------ */

describe("spanHours", () => {
  it("descuenta el almuerzo de una jornada normal", () => {
    expect(spanHours("08:00", "17:00", 60).total).toBe(8)
  })

  it("no descuenta nada cuando no hay almuerzo", () => {
    expect(spanHours("08:00", "17:00", 0).total).toBe(9)
  })

  it("paga completo el turno que cruza la medianoche", () => {
    const result = spanHours("22:00", "06:00", 60)
    expect(result.total).toBe(7)
    expect(result.crossesMidnight).toBe(true)
  })

  it("marca inválido el turno que el almuerzo se come entero", () => {
    const result = spanHours("08:00", "08:30", 60)
    expect(result.total).toBe(0)
    expect(result.invalid).toBe(true)
  })

  it("devuelve cero sin marcas de tiempo", () => {
    expect(spanHours("", "17:00", 60).total).toBe(0)
    expect(spanHours("08:00", "", 60).total).toBe(0)
  })

  it("rechaza entrada y salida iguales en vez de pagar 23 horas", () => {
    // Un tipeo como 08:00–08:00 es ambiguo: o son 0 h o son 24 h. Antes se
    // interpretaba como turno nocturno y pagaba 15 horas extra en silencio.
    const result = spanHours("08:00", "08:00", 60)
    expect(result.total).toBe(0)
    expect(result.invalid).toBe(true)
    expect(result.crossesMidnight).toBe(false)
  })

  it("ignora marcas de tiempo con formato roto", () => {
    expect(spanHours("ab:cd", "17:00", 0).total).toBe(0)
  })
})

describe("calcWorkedHours", () => {
  it("no cuenta horas en días sin horario", () => {
    expect(calcWorkedHours(entry({ dayType: "vacaciones" })).total).toBe(0)
    expect(calcWorkedHours(entry({ dayType: "ausencia" })).total).toBe(0)
  })

  it("cuenta horas en trabajo y en feriado trabajado", () => {
    expect(calcWorkedHours(entry({ dayType: "trabajo" })).total).toBe(8)
    expect(calcWorkedHours(entry({ dayType: "feriado" })).total).toBe(8)
  })

  it("omite el descuento cuando el almuerzo está desactivado", () => {
    expect(calcWorkedHours(entry({ lunchBreak: false })).total).toBe(9)
  })
})

/* ------------------------------------------------------------------ */
/* splitHours                                                          */
/* ------------------------------------------------------------------ */

describe("splitHours", () => {
  it("no genera extras por debajo del umbral", () => {
    expect(splitHours(7, 8)).toEqual({ regular: 7, overtime: 0 })
  })

  it("no genera extras justo en el umbral", () => {
    expect(splitHours(8, 8)).toEqual({ regular: 8, overtime: 0 })
  })

  it("manda al excedente todo lo que pasa del umbral", () => {
    expect(splitHours(10.5, 8)).toEqual({ regular: 8, overtime: 2.5 })
  })
})

/* ------------------------------------------------------------------ */
/* calcEmployeeSummary — por hora                                      */
/* ------------------------------------------------------------------ */

describe("calcEmployeeSummary (por hora)", () => {
  it("calcula un día simple con sus deducciones de ley", () => {
    const s = calcEmployeeSummary(employee(), [entry()], RULES)

    expect(s.regularHours).toBe(8)
    expect(s.regularPay).toBe(80)
    expect(s.grossSalary).toBe(80)
    expect(s.socialSecurityDeduction).toBeCloseTo(7.8, 10)
    expect(s.educationDeduction).toBeCloseTo(1, 10)
    expect(s.netSalary).toBeCloseTo(71.2, 10)
    expect(s.daysWorked).toBe(1)
  })

  it("paga las horas extra al recargo de la entrada", () => {
    // 07:00–18:00 con 1 h de almuerzo = 10 h: 8 regulares + 2 extra.
    const s = calcEmployeeSummary(
      employee(),
      [entry({ entryTime: "07:00", exitTime: "18:00" })],
      RULES,
    )

    expect(s.regularHours).toBe(8)
    expect(s.overtimeHours).toBe(2)
    expect(s.regularPay).toBe(80)
    expect(s.overtimePay).toBe(30) // 2 h × 10 × 1.5
    // El bruto es solo salario: las extras se pagan aparte y aparecen en el
    // total entregado.
    expect(s.grossSalary).toBe(80)
    expect(s.netSalary).toBeCloseTo(71.2, 10)
    expect(s.totalPay).toBeCloseTo(101.2, 10)
  })

  it("no aplica deducciones de ley sobre las horas extra", () => {
    const s = calcEmployeeSummary(
      employee(),
      [entry({ entryTime: "07:00", exitTime: "18:00" })],
      RULES,
    )

    // Base imponible = 80 (solo las regulares), no 110.
    expect(s.socialSecurityDeduction).toBeCloseTo(7.8, 10)
    expect(s.educationDeduction).toBeCloseTo(1, 10)
  })

  it("suma solo el recargo cuando se trabaja un feriado", () => {
    const s = calcEmployeeSummary(
      employee(),
      [entry({ dayType: "feriado" })],
      RULES,
    )

    expect(s.holidayHours).toBe(8)
    expect(s.regularPay).toBe(80) // la tarifa base ya cuenta como imponible
    expect(s.holidayPay).toBe(40) // 8 h × 10 × (1.5 − 1)
    expect(s.grossSalary).toBe(120)
  })

  it("paga la jornada estándar en vacaciones cuando la regla lo indica", () => {
    const s = calcEmployeeSummary(
      employee(),
      [entry({ dayType: "vacaciones", entryTime: "", exitTime: "" })],
      RULES,
    )

    expect(s.leaveHours).toBe(8)
    expect(s.regularPay).toBe(80)
    expect(s.daysWorked).toBe(0)
    expect(s.dayCounts.vacaciones).toBe(1)
  })

  it("no paga vacaciones si la regla está apagada", () => {
    const s = calcEmployeeSummary(
      employee(),
      [entry({ dayType: "vacaciones", entryTime: "", exitTime: "" })],
      { ...RULES, payVacations: false },
    )

    expect(s.leaveHours).toBe(0)
    expect(s.grossSalary).toBe(0)
  })

  it("no paga la incapacidad por defecto, porque en Panamá la cubre la CSS", () => {
    const s = calcEmployeeSummary(
      employee(),
      [entry({ dayType: "incapacidad", entryTime: "", exitTime: "" })],
      RULES,
    )

    expect(s.grossSalary).toBe(0)
    expect(s.dayCounts.incapacidad).toBe(1)
  })

  it("nunca paga una ausencia", () => {
    const s = calcEmployeeSummary(
      employee(),
      [entry({ dayType: "ausencia", entryTime: "", exitTime: "" })],
      { ...RULES, payVacations: true, payHolidays: true, paySickLeave: true },
    )

    expect(s.grossSalary).toBe(0)
    expect(s.dayCounts.ausencia).toBe(1)
  })

  it("ignora los registros de otros colaboradores", () => {
    const s = calcEmployeeSummary(
      employee(),
      [entry(), entry({ id: "te-2", employeeId: "otro" })],
      RULES,
    )

    expect(s.entriesCount).toBe(1)
    expect(s.regularPay).toBe(80)
  })

  it("no deduce nada a un profesional sin tasas", () => {
    const s = calcEmployeeSummary(
      employee({
        category: "profesional",
        socialSecurityRate: 0,
        educationRate: 0,
      }),
      [entry()],
      RULES,
    )

    expect(s.totalDeductions).toBe(0)
    expect(s.netSalary).toBe(80)
  })
})

/* ------------------------------------------------------------------ */
/* calcEmployeeSummary — por día                                       */
/* ------------------------------------------------------------------ */

describe("calcEmployeeSummary (por día)", () => {
  const daily = employee({ paymentType: "daily", hourlyRate: 0, dailyRate: 50 })

  it("paga la tarifa fija sin importar las horas", () => {
    const s = calcEmployeeSummary(
      daily,
      [entry({ entryTime: "07:00", exitTime: "18:00" })],
      RULES,
    )

    expect(s.regularPay).toBe(50)
    expect(s.overtimeHours).toBe(0)
    expect(s.overtimePay).toBe(0)
  })

  it("aplica el recargo de feriado sobre la tarifa diaria", () => {
    const s = calcEmployeeSummary(daily, [entry({ dayType: "feriado" })], RULES)

    expect(s.regularPay).toBe(50)
    expect(s.holidayPay).toBe(25) // 50 × (1.5 − 1)
    expect(s.grossSalary).toBe(75)
  })

  it("paga un día completo en vacaciones", () => {
    const s = calcEmployeeSummary(
      daily,
      [entry({ dayType: "vacaciones", entryTime: "", exitTime: "" })],
      RULES,
    )

    expect(s.regularPay).toBe(50)
  })
})

/* ------------------------------------------------------------------ */
/* calcEmployeeSummary — salario fijo por quincena                     */
/* ------------------------------------------------------------------ */

describe("calcEmployeeSummary (salario fijo)", () => {
  const fixed = employee({
    paymentType: "fixed",
    hourlyRate: 0,
    fixedSalary: 450,
  })

  it("paga el salario completo sin ningún registro", () => {
    // Es la diferencia clave con "por día": un colaborador asalariado cobra
    // aunque no haya llenado la cuadrícula esa quincena.
    const s = calcEmployeeSummary(fixed, [], RULES)

    expect(s.regularPay).toBe(450)
    expect(s.grossSalary).toBe(450)
  })

  it("no le suma nada a un día de trabajo normal: ya está incluido", () => {
    const s = calcEmployeeSummary(fixed, [entry()], RULES)

    expect(s.regularPay).toBe(450)
    expect(s.regularHours).toBe(8)
    expect(s.daysWorked).toBe(1)
  })

  it("no genera horas extra aunque el día se alargue", () => {
    const s = calcEmployeeSummary(
      fixed,
      [entry({ entryTime: "07:00", exitTime: "20:00" })],
      RULES,
    )

    expect(s.overtimeHours).toBe(0)
    expect(s.overtimePay).toBe(0)
    expect(s.regularPay).toBe(450)
  })

  it("descuenta el día proporcional por cada ausencia", () => {
    const s = calcEmployeeSummary(
      fixed,
      [entry({ dayType: "ausencia", entryTime: "", exitTime: "" })],
      RULES,
    )

    // 450 / 15 = 30 por día.
    expect(s.regularPay).toBe(420)
    expect(s.dayCounts.ausencia).toBe(1)
  })

  it("nunca deja el salario en negativo por acumular ausencias", () => {
    const entries = Array.from({ length: 20 }, (_, i) =>
      entry({
        id: `au-${i}`,
        date: `2026-08-${String((i % 28) + 1).padStart(2, "0")}`,
        dayType: "ausencia",
        entryTime: "",
        exitTime: "",
      }),
    )
    const s = calcEmployeeSummary(fixed, entries, RULES)

    expect(s.regularPay).toBe(0)
  })

  it("suma el recargo de feriado trabajado sobre la tarifa diaria equivalente", () => {
    const s = calcEmployeeSummary(fixed, [entry({ dayType: "feriado" })], RULES)

    expect(s.holidayHours).toBe(8)
    expect(s.holidayPay).toBe(15) // (450/15) × (1.5 − 1)
    expect(s.grossSalary).toBe(465)
  })

  it("cubre vacaciones, feriado no trabajado e incapacidad sin cambiar el pago", () => {
    // A diferencia de por hora o por día, estos interruptores no aplican: el
    // salario fijo ya los cubre sin importar payVacations/payHolidays/paySickLeave.
    const apagado = {
      ...RULES,
      payVacations: false,
      payHolidays: false,
      paySickLeave: false,
    }
    const vacaciones = calcEmployeeSummary(
      fixed,
      [entry({ dayType: "vacaciones", entryTime: "", exitTime: "" })],
      apagado,
    )
    const incapacidad = calcEmployeeSummary(
      fixed,
      [entry({ dayType: "incapacidad", entryTime: "", exitTime: "" })],
      apagado,
    )

    expect(vacaciones.regularPay).toBe(450)
    expect(vacaciones.leaveHours).toBe(8)
    expect(incapacidad.regularPay).toBe(450)
    expect(incapacidad.leaveHours).toBe(8)
  })

  it("deduce seguro social y educativo sobre el salario fijo", () => {
    const s = calcEmployeeSummary(fixed, [], RULES)

    expect(s.socialSecurityDeduction).toBeCloseTo(43.875, 10) // 450 × 9.75%
    expect(s.educationDeduction).toBeCloseTo(5.625, 10) // 450 × 1.25%
  })
})

/* ------------------------------------------------------------------ */
/* Préstamos dentro del resumen                                        */
/* ------------------------------------------------------------------ */

describe("descuento de préstamo", () => {
  it("descuenta la cuota después de las deducciones de ley", () => {
    const s = calcEmployeeSummary(employee(), [entry()], RULES, 20)

    expect(s.loanDeduction).toBe(20)
    expect(s.totalDeductions).toBeCloseTo(28.8, 10)
    expect(s.netSalary).toBeCloseTo(51.2, 10)
  })

  it("nunca deja el neto en negativo", () => {
    // El neto tras deducciones de ley es 71.20; la cuota pide 500.
    const s = calcEmployeeSummary(employee(), [entry()], RULES, 500)

    expect(s.loanDeduction).toBeCloseTo(71.2, 10)
    expect(s.netSalary).toBeCloseTo(0, 10)
  })

  it("no descuenta nada en una quincena sin salario", () => {
    const s = calcEmployeeSummary(employee(), [], RULES, 100)

    expect(s.loanDeduction).toBe(0)
    expect(s.netSalary).toBe(0)
  })
})

/* ------------------------------------------------------------------ */
/* Agregados y formato                                                 */
/* ------------------------------------------------------------------ */

describe("calcTotals", () => {
  it("suma los resúmenes de todo el período", () => {
    const a = calcEmployeeSummary(employee(), [entry()], RULES)
    const b = calcEmployeeSummary(
      employee({ id: "emp-2" }),
      [entry({ employeeId: "emp-2" })],
      RULES,
    )
    const totals = calcTotals([a, b])

    expect(totals.gross).toBe(160)
    expect(totals.regularHours).toBe(16)
    expect(totals.days).toBe(2)
  })

  it("devuelve ceros sin colaboradores", () => {
    const totals = calcTotals([])

    expect(totals.gross).toBe(0)
    expect(totals.net).toBe(0)
  })
})

describe("fmtHours", () => {
  it("omite los minutos cuando son cero", () => {
    expect(fmtHours(8)).toBe("8h")
  })

  it("muestra horas y minutos", () => {
    expect(fmtHours(7.5)).toBe("7h 30m")
  })

  it("sube la hora cuando el redondeo llega a 60 minutos", () => {
    expect(fmtHours(7.999)).toBe("8h")
  })

  it("protege contra valores no finitos", () => {
    expect(fmtHours(NaN)).toBe("0h")
    expect(fmtHours(-3)).toBe("0h")
  })
})

describe("pct", () => {
  it("calcula el porcentaje", () => {
    expect(pct(25, 200)).toBe(12.5)
  })

  it("devuelve cero en vez de dividir por cero", () => {
    expect(pct(10, 0)).toBe(0)
    expect(pct(NaN, 100)).toBe(0)
  })
})

/* ------------------------------------------------------------------ */
/* Ajustes manuales                                                    */
/* ------------------------------------------------------------------ */

describe("ajustes manuales", () => {
  it("suma el bono al neto y lo declara aparte de las deducciones", () => {
    const base = calcEmployeeSummary(employee(), [entry()], RULES)
    const conBono = calcEmployeeSummary(employee(), [entry()], RULES, 0, 25)

    expect(conBono.manualAdjustment).toBe(25)
    expect(conBono.totalDeductions).toBeCloseTo(base.totalDeductions, 10)
    expect(conBono.netSalary).toBeCloseTo(base.netSalary + 25, 10)
  })

  it("recorta el descuento que dejaría el neto en negativo", () => {
    const s = calcEmployeeSummary(employee(), [entry()], RULES, 0, -9999)

    expect(s.netSalary).toBe(0)
    expect(s.manualAdjustment).toBeCloseTo(-(s.grossSalary - s.totalDeductions), 10)
  })

  it("el bruto menos deducciones más ajustes explica el neto en los totales", () => {
    const totals = calcTotals([
      calcEmployeeSummary(employee(), [entry()], RULES, 0, 25),
      calcEmployeeSummary(
        employee({ id: "emp-2" }),
        [entry({ employeeId: "emp-2" })],
        RULES,
        0,
        -10,
      ),
    ])

    expect(totals.adjustments).toBeCloseTo(15, 10)
    expect(totals.net).toBeCloseTo(
      totals.gross - totals.deductions + totals.adjustments,
      10,
    )
  })

  it("una planilla congelada sin el campo no ensucia los totales", () => {
    const legacy = calcEmployeeSummary(employee(), [entry()], RULES)
    delete (legacy as { manualAdjustment?: number }).manualAdjustment

    expect(calcTotals([legacy]).adjustments).toBe(0)
  })
})

/* ------------------------------------------------------------------ */
/* Horas extra fuera del salario                                       */
/* ------------------------------------------------------------------ */

describe("separación de las horas extra", () => {
  const withOvertime = () =>
    calcEmployeeSummary(
      employee(),
      [entry({ entryTime: "07:00", exitTime: "18:00" })],
      RULES,
    )

  it("deja el bruto con el salario y las extras aparte", () => {
    const s = withOvertime()

    expect(s.grossSalary).toBe(s.regularPay + s.holidayPay)
    expect(s.grossSalary).not.toBe(s.grossSalary + s.overtimePay)
    expect(s.totalPay).toBeCloseTo(s.netSalary + s.overtimePay, 10)
  })

  it("no cambia lo que se entrega: total = bruto + extras − descuentos", () => {
    const s = withOvertime()

    expect(s.totalPay).toBeCloseTo(
      s.grossSalary + s.overtimePay - s.totalDeductions + s.manualAdjustment,
      10,
    )
  })

  it("el préstamo se puede cobrar contra las horas extra", () => {
    // El salario neto solo da 71.20, pero con las extras se entregan 101.20:
    // una cuota de 90 tiene de dónde salir y se cobra completa.
    const s = calcEmployeeSummary(
      employee(),
      [entry({ entryTime: "07:00", exitTime: "18:00" })],
      RULES,
      90,
    )

    expect(s.loanDeduction).toBe(90)
    expect(s.totalPay).toBeCloseTo(11.2, 10)
  })

  it("los totales del período separan salario, extras y lo entregado", () => {
    const totals = calcTotals([withOvertime()])

    expect(totals.gross).toBe(80)
    expect(totals.overtimePay).toBe(30)
    expect(totals.totalPay).toBeCloseTo(totals.net + totals.overtimePay, 10)
  })

  it("una planilla congelada sin el campo cuenta su neto como lo pagado", () => {
    const legacy = withOvertime()
    delete (legacy as { totalPay?: number }).totalPay

    expect(calcTotals([legacy]).totalPay).toBeCloseTo(legacy.netSalary, 10)
  })
})
