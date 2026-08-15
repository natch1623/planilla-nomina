import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import type { EmployeeSummary, PayPeriod } from "../types"
import { MONTHS_ES, getPeriodDates } from "../store"
import { calcTotals, fmt, fmtHours } from "./calculations"
import { formatDate } from "./dates"

const NAVY: [number, number, number] = [22, 36, 61]
const MUTED: [number, number, number] = [100, 116, 139]
const GREEN: [number, number, number] = [14, 159, 110]
const AMBER: [number, number, number] = [194, 104, 10]
const STRIPE: [number, number, number] = [246, 248, 252]
const RED: [number, number, number] = [190, 45, 55]

/** Un ajuste manual se lee por su signo: `+` suma al neto, `−` lo recorta. */
function adjustmentCell(amount = 0): string {
  if (!amount) return "—"
  return amount > 0 ? `+$${fmt(amount)}` : `-$${fmt(Math.abs(amount))}`
}

export function exportToPDF(
  summaries: EmployeeSummary[],
  period: PayPeriod,
  companyName = "",
): void {
  const doc = new jsPDF({ orientation: "landscape", format: "a4", unit: "mm" })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 12

  const periodLabel = `${MONTHS_ES[period.month - 1]} ${period.year} — ${
    period.half === 1 ? "1ª quincena (1–15)" : "2ª quincena (16–fin)"
  }`
  const { start, end } = getPeriodDates(period)
  const totals = calcTotals(summaries)

  // Encabezado
  doc.setFillColor(...NAVY)
  doc.rect(0, 0, W, 22, "F")
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(15)
  doc.setFont("helvetica", "bold")
  doc.text(
    companyName ? companyName.toUpperCase() : "PLANILLA DE SALARIOS",
    M,
    11,
  )
  doc.setFontSize(9)
  doc.setFont("helvetica", "normal")
  doc.text(
    companyName
      ? `Planilla de salarios · ${formatDate(start)} – ${formatDate(end)}`
      : `${formatDate(start)} – ${formatDate(end)}`,
    M,
    17.5,
  )
  doc.setFontSize(10)
  doc.text(periodLabel, W - M, 13, { align: "right" })

  // Indicadores
  const tiles = [
    { label: "Colaboradores", value: String(summaries.length) },
    { label: "Días trabajados", value: String(totals.days) },
    { label: "Horas (reg. + extra)", value: fmtHours(totals.hours) },
    { label: "Salario bruto", value: `$${fmt(totals.gross)}` },
    { label: "Horas extra", value: `$${fmt(totals.overtimePay)}` },
    // Seguro social y educativo por separado: son dos retenciones distintas y
    // cada colaborador reclama una u otra, no la suma.
    { label: "Seguro social", value: `-$${fmt(totals.socialSecurity)}` },
    { label: "Seguro educativo", value: `-$${fmt(totals.education)}` },
    // Solo aparece cuando hubo bonos o descuentos manuales: un recuadro en
    // cero ocuparía el ancho de los demás sin decir nada.
    ...(totals.adjustments !== 0
      ? [
          {
            label: "Bonos / desc.",
            value: adjustmentCell(totals.adjustments),
          },
        ]
      : []),
    { label: "Total a pagar", value: `$${fmt(totals.totalPay)}` },
  ]
  const tileW = (W - M * 2 - (tiles.length - 1) * 2) / tiles.length
  tiles.forEach((tile, i) => {
    const x = M + i * (tileW + 2)
    const last = i === tiles.length - 1
    doc.setFillColor(...(last ? NAVY : STRIPE))
    doc.roundedRect(x, 27, tileW, 17, 2, 2, "F")
    doc.setFontSize(6.5)
    doc.setFont("helvetica", "normal")
    doc.setTextColor(
      ...(last ? [160, 180, 210] as [number, number, number] : MUTED),
    )
    doc.text(tile.label.toUpperCase(), x + tileW / 2, 32.5, { align: "center" })
    doc.setFontSize(11)
    doc.setFont("helvetica", "bold")
    doc.setTextColor(...(last ? GREEN : NAVY))
    doc.text(tile.value, x + tileW / 2, 40, { align: "center" })
  })

  // Tabla
  const body = summaries.map((s) => [
    s.employee.name,
    s.employee.idNumber || "—",
    s.employee.category === "profesional" ? "Profesional" : "Empleado",
    String(s.daysWorked),
    fmtHours(s.regularHours),
    s.overtimeHours > 0 ? fmtHours(s.overtimeHours) : "—",
    s.employee.paymentType === "daily"
      ? `$${fmt(s.employee.dailyRate)}/d`
      : s.employee.paymentType === "fixed"
        ? `$${fmt(s.employee.fixedSalary)}/q`
        : `$${fmt(s.employee.hourlyRate)}/h`,
    `$${fmt(s.regularPay)}`,
    s.overtimePay > 0 ? `$${fmt(s.overtimePay)}` : "—",
    s.holidayPay > 0 ? `$${fmt(s.holidayPay)}` : "—",
    `$${fmt(s.grossSalary)}`,
    s.socialSecurityDeduction > 0 ? `$${fmt(s.socialSecurityDeduction)}` : "—",
    s.educationDeduction > 0 ? `$${fmt(s.educationDeduction)}` : "—",
    s.loanDeduction > 0 ? `$${fmt(s.loanDeduction)}` : "—",
    adjustmentCell(s.manualAdjustment),
    `$${fmt(s.netSalary)}`,
    `$${fmt(s.totalPay ?? s.netSalary)}`,
  ])

  autoTable(doc, {
    startY: 49,
    head: [
      [
        "Colaborador",
        "Cédula",
        "Tipo",
        "Días",
        "H. reg.",
        "H. extra",
        "Tarifa",
        "Base",
        "Extras",
        "Feriado",
        "Bruto",
        "Seg. social",
        "Educativo",
        "Préstamo",
        "Bono / desc.",
        "Neto",
        "TOTAL",
      ],
    ],
    body,
    foot: [
      [
        "TOTALES",
        "",
        "",
        String(totals.days),
        fmtHours(totals.regularHours),
        fmtHours(totals.overtimeHours),
        "",
        `$${fmt(totals.regularPay)}`,
        `$${fmt(totals.overtimePay)}`,
        `$${fmt(totals.holidayPay)}`,
        `$${fmt(totals.gross)}`,
        `$${fmt(totals.socialSecurity)}`,
        `$${fmt(totals.education)}`,
        `$${fmt(totals.loans)}`,
        adjustmentCell(totals.adjustments),
        `$${fmt(totals.net)}`,
        `$${fmt(totals.totalPay)}`,
      ],
    ],
    theme: "grid",
    headStyles: {
      fillColor: NAVY,
      textColor: 255,
      fontSize: 7.5,
      fontStyle: "bold",
      halign: "right",
    },
    bodyStyles: { fontSize: 7.5, textColor: NAVY, halign: "right" },
    footStyles: {
      fillColor: NAVY,
      textColor: 255,
      fontSize: 8,
      fontStyle: "bold",
      halign: "right",
    },
    alternateRowStyles: { fillColor: STRIPE },
    columnStyles: {
      0: { cellWidth: 34, halign: "left" },
      1: { cellWidth: 18, halign: "left" },
      2: { cellWidth: 16, halign: "left" },
      8: { textColor: AMBER },
      10: { fontStyle: "bold" },
      16: { fontStyle: "bold", textColor: GREEN },
    },
    // El ajuste manual se pinta por su signo: verde si suma, rojo si recorta.
    // Un color fijo obligaría a leer el número para saber de qué lado está.
    didParseCell: (d) => {
      if (d.column.index !== 14 || d.section !== "body") return
      const text = String(d.cell.raw ?? "")
      if (text.startsWith("+")) d.cell.styles.textColor = GREEN
      else if (text.startsWith("-")) d.cell.styles.textColor = RED
    },
    margin: { left: M, right: M, top: 14 },
    // La cabecera azul solo se dibuja en la primera página; en las siguientes la
    // tabla arranca más arriba y necesita margen superior propio.
    didDrawPage: (d) => {
      if (d.pageNumber > 1) {
        doc.setFontSize(8)
        doc.setTextColor(...MUTED)
        doc.setFont("helvetica", "normal")
        doc.text(
          `${companyName || "Planilla de salarios"} · ${periodLabel}`,
          M,
          9,
        )
      }
    },
  })

  // Pie con numeración real en todas las páginas.
  const pageCount = doc.getNumberOfPages()
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p)
    doc.setFontSize(7)
    doc.setFont("helvetica", "normal")
    doc.setTextColor(...MUTED)
    doc.text(`Generado el ${new Date().toLocaleDateString("es-PA")}`, M, H - 6)
    doc.text(`Página ${p} de ${pageCount}`, W - M, H - 6, { align: "right" })
  }

  doc.save(
    `planilla_${period.year}_${String(period.month).padStart(2, "0")}_q${period.half}.pdf`,
  )
}
