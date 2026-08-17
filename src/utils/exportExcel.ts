import * as XLSX from "xlsx"
import type { EmployeeSummary, PayPeriod, TimeEntry } from "../types"
import { MONTHS_ES, getPeriodDates } from "../store"
import { DAY_TYPE_META, DAY_TYPES, calcTotals } from "./calculations"
import type { PayrollRules } from "./calculations"
import { attendanceFor } from "./attendance"

const round = (n: number) => Math.round(n * 100) / 100

/**
 * Formatos de celda de Excel.
 *
 * Se guardan como número con formato, no como texto: así el archivo sigue
 * sirviendo para sumar, filtrar y hacer tablas dinámicas. Escribir `"$1,234.56"`
 * se vería igual pero convertiría cada monto en una cadena inútil.
 */
const MONEY = '"$"#,##0.00'
const HOURS = "0.00"

/** Índices de columna, en el mismo orden en que `row()` declara las claves. */
const MONEY_COLUMNS = [5, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]
const HOURS_COLUMNS = [11, 12, 13]

function applyFormats(ws: XLSX.WorkSheet): void {
  const ref = ws["!ref"]
  if (!ref) return
  const range = XLSX.utils.decode_range(ref)

  const assign = (columns: number[], z: string) => {
    // Desde la fila 1: la 0 es el encabezado y no lleva formato numérico.
    for (let r = range.s.r + 1; r <= range.e.r; r++) {
      for (const c of columns) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })]
        if (cell && cell.t === "n") cell.z = z
      }
    }
  }

  assign(MONEY_COLUMNS, MONEY)
  assign(HOURS_COLUMNS, HOURS)
}

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
      "Método de pago":
        s.employee.paymentType === "daily"
          ? "Por día"
          : s.employee.paymentType === "fixed"
            ? "Salario fijo"
            : "Por hora",
      Tarifa: round(
        s.employee.paymentType === "daily"
          ? s.employee.dailyRate
          : s.employee.paymentType === "fixed"
            ? s.employee.fixedSalary
            : s.employee.hourlyRate,
      ),
      "Días trabajados": s.daysWorked,
      "Días vacaciones": s.dayCounts.vacaciones,
      "Días incapacidad": s.dayCounts.incapacidad,
      "Días ausencia": s.dayCounts.ausencia,
      "Días feriado": s.dayCounts.feriado,
      "Horas regulares": round(s.regularHours),
      "Horas extra": round(s.overtimeHours),
      "Horas pagadas sin trabajar": round(s.leaveHours),
      "Salario base (imponible)": round(s.regularPay),
      "Salario de horas extra": round(s.overtimePay),
      "Recargo feriado": round(s.holidayPay),
      "Salario bruto (sin extras)": round(s.grossSalary),
      "Seg. social (-)": round(s.socialSecurityDeduction),
      "Seg. educativo (-)": round(s.educationDeduction),
      "Préstamo (-)": round(s.loanDeduction),
      "Total descuentos": round(s.totalDeductions),
      // Un solo campo con signo, y no dos columnas: así la resta cuadra sola
      // (bruto − descuentos + ajuste = neto) sin fórmulas de apoyo.
      "Bono (+) / descuento (−) manual": round(s.manualAdjustment || 0),
      "Salario neto": round(s.netSalary),
      // Lo que de verdad sale de caja: el neto del salario más las horas extra,
      // que se pagan aparte del sueldo.
      "Total a pagar": round(s.totalPay ?? s.netSalary),
    }
  }

  const t = totals!
  return {
    Nombre: label,
    Cédula: "",
    Cargo: "",
    Categoría: "",
    "Método de pago": "",
    Tarifa: "",
    "Días trabajados": t.days,
    "Días vacaciones": "",
    "Días incapacidad": "",
    "Días ausencia": "",
    "Días feriado": "",
    "Horas regulares": round(t.regularHours),
    "Horas extra": round(t.overtimeHours),
    "Horas pagadas sin trabajar": "",
    "Salario base (imponible)": round(t.regularPay),
    "Salario de horas extra": round(t.overtimePay),
    "Recargo feriado": round(t.holidayPay),
    "Salario bruto (sin extras)": round(t.gross),
    "Seg. social (-)": round(t.socialSecurity),
    "Seg. educativo (-)": round(t.education),
    "Préstamo (-)": round(t.loans),
    "Total descuentos": round(t.deductions),
    "Bono (+) / descuento (−) manual": round(t.adjustments),
    "Salario neto": round(t.net),
    "Total a pagar": round(t.totalPay),
  }
}

/**
 * Arma el libro sin escribirlo. Separado de `exportToExcel` para poder
 * verificar en pruebas el formato de las celdas, que es justo lo que no se ve
 * al mirar el archivo por encima.
 */
export function buildPayrollWorkbook(
  summaries: EmployeeSummary[],
  period: PayPeriod,
  /** Registros del período; sin ellos se omite la hoja de asistencia. */
  entries?: TimeEntry[],
  /** Umbral de horas extra; sin él se asume el estándar de 8h diarias. */
  rules: Pick<PayrollRules, "overtimeThreshold"> = { overtimeThreshold: 8 },
): XLSX.WorkBook {
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
    { wch: 14 },
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
    { wch: 14 },
    { wch: 16 },
    { wch: 16 },
    { wch: 30 },
    { wch: 14 },
    { wch: 15 },
  ]
  // Congela el encabezado y la columna de nombres al desplazarse.
  ws["!freeze"] = { xSplit: 1, ySplit: 1 }
  applyFormats(ws)

  // Autofiltro sobre los colaboradores, sin incluir la fila de totales: si
  // entrara en el rango, filtrar por categoría la escondería o la sumaría mal.
  ws["!autofilter"] = {
    ref: XLSX.utils.encode_range(
      { r: 0, c: 0 },
      { r: summaries.length, c: MONEY_COLUMNS[MONEY_COLUMNS.length - 1] },
    ),
  }

  const wb = XLSX.utils.book_new()

  // El resumen va primero: es lo que se mira antes de entrar al detalle.
  // Cada fila declara si es dinero. Marcar las filas por número de índice se
  // desincroniza en cuanto se inserta un concepto en el medio.
  const resumenRows: { concepto: string; monto: string | number; money: boolean }[] =
    [
      { concepto: "Período", monto: periodLabel, money: false },
      { concepto: "Colaboradores", monto: summaries.length, money: false },
      { concepto: "Días trabajados", monto: totals.days, money: false },
      {
        concepto: "Horas regulares",
        monto: round(totals.regularHours),
        money: false,
      },
      {
        concepto: "Horas extra",
        monto: round(totals.overtimeHours),
        money: false,
      },
      {
        concepto: "Salario base (imponible)",
        monto: round(totals.regularPay),
        money: true,
      },
      {
        concepto: "Salario de horas extra",
        monto: round(totals.overtimePay),
        money: true,
      },
      {
        concepto: "Recargo feriado",
        monto: round(totals.holidayPay),
        money: true,
      },
      {
        concepto: "Salario bruto (sin extras)",
        monto: round(totals.gross),
        money: true,
      },
      {
        concepto: "Seguro social",
        monto: round(totals.socialSecurity),
        money: true,
      },
      {
        concepto: "Seguro educativo",
        monto: round(totals.education),
        money: true,
      },
      { concepto: "Préstamos", monto: round(totals.loans), money: true },
      {
        concepto: "Total descuentos",
        monto: round(totals.deductions),
        money: true,
      },
      {
        concepto: "Bonos (+) / descuentos (−) manuales",
        monto: round(totals.adjustments),
        money: true,
      },
      { concepto: "Salario neto", monto: round(totals.net), money: true },
      { concepto: "TOTAL A PAGAR", monto: round(totals.totalPay), money: true },
    ]

  const resumen = XLSX.utils.json_to_sheet(
    resumenRows.map((r) => ({ Concepto: r.concepto, Monto: r.monto })),
  )
  resumen["!cols"] = [{ wch: 26 }, { wch: 16 }]
  // Solo las filas de dinero: un conteo de colaboradores visto como "$5.00"
  // confunde. La fila 0 es el encabezado, así que los datos arrancan en la 1.
  resumenRows.forEach((r, i) => {
    if (!r.money) return
    const cell = resumen[XLSX.utils.encode_cell({ r: i + 1, c: 1 })]
    if (cell && cell.t === "n") cell.z = MONEY
  })
  XLSX.utils.book_append_sheet(wb, resumen, "Resumen")

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

  // Hoja de asistencia: la misma marcación que sale en el comprobante, aquí
  // en formato tabular para poder filtrar por colaborador o por día.
  if (entries && summaries.length > 0) {
    const { start, end } = getPeriodDates(period)
    const attendance = summaries.flatMap((s) =>
      attendanceFor(entries, s.employee.id, start, end, s.employee, rules).records.map(
        (r) => ({
          Colaborador: s.employee.name,
          Fecha: r.date,
          Día: r.dayLabel,
          Tipo: r.typeLabel,
          Entrada: r.entryTime,
          Salida: r.exitTime,
          "Almuerzo (min)": r.lunchMinutes,
          "Horas regulares": round(r.regularHours),
          "Horas extra": round(r.overtimeHours),
          "Recargo extra": r.overtimeRate !== 1 ? `x${r.overtimeRate}` : "",
          Nota: r.note,
        }),
      ),
    )
    if (attendance.length > 0) {
      const wsAttendance = XLSX.utils.json_to_sheet(attendance)
      wsAttendance["!cols"] = [
        { wch: 26 },
        { wch: 12 },
        { wch: 10 },
        { wch: 14 },
        { wch: 10 },
        { wch: 10 },
        { wch: 14 },
        { wch: 14 },
        { wch: 12 },
        { wch: 12 },
        { wch: 34 },
      ]
      wsAttendance["!freeze"] = { xSplit: 1, ySplit: 1 }
      wsAttendance["!autofilter"] = {
        ref: XLSX.utils.encode_range(
          { r: 0, c: 0 },
          { r: attendance.length, c: 10 },
        ),
      }
      // Las horas se guardan como número con formato, igual que en la planilla:
      // así la hoja sirve para sumar y no solo para mirar.
      for (let r = 1; r <= attendance.length; r++) {
        for (const c of [7, 8]) {
          const cell = wsAttendance[XLSX.utils.encode_cell({ r, c })]
          if (cell && cell.t === "n") cell.z = HOURS
        }
      }
      XLSX.utils.book_append_sheet(wb, wsAttendance, "Asistencia")
    }
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

  return wb
}

export function exportToExcel(
  summaries: EmployeeSummary[],
  period: PayPeriod,
  entries?: TimeEntry[],
  /** Umbral de horas extra; sin él se asume el estándar de 8h diarias. */
  rules: Pick<PayrollRules, "overtimeThreshold"> = { overtimeThreshold: 8 },
): void {
  XLSX.writeFile(
    buildPayrollWorkbook(summaries, period, entries, rules),
    `planilla_${period.year}_${String(period.month).padStart(2, "0")}_q${period.half}.xlsx`,
  )
}
