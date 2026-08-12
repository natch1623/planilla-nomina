import { describe, expect, it } from "vitest"
import type { Employee, WeeklySchedule } from "../types"
import { defaultWeeklySchedule } from "../store"
import {
  SCHEDULE_PRESETS,
  dayScheduleHours,
  describeSchedule,
  scheduleForDate,
  weeklyHours,
  workingDaysCount,
} from "./schedule"

function preset(id: string): WeeklySchedule {
  const found = SCHEDULE_PRESETS.find((p) => p.id === id)
  if (!found) throw new Error(`Plantilla desconocida: ${id}`)
  return found.build()
}

describe("dayScheduleHours", () => {
  it("no cuenta horas en un día libre", () => {
    const day = defaultWeeklySchedule()[0] // domingo
    expect(dayScheduleHours(day)).toBe(0)
  })

  it("descuenta el almuerzo de un día laborable", () => {
    const day = defaultWeeklySchedule()[1] // lunes 08:00–17:00
    expect(dayScheduleHours(day)).toBe(8)
  })
})

describe("weeklyHours", () => {
  it("suma la semana estándar de lunes a viernes", () => {
    expect(weeklyHours(defaultWeeklySchedule())).toBe(40)
  })

  it("mide una jornada de siete horas", () => {
    expect(weeklyHours(preset("lv-7-15"))).toBe(35)
  })

  it("suma el sábado medio día", () => {
    // 5 × 8 h + sábado 08:00–12:00 sin almuerzo.
    expect(weeklyHours(preset("lvs"))).toBe(44)
  })

  it("cuenta completo el turno que cruza la medianoche", () => {
    // 22:00–06:00 menos 1 h de almuerzo = 7 h por día, cinco días.
    expect(weeklyHours(preset("nocturno"))).toBe(35)
  })
})

describe("workingDaysCount", () => {
  it("cuenta cinco días en la semana estándar", () => {
    expect(workingDaysCount(defaultWeeklySchedule())).toBe(5)
  })

  it("cuenta seis con sábado", () => {
    expect(workingDaysCount(preset("lvs"))).toBe(6)
  })
})

describe("scheduleForDate", () => {
  const employee = { schedule: defaultWeeklySchedule() } as Employee

  it("devuelve el horario de un día laborable", () => {
    expect(scheduleForDate(employee, "2026-08-10")?.entryTime).toBe("08:00")
  })

  it("devuelve null en un día libre", () => {
    expect(scheduleForDate(employee, "2026-08-09")).toBeNull() // domingo
  })

  it("tolera un colaborador sin horario", () => {
    expect(scheduleForDate({} as Employee, "2026-08-10")).toBeNull()
  })
})

describe("describeSchedule", () => {
  it("agrupa los días consecutivos con el mismo horario", () => {
    expect(describeSchedule(defaultWeeklySchedule())).toBe("Lun–Vie 08:00–17:00")
  })

  it("separa el día que tiene otro horario", () => {
    expect(describeSchedule(preset("lvs"))).toBe(
      "Lun–Vie 08:00–17:00 · Sáb 08:00–12:00",
    )
  })

  it("avisa cuando no hay días laborables", () => {
    const libre = defaultWeeklySchedule().map((d) => ({ ...d, works: false }))
    expect(describeSchedule(libre)).toBe("Sin días laborables")
  })

  it("nombra un único día sin rango", () => {
    const soloLunes = defaultWeeklySchedule().map((d, i) => ({
      ...d,
      works: i === 1,
    }))
    expect(describeSchedule(soloLunes)).toBe("Lun 08:00–17:00")
  })

  it("une dos días con «y» en vez de guion", () => {
    const lunesMartes = defaultWeeklySchedule().map((d, i) => ({
      ...d,
      works: i === 1 || i === 2,
    }))
    expect(describeSchedule(lunesMartes)).toBe("Lun y Mar 08:00–17:00")
  })
})

describe("defaultWeeklySchedule", () => {
  it("siempre trae siete posiciones", () => {
    // Un arreglo corto rompería la búsqueda por día de la semana.
    expect(defaultWeeklySchedule()).toHaveLength(7)
  })

  it("deja el fin de semana libre", () => {
    const schedule = defaultWeeklySchedule()
    expect(schedule[0].works).toBe(false)
    expect(schedule[6].works).toBe(false)
  })
})
