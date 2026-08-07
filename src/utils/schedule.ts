import type { DaySchedule, Employee, WeeklySchedule } from "../types"
import { spanHours } from "./calculations"
import { weekdayIndex } from "./dates"

/** Etiquetas indexadas como `Date.getDay()`: 0 = domingo. */
export const WEEKDAY_SHORT = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"]
export const WEEKDAY_LONG = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
]

/**
 * Orden de presentación: la semana laboral empieza el lunes, aunque el índice
 * nativo de JavaScript empiece el domingo.
 */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]

export function dayScheduleHours(day: DaySchedule): number {
  if (!day.works) return 0
  return spanHours(
    day.entryTime,
    day.exitTime,
    day.lunchBreak ? day.lunchDuration : 0,
  ).total
}

export function weeklyHours(schedule: WeeklySchedule): number {
  return schedule.reduce((sum, day) => sum + dayScheduleHours(day), 0)
}

export function workingDaysCount(schedule: WeeklySchedule): number {
  return schedule.filter((d) => d.works).length
}

/** El horario que le toca a un colaborador en una fecha concreta. */
export function scheduleForDate(
  employee: Employee,
  date: string,
): DaySchedule | null {
  const day = employee.schedule?.[weekdayIndex(date)]
  return day && day.works ? day : null
}

interface ScheduleGroup {
  days: number[]
  entryTime: string
  exitTime: string
}

/**
 * Agrupa días consecutivos con el mismo horario para describirlo en una línea:
 * `Lun–Vie 08:00–17:00 · Sáb 08:00–12:00`.
 */
export function describeSchedule(schedule: WeeklySchedule): string {
  const groups: ScheduleGroup[] = []
  let lastOrderIndex = -2

  WEEK_ORDER.forEach((weekday, orderIndex) => {
    const day = schedule[weekday]
    if (!day?.works) return

    const previous = groups[groups.length - 1]
    const isContiguous = orderIndex === lastOrderIndex + 1
    if (
      previous &&
      isContiguous &&
      previous.entryTime === day.entryTime &&
      previous.exitTime === day.exitTime
    ) {
      previous.days.push(weekday)
    } else {
      groups.push({
        days: [weekday],
        entryTime: day.entryTime,
        exitTime: day.exitTime,
      })
    }
    lastOrderIndex = orderIndex
  })

  if (groups.length === 0) return "Sin días laborables"

  return groups
    .map((g) => {
      const first = WEEKDAY_SHORT[g.days[0]]
      const last = WEEKDAY_SHORT[g.days[g.days.length - 1]]
      const label =
        g.days.length === 1
          ? first
          : g.days.length === 2
            ? `${first} y ${last}`
            : `${first}–${last}`
      return `${label} ${g.entryTime}–${g.exitTime}`
    })
    .join(" · ")
}

export interface SchedulePreset {
  id: string
  label: string
  description: string
  build: () => WeeklySchedule
}

function makeSchedule(
  workdays: number[],
  entryTime: string,
  exitTime: string,
  lunchDuration = 60,
  overrides: Record<number, Partial<DaySchedule>> = {},
): WeeklySchedule {
  return Array.from({ length: 7 }, (_, weekday) => ({
    works: workdays.includes(weekday),
    entryTime,
    exitTime,
    lunchBreak: lunchDuration > 0,
    lunchDuration,
    ...overrides[weekday],
  }))
}

/** Plantillas para los horarios más comunes; el resto se ajusta a mano. */
export const SCHEDULE_PRESETS: SchedulePreset[] = [
  {
    id: "lv-8-17",
    label: "Lun–Vie 8:00–17:00",
    description: "40 h · almuerzo 1 h",
    build: () => makeSchedule([1, 2, 3, 4, 5], "08:00", "17:00"),
  },
  {
    id: "lv-7-15",
    label: "Lun–Vie 7:00–15:00",
    description: "35 h · almuerzo 1 h",
    build: () => makeSchedule([1, 2, 3, 4, 5], "07:00", "15:00"),
  },
  {
    id: "lvs",
    label: "Lun–Vie + sábado medio",
    description: "Sábado 8:00–12:00 sin almuerzo",
    build: () =>
      makeSchedule([1, 2, 3, 4, 5, 6], "08:00", "17:00", 60, {
        6: {
          entryTime: "08:00",
          exitTime: "12:00",
          lunchBreak: false,
          lunchDuration: 0,
        },
      }),
  },
  {
    id: "nocturno",
    label: "Turno nocturno",
    description: "Lun–Vie 22:00–06:00",
    build: () => makeSchedule([1, 2, 3, 4, 5], "22:00", "06:00", 60),
  },
]
