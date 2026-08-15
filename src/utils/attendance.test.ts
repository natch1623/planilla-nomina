import { describe, expect, it } from "vitest"
import { attendanceRows } from "./attendance"
import type { TimeEntry } from "../types"

describe("attendanceRows", () => {
  it("incluye notas y datos útiles por día", () => {
    const entries: TimeEntry[] = [
      {
        id: "t1",
        employeeId: "e1",
        date: "2026-08-03",
        dayType: "trabajo",
        entryTime: "08:00",
        exitTime: "17:00",
        lunchBreak: true,
        lunchDuration: 60,
        overtimeRate: 1.5,
        notes: "Llegó tarde por lluvia",
      },
    ]

    const result = attendanceRows(entries, "e1", "2026-08-01", "2026-08-03")

    expect(result.rows[2]).toEqual([
      "03 Lun",
      "Trabajado",
      "08:00",
      "17:00",
      "8h",
      "Almuerzo 60 min · Extra x1.5 · Nota: Llegó tarde por lluvia",
    ])
    expect(result.totalHours).toBe(8)
  })

  it("marca los días sin registro", () => {
    const result = attendanceRows([], "e1", "2026-08-01", "2026-08-01")

    expect(result.rows[0]).toEqual([
      "01 Sáb",
      "Sin registro",
      "—",
      "—",
      "—",
      "Sin marcación",
    ])
  })
})
