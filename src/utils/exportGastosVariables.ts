import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import * as XLSX from "xlsx"
import type { DailyExpense, SupplierPayment } from "../types"
import { PAYMENT_METHOD_LABEL } from "./accounting"
import { fmt } from "./calculations"
import { formatDate } from "./dates"
import { breakdown, groupByDay, rucText } from "./variableExpenses"

const NAVY: [number, number, number] = [22, 36, 61]
const MUTED: [number, number, number] = [100, 116, 139]
const STRIPE: [number, number, number] = [246, 248, 252]

const MONTHS_SHORT = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]
const MONTHS_LONG = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
]

const round = (n: number) => Math.round(n * 100) / 100
const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_")
const byDate = <T extends { date: string; createdAt: string }>(a: T, b: T) =>
  a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt)

function monthName(month: string): string {
  const [y, m] = month.split("-").map(Number)
  return `${MONTHS_LONG[m - 1]} ${y}`
}

/**
 * Tabla "clave × mes" del año: cuánto se gastó en cada tipo (o a cada
 * empresa) mes por mes, con su total. Sirve para ver en qué mes se disparó
 * la gasolina sin sumar a mano.
 */
function byMonthTable<T extends { date: string; amount: number }>(
  list: T[],
  year: number,
  keyOf: (x: T) => string,
  keyLabel: string,
): Record<string, string | number>[] {
  const keys = breakdown(list, keyOf).map((b) => b.key)
  const rows = keys.map((k) => {
    const row: Record<string, string | number> = { [keyLabel]: k }
    let total = 0
    MONTHS_SHORT.forEach((m, i) => {
      const prefix = `${year}-${String(i + 1).padStart(2, "0")}-`
      const sum = list
        .filter((x) => x.date.startsWith(prefix) && keyOf(x).trim().toLowerCase() === k.toLowerCase())
        .reduce((s, x) => s + x.amount, 0)
      row[m] = sum ? round(sum) : ""
      total += sum
    })
    row.Total = round(total)
    return row
  })
  const totalRow: Record<string, string | number> = { [keyLabel]: "TOTAL" }
  MONTHS_SHORT.forEach((m, i) => {
    const prefix = `${year}-${String(i + 1).padStart(2, "0")}-`
    totalRow[m] = round(list.filter((x) => x.date.startsWith(prefix)).reduce((s, x) => s + x.amount, 0))
  })
  totalRow.Total = round(list.reduce((s, x) => s + x.amount, 0))
  return [...rows, totalRow]
}

/* --------------------------------------------------------- Día a día */

export function buildDailyWorkbook(list: DailyExpense[], year: number): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()
  const inYear = list.filter((x) => x.date.startsWith(`${year}-`)).sort(byDate)

  const ws = XLSX.utils.json_to_sheet(
    inYear.length
      ? inYear.map((x) => ({
          Fecha: x.date,
          Tipo: x.category,
          Monto: round(x.amount),
          "Forma de pago": PAYMENT_METHOD_LABEL[x.paymentMethod],
          "Lo pagó": x.paidBy,
          Nota: x.notes,
        }))
      : [{ Fecha: "Sin gastos en el año" }],
  )
  ws["!cols"] = [{ wch: 12 }, { wch: 16 }, { wch: 11 }, { wch: 14 }, { wch: 18 }, { wch: 32 }]
  XLSX.utils.book_append_sheet(wb, ws, `Gastos ${year}`)

  const wsTipo = XLSX.utils.json_to_sheet(byMonthTable(inYear, year, (x) => x.category, "Tipo"))
  wsTipo["!cols"] = [{ wch: 16 }, ...MONTHS_SHORT.map(() => ({ wch: 10 })), { wch: 12 }]
  XLSX.utils.book_append_sheet(wb, wsTipo, "Por tipo")
  return wb
}

export function exportDailyYear(list: DailyExpense[], year: number, companyName: string): void {
  const company = slug(companyName)
  XLSX.writeFile(buildDailyWorkbook(list, year), `gastos_diarios_${company ? `${company}_` : ""}${year}.xlsx`)
}

/* -------------------------------------------------------- Empresas */

export function buildSuppliersWorkbook(list: SupplierPayment[], year: number): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()
  const inYear = list.filter((x) => x.date.startsWith(`${year}-`)).sort(byDate)

  const ws = XLSX.utils.json_to_sheet(
    inYear.length
      ? inYear.map((x) => ({
          Fecha: x.date,
          Empresa: x.supplierName,
          RUC: x.taxId,
          DV: x.dv,
          Concepto: x.concept,
          "N.º de factura": x.invoiceNumber,
          Subtotal: round(x.amount - x.itbms),
          ITBMS: round(x.itbms),
          Total: round(x.amount),
          "Forma de pago": PAYMENT_METHOD_LABEL[x.paymentMethod],
          Notas: x.notes,
        }))
      : [{ Fecha: "Sin pagos en el año" }],
  )
  ws["!cols"] = [
    { wch: 12 }, { wch: 26 }, { wch: 20 }, { wch: 5 }, { wch: 26 }, { wch: 14 },
    { wch: 11 }, { wch: 10 }, { wch: 11 }, { wch: 14 }, { wch: 28 },
  ]
  XLSX.utils.book_append_sheet(wb, ws, `Pagos ${year}`)

  // Por empresa: lo que el contador pide para el anexo de compras.
  const companies = breakdown(inYear, (x) => x.supplierName).map((b) => {
    const rows = inYear.filter((x) => x.supplierName.trim().toLowerCase() === b.key.toLowerCase())
    const last = rows[rows.length - 1]
    const itbms = rows.reduce((s, x) => s + x.itbms, 0)
    return {
      Empresa: b.key,
      RUC: last.taxId,
      DV: last.dv,
      Pagos: b.count,
      Subtotal: round(b.total - itbms),
      ITBMS: round(itbms),
      Total: round(b.total),
    }
  })
  const wsEmp = XLSX.utils.json_to_sheet(companies.length ? companies : [{ Empresa: "Sin pagos en el año" }])
  wsEmp["!cols"] = [{ wch: 26 }, { wch: 20 }, { wch: 5 }, { wch: 7 }, { wch: 11 }, { wch: 10 }, { wch: 11 }]
  XLSX.utils.book_append_sheet(wb, wsEmp, "Por empresa")

  const wsMes = XLSX.utils.json_to_sheet(byMonthTable(inYear, year, (x) => x.supplierName, "Empresa"))
  wsMes["!cols"] = [{ wch: 26 }, ...MONTHS_SHORT.map(() => ({ wch: 10 })), { wch: 12 }]
  XLSX.utils.book_append_sheet(wb, wsMes, "Por mes")
  return wb
}

export function exportSuppliersYear(list: SupplierPayment[], year: number, companyName: string): void {
  const company = slug(companyName)
  XLSX.writeFile(buildSuppliersWorkbook(list, year), `pagos_empresas_${company ? `${company}_` : ""}${year}.xlsx`)
}

/* -------------------------------------------------------- Imprimir */

const M = 14

function newDoc(companyName: string, subtitle: string, today: string): jsPDF {
  const doc = new jsPDF({ orientation: "portrait", format: "letter", unit: "mm" })
  const W = doc.internal.pageSize.getWidth()
  doc.setFillColor(...NAVY)
  doc.rect(0, 0, W, 22, "F")
  doc.setTextColor(255, 255, 255)
  doc.setFont("helvetica", "bold")
  doc.setFontSize(14)
  doc.text(companyName ? companyName.toUpperCase() : "GASTOS", M, 10)
  doc.setFont("helvetica", "normal")
  doc.setFontSize(9)
  doc.text(subtitle, M, 16.5)
  doc.setFontSize(8)
  doc.text(`Generado el ${formatDate(today)}`, W - M, 16.5, { align: "right" })
  return doc
}

function pageNumbers(doc: jsPDF) {
  const W = doc.internal.pageSize.getWidth()
  doc.setFontSize(7)
  doc.setTextColor(...MUTED)
  doc.text(`Página ${doc.getNumberOfPages()}`, W - M, doc.internal.pageSize.getHeight() - 6, {
    align: "right",
  })
}

function openForPrint(doc: jsPDF, filename: string) {
  doc.autoPrint()
  const win = window.open(doc.output("bloburl"), "_blank")
  if (!win) doc.save(filename)
}

/** Los gastos del mes por día, cada día con su total. Respeta el filtro activo. */
export function printDailyMonth(
  list: DailyExpense[],
  month: string,
  companyName: string,
  today: string,
  filter: string | null,
): void {
  const doc = newDoc(
    companyName,
    `Gastos del día a día · ${monthName(month)}${filter ? ` · ${filter}` : ""}`,
    today,
  )
  const body: any[] = []
  for (const day of [...groupByDay(list)].reverse()) {
    body.push([
      { content: formatDate(day.date), colSpan: 3, styles: { fontStyle: "bold", fillColor: STRIPE } },
      { content: `$${fmt(day.total)}`, styles: { fontStyle: "bold", fillColor: STRIPE, halign: "right" } },
    ])
    for (const x of [...day.items].reverse()) {
      body.push([
        x.category,
        [x.notes, x.paidBy && `Pagó ${x.paidBy}`].filter(Boolean).join(" · ") || "—",
        PAYMENT_METHOD_LABEL[x.paymentMethod],
        `$${fmt(x.amount)}`,
      ])
    }
  }
  const total = list.reduce((s, x) => s + x.amount, 0)
  autoTable(doc, {
    startY: 28,
    head: [["Tipo", "Detalle", "Forma de pago", "Monto"]],
    body,
    foot: [[{ content: `${list.length} gastos`, colSpan: 3 }, { content: `$${fmt(total)}`, styles: { halign: "right" } }]],
    theme: "grid",
    headStyles: { fillColor: NAVY, textColor: 255, fontSize: 8.5, fontStyle: "bold" },
    footStyles: { fillColor: NAVY, textColor: 255, fontSize: 8.5, fontStyle: "bold" },
    bodyStyles: { fontSize: 8.5, textColor: NAVY },
    columnStyles: { 0: { cellWidth: 30 }, 2: { cellWidth: 28 }, 3: { cellWidth: 26, halign: "right", fontStyle: "bold" } },
    margin: { left: M, right: M },
    didDrawPage: () => pageNumbers(doc),
  })
  openForPrint(doc, `gastos_diarios_${month}.pdf`)
}

/** Los pagos a empresas del mes, con RUC, DV, factura e ITBMS. */
export function printSuppliersMonth(
  list: SupplierPayment[],
  month: string,
  companyName: string,
  today: string,
  filter: string | null,
): void {
  const doc = newDoc(
    companyName,
    `Pagos a empresas · ${monthName(month)}${filter ? ` · ${filter}` : ""}`,
    today,
  )
  const rows = [...list].sort(byDate)
  const total = rows.reduce((s, x) => s + x.amount, 0)
  const itbms = rows.reduce((s, x) => s + x.itbms, 0)
  autoTable(doc, {
    startY: 28,
    head: [["Fecha", "Empresa", "RUC", "Concepto / factura", "ITBMS", "Total"]],
    body: rows.map((x) => [
      formatDate(x.date),
      x.supplierName,
      rucText(x.taxId, x.dv) || "—",
      [x.concept, x.invoiceNumber && `Fact. ${x.invoiceNumber}`].filter(Boolean).join(" · ") || "—",
      x.itbms ? `$${fmt(x.itbms)}` : "—",
      `$${fmt(x.amount)}`,
    ]),
    foot: [
      [
        { content: `${rows.length} pagos`, colSpan: 4 },
        { content: `$${fmt(itbms)}`, styles: { halign: "right" } },
        { content: `$${fmt(total)}`, styles: { halign: "right" } },
      ],
    ],
    theme: "grid",
    headStyles: { fillColor: NAVY, textColor: 255, fontSize: 8, fontStyle: "bold" },
    footStyles: { fillColor: NAVY, textColor: 255, fontSize: 8, fontStyle: "bold" },
    bodyStyles: { fontSize: 7.8, textColor: NAVY },
    columnStyles: {
      0: { cellWidth: 22 },
      4: { cellWidth: 18, halign: "right" },
      5: { cellWidth: 22, halign: "right", fontStyle: "bold" },
    },
    margin: { left: M, right: M },
    didDrawPage: () => pageNumbers(doc),
  })
  openForPrint(doc, `pagos_empresas_${month}.pdf`)
}
