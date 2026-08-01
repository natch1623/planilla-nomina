import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import type { EmployeeSummary, PayPeriod } from "../types"
import { MONTHS_ES, getPeriodDates } from "../store"
import { DAY_TYPE_META, DAY_TYPES, fmt, fmtHours } from "./calculations"
import { formatDate } from "./dates"

/* Marcas diacríticas combinantes. Se construye desde una cadena ASCII para que
   el patrón sobreviva a cualquier recodificación del archivo fuente. */
const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g")

const NAVY: [number, number, number] = [22, 36, 61]
const MUTED: [number, number, number] = [100, 116, 139]
const LINE: [number, number, number] = [225, 231, 240]
const GREEN: [number, number, number] = [14, 159, 110]

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
 * Dibuja un comprobante en la página actual del documento.
 * Se separa de la exportación para poder encadenar varios en un solo PDF.
 */
function drawPayslip(
  doc: jsPDF,
  s: EmployeeSummary,
  period: PayPeriod,
  companyName: string,
): void {
  const W = doc.internal.pageSize.getWidth()
  const M = 16
  const { start, end } = getPeriodDates(period)
  const emp = s.employee

  // Encabezado
  doc.setFillColor(...NAVY)
  doc.rect(0, 0, W, 26, "F")
  doc.setTextColor(255, 255, 255)
  doc.setFont("helvetica", "bold")
  doc.setFontSize(13)
  doc.text("COMPROBANTE DE PAGO", M, 12)
  doc.setFont("helvetica", "normal")
  doc.setFontSize(8.5)
  doc.text(periodTitle(period), M, 19)
  if (companyName) {
    doc.setFont("helvetica", "bold")
    doc.setFontSize(10)
    doc.text(companyName, W - M, 12, { align: "right" })
  }
  doc.setFont("helvetica", "normal")
  doc.setFontSize(8)
  doc.text(`${formatDate(start)} – ${formatDate(end)}`, W - M, 19, {
    align: "right",
  })

  // Datos del colaborador
  let y = 36
  doc.setTextColor(...NAVY)
  doc.setFont("helvetica", "bold")
  doc.setFontSize(12)
  doc.text(emp.name, M, y)

  doc.setFont("helvetica", "normal")
  doc.setFontSize(8.5)
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
    ["Tarifa por hora", `$${fmt(emp.hourlyRate)}`],
    ["Ingreso", emp.startDate ? formatDate(emp.startDate) : "—"],
    ["Días trabajados", String(s.daysWorked)],
  ]
  y += 7
  facts.forEach(([k, v], i) => {
    const col = i % 3
    const row = Math.floor(i / 3)
    const x = M + col * ((W - M * 2) / 3)
    doc.setTextColor(...MUTED)
    doc.text(k.toUpperCase(), x, y + row * 11)
    doc.setTextColor(...NAVY)
    doc.setFont("helvetica", "bold")
    doc.text(v, x, y + row * 11 + 5)
    doc.setFont("helvetica", "normal")
  })
  y += 26

  // Ingresos
  const earnings: (string | number)[][] = [
    [
      "Salario base (horas regulares y días pagados)",
      fmtHours(s.regularHours + s.leaveHours),
      `$${fmt(s.regularPay)}`,
    ],
  ]
  if (s.overtimePay > 0) {
    earnings.push([
      "Horas extra",
      fmtHours(s.overtimeHours),
      `$${fmt(s.overtimePay)}`,
    ])
  }
  if (s.holidayPay > 0) {
    earnings.push([
      "Recargo por día feriado",
      fmtHours(s.holidayHours),
      `$${fmt(s.holidayPay)}`,
    ])
  }
  earnings.push(["Total ingresos", "", `$${fmt(s.grossSalary)}`])

  autoTable(doc, {
    startY: y,
    head: [["Ingresos", "Horas", "Monto"]],
    body: earnings,
    theme: "grid",
    headStyles: {
      fillColor: NAVY,
      textColor: 255,
      fontSize: 8.5,
      fontStyle: "bold",
    },
    bodyStyles: { fontSize: 9, textColor: NAVY, lineColor: LINE },
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
      fontSize: 8.5,
      fontStyle: "bold",
    },
    bodyStyles: { fontSize: 9, textColor: NAVY, lineColor: LINE },
    columnStyles: { 1: { halign: "right", cellWidth: 34 } },
    didParseCell: (d) => {
      if (d.section === "body" && d.row.index === deductions.length - 1) {
        d.cell.styles.fontStyle = "bold"
        d.cell.styles.fillColor = [246, 248, 252]
      }
    },
    margin: { left: M, right: M },
  })

  // Neto
  y = (doc as any).lastAutoTable.finalY + 8
  doc.setFillColor(...NAVY)
  doc.roundedRect(M, y, W - M * 2, 18, 2, 2, "F")
  doc.setTextColor(255, 255, 255)
  doc.setFont("helvetica", "bold")
  doc.setFontSize(10)
  doc.text("NETO A PAGAR", M + 6, y + 11.5)
  doc.setFontSize(15)
  doc.setTextColor(...GREEN)
  doc.text(`$${fmt(s.netSalary)}`, W - M - 6, y + 12, { align: "right" })

  // Detalle de días
  y += 26
  const dayRows = DAY_TYPES.filter((t) => s.dayCounts[t] > 0).map((t) => [
    DAY_TYPE_META[t].label,
    String(s.dayCounts[t]),
  ])
  if (dayRows.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [["Detalle de días", "Cantidad"]],
      body: dayRows,
      theme: "plain",
      headStyles: { textColor: MUTED, fontSize: 8, fontStyle: "bold" },
      bodyStyles: { fontSize: 8.5, textColor: NAVY },
      columnStyles: { 1: { halign: "right", cellWidth: 24 } },
      margin: { left: M, right: W / 2 },
    })
    y = (doc as any).lastAutoTable.finalY
  }

  // Firmas
  const signY = Math.max(y + 26, doc.internal.pageSize.getHeight() - 34)
  doc.setDrawColor(...MUTED)
  doc.setLineWidth(0.3)
  const half = (W - M * 2 - 20) / 2
  doc.line(M, signY, M + half, signY)
  doc.line(W - M - half, signY, W - M, signY)
  doc.setFontSize(8)
  doc.setTextColor(...MUTED)
  doc.setFont("helvetica", "normal")
  doc.text("Recibí conforme — colaborador", M, signY + 5)
  doc.text("Autorizado por", W - M - half, signY + 5)
  doc.setFontSize(7)
  doc.text(
    `Generado el ${new Date().toLocaleDateString("es-PA")}`,
    W - M,
    doc.internal.pageSize.getHeight() - 8,
    { align: "right" },
  )
}

export function exportPayslip(
  s: EmployeeSummary,
  period: PayPeriod,
  companyName = "",
): void {
  const doc = new jsPDF({
    orientation: "portrait",
    format: "letter",
    unit: "mm",
  })
  drawPayslip(doc, s, period, companyName)
  doc.save(
    `comprobante_${fileSlug(s.employee.name)}_${period.year}_${String(period.month).padStart(2, "0")}_q${period.half}.pdf`,
  )
}

export function exportAllPayslips(
  summaries: EmployeeSummary[],
  period: PayPeriod,
  companyName = "",
): void {
  const doc = new jsPDF({
    orientation: "portrait",
    format: "letter",
    unit: "mm",
  })
  summaries.forEach((s, i) => {
    if (i > 0) doc.addPage()
    drawPayslip(doc, s, period, companyName)
  })
  doc.save(
    `comprobantes_${period.year}_${String(period.month).padStart(2, "0")}_q${period.half}.pdf`,
  )
}
