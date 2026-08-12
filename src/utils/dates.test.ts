import { describe, expect, it } from "vitest"
import {
  datesBetween,
  dayName,
  dayNum,
  formatDate,
  isWeekend,
  weekdayIndex,
} from "./dates"

describe("datesBetween", () => {
  it("incluye ambos extremos", () => {
    expect(datesBetween("2026-08-01", "2026-08-04")).toEqual([
      "2026-08-01",
      "2026-08-02",
      "2026-08-03",
      "2026-08-04",
    ])
  })

  it("devuelve un solo día cuando inicio y fin coinciden", () => {
    expect(datesBetween("2026-08-01", "2026-08-01")).toEqual(["2026-08-01"])
  })

  it("cruza el fin de mes", () => {
    expect(datesBetween("2026-01-30", "2026-02-02")).toEqual([
      "2026-01-30",
      "2026-01-31",
      "2026-02-01",
      "2026-02-02",
    ])
  })

  it("respeta el 29 de febrero en año bisiesto", () => {
    expect(datesBetween("2028-02-28", "2028-03-01")).toEqual([
      "2028-02-28",
      "2028-02-29",
      "2028-03-01",
    ])
  })

  it("devuelve vacío si el fin es anterior al inicio", () => {
    expect(datesBetween("2026-08-10", "2026-08-01")).toEqual([])
  })

  it("cubre una segunda quincena completa de 31 días", () => {
    expect(datesBetween("2026-08-16", "2026-08-31")).toHaveLength(16)
  })
})

describe("weekdayIndex", () => {
  it("usa el índice nativo, con domingo en cero", () => {
    // 2026-08-09 es domingo; 2026-08-10, lunes.
    expect(weekdayIndex("2026-08-09")).toBe(0)
    expect(weekdayIndex("2026-08-10")).toBe(1)
  })

  it("no se corre de día por la zona horaria", () => {
    // El cálculo es en UTC: usar fechas locales desplazaba el día y una
    // quincena mal recortada es un día de salario que aparece o desaparece.
    expect(weekdayIndex("2026-01-01")).toBe(4) // jueves
  })
})

describe("isWeekend", () => {
  it("reconoce sábado y domingo", () => {
    expect(isWeekend("2026-08-08")).toBe(true) // sábado
    expect(isWeekend("2026-08-09")).toBe(true) // domingo
  })

  it("no marca los días hábiles", () => {
    expect(isWeekend("2026-08-10")).toBe(false)
  })
})

describe("dayNum", () => {
  it("extrae el día sin ceros a la izquierda", () => {
    expect(dayNum("2026-08-07")).toBe(7)
    expect(dayNum("2026-08-31")).toBe(31)
  })
})

describe("dayName", () => {
  it("nombra el día en español abreviado", () => {
    expect(dayName("2026-08-10")).toBe("Lun")
  })
})

describe("formatDate", () => {
  it("formatea a día, mes abreviado y año", () => {
    expect(formatDate("2026-07-31")).toBe("31 jul 2026")
  })

  it("quita el cero inicial del día", () => {
    expect(formatDate("2026-01-05")).toBe("5 ene 2026")
  })
})
