import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import * as XLSX from "xlsx"
import type { CostCashCount, CostEntry } from "../types"
import { fmt } from "./calculations"
import { signedAmount } from "./costs"
import { formatDate, formatDateTime, localDay, todayISO } from "./dates"

const NAVY: [number, number, number] = [22, 36, 61]
const MUTED: [number, number, number] = [100, 116, 139]
const GREEN: [number, number, number] = [14, 159, 110]
const RED: [number, number, number] = [190, 45, 55]
const STRIPE: [number, number, number] = [246, 248, 252]

const round = (n: number) => Math.round(n * 100) / 100
// Guion normal, no "−": las fuentes estándar de jsPDF no traen ese signo.
const signed = (n: number) => `${n < 0 ? "-" : "+"}$${fmt(Math.abs(n))}`
const KIND = { cobro: "Cobro", pago: "Pago" } as const

function sortByDate(entries: CostEntry[]): CostEntry[] {
  return [...entries].sort(
    (a, b) =>
      a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt),
  )
}

function dailySummary(entries: CostEntry[]) {
  const map = new Map<string, { cobros: number; pagos: number }>()
  for (const c of entries) {
    const d = map.get(c.date) ?? { cobros: 0, pagos: 0 }
    if (c.kind === "cobro") d.cobros += c.amount
    else d.pagos += c.amount
    map.set(c.date, d)
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({ date, ...d, balance: d.cobros - d.pagos }))
}

/**
 * Libro de Excel con los movimientos que se están viendo (respeta filtro y
 * búsqueda), el resumen por día y los arqueos de caja.
 */
export function buildCajaWorkbook(
  entries: CostEntry[],
  cashCounts: CostCashCount[],
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()

  const movimientos = sortByDate(entries).map((c) => ({
    Fecha: c.date,
    Tipo: KIND[c.kind],
    Nombre: c.recipientName,
    "RUC / Cédula": c.taxId,
    Consulta: c.concept,
    Detalle: c.comment,
    Cantidad: c.quantity,
    Monto: round(signedAmount(c)),
    Encargada: c.processedBy,
  }))
  const wsMov = XLSX.utils.json_to_sheet(movimientos)
  wsMov["!cols"] = [
    { wch: 12 },
    { wch: 8 },
    { wch: 28 },
    { wch: 16 },
    { wch: 24 },
    { wch: 28 },
    { wch: 9 },
    { wch: 12 },
    { wch: 18 },
  ]
  XLSX.utils.book_append_sheet(wb, wsMov, "Movimientos")

  const days = dailySummary(entries)
  const wsDias = XLSX.utils.json_to_sheet([
    ...days.map((d) => ({
      Fecha: d.date,
      Cobros: round(d.cobros),
      Pagos: round(-d.pagos) || 0,
      "Balance diario": round(d.balance),
    })),
    {
      Fecha: "TOTAL",
      Cobros: round(days.reduce((a, d) => a + d.cobros, 0)),
      Pagos: round(-days.reduce((a, d) => a + d.pagos, 0)) || 0,
      "Balance diario": round(days.reduce((a, d) => a + d.balance, 0)),
    },
  ])
  wsDias["!cols"] = [{ wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 15 }]
  XLSX.utils.book_append_sheet(wb, wsDias, "Resumen diario")

  if (cashCounts.length > 0) {
    const wsArq = XLSX.utils.json_to_sheet(
      [...cashCounts]
        .sort((a, b) => a.at.localeCompare(b.at))
        .map((s) => ({
          "Fecha y hora": formatDateTime(s.at),
          Encargada: s.operatorName,
          Tipo: s.kind === "apertura" ? "Inicio de turno" : "Cierre de turno",
          Efectivo: round(s.cashOnHand),
          Detalles: s.notes,
        })),
    )
    wsArq["!cols"] = [{ wch: 22 }, { wch: 18 }, { wch: 16 }, { wch: 12 }, { wch: 36 }]
    XLSX.utils.book_append_sheet(wb, wsArq, "Arqueos")
  }

  return wb
}

export function exportCajaWorkbook(
  entries: CostEntry[],
  cashCounts: CostCashCount[],
  companyName: string,
): void {
  const wb = buildCajaWorkbook(entries, cashCounts)
  const slug = companyName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_")
  XLSX.writeFile(wb, `caja_${slug ? `${slug}_` : ""}${todayISO()}.xlsx`)
}

const M = 14

function newDoc(companyName: string, subtitle: string): jsPDF {
  const doc = new jsPDF({ orientation: "portrait", format: "letter", unit: "mm" })
  const W = doc.internal.pageSize.getWidth()
  doc.setFillColor(...NAVY)
  doc.rect(0, 0, W, 22, "F")
  doc.setTextColor(255, 255, 255)
  doc.setFont("helvetica", "bold")
  doc.setFontSize(14)
  doc.text(companyName ? companyName.toUpperCase() : "CAJA", M, 10)
  doc.setFont("helvetica", "normal")
  doc.setFontSize(9)
  doc.text(subtitle, M, 16.5)
  doc.setFontSize(8)
  doc.text(`Generado el ${formatDate(todayISO())}`, W - M, 16.5, { align: "right" })
  return doc
}

/** Movimientos agrupados por día, cada día con su balance, y el total. */
function movementsTable(doc: jsPDF, entries: CostEntry[], startY: number) {
  const W = doc.internal.pageSize.getWidth()
  const body: any[] = []
  const sorted = sortByDate(entries)
  for (const day of dailySummary(entries)) {
    body.push([
      {
        content: formatDate(day.date),
        colSpan: 5,
        styles: { fontStyle: "bold", fillColor: STRIPE },
      },
      {
        content: `Balance diario ${signed(day.balance)}`,
        styles: {
          fontStyle: "bold",
          fillColor: STRIPE,
          halign: "right",
          textColor: day.balance < 0 ? RED : GREEN,
        },
      },
    ])
    for (const c of sorted.filter((x) => x.date === day.date)) {
      body.push([
        KIND[c.kind],
        c.recipientName,
        c.concept || "—",
        String(c.quantity),
        c.processedBy || "—",
        {
          content: signed(signedAmount(c)),
          styles: { textColor: c.kind === "cobro" ? GREEN : RED },
        },
      ])
    }
  }
  const total = entries.reduce((a, c) => a + signedAmount(c), 0)

  autoTable(doc, {
    startY,
    head: [["Tipo", "Nombre", "Consulta", "Cant.", "Encargada", "Monto"]],
    body,
    foot: [
      [
        { content: `${entries.length} movimientos`, colSpan: 5 },
        { content: signed(total), styles: { halign: "right" } },
      ],
    ],
    theme: "grid",
    headStyles: { fillColor: NAVY, textColor: 255, fontSize: 8.5, fontStyle: "bold" },
    footStyles: { fillColor: NAVY, textColor: 255, fontSize: 8.5, fontStyle: "bold" },
    bodyStyles: { fontSize: 8, textColor: NAVY },
    columnStyles: {
      0: { cellWidth: 16 },
      3: { cellWidth: 12, halign: "right" },
      5: { cellWidth: 28, halign: "right", fontStyle: "bold" },
    },
    margin: { left: M, right: M },
    didDrawPage: () => {
      doc.setFontSize(7)
      doc.setTextColor(...MUTED)
      doc.text(
        `Página ${doc.getNumberOfPages()}`,
        W - M,
        doc.internal.pageSize.getHeight() - 6,
        { align: "right" },
      )
    },
  })
}

/**
 * Abre el PDF con el diálogo de impresión del navegador; si el navegador
 * bloquea la ventana nueva, lo descarga.
 */
function openForPrint(doc: jsPDF, filename: string) {
  doc.autoPrint()
  const win = window.open(doc.output("bloburl"), "_blank")
  if (!win) doc.save(filename)
}

/**
 * Inicios y cierres de turno: cuánto efectivo había en caja y lo que dejó
 * anotado cada encargada al cerrar.
 */
function cashCountsTable(doc: jsPDF, counts: CostCashCount[], startY: number) {
  autoTable(doc, {
    startY,
    head: [["Arqueos de caja", "Encargada", "Tipo", "Efectivo en caja", "Detalles"]],
    body: [...counts]
      .sort((a, b) => a.at.localeCompare(b.at))
      .map((s) => [
        formatDateTime(s.at),
        s.operatorName || "—",
        s.kind === "apertura" ? "Inicio de turno" : "Cierre de turno",
        `$${fmt(s.cashOnHand)}`,
        s.notes || "—",
      ]),
    theme: "grid",
    headStyles: { fillColor: NAVY, textColor: 255, fontSize: 8.5, fontStyle: "bold" },
    bodyStyles: { fontSize: 8, textColor: NAVY },
    columnStyles: {
      0: { cellWidth: 34 },
      2: { cellWidth: 26 },
      3: { cellWidth: 26, halign: "right", fontStyle: "bold" },
    },
    margin: { left: M, right: M },
  })
}

/**
 * Hoja lista para imprimir con los movimientos que se están viendo y los
 * arqueos de esos mismos días.
 */
export function printCaja(
  entries: CostEntry[],
  cashCounts: CostCashCount[],
  companyName: string,
): void {
  const doc = newDoc(companyName, "Movimientos en caja")
  movementsTable(doc, entries, 28)
  const days = new Set(entries.map((c) => c.date))
  const counts = cashCounts.filter((s) => days.has(localDay(s.at)))
  if (counts.length > 0) {
    cashCountsTable(doc, counts, (doc as any).lastAutoTable.finalY + 8)
  }
  openForPrint(doc, `caja_${todayISO()}.pdf`)
}

export interface ShiftReport {
  operatorName: string
  /** ISO; vacío si el turno se abrió antes de que se guardara la hora. */
  startedAt: string
  entries: CostEntry[]
  openingCash?: number
  expectedCash?: number
  /** Lo que la encargada contó al cerrar; vacío si aún no lo escribió. */
  countedCash?: number
  notes: string
}

/**
 * Comprobante de un solo turno, para que la encargada se lleve (o archive)
 * lo que registró: resumen de efectivo arriba y sus movimientos abajo.
 */
export function printShift(report: ShiftReport, companyName: string): void {
  const doc = newDoc(companyName, `Turno de ${report.operatorName}`)
  const cobros = report.entries
    .filter((c) => c.kind === "cobro")
    .reduce((a, c) => a + c.amount, 0)
  const pagos = report.entries
    .filter((c) => c.kind === "pago")
    .reduce((a, c) => a + c.amount, 0)
  const money = (n: number) => `$${fmt(n)}`

  const rows: [string, string][] = [
    ["Encargada", report.operatorName],
    ["Inicio", report.startedAt ? formatDateTime(report.startedAt) : "—"],
    ["Cierre", formatDateTime(new Date().toISOString())],
  ]
  if (report.openingCash !== undefined)
    rows.push(["Efectivo al iniciar", money(report.openingCash)])
  rows.push(["Cobros", `+${money(cobros)}`], ["Pagos", `-${money(pagos)}`])
  rows.push(["Balance del turno", signed(cobros - pagos)])
  if (report.expectedCash !== undefined)
    rows.push(["En caja", money(report.expectedCash)])
  if (report.countedCash !== undefined)
    rows.push(["Efectivo contado al cerrar", money(report.countedCash)])
  if (report.notes.trim()) rows.push(["Detalles", report.notes.trim()])

  autoTable(doc, {
    startY: 28,
    body: rows,
    theme: "plain",
    bodyStyles: { fontSize: 9, textColor: NAVY, cellPadding: 1.6 },
    columnStyles: {
      0: { cellWidth: 55, textColor: MUTED },
      1: { fontStyle: "bold" },
    },
    margin: { left: M, right: M },
  })

  const afterSummary = (doc as any).lastAutoTable.finalY + 6
  if (report.entries.length > 0) {
    movementsTable(doc, report.entries, afterSummary)
  } else {
    doc.setFontSize(9)
    doc.setTextColor(...MUTED)
    doc.text("Sin movimientos registrados en este turno.", M, afterSummary + 4)
  }

  const slug = report.operatorName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_")
  openForPrint(doc, `turno_${slug}_${todayISO()}.pdf`)
}
