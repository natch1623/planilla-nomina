import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import * as XLSX from "xlsx"
import type { AppData } from "../types"
import type { PayrollRules } from "./calculations"
import { fmt } from "./calculations"
import {
  PAYMENT_METHOD_LABEL,
  RECURRENCE_LABEL,
  buildMonthlySeries,
  currentMonthKey,
  monthLabel,
  projectFutureMonths,
} from "./accounting"
import {
  budgetStatuses,
  calcCashFlow,
  calcHealth,
  comparePeriods,
} from "./finance"
import { loanStatus } from "./loans"
import { formatDate, todayISO } from "./dates"

const NAVY: [number, number, number] = [22, 36, 61]
const MUTED: [number, number, number] = [100, 116, 139]
const GREEN: [number, number, number] = [14, 159, 110]
const RED: [number, number, number] = [190, 45, 55]
const STRIPE: [number, number, number] = [246, 248, 252]

const round = (n: number) => Math.round(n * 100) / 100
const money = (n: number) => `$${fmt(n)}`

/* ============================================================ PDF */

/**
 * Estado financiero de una página: caja, resultado del mes, indicadores de
 * salud y proyección. Es el documento que se lleva a una reunión, así que
 * prioriza el resumen sobre el detalle.
 */
export function exportFinancialReportPDF(
  data: AppData,
  rules: PayrollRules,
): void {
  const doc = new jsPDF({
    orientation: "portrait",
    format: "letter",
    unit: "mm",
  })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 14

  const series = buildMonthlySeries(data, rules, 24)
  const projected = projectFutureMonths(series, data, rules, { monthsAhead: 3 })
  const cash = calcCashFlow(data, rules)
  const health = calcHealth(data, series, cash, rules)
  const cur = currentMonthKey()
  const mCur = series.find((m) => m.key === cur)

  // Encabezado
  doc.setFillColor(...NAVY)
  doc.rect(0, 0, W, 24, "F")
  doc.setTextColor(255, 255, 255)
  doc.setFont("helvetica", "bold")
  doc.setFontSize(14)
  doc.text(
    data.companyName ? data.companyName.toUpperCase() : "ESTADO FINANCIERO",
    M,
    11,
  )
  doc.setFont("helvetica", "normal")
  doc.setFontSize(9)
  doc.text(`Estado financiero · ${monthLabel(cur)}`, M, 18)
  doc.setFontSize(8)
  doc.text(`Generado el ${formatDate(todayISO())}`, W - M, 18, {
    align: "right",
  })

  // Tarjetas de caja
  const tiles = [
    { label: "Dinero disponible", value: money(cash.saldoActual) },
    { label: "Por entrar", value: money(cash.porEntrar) },
    { label: "Por salir", value: money(cash.porSalir) },
    { label: "Saldo proyectado", value: money(cash.saldoProyectado) },
  ]
  const tileW = (W - M * 2 - (tiles.length - 1) * 3) / tiles.length
  tiles.forEach((t, i) => {
    const x = M + i * (tileW + 3)
    doc.setFillColor(...STRIPE)
    doc.roundedRect(x, 30, tileW, 18, 2, 2, "F")
    doc.setFontSize(6.5)
    doc.setTextColor(...MUTED)
    doc.setFont("helvetica", "normal")
    doc.text(t.label.toUpperCase(), x + tileW / 2, 36, { align: "center" })
    doc.setFontSize(11)
    doc.setFont("helvetica", "bold")
    doc.setTextColor(...NAVY)
    doc.text(t.value, x + tileW / 2, 43.5, { align: "center" })
  })

  // Resultado del mes
  autoTable(doc, {
    startY: 54,
    head: [["Resultado de " + monthLabel(cur), "Monto"]],
    body: [
      ["Ingresos", money(mCur?.ingresos ?? 0)],
      ["Gastos operativos", money(mCur?.gastosManual ?? 0)],
      ["Nómina", money(mCur?.gastosNomina ?? 0)],
      ["Gastos totales", money(mCur?.gastosTotal ?? 0)],
      ["Utilidad del mes", money(mCur?.balance ?? 0)],
      ["Flujo neto de caja", money(mCur?.flujoNeto ?? 0)],
    ],
    theme: "grid",
    headStyles: {
      fillColor: NAVY,
      textColor: 255,
      fontSize: 9,
      fontStyle: "bold",
    },
    bodyStyles: { fontSize: 9, textColor: NAVY },
    columnStyles: { 1: { halign: "right", cellWidth: 45 } },
    didParseCell: (d) => {
      if (d.section !== "body") return
      // Las dos últimas filas son resultado, no detalle: se resaltan.
      if (d.row.index >= 4) {
        d.cell.styles.fontStyle = "bold"
        d.cell.styles.fillColor = STRIPE
        if (d.column.index === 1) {
          const value =
            d.row.index === 4 ? (mCur?.balance ?? 0) : (mCur?.flujoNeto ?? 0)
          d.cell.styles.textColor = value >= 0 ? GREEN : RED
        }
      }
    },
    margin: { left: M, right: M },
  })

  // Indicadores de salud
  autoTable(doc, {
    startY: (doc as any).lastAutoTable.finalY + 6,
    head: [["Indicador", "Valor", "Lectura"]],
    body: health.indicators.map((i) => [i.label, i.display, i.hint]),
    theme: "grid",
    headStyles: {
      fillColor: NAVY,
      textColor: 255,
      fontSize: 9,
      fontStyle: "bold",
    },
    bodyStyles: { fontSize: 8.5, textColor: NAVY },
    columnStyles: {
      1: { halign: "right", cellWidth: 28, fontStyle: "bold" },
      2: { textColor: MUTED, fontSize: 7.5 },
    },
    margin: { left: M, right: M },
  })

  // Proyección
  autoTable(doc, {
    startY: (doc as any).lastAutoTable.finalY + 6,
    head: [["Proyección", "Ingresos", "Gastos", "Balance"]],
    body: projected.map((m) => [
      m.label,
      money(m.ingresos),
      money(m.gastosTotal),
      money(m.balance),
    ]),
    theme: "grid",
    headStyles: {
      fillColor: NAVY,
      textColor: 255,
      fontSize: 9,
      fontStyle: "bold",
    },
    bodyStyles: { fontSize: 8.5, textColor: NAVY, halign: "right" },
    columnStyles: { 0: { halign: "left", fontStyle: "bold" } },
    margin: { left: M, right: M },
  })

  doc.setFontSize(7)
  doc.setTextColor(...MUTED)
  doc.setFont("helvetica", "normal")
  doc.text(
    "La proyección combina compromisos registrados, movimientos recurrentes y el promedio reciente. Es una estimación.",
    M,
    H - 8,
  )

  doc.save(`estado_financiero_${cur}.pdf`)
}

/* ========================================================== Excel */

/** Libro con todo el detalle contable, para quien quiera cruzar los números. */
export function exportFinancialWorkbook(
  data: AppData,
  rules: PayrollRules,
): void {
  const series = buildMonthlySeries(data, rules, 24)
  const projected = projectFutureMonths(series, data, rules, { monthsAhead: 6 })
  const cash = calcCashFlow(data, rules)
  const health = calcHealth(data, series, cash, rules)
  const cmp = comparePeriods(series, "mes")
  const cur = currentMonthKey()

  const wb = XLSX.utils.book_new()
  const nameOf = (id: string) =>
    data.counterparties.find((c) => c.id === id)?.name ?? ""

  /* Resumen */
  const resumen = [
    { Concepto: "Saldo inicial declarado", Monto: round(cash.openingBalance) },
    { Concepto: "Ingresos cobrados", Monto: round(cash.cobrado) },
    { Concepto: "Gastos pagados", Monto: round(-cash.pagado) },
    { Concepto: "Nómina pagada", Monto: round(-cash.nominaPagada) },
    { Concepto: "DINERO DISPONIBLE", Monto: round(cash.saldoActual) },
    { Concepto: "Cuentas por cobrar", Monto: round(cash.porEntrar) },
    { Concepto: "Cuentas por pagar", Monto: round(-cash.gastosPendientes) },
    { Concepto: "Nómina comprometida", Monto: round(-cash.nominaComprometida) },
    {
      Concepto: "Préstamos por recuperar",
      Monto: round(cash.prestamosPorCobrar),
    },
    { Concepto: "SALDO PROYECTADO", Monto: round(cash.saldoProyectado) },
    { Concepto: "", Monto: "" as any },
    { Concepto: "Puntaje de salud (0-100)", Monto: health.score },
    ...health.indicators.map((i) => ({
      Concepto: i.label,
      Monto: i.display as any,
    })),
  ]
  const wsResumen = XLSX.utils.json_to_sheet(resumen)
  wsResumen["!cols"] = [{ wch: 32 }, { wch: 16 }]
  XLSX.utils.book_append_sheet(wb, wsResumen, "Resumen")

  /* Movimientos */
  const movimientos = [...data.transactions]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((t) => ({
      Fecha: t.date,
      Vencimiento: t.dueDate,
      Tipo: t.type === "ingreso" ? "Ingreso" : "Gasto",
      Estado: t.status === "pagado" ? "Liquidado" : "Pendiente",
      Categoría: t.category,
      Descripción: t.description,
      Contacto: nameOf(t.counterpartyId),
      "Método de pago": PAYMENT_METHOD_LABEL[t.paymentMethod],
      Recurrencia: RECURRENCE_LABEL[t.recurrence],
      Etiquetas: t.tags.join(", "),
      Adjuntos: t.attachments.length,
      Monto: round(t.type === "ingreso" ? t.amount : -t.amount),
    }))
  if (movimientos.length > 0) {
    const ws = XLSX.utils.json_to_sheet(movimientos)
    ws["!cols"] = [
      { wch: 12 },
      { wch: 12 },
      { wch: 9 },
      { wch: 11 },
      { wch: 22 },
      { wch: 30 },
      { wch: 22 },
      { wch: 15 },
      { wch: 14 },
      { wch: 20 },
      { wch: 9 },
      { wch: 13 },
    ]
    ws["!freeze"] = { xSplit: 0, ySplit: 1 }
    XLSX.utils.book_append_sheet(wb, ws, "Movimientos")
  }

  /* Serie mensual */
  const mensual = series.map((m) => ({
    Mes: m.label,
    Ingresos: round(m.ingresos),
    "Ingresos cobrados": round(m.ingresosCobrados),
    "Gastos operativos": round(m.gastosManual),
    Nómina: round(m.gastosNomina),
    "Gastos totales": round(m.gastosTotal),
    Utilidad: round(m.balance),
    "Flujo de caja": round(m.flujoNeto),
  }))
  const wsMensual = XLSX.utils.json_to_sheet(mensual)
  wsMensual["!cols"] = [{ wch: 12 }, ...Array(7).fill({ wch: 17 })]
  XLSX.utils.book_append_sheet(wb, wsMensual, "Historial")

  /* Proyección */
  const wsProy = XLSX.utils.json_to_sheet(
    projected.map((m) => ({
      Mes: m.label,
      "Ingresos estimados": round(m.ingresos),
      "Gastos estimados": round(m.gastosTotal),
      "Balance estimado": round(m.balance),
    })),
  )
  wsProy["!cols"] = [{ wch: 12 }, ...Array(3).fill({ wch: 20 })]
  XLSX.utils.book_append_sheet(wb, wsProy, "Proyección")

  /* Presupuestos */
  const budgets = budgetStatuses(data, cur)
  if (budgets.length > 0) {
    const ws = XLSX.utils.json_to_sheet(
      budgets.map((b) => ({
        Categoría: b.category,
        "Techo mensual": round(b.limit),
        Gastado: round(b.spent),
        Disponible: round(b.remaining),
        "% consumido": round(b.pct),
      })),
    )
    ws["!cols"] = [{ wch: 24 }, ...Array(4).fill({ wch: 15 })]
    XLSX.utils.book_append_sheet(wb, ws, "Presupuestos")
  }

  /* Préstamos */
  if (data.loans.length > 0) {
    const ws = XLSX.utils.json_to_sheet(
      data.loans.map((l) => {
        const s = loanStatus(l, data.currentPeriod)
        const emp = data.employees.find((e) => e.id === l.employeeId)
        return {
          Colaborador: emp?.name ?? "",
          Fecha: l.date,
          Monto: round(l.amount),
          Cuota: round(l.installment),
          Pagado: round(s.paid),
          Saldo: round(s.balance),
          Estado: s.settled ? "Saldado" : l.active ? "Activo" : "Suspendido",
          Nota: l.notes,
        }
      }),
    )
    ws["!cols"] = [
      { wch: 24 },
      { wch: 12 },
      { wch: 12 },
      { wch: 12 },
      { wch: 12 },
      { wch: 12 },
      { wch: 13 },
      { wch: 24 },
    ]
    XLSX.utils.book_append_sheet(wb, ws, "Préstamos")
  }

  /* Clientes y proveedores */
  if (data.counterparties.length > 0) {
    const totals = new Map<string, number>()
    for (const t of data.transactions) {
      if (!t.counterpartyId) continue
      totals.set(
        t.counterpartyId,
        (totals.get(t.counterpartyId) ?? 0) + t.amount,
      )
    }
    const ws = XLSX.utils.json_to_sheet(
      data.counterparties.map((c) => ({
        Nombre: c.name,
        Tipo: c.kind === "cliente" ? "Cliente" : "Proveedor",
        "RUC / Cédula": c.taxId,
        Contacto: c.contact,
        "Volumen acumulado": round(totals.get(c.id) ?? 0),
        Notas: c.notes,
      })),
    )
    ws["!cols"] = [
      { wch: 28 },
      { wch: 12 },
      { wch: 18 },
      { wch: 20 },
      { wch: 18 },
      { wch: 28 },
    ]
    XLSX.utils.book_append_sheet(wb, ws, "Contactos")
  }

  /* Comparación */
  const wsCmp = XLSX.utils.json_to_sheet([
    {
      Métrica: "Ingresos",
      [cmp.previous.label]: round(cmp.previous.ingresos),
      [cmp.current.label]: round(cmp.current.ingresos),
      "Variación %":
        cmp.delta.ingresos == null ? "" : round(cmp.delta.ingresos),
    },
    {
      Métrica: "Gastos",
      [cmp.previous.label]: round(cmp.previous.gastosTotal),
      [cmp.current.label]: round(cmp.current.gastosTotal),
      "Variación %":
        cmp.delta.gastosTotal == null ? "" : round(cmp.delta.gastosTotal),
    },
    {
      Métrica: "Utilidad",
      [cmp.previous.label]: round(cmp.previous.balance),
      [cmp.current.label]: round(cmp.current.balance),
      "Variación %": cmp.delta.balance == null ? "" : round(cmp.delta.balance),
    },
  ])
  wsCmp["!cols"] = [{ wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 14 }]
  XLSX.utils.book_append_sheet(wb, wsCmp, "Comparación")

  XLSX.writeFile(wb, `finanzas_${cur}.xlsx`)
}
