import * as XLSX from "xlsx"
import type { EmployeeSummary, PayPeriod } from "../types"
import { MONTHS_ES } from "../store"
import { DAY_TYPE_META, DAY_TYPES, calcTotals } from "./calculations"

const round = (n: number) => Math.round(n * 100) / 100

/** Todas las filas comparten exactamente estas claves, incluida la de totales:
 *  `json_to_sheet` deriva las columnas del primer registro y deja huecos en
 *  cualquier fila a la que le falte una clave. */
function row(
  label: string,
  s: EmployeeSummary | null,
  totals?: ReturnType<typeof calcTotals>,
) {
  if (s) {
    return {
      Nombre: s.employee.name,
      Cédula: s.employee.idNumber,
      Cargo: s.employee.position,
      Categoría:
        s.employee.category === "profesional"
          ? "Serv. profesional"
          : "Empleado",
      "Tarifa/hora": round(s.employee.hourlyRate),
      "Días trabajados": s.daysWorked,
      "Días vacaciones": s.dayCounts.vacaciones,
      "Días incapacidad": s.dayCounts.incapacidad,
      "Días ausencia": s.dayCounts.ausencia,
      "Días feriado": s.dayCounts.feriado,
      "Horas regulares": round(s.regularHours),
      "Horas extra": round(s.overtimeHours),
      "Horas pagadas sin trabajar": round(s.leaveHours),
      "Salario base (imponible)": round(s.regularPay),
      "Recargo horas extra": round(s.overtimePay),
      "Recargo feriado": round(s.holidayPay),
      "Salario bruto": round(s.grossSalary),
      "Seg. social (-)": round(s.socialSecurityDeduction),
      "Seg. educativo (-)": round(s.educationDeduction),
      "Total descuentos": round(s.totalDeductions),
      "Salario neto": round(s.netSalary),
    }
  }

  const t = totals!
  return {
    Nombre: label,
    Cédula: "",
    Cargo: "",
    Categoría: "",
    "Tarifa/hora": "",
    "Días trabajados": t.days,
    "Días vacaciones": "",
    "Días incapacidad": "",
    "Días ausencia": "",
    "Días feriado": "",
    "Horas regulares": round(t.regularHours),
    "Horas extra": round(t.overtimeHours),
    "Horas pagadas sin trabajar": "",
    "Salario base (imponible)": round(t.regularPay),
    "Recargo horas extra": round(t.overtimePay),
    "Recargo feriado": round(t.holidayPay),
    "Salario bruto": round(t.gross),
    "Seg. social (-)": round(t.socialSecurity),
    "Seg. educativo (-)": round(t.education),
    "Total descuentos": round(t.deductions),
    "Salario neto": round(t.net),
  }
}

export function exportToExcel(
  summaries: EmployeeSummary[],
  period: PayPeriod,
): void {
  const periodLabel = `${MONTHS_ES[period.month - 1]} ${period.year} - Q${period.half}`
  const totals = calcTotals(summaries)

  const rows: Record<string, string | number>[] = summaries.map((s) =>
    row("", s),
  )
  rows.push(row("TOTALES", null, totals))

  const ws = XLSX.utils.json_to_sheet(rows)
  ws["!cols"] = [
    { wch: 26 },
    { wch: 14 },
    { wch: 22 },
    { wch: 17 },
    { wch: 11 },
    { wch: 15 },
    { wch: 15 },
    { wch: 16 },
    { wch: 14 },
    { wch: 13 },
    { wch: 16 },
    { wch: 12 },
    { wch: 24 },
    { wch: 22 },
    { wch: 18 },
    { wch: 15 },
    { wch: 14 },
    { wch: 14 },
    { wch: 16 },
    { wch: 16 },
    { wch: 14 },
  ]
  // Congela el encabezado y la columna de nombres al desplazarse.
  ws["!freeze"] = { xSplit: 1, ySplit: 1 }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Planilla")

  // Segunda hoja: el desglose de días, que en la principal solo cabe como conteo.
  const detail = summaries.map((s) => ({
    Nombre: s.employee.name,
    ...Object.fromEntries(
      DAY_TYPES.map((t) => [DAY_TYPE_META[t].label, s.dayCounts[t]]),
    ),
    "Total días registrados": s.entriesCount,
  }))
  if (detail.length > 0) {
    const wsDetail = XLSX.utils.json_to_sheet(detail)
    wsDetail["!cols"] = [{ wch: 26 }, ...Array(6).fill({ wch: 14 })]
    XLSX.utils.book_append_sheet(wb, wsDetail, "Días")
  }

  // Hoja de contexto: quién lo generó y con qué período, para que el archivo
  // se explique solo cuando llegue a contabilidad.
  const meta = XLSX.utils.json_to_sheet([
    { Campo: "Período", Valor: periodLabel },
    { Campo: "Colaboradores", Valor: summaries.length },
    { Campo: "Generado", Valor: new Date().toLocaleString("es-PA") },
  ])
  meta["!cols"] = [{ wch: 18 }, { wch: 30 }]
  XLSX.utils.book_append_sheet(wb, meta, "Info")

  XLSX.writeFile(
    wb,
    `planilla_${period.year}_${String(period.month).padStart(2, "0")}_q${period.half}.xlsx`,
  )
}
