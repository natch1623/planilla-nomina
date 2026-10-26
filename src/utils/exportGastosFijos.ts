import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import * as XLSX from "xlsx"
import type { FixedExpense, FixedExpensePayment } from "../types"
import { PAYMENT_METHOD_LABEL } from "./accounting"
import { fmt } from "./calculations"
import { formatDate } from "./dates"
import type { FixedExpenseMonthRow } from "./fixedExpenses"
import { FREQUENCY_LABEL, dueText, paymentsFor } from "./fixedExpenses"

const NAVY: [number, number, number] = [22, 36, 61]
const MUTED: [number, number, number] = [100, 116, 139]
const RED: [number, number, number] = [190, 45, 55]
const GREEN: [number, number, number] = [4, 120, 87]

const MONTHS_SHORT = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]
const MONTHS_LONG = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
]

const round = (n: number) => Math.round(n * 100) / 100
const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_")

function monthName(month: string): string {
  const [y, m] = month.split("-").map(Number)
  return `${MONTHS_LONG[m - 1]} ${y}`
}

/**
 * Libro del año: una hoja con lo pagado por servicio y mes (para ver de un
 * vistazo en qué meses subió algo) y otra con cada pago, que es lo que pide
 * el contador.
 */
export function buildFixedExpensesWorkbook(
  expenses: FixedExpense[],
  payments: FixedExpensePayment[],
  year: number,
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`)
  const inYear = payments.filter((p) => p.month.startsWith(`${year}-`))
  // Solo los servicios con algún pago en el año, más los activos.
  const shown = expenses.filter((e) => e.active || inYear.some((p) => p.expenseId === e.id))

  const totalsByMonth = months.map(() => 0)
  const resumen = shown.map((e) => {
    const row: Record<string, string | number> = {
      Servicio: e.name,
      Proveedor: e.provider,
      Frecuencia: FREQUENCY_LABEL[e.frequency],
    }
    let total = 0
    months.forEach((m, i) => {
      const paid = paymentsFor(payments, e.id, m).reduce((a, p) => a + p.amount, 0)
      row[MONTHS_SHORT[i]] = paid ? round(paid) : ""
      total += paid
      totalsByMonth[i] += paid
    })
    row.Total = round(total)
    return row
  })
  const totalRow: Record<string, string | number> = { Servicio: "TOTAL", Proveedor: "", Frecuencia: "" }
  months.forEach((_, i) => (totalRow[MONTHS_SHORT[i]] = round(totalsByMonth[i])))
  totalRow.Total = round(totalsByMonth.reduce((a, n) => a + n, 0))

  const wsResumen = XLSX.utils.json_to_sheet([...resumen, totalRow])
  wsResumen["!cols"] = [{ wch: 18 }, { wch: 20 }, { wch: 14 }, ...months.map(() => ({ wch: 10 })), { wch: 12 }]
  XLSX.utils.book_append_sheet(wb, wsResumen, `Resumen ${year}`)

  const byId = new Map(expenses.map((e) => [e.id, e]))
  const pagos = [...inYear]
    .sort(
      (a, b) =>
        a.month.localeCompare(b.month) ||
        (byId.get(a.expenseId)?.name ?? "").localeCompare(byId.get(b.expenseId)?.name ?? "") ||
        a.paidOn.localeCompare(b.paidOn),
    )
    .map((p) => {
      const e = byId.get(p.expenseId)
      return {
        Mes: monthName(p.month),
        Servicio: e?.name ?? "",
        Proveedor: e?.provider ?? "",
        Cuenta: e?.accountNumber ?? "",
        Monto: round(p.amount),
        Tipo: p.partial ? "Abono" : "Pago",
        "Fecha de pago": p.paidOn,
        "Forma de pago": PAYMENT_METHOD_LABEL[p.paymentMethod],
        "N.º de factura": p.reference,
        Notas: p.notes,
      }
    })
  const wsPagos = XLSX.utils.json_to_sheet(pagos.length ? pagos : [{ Mes: "Sin pagos en el año" }])
  wsPagos["!cols"] = [
    { wch: 16 }, { wch: 18 }, { wch: 20 }, { wch: 16 }, { wch: 11 },
    { wch: 8 }, { wch: 13 }, { wch: 14 }, { wch: 16 }, { wch: 30 },
  ]
  XLSX.utils.book_append_sheet(wb, wsPagos, "Pagos")

  return wb
}

export function exportFixedExpensesWorkbook(
  expenses: FixedExpense[],
  payments: FixedExpensePayment[],
  year: number,
  companyName: string,
): void {
  const wb = buildFixedExpensesWorkbook(expenses, payments, year)
  const company = slug(companyName)
  XLSX.writeFile(wb, `gastos_fijos_${company ? `${company}_` : ""}${year}.xlsx`)
}

const M = 14

const STATE_TEXT: Record<FixedExpenseMonthRow["state"], string> = {
  pagado: "Pagado",
  vencido: "Vencido",
  "por-vencer": "Vence pronto",
  pendiente: "Pendiente",
  "no-aplica": "—",
}

/**
 * Hoja del mes lista para imprimir: cada servicio con su estado, lo pagado
 * y lo que falta. Abre el diálogo de impresión; si el navegador bloquea la
 * ventana nueva, se descarga el PDF.
 */
export function printFixedExpensesMonth(
  rows: FixedExpenseMonthRow[],
  month: string,
  companyName: string,
  today: string,
): void {
  const doc = new jsPDF({ orientation: "portrait", format: "letter", unit: "mm" })
  const W = doc.internal.pageSize.getWidth()
  doc.setFillColor(...NAVY)
  doc.rect(0, 0, W, 22, "F")
  doc.setTextColor(255, 255, 255)
  doc.setFont("helvetica", "bold")
  doc.setFontSize(14)
  doc.text(companyName ? companyName.toUpperCase() : "GASTOS FIJOS", M, 10)
  doc.setFont("helvetica", "normal")
  doc.setFontSize(9)
  doc.text(`Gastos fijos · ${monthName(month)}`, M, 16.5)
  doc.setFontSize(8)
  doc.text(`Generado el ${formatDate(today)}`, W - M, 16.5, { align: "right" })

  let paid = 0
  let pending = 0
  const body = rows.map((r) => {
    paid += r.paid
    if (r.state !== "pagado") pending += Math.max(0, r.amount - r.paid)
    const when = r.payment
      ? `Pagado el ${formatDate(r.payment.paidOn)}`
      : dueText(r.dueDate, today) || "—"
    return [
      r.expense.name,
      r.expense.provider || "—",
      when,
      {
        content: r.state !== "pagado" && r.paid > 0 ? `Abonado $${fmt(r.paid)}` : STATE_TEXT[r.state],
        styles: {
          textColor: r.state === "pagado" ? GREEN : r.state === "vencido" ? RED : NAVY,
          fontStyle: "bold" as const,
        },
      },
      r.state === "pagado" ? `$${fmt(r.amount)}` : r.amount > 0 ? `aprox. $${fmt(r.amount)}` : "—",
    ]
  })

  autoTable(doc, {
    startY: 28,
    head: [["Servicio", "Proveedor", "Fecha", "Estado", "Monto"]],
    body,
    foot: [
      [
        { content: `Pagado $${fmt(paid)}`, colSpan: 3 },
        { content: `Falta aprox. $${fmt(pending)}`, colSpan: 2, styles: { halign: "right" } },
      ],
    ],
    theme: "grid",
    headStyles: { fillColor: NAVY, textColor: 255, fontSize: 8.5, fontStyle: "bold" },
    footStyles: { fillColor: NAVY, textColor: 255, fontSize: 8.5, fontStyle: "bold" },
    bodyStyles: { fontSize: 8.5, textColor: NAVY },
    columnStyles: { 4: { halign: "right", cellWidth: 32 } },
    margin: { left: M, right: M },
    didDrawPage: () => {
      doc.setFontSize(7)
      doc.setTextColor(...MUTED)
      doc.text(`Página ${doc.getNumberOfPages()}`, W - M, doc.internal.pageSize.getHeight() - 6, {
        align: "right",
      })
    },
  })

  doc.autoPrint()
  const win = window.open(doc.output("bloburl"), "_blank")
  if (!win) doc.save(`gastos_fijos_${month}.pdf`)
}
