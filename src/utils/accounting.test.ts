import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { AppData, Employee, TimeEntry, Transaction } from "../types"
import type { PayrollRules } from "./calculations"
import { defaultData, defaultWeeklySchedule } from "../store"
import {
  addMonths,
  buildMonthlySeries,
  cashDate,
  currentMonthKey,
  monthEnd,
  monthKey,
  monthLabel,
  monthRange,
  monthStart,
  monthsBetween,
  occurrencesInMonth,
  payrollCostForMonth,
} from "./accounting"

const RULES: PayrollRules = {
  overtimeThreshold: 8,
  standardDayHours: 8,
  holidayRate: 1.5,
  payVacations: true,
  payHolidays: true,
  paySickLeave: false,
}

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "tx-1",
    date: "2026-08-05",
    dueDate: "2026-08-05",
    type: "gasto",
    status: "pagado",
    category: "Insumos",
    description: "",
    amount: 100,
    recurrence: "ninguna",
    paymentMethod: "efectivo",
    counterpartyId: "",
    tags: [],
    attachments: [],
    ...overrides,
  }
}

/* ------------------------------------------------------------------ */
/* Claves de mes                                                       */
/* ------------------------------------------------------------------ */

describe("monthKey y monthLabel", () => {
  it("recorta la fecha al mes", () => {
    expect(monthKey("2026-07-31")).toBe("2026-07")
  })

  it("etiqueta el mes en español abreviado", () => {
    expect(monthLabel("2026-07")).toBe("Jul 2026")
    expect(monthLabel("2026-12")).toBe("Dic 2026")
  })
})

describe("addMonths", () => {
  it("avanza dentro del mismo año", () => {
    expect(addMonths("2026-03", 2)).toBe("2026-05")
  })

  it("cruza el fin de año hacia adelante", () => {
    expect(addMonths("2026-11", 3)).toBe("2027-02")
  })

  it("cruza el fin de año hacia atrás", () => {
    expect(addMonths("2026-01", -1)).toBe("2025-12")
  })

  it("no cambia nada con delta cero", () => {
    expect(addMonths("2026-08", 0)).toBe("2026-08")
  })
})

describe("monthsBetween", () => {
  it("cuenta hacia adelante", () => {
    expect(monthsBetween("2026-01", "2026-08")).toBe(7)
  })

  it("cuenta hacia atrás en negativo", () => {
    expect(monthsBetween("2026-08", "2026-01")).toBe(-7)
  })

  it("cruza el año", () => {
    expect(monthsBetween("2025-11", "2026-02")).toBe(3)
  })
})

describe("monthRange", () => {
  it("incluye ambos extremos", () => {
    expect(monthRange("2026-06", "2026-09")).toEqual([
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
    ])
  })

  it("devuelve un solo mes si coinciden", () => {
    expect(monthRange("2026-06", "2026-06")).toEqual(["2026-06"])
  })
})

describe("monthStart y monthEnd", () => {
  it("marca el primero y el último día", () => {
    expect(monthStart("2026-08")).toBe("2026-08-01")
    expect(monthEnd("2026-08")).toBe("2026-08-31")
  })

  it("respeta los meses de 30 días", () => {
    expect(monthEnd("2026-04")).toBe("2026-04-30")
  })

  it("respeta febrero, bisiesto o no", () => {
    expect(monthEnd("2026-02")).toBe("2026-02-28")
    expect(monthEnd("2028-02")).toBe("2028-02-29")
  })
})

/* ------------------------------------------------------------------ */
/* Recurrencias                                                        */
/* ------------------------------------------------------------------ */

describe("cashDate", () => {
  it("prefiere el vencimiento sobre el devengo", () => {
    expect(cashDate(tx({ date: "2026-08-01", dueDate: "2026-09-15" }))).toBe(
      "2026-09-15",
    )
  })

  it("cae en la fecha de devengo si no hay vencimiento", () => {
    expect(cashDate(tx({ date: "2026-08-01", dueDate: "" }))).toBe("2026-08-01")
  })
})

describe("occurrencesInMonth", () => {
  it("no cuenta un movimiento único", () => {
    expect(occurrencesInMonth(tx({ recurrence: "ninguna" }), "2026-08")).toBe(0)
  })

  it("cuenta una vez el mensual", () => {
    expect(occurrencesInMonth(tx({ recurrence: "mensual" }), "2026-09")).toBe(1)
  })

  it("no cuenta antes de que empiece", () => {
    const futuro = tx({ recurrence: "mensual", dueDate: "2026-10-01" })
    expect(occurrencesInMonth(futuro, "2026-08")).toBe(0)
  })

  it("cuenta el anual solo en su mes", () => {
    const anual = tx({ recurrence: "anual", dueDate: "2026-03-10" })
    expect(occurrencesInMonth(anual, "2027-03")).toBe(1)
    expect(occurrencesInMonth(anual, "2027-04")).toBe(0)
  })

  it("enumera las fechas reales del semanal en vez de promediar", () => {
    // Desde el 1 de agosto de 2026, cada 7 días: 1, 8, 15, 22 y 29. Un promedio
    // de 4.33 semanas daría 4 y arrastraría un sesgo constante.
    const semanal = tx({ recurrence: "semanal", dueDate: "2026-08-01" })
    expect(occurrencesInMonth(semanal, "2026-08")).toBe(5)
  })

  it("cuenta el quincenal dos o tres veces según el mes", () => {
    const quincenal = tx({ recurrence: "quincenal", dueDate: "2026-08-01" })
    expect(occurrencesInMonth(quincenal, "2026-08")).toBe(3) // 1, 15 y 29
  })
})

/* ------------------------------------------------------------------ */
/* Serie mensual: lo que alimenta el estado de resultados              */
/* ------------------------------------------------------------------ */

function employee(): Employee {
  return {
    id: "e1",
    name: "Juan Pérez",
    idNumber: "",
    position: "",
    startDate: "",
    category: "empleado",
    paymentType: "hourly",
    hourlyRate: 10,
    dailyRate: 0,
    fixedSalary: 0,
    schedule: defaultWeeklySchedule(),
    socialSecurityRate: 9.75,
    educationRate: 1.25,
    active: true,
  }
}

/** Un día de 8 h a $10: bruto 80, deducciones 8.80, neto 71.20. */
function workday(date: string): TimeEntry {
  return {
    id: `te-${date}`,
    employeeId: "e1",
    date,
    dayType: "trabajo",
    entryTime: "08:00",
    exitTime: "17:00",
    lunchBreak: true,
    lunchDuration: 60,
    overtimeRate: 1.5,
    notes: "",
    attachments: [],
  }
}

function appData(overrides: Partial<AppData> = {}): AppData {
  return { ...defaultData, employees: [employee()], ...overrides }
}

describe("payrollCostForMonth", () => {
  it("suma las dos quincenas del mes", () => {
    const data = appData({
      timeEntries: [workday("2026-08-03"), workday("2026-08-20")],
    })
    expect(payrollCostForMonth("2026-08", data, RULES)).toBeCloseTo(142.4, 2)
  })

  it("no cuenta los días de otro mes", () => {
    const data = appData({
      timeEntries: [workday("2026-08-03"), workday("2026-09-03")],
    })
    expect(payrollCostForMonth("2026-08", data, RULES)).toBeCloseTo(71.2, 2)
  })

  it("da cero en un mes sin registros", () => {
    expect(payrollCostForMonth("2026-08", appData(), RULES)).toBe(0)
  })
})

describe("buildMonthlySeries", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 12)) // 12 de agosto de 2026
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("termina en el mes corriente", () => {
    const series = buildMonthlySeries(appData(), RULES, 3)
    expect(series.map((m) => m.key)).toEqual(["2026-06", "2026-07", "2026-08"])
    expect(currentMonthKey()).toBe("2026-08")
  })

  it("separa lo devengado de lo cobrado", () => {
    const data = appData({
      transactions: [
        tx({ id: "a", type: "ingreso", status: "pagado", amount: 1000 }),
        tx({ id: "b", type: "ingreso", status: "pendiente", amount: 400 }),
      ],
    })
    const mes = buildMonthlySeries(data, RULES, 1)[0]

    expect(mes.ingresos).toBe(1400) // todo lo facturado
    expect(mes.ingresosCobrados).toBe(1000) // solo lo que entró
  })

  it("separa el gasto devengado del pagado", () => {
    const data = appData({
      transactions: [
        tx({ id: "a", amount: 300, status: "pagado" }),
        tx({ id: "b", amount: 200, status: "pendiente" }),
      ],
    })
    const mes = buildMonthlySeries(data, RULES, 1)[0]

    expect(mes.gastosManual).toBe(500)
    expect(mes.gastosManualPagados).toBe(300)
  })

  it("suma la nómina al gasto total", () => {
    const data = appData({
      timeEntries: [workday("2026-08-03")],
      transactions: [tx({ amount: 100 })],
    })
    const mes = buildMonthlySeries(data, RULES, 1)[0]

    expect(mes.gastosNomina).toBeCloseTo(71.2, 2)
    expect(mes.gastosTotal).toBeCloseTo(171.2, 2)
  })

  it("calcula utilidad contable y flujo de caja por separado", () => {
    // Un mes puede ser rentable y aun así no dejar efectivo: es justo la
    // distinción que el estado de resultados ofrece como «devengado» y «caja».
    const data = appData({
      transactions: [
        tx({ id: "a", type: "ingreso", status: "pendiente", amount: 1000 }),
        tx({ id: "b", type: "gasto", status: "pagado", amount: 300 }),
      ],
    })
    const mes = buildMonthlySeries(data, RULES, 1)[0]

    expect(mes.balance).toBe(700) // rentable
    expect(mes.flujoNeto).toBe(-300) // pero sin efectivo
  })

  it("no mezcla movimientos de meses distintos", () => {
    const data = appData({
      transactions: [
        tx({ id: "a", date: "2026-08-05", amount: 100 }),
        tx({ id: "b", date: "2026-07-05", amount: 900 }),
      ],
    })
    const [julio, agosto] = buildMonthlySeries(data, RULES, 2)

    expect(julio.gastosManual).toBe(900)
    expect(agosto.gastosManual).toBe(100)
  })

  it("devuelve meses vacíos sin datos, no huecos", () => {
    const series = buildMonthlySeries(appData(), RULES, 6)
    expect(series).toHaveLength(6)
    expect(series.every((m) => m.balance === 0)).toBe(true)
  })
})
