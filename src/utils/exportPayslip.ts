import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import type {
  EmployeeSummary,
  PayPeriod,
  PayrollAdjustment,
  TimeEntry,
} from "../types"
import { MONTHS_ES, getPeriodDates } from "../store"
import {
  adjustmentsForPeriod,
  DAY_TYPE_META,
  DAY_TYPES,
  fmt,
  fmtHours,
} from "./calculations"
import type { PayrollRules } from "./calculations"
import { attendanceRows } from "./attendance"
import { formatDate } from "./dates"

/* Marcas diacríticas combinantes. Se construye desde una cadena ASCII para que
   el patrón sobreviva a cualquier recodificación del archivo fuente. */
const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g")

const NAVY: [number, number, number] = [22, 36, 61]
const MUTED: [number, number, number] = [100, 116, 139]
const LINE: [number, number, number] = [225, 231, 240]
const GREEN: [number, number, number] = [14, 159, 110]
const RED: [number, number, number] = [190, 45, 55]
const AMBER: [number, number, number] = [194, 104, 10]

function periodTitle(period: PayPeriod): string {
  return `${MONTHS_ES[period.month - 1]} ${period.year} — ${
    period.half === 1 ? "1ª quincena (1–15)" : "2ª quincena (16–fin de mes)"
  }`
}

function fileSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase()
}

/**
 * Asistencia día por día, ajustada al hueco que queda en la página.
 *
 * El comprobante tiene que caber en una hoja —es lo que se firma y se
 * archiva—, así que la tabla no elige su tamaño: recibe el espacio disponible
 * y calcula el tipo de letra que hace entrar sus filas. Solo si ni con el
 * mínimo legible alcanza, se deja que continúe en otra página en vez de
 * recortar días.
 *
 * Devuelve la Y donde terminó el bloque.
 */
function drawAttendance(
  doc: jsPDF,
  rows: string[][],
  totalHours: number,
  y: number,
  available: number,
  M: number,
  W: number,
): number {
  const inner = W - M * 2

  doc.setFont("helvetica", "bold")
  doc.setFontSize(8)
  doc.setTextColor(...NAVY)
  doc.text("Asistencia día por día", M, y)
  doc.setFont("helvetica", "normal")
  doc.setFontSize(6.4)
  doc.setTextColor(...MUTED)
  doc.text(
    `Total ${fmtHours(totalHours)} · horas netas (almuerzo descontado)`,
    W - M,
    y,
    { align: "right" },
  )
  y += 2.5

  /**
   * Elige el mayor tipo de letra con el que la tabla entera entra en el hueco.
   *
   * No basta con dividir el alto entre el número de días: la columna de
   * detalle puede partirse en dos renglones y ese desbordamiento es justo el
   * que empujaría el comprobante a una segunda hoja. Por eso se mide el texto
   * real de cada fila —con la misma función que usa la tabla al dibujar— en vez
   * de suponer un renglón por día. Se prefiere achicar el relleno antes que la
   * letra: apretar el interlineado se nota menos que perder cuerpo.
   */
  const budget = available - 2.5
  const detailWidth = inner * 0.44
  let fontSize = 7
  let padding = 1.4

  outer: for (const fs of [7, 6.6, 6.2, 5.8, 5.4, 5.2]) {
    doc.setFont("helvetica", "normal")
    doc.setFontSize(fs)
    const lineH = (fs * 1.15) / 2.8346
    for (const pad of [1.4, 1.1, 0.9, 0.7, 0.55]) {
      const lines = rows.reduce(
        (sum, r) =>
          sum +
          Math.max(1, doc.splitTextToSize(r[6], detailWidth - pad * 2).length),
        1, // el encabezado
      )
      const height = lines * lineH + (rows.length + 1) * pad * 2
      if (height <= budget) {
        fontSize = fs
        padding = pad
        break outer
      }
      // Con el cuerpo más chico y el relleno mínimo ya no hay de dónde recortar:
      // la asistencia se derrama a otra hoja antes que perder días.
      if (fs === 5.2 && pad === 0.55) {
        fontSize = fs
        padding = pad
      }
    }
  }

  autoTable(doc, {
    startY: y,
    head: [
      ["Día", "Tipo", "Entrada", "Salida", "Reg.", "Extra", "Detalle"],
    ],
    body: rows,
    theme: "grid",
    headStyles: {
      fillColor: NAVY,
      textColor: 255,
      fontSize,
      fontStyle: "bold",
      cellPadding: padding,
    },
    bodyStyles: {
      fontSize,
      textColor: NAVY,
      lineColor: LINE,
      cellPadding: padding,
    },
    alternateRowStyles: { fillColor: [250, 251, 253] },
    columnStyles: {
      0: { cellWidth: inner * 0.1 },
      1: { cellWidth: inner * 0.12 },
      2: { cellWidth: inner * 0.09, halign: "center" },
      3: { cellWidth: inner * 0.09, halign: "center" },
      4: { cellWidth: inner * 0.08, halign: "right" },
      5: { cellWidth: inner * 0.08, halign: "right", textColor: AMBER },
      6: { cellWidth: "auto", textColor: MUTED },
    },
    // Un día sin marcación se atenúa entero: se distingue de un día trabajado
    // sin tener que leer la columna de tipo.
    didParseCell: (d) => {
      const raw = d.row.raw as unknown
      if (d.section !== "body" || !Array.isArray(raw)) return
      if (raw[1] === "Sin registro") d.cell.styles.textColor = MUTED
    },
    // El margen inferior es el mismo límite con el que se repartió el espacio:
    // si no coincidieran, la tabla podría saltar de página creyendo que no cabe
    // —o peor, pisar las firmas.
    margin: {
      left: M,
      right: M,
      top: 14,
      bottom: doc.internal.pageSize.getHeight() - (y + available - 2.5),
    },
  })

  return (doc as any).lastAutoTable.finalY
}

/**
 * Dibuja un comprobante en la página actual del documento.
 * Se separa de la exportación para poder encadenar varios en un solo PDF.
 */
function drawPayslip(
  doc: jsPDF,
  s: EmployeeSummary,
  period: PayPeriod,
  companyName: string,
  rules: Pick<PayrollRules, "overtimeThreshold">,
  entries?: TimeEntry[],
  adjustments: PayrollAdjustment[] = [],
): void {
  const W = doc.internal.pageSize.getWidth()
  const M = 14
  const { start, end } = getPeriodDates(period)
  const emp = s.employee
  // Al encadenar comprobantes cada uno arranca en su propia hoja; hay que
  // recordarla para volver a firmar sobre ella al final.
  const firstPage = doc.getNumberOfPages()

  // Encabezado
  doc.setFillColor(...NAVY)
  doc.rect(0, 0, W, 22, "F")
  doc.setTextColor(255, 255, 255)
  doc.setFont("helvetica", "bold")
  doc.setFontSize(12)
  doc.text("COMPROBANTE DE PAGO", M, 10)
  doc.setFont("helvetica", "normal")
  doc.setFontSize(8)
  doc.text(periodTitle(period), M, 16.5)
  if (companyName) {
    doc.setFont("helvetica", "bold")
    doc.setFontSize(9.5)
    doc.text(companyName, W - M, 10, { align: "right" })
  }
  doc.setFont("helvetica", "normal")
  doc.setFontSize(7.5)
  doc.text(`${formatDate(start)} – ${formatDate(end)}`, W - M, 16.5, {
    align: "right",
  })

  // Datos del colaborador
  let y = 30
  doc.setTextColor(...NAVY)
  doc.setFont("helvetica", "bold")
  doc.setFontSize(11)
  doc.text(emp.name, M, y)

  doc.setFont("helvetica", "normal")
  doc.setFontSize(7.5)
  doc.setTextColor(...MUTED)
  const facts: [string, string][] = [
    ["Cédula", emp.idNumber || "—"],
    ["Cargo", emp.position || "—"],
    [
      "Categoría",
      emp.category === "profesional"
        ? "Servicio profesional"
        : "Empleado regular",
    ],
    emp.paymentType === "daily"
      ? ["Tarifa por día", `$${fmt(emp.dailyRate)}`]
      : emp.paymentType === "fixed"
        ? ["Salario por quincena", `$${fmt(emp.fixedSalary)}`]
        : ["Tarifa por hora", `$${fmt(emp.hourlyRate)}`],
    ["Ingreso", emp.startDate ? formatDate(emp.startDate) : "—"],
    ["Días trabajados", String(s.daysWorked)],
  ]
  y += 5.5
  facts.forEach(([k, v], i) => {
    const col = i % 3
    const row = Math.floor(i / 3)
    const x = M + col * ((W - M * 2) / 3)
    doc.setFontSize(6.2)
    doc.setTextColor(...MUTED)
    doc.text(k.toUpperCase(), x, y + row * 8.5)
    doc.setFontSize(8)
    doc.setTextColor(...NAVY)
    doc.setFont("helvetica", "bold")
    doc.text(v, x, y + row * 8.5 + 4)
    doc.setFont("helvetica", "normal")
  })
  y += 18

  // Ingresos
  const earnings: (string | number)[][] = [
    [
      "Salario base (horas regulares y días pagados)",
      fmtHours(s.regularHours + s.leaveHours),
      `$${fmt(s.regularPay)}`,
    ],
  ]
  if (s.holidayPay > 0) {
    earnings.push([
      "Recargo por día feriado",
      fmtHours(s.holidayHours),
      `$${fmt(s.holidayPay)}`,
    ])
  }
  earnings.push(["Salario bruto", "", `$${fmt(s.grossSalary)}`])

  autoTable(doc, {
    startY: y,
    head: [["Ingresos", "Horas", "Monto"]],
    body: earnings,
    theme: "grid",
    headStyles: {
      fillColor: NAVY,
      textColor: 255,
      fontSize: 7.5,
      fontStyle: "bold",
      cellPadding: 1.3,
    },
    bodyStyles: {
      fontSize: 8,
      textColor: NAVY,
      lineColor: LINE,
      cellPadding: 1.3,
    },
    columnStyles: {
      1: { halign: "right", cellWidth: 28 },
      2: { halign: "right", cellWidth: 34 },
    },
    // La última fila es el subtotal: se resalta para separarla de los conceptos.
    didParseCell: (d) => {
      if (d.section === "body" && d.row.index === earnings.length - 1) {
        d.cell.styles.fontStyle = "bold"
        d.cell.styles.fillColor = [246, 248, 252]
      }
    },
    margin: { left: M, right: M },
  })

  // Deducciones
  y = (doc as any).lastAutoTable.finalY + 6
  const deductions: (string | number)[][] = []
  if (s.socialSecurityDeduction > 0) {
    deductions.push([
      `Seguro social (${emp.socialSecurityRate}% del salario base)`,
      `$${fmt(s.socialSecurityDeduction)}`,
    ])
  }
  if (s.educationDeduction > 0) {
    deductions.push([
      `Seguro educativo (${emp.educationRate}% del salario base)`,
      `$${fmt(s.educationDeduction)}`,
    ])
  }
  if (s.loanDeduction > 0) {
    deductions.push([
      "Cuota de préstamo o adelanto",
      `$${fmt(s.loanDeduction)}`,
    ])
  }
  if (deductions.length === 0)
    deductions.push(["Sin deducciones aplicables", "$0.00"])
  deductions.push(["Total deducciones", `$${fmt(s.totalDeductions)}`])

  autoTable(doc, {
    startY: y,
    head: [["Deducciones", "Monto"]],
    body: deductions,
    theme: "grid",
    headStyles: {
      fillColor: NAVY,
      textColor: 255,
      fontSize: 7.5,
      fontStyle: "bold",
      cellPadding: 1.3,
    },
    bodyStyles: {
      fontSize: 8,
      textColor: NAVY,
      lineColor: LINE,
      cellPadding: 1.3,
    },
    columnStyles: { 1: { halign: "right", cellWidth: 34 } },
    didParseCell: (d) => {
      if (d.section === "body" && d.row.index === deductions.length - 1) {
        d.cell.styles.fontStyle = "bold"
        d.cell.styles.fillColor = [246, 248, 252]
      }
    },
    margin: { left: M, right: M },
  })

  const manualAdjustments = adjustmentsForPeriod(
    s.employee.id,
    period,
    adjustments,
  )
  // El neto ya trae el ajuste incorporado: si hay monto pero no llegó el
  // desglose, igual se declara una línea para que el bruto y el neto cuadren.
  if (manualAdjustments.length > 0 || (s.manualAdjustment || 0) !== 0) {
    y = (doc as any).lastAutoTable.finalY + 6
    const adjustmentRows = manualAdjustments.map((adj) => [
      adj.kind === "bono" ? "Bono manual" : "Descuento manual",
      adj.note || "—",
      adj.kind === "bono"
        ? `+$${fmt(adj.amount)}`
        : `-$${fmt(adj.amount)}`,
    ])
    // El total sale del cálculo y no de la suma de las filas: si un descuento
    // fue mayor que el neto disponible, se aplicó recortado y el comprobante
    // tiene que mostrar lo que de verdad se descontó.
    const appliedTotal = s.manualAdjustment || 0
    if (adjustmentRows.length === 0) {
      adjustmentRows.push([
        appliedTotal > 0 ? "Bono manual" : "Descuento manual",
        "Registrado en la planilla",
        appliedTotal > 0
          ? `+$${fmt(appliedTotal)}`
          : `-$${fmt(Math.abs(appliedTotal))}`,
      ])
    }
    adjustmentRows.push([
      "Total ajustes aplicados",
      "",
      appliedTotal < 0
        ? `-$${fmt(Math.abs(appliedTotal))}`
        : `+$${fmt(appliedTotal)}`,
    ])

    autoTable(doc, {
      startY: y,
      head: [["Ajustes manuales", "Nota", "Monto"]],
      body: adjustmentRows,
      theme: "grid",
      headStyles: {
        fillColor: NAVY,
        textColor: 255,
        fontSize: 7.5,
        fontStyle: "bold",
        cellPadding: 1.3,
      },
      bodyStyles: {
        fontSize: 8,
        textColor: NAVY,
        lineColor: LINE,
        cellPadding: 1.3,
      },
      columnStyles: {
        2: { halign: "right", cellWidth: 28 },
      },
      didParseCell: (d) => {
        if (d.section !== "body") return
        if (d.row.index === adjustmentRows.length - 1) {
          d.cell.styles.fontStyle = "bold"
          d.cell.styles.fillColor = [246, 248, 252]
        }
        const raw = d.row.raw as unknown
        if (!Array.isArray(raw)) return
        if (raw[0] === "Descuento manual") d.cell.styles.textColor = RED
        if (raw[0] === "Bono manual") d.cell.styles.textColor = GREEN
      },
      margin: { left: M, right: M },
    })
  }

  // Cierre del pago: el neto del salario, las horas extra —que se pagan
  // aparte del sueldo— y el total que se entrega.
  y = (doc as any).lastAutoTable.finalY + 5
  const inner = W - M * 2
  const boxW = (inner - 4) / 2

  doc.setDrawColor(...LINE)
  doc.setLineWidth(0.3)
  doc.roundedRect(M, y, boxW, 14, 2, 2, "S")
  doc.setFont("helvetica", "bold")
  doc.setFontSize(7)
  doc.setTextColor(...MUTED)
  doc.text("SALARIO NETO", M + 4, y + 5.5)
  doc.text(
    s.overtimeHours > 0
      ? `HORAS EXTRA (${fmtHours(s.overtimeHours)})`
      : "HORAS EXTRA",
    M + boxW / 2 + 4,
    y + 5.5,
  )
  doc.setFontSize(10)
  doc.setTextColor(...NAVY)
  doc.text(`$${fmt(s.netSalary)}`, M + 4, y + 11)
  doc.setTextColor(...(s.overtimePay > 0 ? AMBER : MUTED))
  doc.text(`$${fmt(s.overtimePay)}`, M + boxW / 2 + 4, y + 11)

  doc.setFillColor(...NAVY)
  doc.roundedRect(M + boxW + 4, y, boxW, 14, 2, 2, "F")
  doc.setTextColor(255, 255, 255)
  doc.setFont("helvetica", "bold")
  doc.setFontSize(9)
  doc.text("TOTAL A PAGAR", M + boxW + 9, y + 9)
  doc.setFontSize(13)
  doc.setTextColor(...GREEN)
  doc.text(`$${fmt(s.totalPay)}`, W - M - 5, y + 9.5, { align: "right" })
  y += 14

  // Detalle de días: en una línea y no en tabla. Es el mismo dato —el conteo
  // por tipo— en una fracción del alto, y ese alto es el que necesita la
  // asistencia para caber debajo.
  const dayParts = DAY_TYPES.filter((t) => s.dayCounts[t] > 0).map(
    (t) => `${DAY_TYPE_META[t].label} ${s.dayCounts[t]}`,
  )
  if (dayParts.length > 0) {
    y += 4.5
    doc.setFont("helvetica", "bold")
    doc.setFontSize(6.4)
    doc.setTextColor(...MUTED)
    doc.text("DETALLE DE DÍAS", M, y)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(7.5)
    doc.setTextColor(...NAVY)
    doc.text(dayParts.join("   ·   "), M + 30, y)
  }

  const pageH = doc.internal.pageSize.getHeight()
  const signY = pageH - 26

  // Asistencia día por día, en el hueco que queda entre el neto y las firmas.
  if (entries) {
    const { rows, totalHours } = attendanceRows(
      entries,
      emp.id,
      start,
      end,
      emp,
      rules,
    )
    if (rows.length > 0) {
      drawAttendance(doc, rows, totalHours, y + 6, signY - 8 - (y + 6), M, W)
    }
  }

  // Firmas: siempre al pie de la hoja del comprobante, aunque una asistencia
  // excepcionalmente larga se haya derramado a una página extra.
  doc.setPage(firstPage)
  doc.setDrawColor(...MUTED)
  doc.setLineWidth(0.3)
  const half = (W - M * 2 - 20) / 2
  doc.line(M, signY, M + half, signY)
  doc.line(W - M - half, signY, W - M, signY)
  doc.setFontSize(7.5)
  doc.setTextColor(...MUTED)
  doc.setFont("helvetica", "normal")
  doc.text("Recibí conforme — colaborador", M, signY + 4.5)
  doc.text("Autorizado por", W - M - half, signY + 4.5)
  doc.setFontSize(7)
  doc.text(
    `Generado el ${new Date().toLocaleDateString("es-PA")}`,
    W - M,
    pageH - 8,
    { align: "right" },
  )
  // El siguiente comprobante debe añadirse al final, no detrás de esta hoja.
  doc.setPage(doc.getNumberOfPages())
}

/**
 * Arma el comprobante sin escribirlo. Separado de la descarga para poder
 * verificar en pruebas que sigue cabiendo en una sola hoja, que es lo que no
 * se nota al mirar el archivo por encima.
 */
export function buildPayslipDoc(
  s: EmployeeSummary,
  period: PayPeriod,
  companyName = "",
  entries?: TimeEntry[],
  adjustments: PayrollAdjustment[] = [],
  /** Umbral de horas extra; sin él se asume el estándar de 8h diarias. */
  rules: Pick<PayrollRules, "overtimeThreshold"> = { overtimeThreshold: 8 },
): jsPDF {
  const doc = new jsPDF({
    orientation: "portrait",
    format: "letter",
    unit: "mm",
  })
  drawPayslip(doc, s, period, companyName, rules, entries, adjustments)
  return doc
}

export function exportPayslip(
  s: EmployeeSummary,
  period: PayPeriod,
  companyName = "",
  /** Registros del período; sin ellos se omite el detalle de asistencia. */
  entries?: TimeEntry[],
  /** Ajustes manuales del período; sin ellos se omite el detalle de bonos/descuentos. */
  adjustments: PayrollAdjustment[] = [],
  /** Umbral de horas extra; sin él se asume el estándar de 8h diarias. */
  rules: Pick<PayrollRules, "overtimeThreshold"> = { overtimeThreshold: 8 },
): void {
  const doc = buildPayslipDoc(
    s,
    period,
    companyName,
    entries,
    adjustments,
    rules,
  )
  doc.save(
    `comprobante_${fileSlug(s.employee.name)}_${period.year}_${String(period.month).padStart(2, "0")}_q${period.half}.pdf`,
  )
}

export function exportAllPayslips(
  summaries: EmployeeSummary[],
  period: PayPeriod,
  companyName = "",
  /** Registros del período; sin ellos se omite el detalle de asistencia. */
  entries?: TimeEntry[],
  /** Ajustes manuales del período; sin ellos se omite el detalle de bonos/descuentos. */
  adjustments: PayrollAdjustment[] = [],
  /** Umbral de horas extra; sin él se asume el estándar de 8h diarias. */
  rules: Pick<PayrollRules, "overtimeThreshold"> = { overtimeThreshold: 8 },
): void {
  const doc = new jsPDF({
    orientation: "portrait",
    format: "letter",
    unit: "mm",
  })
  summaries.forEach((s, i) => {
    if (i > 0) doc.addPage()
    drawPayslip(doc, s, period, companyName, rules, entries, adjustments)
  })
  doc.save(
    `comprobantes_${period.year}_${String(period.month).padStart(2, "0")}_q${period.half}.pdf`,
  )
}
