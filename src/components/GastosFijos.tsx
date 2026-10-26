import { useEffect, useMemo, useRef, useState } from "react"
import type {
  AppData,
  FixedExpense,
  FixedExpenseFrequency,
  FixedExpensePayment,
  PaymentMethod,
  Transaction,
} from "../types"
import { MAX_ATTACHMENTS_PER_TX, MONTHS_ES } from "../store"
import { fmt } from "../utils/calculations"
import {
  PAYMENT_METHOD_LABEL,
  addMonths,
  currentMonthKey,
  monthLabel,
} from "../utils/accounting"
import { formatDate, todayISO } from "../utils/dates"
import type { FixedExpenseMonthRow, FixedExpenseState } from "../utils/fixedExpenses"
import {
  FREQUENCY_LABEL,
  UNUSUAL_RATIO,
  comparisonFor,
  deactivate,
  dueText,
  expectedAmount,
  isBillingMonth,
  monthRows,
  monthsEndingAt,
  overdueBills,
  pausedSince,
  paymentFor,
  paymentsFor,
  reactivate,
  removePaymentTransactions,
  stateFor,
  summarizeMonth,
  syncPaymentTransaction,
  unusualIncrease,
} from "../utils/fixedExpenses"
import { AttachmentList, AttachmentPicker } from "./Adjuntos"
import { MonthNav, SummaryCard, longMonth, shortDate } from "./gastos/shared"
import Icon from "./Icon"
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  IconButton,
  Modal,
  Toggle,
  inputClass,
  inputNumClass,
} from "./ui"
import type { Tone } from "./ui"

interface Props {
  data: AppData
  /** Rango Solo lectura: ve servicios, pagos y recibos, pero no cambia nada. */
  readOnly?: boolean
  onChange: (patch: Partial<AppData>) => void
  onNotify: (text: string, tone?: Tone) => void
}

/** Los que casi toda empresa tiene: un toque y ya están en la lista. */
const PRESETS = ["Internet", "Agua", "Luz", "Basura", "Teléfono", "Alquiler"]

/** Cuántos meses muestra la tabla de historial. */
const HISTORY_MONTHS = 6

const SERVICE_FORM_ID = "gasto-fijo-servicio"
const PAYMENT_FORM_ID = "gasto-fijo-pago"

const FREQUENCIES = Object.keys(FREQUENCY_LABEL).map(Number) as FixedExpenseFrequency[]

const STATE_BADGE: Record<FixedExpenseState, { label: string; tone: Tone }> = {
  pagado: { label: "Pagado", tone: "ok" },
  vencido: { label: "Vencido", tone: "danger" },
  "por-vencer": { label: "Vence pronto", tone: "amber" },
  pendiente: { label: "Pendiente", tone: "muted" },
  "no-aplica": { label: "—", tone: "muted" },
}

type ServiceDraft = Omit<FixedExpense, "id">

const emptyService = (name = ""): ServiceDraft => ({
  name,
  provider: "",
  accountNumber: "",
  estimatedAmount: 0,
  dueDay: 0,
  frequency: 1,
  recordInAccounting: false,
  startMonth: currentMonthKey(),
  notes: "",
  active: true,
  pauses: [],
})

const sameName = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase()

type PaymentDraft = Omit<FixedExpensePayment, "id" | "createdAt">

/** Un mes atrasado que se puede saldar junto con el pago que se registra. */
interface ArrearDraft {
  month: string
  selected: boolean
  amount: number
}

export default function GastosFijos({
  data,
  readOnly = false,
  onChange,
  onNotify,
}: Props) {
  const [month, setMonth] = useState(currentMonthKey)
  const [serviceForm, setServiceForm] = useState<{
    editing: FixedExpense | null
    draft: ServiceDraft
    tried?: boolean
  } | null>(null)
  const [paymentForm, setPaymentForm] = useState<{
    expense: FixedExpense
    editing: FixedExpensePayment | null
    draft: PaymentDraft
    /** Meses atrasados del mismo servicio que este pago puede cubrir. */
    arrears: ArrearDraft[]
    /** Ya se intentó guardar: a partir de ahí se muestra qué falta. */
    tried?: boolean
  } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<FixedExpense | null>(null)
  const [pendingUnpay, setPendingUnpay] = useState<FixedExpensePayment | null>(null)
  const [reactivating, setReactivating] = useState<{
    expense: FixedExpense
    month: string
  } | null>(null)
  // Arrancan marcados los cuatro que casi toda empresa tiene.
  const [picked, setPicked] = useState<string[]>(PRESETS.slice(0, 4))
  const [exporting, setExporting] = useState(false)

  const expenses = data.fixedExpenses
  const payments = data.fixedExpensePayments
  const today = todayISO()
  const thisMonth = today.slice(0, 7)
  // Con Contabilidad apagada no se ofrece anotar ahí: sería escribir en una
  // pestaña que nadie ve.
  const accounting = data.accountingEnabled

  const rows = useMemo(
    () => monthRows(expenses, payments, month, today),
    [expenses, payments, month, today],
  )
  const summary = useMemo(() => summarizeMonth(rows), [rows])
  const historyMonths = useMemo(() => monthsEndingAt(month, HISTORY_MONTHS), [month])
  const overdue = useMemo(
    () => overdueBills(expenses, payments, today),
    [expenses, payments, today],
  )
  const overdueElsewhere = overdue.filter((b) => b.month !== month)
  // Agrupado por servicio: un botón por mes llenaba media pantalla en el
  // celular cuando un servicio tenía varios meses sin pagar.
  const overdueGroups = useMemo(() => {
    const groups = new Map<string, { expense: FixedExpense; months: string[] }>()
    for (const b of overdueElsewhere) {
      const g = groups.get(b.expense.id) ?? { expense: b.expense, months: [] }
      g.months.push(b.month)
      groups.set(b.expense.id, g)
    }
    return [...groups.values()]
  }, [overdueElsewhere])

  // En el historial entran los activos y los dados de baja que tuvieron algún
  // pago en los meses visibles (los demás están en "Dados de baja").
  const historyExpenses = useMemo(
    () =>
      expenses.filter(
        (e) =>
          e.active ||
          payments.some(
            (p) => p.expenseId === e.id && historyMonths.includes(p.month),
          ),
      ),
    [expenses, payments, historyMonths],
  )

  const expenseName = (id: string) =>
    expenses.find((e) => e.id === id)?.name ?? "Servicio"

  const inactive = useMemo(() => expenses.filter((e) => !e.active), [expenses])

  // Al escribir el nombre de un servicio nuevo que ya existe dado de baja,
  // se ofrece retomarlo en vez de chocar con "ya existe".
  const inactiveMatch =
    serviceForm && !serviceForm.editing && serviceForm.draft.name.trim()
      ? (inactive.find((e) => sameName(e.name, serviceForm.draft.name)) ?? null)
      : null

  /* ------------------------------------------------------- Servicios */

  function openNewService(name = "") {
    setServiceForm({ editing: null, draft: emptyService(name) })
  }

  /**
   * Alta de varios de una vez: abrir un formulario por cada servicio hacía
   * que empezar costara cuatro ventanas seguidas. Los datos que faltan
   * (monto, vencimiento) se completan después tocando el nombre.
   */
  function addPicked() {
    if (readOnly || picked.length === 0) return
    onChange({
      fixedExpenses: [
        ...expenses,
        ...picked.map((name) => ({ ...emptyService(name), id: crypto.randomUUID() })),
      ],
    })
    onNotify(
      picked.length === 1
        ? `${picked[0]} agregado`
        : `${picked.length} servicios agregados`,
    )
  }

  function openEditService(expense: FixedExpense) {
    const { id: _id, ...draft } = expense
    setServiceForm({ editing: expense, draft })
  }

  function saveService() {
    if (!serviceForm || readOnly) return
    const { editing, draft } = serviceForm
    const clean: ServiceDraft = {
      ...draft,
      name: draft.name.trim(),
      provider: draft.provider.trim(),
      accountNumber: draft.accountNumber.trim(),
      notes: draft.notes.trim(),
    }
    if (!clean.name) {
      setServiceForm({ ...serviceForm, tried: true })
      return
    }

    const duplicate = expenses.find(
      (e) =>
        e.id !== editing?.id &&
        sameName(e.name, clean.name) &&
        e.accountNumber === clean.accountNumber,
    )
    if (duplicate) {
      onNotify(
        duplicate.active
          ? `Ya existe ${clean.name}${clean.accountNumber ? ` con esa cuenta` : ""}`
          : `${duplicate.name} está dado de baja: usa «Reactivar»`,
        "amber",
      )
      return
    }

    if (editing) {
      // El interruptor "activo" no se guarda tal cual: darlo de baja o
      // reactivarlo registra los meses de baja, para que no salgan vencidos.
      let updated: FixedExpense = {
        ...clean,
        id: editing.id,
        active: editing.active,
        pauses: editing.pauses,
      }
      if (editing.active && !clean.active) {
        updated = deactivate(updated, thisMonth, !!paymentFor(payments, editing.id, thisMonth))
      } else if (!editing.active && clean.active) {
        updated = reactivate(updated, thisMonth)
      }
      onChange({
        fixedExpenses: expenses.map((e) => (e.id === editing.id ? updated : e)),
      })
      onNotify(
        editing.active === updated.active
          ? "Servicio actualizado"
          : updated.active
            ? `${updated.name} reactivado`
            : `${updated.name} dado de baja`,
      )
    } else {
      onChange({
        fixedExpenses: [...expenses, { ...clean, id: crypto.randomUUID() }],
      })
      onNotify(`${clean.name} agregado`)
    }
    setServiceForm(null)
  }

  /**
   * Volver a contratar un servicio retoma el mismo, con su historial. Se
   * pregunta desde qué mes: quien vuelve en noviembre puede anotarlo en
   * diciembre, y noviembre no debe quedar como mes de baja.
   */
  function openReactivate(expense: FixedExpense) {
    if (readOnly) return
    setServiceForm(null)
    setReactivating({ expense, month: thisMonth })
  }

  function confirmReactivate() {
    if (!reactivating) return
    const { expense, month: from } = reactivating
    onChange({
      fixedExpenses: expenses.map((e) => (e.id === expense.id ? reactivate(e, from) : e)),
    })
    onNotify(`${expense.name} reactivado desde ${longMonth(from).toLowerCase()}`)
    setReactivating(null)
    setMonth(from)
  }

  const deleteBlockedBy = pendingDelete
    ? payments.filter((p) => p.expenseId === pendingDelete.id).length
    : 0

  /**
   * Solo se elimina un servicio sin pagos. Con historial se ofrece darlo de
   * baja: borrarlo se llevaba todos sus pagos, sin vuelta atrás.
   */
  function confirmDeleteService() {
    if (!pendingDelete) return
    if (deleteBlockedBy > 0) {
      if (pendingDelete.active) {
        onChange({
          fixedExpenses: expenses.map((e) =>
            e.id === pendingDelete.id
              ? deactivate(e, thisMonth, !!paymentFor(payments, e.id, thisMonth))
              : e,
          ),
        })
        onNotify(`${pendingDelete.name} dado de baja`)
      }
    } else {
      onChange({ fixedExpenses: expenses.filter((e) => e.id !== pendingDelete.id) })
      onNotify(`${pendingDelete.name} eliminado`, "danger")
    }
    setPendingDelete(null)
    setServiceForm(null)
  }

  /* ----------------------------------------------------------- Pagos */

  function openPayment(expense: FixedExpense) {
    const existing = paymentFor(payments, expense.id, month)
    if (!existing && readOnly) return
    if (existing) {
      const { id: _id, createdAt: _createdAt, ...draft } = existing
      setPaymentForm({ expense, editing: existing, draft, arrears: [] })
      return
    }
    // La fecha de pago por defecto es hoy, salvo que se esté registrando un
    // mes ya pasado: ahí lo normal es que se haya pagado dentro de ese mes.
    const paidOn = thisMonth > month ? `${month}-01` : today
    setPaymentForm({
      expense,
      editing: null,
      draft: {
        expenseId: expense.id,
        month,
        // Vacío a propósito: si trajera el estimado, bastaría un toque para
        // guardar un monto que nadie leyó de la factura, y ese número falso
        // contaminaría el promedio y el aviso de recibo alto. El estimado se
        // ofrece como sugerencia que hay que aceptar.
        amount: 0,
        partial: false,
        transactionId: "",
        paidOn,
        paymentMethod: lastMethod(expense.id),
        reference: "",
        notes: "",
        attachments: [],
      },
      // Lo atrasado de meses anteriores: se suele pagar todo junto en la
      // misma ventanilla, y antes había que registrarlo mes por mes.
      arrears: overdue
        .filter((b) => b.expense.id === expense.id && b.month < month)
        .map((b) => ({ month: b.month, selected: false, amount: 0 })),
    })
  }

  /** El método del último pago del servicio: casi siempre se repite. */
  function lastMethod(expenseId: string): PaymentMethod {
    const last = payments
      .filter((p) => p.expenseId === expenseId)
      .sort((a, b) => b.month.localeCompare(a.month))[0]
    return last?.paymentMethod ?? "transferencia"
  }

  /** El servicio tal como decide si se anota en Contabilidad. */
  const forAccounting = (e: FixedExpense): FixedExpense => ({
    ...e,
    recordInAccounting: e.recordInAccounting && accounting,
  })

  function savePayment() {
    if (!paymentForm || readOnly) return
    const { editing, draft, expense, arrears } = paymentForm
    const chosen = arrears.filter((a) => a.selected)
    // El botón nunca se deshabilita: uno gris no dice qué falta, y la gente
    // lo toca y no pasa nada. Se intenta, y se señala el campo vacío.
    if (
      !(draft.amount > 0) ||
      !draft.paidOn ||
      chosen.some((a) => !(a.amount > 0))
    ) {
      setPaymentForm({ ...paymentForm, tried: true })
      return
    }
    const clean = {
      ...draft,
      reference: draft.reference.trim(),
      notes: draft.notes.trim(),
    }
    const svc = forAccounting(expense)
    let transactions: Transaction[] = data.transactions
    const newId = () => crypto.randomUUID()

    if (editing) {
      const synced = syncPaymentTransaction(svc, { ...editing, ...clean }, transactions, newId)
      onChange({
        fixedExpensePayments: payments.map((p) => (p.id === editing.id ? synced.payment : p)),
        transactions: synced.transactions,
      })
      onNotify("Pago actualizado")
      setPaymentForm(null)
      return
    }

    const createdAt = new Date().toISOString()
    const fresh: FixedExpensePayment[] = []
    // Cada mes atrasado queda como su propio pago (saldado), con lo que costó
    // su factura: así el historial y el promedio siguen siendo por mes.
    for (const a of chosen) {
      const synced = syncPaymentTransaction(
        svc,
        {
          ...clean,
          id: newId(),
          month: a.month,
          amount: a.amount,
          partial: false,
          attachments: [],
          notes: [clean.notes, `Pagado junto con ${longMonth(month).toLowerCase()}`]
            .filter(Boolean)
            .join(" · "),
          createdAt,
        },
        transactions,
        newId,
      )
      transactions = synced.transactions
      fresh.push(synced.payment)
    }
    const main = syncPaymentTransaction(
      svc,
      { ...clean, id: newId(), createdAt },
      transactions,
      newId,
    )
    fresh.push(main.payment)

    // Nunca dos pagos finales del mismo servicio en el mismo mes.
    const replaced = (p: FixedExpensePayment) =>
      !p.partial &&
      p.expenseId === clean.expenseId &&
      fresh.some((f) => !f.partial && f.month === p.month)
    onChange({
      fixedExpensePayments: [...payments.filter((p) => !replaced(p)), ...fresh],
      transactions: removePaymentTransactions(payments.filter(replaced), main.transactions),
    })
    onNotify(
      clean.partial
        ? `Abono de ${expense.name} registrado`
        : chosen.length > 0
          ? `${expense.name}: ${chosen.length + 1} meses pagados`
          : `${expense.name} de ${longMonth(clean.month).toLowerCase()} pagado`,
    )
    setPaymentForm(null)
  }

  function confirmUnpay() {
    if (!pendingUnpay) return
    onChange({
      fixedExpensePayments: payments.filter((p) => p.id !== pendingUnpay.id),
      transactions: removePaymentTransactions([pendingUnpay], data.transactions),
    })
    onNotify(pendingUnpay.partial ? "Abono quitado" : "Pago quitado", "danger")
    // Si se quitó el pago que se estaba viendo, la ventana ya no tiene qué
    // mostrar; si fue un abono, sigue abierta para registrar el pago.
    if (paymentForm?.editing?.id === pendingUnpay.id) setPaymentForm(null)
    setPendingUnpay(null)
  }

  /* -------------------------------------------------------- Exportar */

  // Los exportadores arrastran SheetJS y jsPDF: se cargan solo al usarlos.
  async function exportYear() {
    setExporting(true)
    try {
      const { exportFixedExpensesWorkbook } = await import("../utils/exportGastosFijos")
      const year = Number(month.slice(0, 4))
      exportFixedExpensesWorkbook(expenses, payments, year, data.companyName)
      onNotify(`Excel de ${year} descargado`)
    } catch (err) {
      console.error("Falló la exportación", err)
      onNotify("No se pudo generar el archivo. Intenta de nuevo.", "danger")
    } finally {
      setExporting(false)
    }
  }

  async function printMonth() {
    setExporting(true)
    try {
      const { printFixedExpensesMonth } = await import("../utils/exportGastosFijos")
      printFixedExpensesMonth(rows, month, data.companyName, today)
    } catch (err) {
      console.error("Falló la impresión", err)
      onNotify("No se pudo preparar la impresión. Intenta de nuevo.", "danger")
    } finally {
      setExporting(false)
    }
  }

  /* ---------------------------------------------------------- Render */

  const formRow = paymentForm
    ? monthRows([paymentForm.expense], payments, paymentForm.draft.month, today)[0]
    : undefined
  const formAbonos = (formRow?.payments ?? []).filter((p) => p.partial && p.id !== paymentForm?.editing?.id)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted">
          Internet, agua, luz, basura y demás servicios que llegan con factura
          cada mes o cada cierto tiempo.
        </p>
        {!readOnly && expenses.length > 0 && (
          // Secundario: el azul queda para "Marcar pagado", que es lo que se
          // hace cada mes. Con varios servicios, dos azules compiten.
          <Button
            icon="plus"
            onClick={() => openNewService()}
            className="min-h-11 sm:min-h-0"
          >
            Nuevo servicio
          </Button>
        )}
      </div>

      {expenses.length === 0 && readOnly ? (
        <EmptyState
          icon="bolt"
          title="Todavía no hay servicios"
          message="Aquí aparecerán los servicios que se pagan cada mes cuando un administrador o editor los agregue."
        />
      ) : expenses.length === 0 ? (
        <EmptyState
          icon="bolt"
          title="Todavía no hay servicios"
          message="Elige los que paga la empresa. Después solo marcas cuáles ya se pagaron y con cuánto vino la factura."
          action={
            <div className="space-y-4">
              <div className="flex flex-wrap justify-center gap-2" role="group" aria-label="Servicios para agregar">
                {PRESETS.map((name) => {
                  const on = picked.includes(name)
                  return (
                    <button
                      key={name}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setPicked((p) => (on ? p.filter((x) => x !== name) : [...p, name]))
                      }
                      className={`inline-flex items-center gap-1.5 px-3.5 min-h-11 rounded-xl border text-sm font-semibold transition-colors ${
                        on
                          ? "bg-brand-soft border-brand text-brand"
                          : "bg-surface border-line text-muted hover:text-fg"
                      }`}
                    >
                      <Icon name={on ? "check" : "plus"} className="w-4 h-4" />
                      {name}
                    </button>
                  )
                })}
              </div>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-2">
                <Button
                  variant="primary"
                  icon="plus"
                  disabled={picked.length === 0}
                  onClick={addPicked}
                  className="min-h-11"
                >
                  {picked.length === 1
                    ? `Agregar ${picked[0]}`
                    : `Agregar ${picked.length} servicios`}
                </Button>
                <Button variant="ghost" onClick={() => openNewService()} className="min-h-11">
                  Otro servicio…
                </Button>
              </div>
              <p className="text-[11px] text-muted">
                El monto y el día de vencimiento se completan después tocando el
                nombre de cada uno.
              </p>
            </div>
          }
        />
      ) : (
        <>
          <MonthNav
            month={month}
            thisMonth={thisMonth}
            onChange={setMonth}
            actions={
              <>
              <Button
                size="sm"
                icon="document"
                disabled={exporting || rows.length === 0}
                onClick={printMonth}
                className="min-h-11 sm:min-h-0"
                title={`Imprimir ${longMonth(month).toLowerCase()}`}
              >
                Imprimir
              </Button>
              <Button
                size="sm"
                icon="download"
                disabled={exporting}
                onClick={exportYear}
                className="min-h-11 sm:min-h-0"
                title={`Todos los pagos de ${month.slice(0, 4)} en Excel`}
              >
                Excel {month.slice(0, 4)}
              </Button>
              </>
            }
          />

          {/* Lo atrasado de otros meses: antes solo se veía yendo mes por mes. */}
          {overdueElsewhere.length > 0 && (
            <div className="rounded-2xl border border-danger/30 bg-danger-soft px-4 py-3" role="status">
              <p className="text-sm font-semibold text-danger flex items-center gap-1.5">
                <Icon name="alert" className="w-4 h-4 shrink-0" />
                {overdueElsewhere.length === 1
                  ? "Hay 1 pago atrasado de otro mes"
                  : `Hay ${overdueElsewhere.length} pagos atrasados de otros meses`}
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                {/* Cada botón lleva al mes más viejo de ese servicio. */}
                {overdueGroups.map(({ expense, months }) => (
                  <button
                    key={expense.id}
                    type="button"
                    onClick={() => setMonth(months[0])}
                    title={months.map((m) => longMonth(m).toLowerCase()).join(", ")}
                    className="inline-flex items-center gap-1 px-3 min-h-11 sm:min-h-8 rounded-lg bg-surface border border-line text-xs font-semibold text-fg hover:border-danger"
                  >
                    {expense.name} ·{" "}
                    {months.length === 1
                      ? longMonth(months[0]).toLowerCase()
                      : `${months.length} meses, desde ${monthLabel(months[0]).toLowerCase()}`}
                    <Icon name="chevronRight" className="w-3.5 h-3.5 text-muted" />
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-2 sm:gap-3 grid-cols-3">
            <SummaryCard
              label="Pagado"
              value={`$${fmt(summary.paid)}`}
              hint={`${summary.paidCount} de ${rows.length} servicios`}
              // Verde solo con todo pagado: un "$0.00" en verde se leía
              // como "todo bien" cuando no se había pagado nada.
              tone={rows.length > 0 && summary.paidCount === rows.length ? "ok" : "muted"}
            />
            <SummaryCard
              label="Por pagar"
              value={`$${fmt(summary.pending)}`}
              hint={
                summary.pendingCount === 0
                  ? "Todo al día"
                  : `${summary.pendingCount} ${summary.pendingCount === 1 ? "servicio" : "servicios"}, estimado`
              }
              tone={summary.pendingCount === 0 ? "ok" : "brand"}
            />
            <SummaryCard
              label="Vencidos"
              value={String(summary.overdueCount)}
              hint={summary.overdueCount === 0 ? "Ninguno atrasado" : "Ya pasó su fecha"}
              tone={summary.overdueCount > 0 ? "danger" : "muted"}
            />
          </div>

          {rows.length === 0 ? (
            <EmptyState
              icon="calendar"
              title={`Nada que pagar en ${longMonth(month).toLowerCase()}`}
              message="Los servicios cuentan desde el mes en que se agregaron, y los que no son mensuales solo aparecen en el mes de su factura."
            />
          ) : (
            <Card padded={false}>
              <ul className="divide-y divide-line">
                {rows.map((row) => (
                  <ServiceRow
                    key={row.expense.id}
                    row={row}
                    unusual={unusualIncrease(row.expense, payments, month)}
                    readOnly={readOnly}
                    today={today}
                    onPay={() => openPayment(row.expense)}
                    onEdit={() => openEditService(row.expense)}
                  />
                ))}
              </ul>
            </Card>
          )}

          <HistoryTable
            expenses={historyExpenses}
            payments={payments}
            months={historyMonths}
            today={today}
            onEdit={readOnly ? undefined : openEditService}
          />

          {/* Antes un servicio dado de baja desaparecía: solo se veía en los
              meses con pago y no había cómo volver a él. */}
          {inactive.length > 0 && (
            <Card padded={false}>
              <div className="px-4 pt-4 pb-3">
                <h3 className="text-sm font-bold text-fg">Dados de baja</h3>
                <p className="text-xs text-muted mt-0.5">
                  No se piden cada mes. Si vuelves a contratar uno, reactívalo y
                  conservas su historial.
                </p>
              </div>
              <ul className="divide-y divide-line border-t border-line">
                {inactive.map((e) => {
                  const since = pausedSince(e)
                  return (
                    <li key={e.id} className="flex items-center gap-3 px-4 py-3 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-fg">{e.name}</p>
                        <p className="text-xs text-muted">
                          {[
                            e.provider,
                            since && `De baja desde ${longMonth(since).toLowerCase()}`,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      {!readOnly && (
                        <Button
                          icon="undo"
                          onClick={() => openReactivate(e)}
                          className="min-h-11 sm:min-h-0"
                        >
                          Reactivar
                        </Button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </Card>
          )}
        </>
      )}

      {serviceForm && !readOnly && (
        <Modal
          title={serviceForm.editing ? "Editar servicio" : "Nuevo servicio"}
          onClose={() => setServiceForm(null)}
          footer={
            <>
              {serviceForm.editing && (
                <IconButton
                  icon="trash"
                  tone="danger"
                  label="Eliminar servicio"
                  onClick={() => setPendingDelete(serviceForm.editing)}
                />
              )}
              <Button className="flex-1" onClick={() => setServiceForm(null)}>
                Cancelar
              </Button>
              <Button
                type="submit"
                form={SERVICE_FORM_ID}
                variant="primary"
                className="flex-1"
              >
                {serviceForm.editing ? "Guardar" : "Agregar"}
              </Button>
            </>
          }
        >
          {/* Formulario de verdad para que Enter guarde. */}
          <form
            id={SERVICE_FORM_ID}
            noValidate
            onSubmit={(e) => {
              e.preventDefault()
              saveService()
            }}
          >
            <ServiceFields
              draft={serviceForm.draft}
              editing={!!serviceForm.editing}
              showErrors={!!serviceForm.tried}
              accounting={accounting}
              inactiveMatch={inactiveMatch}
              onReactivate={openReactivate}
              onChange={(patch) =>
                setServiceForm((f) => f && { ...f, draft: { ...f.draft, ...patch } })
              }
            />
          </form>
        </Modal>
      )}

      {paymentForm && (
        <Modal
          title={
            paymentForm.editing
              ? paymentForm.editing.partial
                ? "Abono registrado"
                : "Pago registrado"
              : "Registrar pago"
          }
          subtitle={`${paymentForm.expense.name} · ${longMonth(paymentForm.draft.month)}`}
          onClose={() => setPaymentForm(null)}
          footer={
            readOnly ? (
              <Button className="flex-1" onClick={() => setPaymentForm(null)}>
                Cerrar
              </Button>
            ) : (
              <>
                {paymentForm.editing && (
                  <IconButton
                    icon="undo"
                    tone="danger"
                    label="Quitar pago (vuelve a pendiente)"
                    onClick={() => setPendingUnpay(paymentForm.editing)}
                  />
                )}
                <Button className="flex-1" onClick={() => setPaymentForm(null)}>
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  form={PAYMENT_FORM_ID}
                  variant="primary"
                  className="flex-1"
                >
                  {paymentForm.editing
                    ? "Guardar"
                    : paymentForm.draft.partial
                      ? "Registrar abono"
                      : "Marcar pagado"}
                </Button>
              </>
            )
          }
        >
          {formAbonos.length > 0 && (
            <AbonosList
              abonos={formAbonos}
              readOnly={readOnly}
              onRemove={(p) => setPendingUnpay(p)}
            />
          )}
          {/* Solo lectura ve el pago como texto: campos bloqueados que se
              ven editables invitan a tocarlos y no pasa nada. */}
          {readOnly ? (
            <PaymentSummary payment={paymentForm.draft} />
          ) : (
            <form
              id={PAYMENT_FORM_ID}
              noValidate
              onSubmit={(e) => {
                e.preventDefault()
                savePayment()
              }}
            >
              <PaymentFields
                showErrors={!!paymentForm.tried}
                draft={paymentForm.draft}
                expense={paymentForm.expense}
                payments={payments}
                abonado={formAbonos.reduce((a, p) => a + p.amount, 0)}
                arrears={paymentForm.arrears}
                editing={!!paymentForm.editing}
                accounting={accounting}
                onNotify={onNotify}
                onArrearsChange={(arrears) =>
                  setPaymentForm((f) => f && { ...f, arrears })
                }
                onChange={(patch) =>
                  setPaymentForm((f) => f && { ...f, draft: { ...f.draft, ...patch } })
                }
              />
            </form>
          )}
        </Modal>
      )}

      {reactivating && (
        <ReactivateDialog
          expense={reactivating.expense}
          month={reactivating.month}
          thisMonth={thisMonth}
          onMonth={(m) => setReactivating((r) => r && { ...r, month: m })}
          onConfirm={confirmReactivate}
          onCancel={() => setReactivating(null)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={deleteBlockedBy > 0 ? "No se puede eliminar" : "Eliminar servicio"}
          tone={deleteBlockedBy > 0 ? "brand" : "danger"}
          message={
            deleteBlockedBy > 0 ? (
              <>
                <strong className="text-fg">{pendingDelete.name}</strong> tiene{" "}
                {deleteBlockedBy === 1 ? "1 pago registrado" : `${deleteBlockedBy} pagos registrados`}.
                Eliminarlo borraría ese historial sin vuelta atrás.{" "}
                {pendingDelete.active
                  ? "Si ya no se usa, dalo de baja: deja de pedirse y su historial se conserva."
                  : "Ya está dado de baja, así que no se pide cada mes."}
              </>
            ) : (
              <>
                Se eliminará <strong className="text-fg">{pendingDelete.name}</strong>.
                No tiene pagos registrados.
              </>
            )
          }
          confirmLabel={
            deleteBlockedBy > 0
              ? pendingDelete.active
                ? "Darlo de baja"
                : "Entendido"
              : "Eliminar"
          }
          onConfirm={confirmDeleteService}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {pendingUnpay && (
        <ConfirmDialog
          title={pendingUnpay.partial ? "Quitar abono" : "Quitar pago"}
          message={
            <>
              {pendingUnpay.partial ? `Se quitará el abono de $${fmt(pendingUnpay.amount)} de ` : ""}
              {expenseName(pendingUnpay.expenseId)} de{" "}
              {longMonth(pendingUnpay.month).toLowerCase()}
              {pendingUnpay.partial ? "." : " volverá a quedar pendiente."}
              {pendingUnpay.transactionId && " También se quita su gasto en Contabilidad."}
            </>
          }
          confirmLabel={pendingUnpay.partial ? "Quitar abono" : "Quitar pago"}
          onConfirm={confirmUnpay}
          onCancel={() => setPendingUnpay(null)}
        />
      )}
    </div>
  )
}

/* --------------------------------------------------------------------- */

function ServiceRow({
  row,
  unusual,
  readOnly,
  today,
  onPay,
  onEdit,
}: {
  row: FixedExpenseMonthRow
  unusual: { ratio: number; basis: "año-pasado" | "costumbre" } | null
  readOnly: boolean
  today: string
  onPay: () => void
  onEdit: () => void
}) {
  const { expense, state, payment, dueDate, amount, paid } = row
  const badge = STATE_BADGE[state]
  const when = payment
    ? `Pagado el ${shortDate(payment.paidOn)} · ${PAYMENT_METHOD_LABEL[payment.paymentMethod]}`
    : dueText(dueDate, today)
  const details = [
    expense.provider,
    expense.accountNumber && `Cta. ${expense.accountNumber}`,
    expense.frequency !== 1 && FREQUENCY_LABEL[expense.frequency],
  ].filter(Boolean)
  const attachments = row.payments.reduce((a, p) => a + p.attachments.length, 0)

  return (
    <li className="flex items-center gap-x-3 gap-y-2 px-4 py-3 flex-wrap sm:flex-nowrap">
      {/* En el celular el nombre ocupa su renglón y las acciones bajan. */}
      <div className="min-w-0 flex-1 basis-full sm:basis-0">
        <div className="flex items-center gap-2 flex-wrap">
          {/* El lápiz va pegado al nombre: suelto al lado de "Ver pago"
              parecía que editaba el pago y no el servicio. */}
          {readOnly ? (
            <span className="font-semibold text-fg">{expense.name}</span>
          ) : (
            <button
              type="button"
              onClick={onEdit}
              title={`Editar ${expense.name}`}
              className="group/name inline-flex items-center gap-1.5 font-semibold text-fg hover:text-brand -my-2 py-2 min-h-11 sm:min-h-0"
            >
              {expense.name}
              <Icon
                name="edit"
                className="w-3.5 h-3.5 text-muted group-hover/name:text-brand"
              />
            </button>
          )}
          <Badge tone={badge.tone}>{badge.label}</Badge>
          {!expense.active && <Badge>Dado de baja</Badge>}
          {unusual !== null && (
            <Badge tone="amber">
              <Icon name="trendUp" className="w-3 h-3" />
              {Math.round(unusual.ratio * 100)}% más que{" "}
              {unusual.basis === "año-pasado" ? "el año pasado" : "de costumbre"}
            </Badge>
          )}
        </div>
        {when && (
          <p
            className={`text-xs mt-0.5 ${
              state === "vencido" ? "text-danger font-semibold" : "text-muted"
            }`}
          >
            {when}
          </p>
        )}
        {details.length > 0 && (
          <p className="text-xs text-muted mt-0.5">{details.join(" · ")}</p>
        )}
        {/* Tras el alta rápida los servicios quedan sin monto ni fecha, y la
            pista que lo explicaba se iba con la pantalla vacía. */}
        {!readOnly && !payment && !expense.dueDay && !expense.estimatedAmount && (
          <button
            type="button"
            onClick={onEdit}
            className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline min-h-8"
          >
            <Icon name="edit" className="w-3.5 h-3.5" />
            Completar datos: monto y día de vencimiento
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0 ml-auto">
        <div className="text-right">
          <p className={`num font-bold ${payment ? "text-fg" : "text-muted"}`}>
            {payment ? (
              `$${fmt(amount)}`
            ) : amount > 0 ? (
              <>
                <span className="font-sans font-semibold">aprox. </span>${fmt(amount)}
              </>
            ) : (
              <span className="font-sans font-semibold">Sin estimar</span>
            )}
          </p>
          {!payment && paid > 0 && (
            <p className="text-[11px] font-semibold text-amber">Abonado ${fmt(paid)}</p>
          )}
          {attachments > 0 && (
            <p className="text-[11px] text-muted flex items-center justify-end gap-1">
              <Icon name="paperclip" className="w-3 h-3" />
              {attachments === 1 ? "Recibo" : `${attachments} archivos`}
            </p>
          )}
        </div>
        {/* 44 px de alto en el celular: es el botón que más se toca. */}
        {payment ? (
          <Button icon="receipt" onClick={onPay} className="min-h-11 sm:min-h-0">
            Ver pago
          </Button>
        ) : (
          !readOnly && (
            <Button
              variant="primary"
              icon="check"
              onClick={onPay}
              className="min-h-11 sm:min-h-0"
            >
              {paid > 0 ? "Registrar pago" : "Marcar pagado"}
            </Button>
          )
        )}
      </div>
    </li>
  )
}

function HistoryTable({
  expenses,
  payments,
  months,
  today,
  onEdit,
}: {
  expenses: FixedExpense[]
  payments: FixedExpensePayment[]
  months: string[]
  today: string
  /** Sin él (Solo lectura) el nombre no abre la edición. */
  onEdit?: (e: FixedExpense) => void
}) {
  // El mes que se está viendo es la última columna: en el celular la tabla
  // abría en los meses viejos y lo relevante quedaba escondido a la derecha.
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [months, expenses.length])

  if (expenses.length === 0) return null
  const totals = months.map((m) =>
    payments
      .filter((p) => p.month === m && expenses.some((e) => e.id === p.expenseId))
      .reduce((a, p) => a + p.amount, 0),
  )

  return (
    <Card padded={false}>
      <div className="px-4 pt-4 pb-3">
        <h3 className="text-sm font-bold text-fg">Últimos {months.length} meses</h3>
        <p className="text-xs text-muted mt-0.5">
          Lo pagado por servicio. Sirve para notar un recibo que subió.
        </p>
      </div>
      <div ref={scroller} className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-line bg-raised text-[11px] font-bold text-muted uppercase tracking-wide">
              <th className="text-left px-4 py-2 sticky left-0 bg-raised">Servicio</th>
              {months.map((m) => (
                <th key={m} className="text-right px-3 py-2 whitespace-nowrap">
                  {monthLabel(m)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {expenses.map((e) => (
              <tr key={e.id}>
                <td className="px-4 py-2 sticky left-0 bg-surface">
                  {onEdit ? (
                    <button
                      onClick={() => onEdit(e)}
                      className="inline-flex items-center min-h-11 sm:min-h-0 -my-2 sm:my-0 font-semibold text-fg hover:text-brand text-left whitespace-nowrap"
                    >
                      {e.name}
                    </button>
                  ) : (
                    <span className="font-semibold text-fg whitespace-nowrap">{e.name}</span>
                  )}
                  {!e.active && <span className="text-[11px] text-muted ml-1">(baja)</span>}
                </td>
                {months.map((m) => {
                  const monthPayments = paymentsFor(payments, e.id, m)
                  const total = monthPayments.reduce((a, p) => a + p.amount, 0)
                  const settled = monthPayments.some((p) => !p.partial)
                  if (settled) {
                    const unusual = unusualIncrease(e, payments, m) !== null
                    return (
                      <td
                        key={m}
                        className={`num text-right px-3 py-2 whitespace-nowrap ${unusual ? "text-amber font-bold" : "text-fg"}`}
                        title={unusual ? "Por encima de lo normal" : undefined}
                      >
                        ${fmt(total)}
                      </td>
                    )
                  }
                  // Los meses de baja o sin factura salen "—", no "Sin pagar".
                  const state = stateFor(e, monthPayments, m, today)
                  return (
                    <td
                      key={m}
                      className={`text-right px-3 py-2 text-xs whitespace-nowrap ${
                        state === "vencido" ? "text-danger font-semibold" : "text-muted"
                      }`}
                    >
                      {state === "no-aplica"
                        ? "—"
                        : total > 0
                          ? `Abonado $${fmt(total)}`
                          : state === "vencido"
                            ? "Sin pagar"
                            : "Pendiente"}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line bg-raised font-bold">
              <td className="px-4 py-2 sticky left-0 bg-raised text-fg">Total pagado</td>
              {totals.map((t, i) => (
                <td key={months[i]} className="num text-right px-3 py-2 text-fg whitespace-nowrap">
                  ${fmt(t)}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  )
}

function ServiceFields({
  draft,
  editing,
  showErrors,
  accounting,
  inactiveMatch,
  onReactivate,
  onChange,
}: {
  draft: ServiceDraft
  editing: boolean
  showErrors: boolean
  /** ¿Está encendida Contabilidad? Sin ella no se ofrece anotar ahí. */
  accounting: boolean
  /** Servicio dado de baja con el mismo nombre que se está escribiendo. */
  inactiveMatch: FixedExpense | null
  onReactivate: (e: FixedExpense) => void
  onChange: (patch: Partial<ServiceDraft>) => void
}) {
  const missingName = showErrors && !draft.name.trim()
  const [startYear, startMonthNum] = draft.startMonth.split("-")
  // Unos años atrás para registrar servicios viejos, uno adelante para el
  // que se contrata en diciembre. Incluye siempre el ya guardado.
  const thisYear = new Date().getFullYear()
  const years = [
    ...new Set([...Array.from({ length: 5 }, (_, i) => thisYear - 3 + i), Number(startYear)]),
  ].sort((a, b) => a - b)

  // Para uno que no es mensual se dice cuándo llegan las próximas facturas:
  // "cada 2 meses desde enero" obliga a sacar la cuenta.
  const nextBills = useMemo(() => {
    if (draft.frequency === 1) return []
    const probe = { ...draft, id: "", pauses: [] } as FixedExpense
    const out: string[] = []
    let m = currentMonthKey() > draft.startMonth ? currentMonthKey() : draft.startMonth
    for (let i = 0; out.length < 3 && i < 36; i++, m = addMonths(m, 1)) {
      if (isBillingMonth(probe, m)) out.push(monthLabel(m).toLowerCase())
    }
    return out
  }, [draft])

  return (
    <div className="space-y-4">
      <Field label="Servicio">
        <input
          value={draft.name}
          onChange={(e) => onChange({ name: e.target.value })}
          list="gastos-fijos-nombres"
          placeholder="Ej. Luz"
          autoFocus={!draft.name}
          aria-invalid={missingName || undefined}
          className={`${inputClass} ${missingName ? "border-danger" : ""}`}
        />
        <datalist id="gastos-fijos-nombres">
          {PRESETS.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </Field>
      {missingName && (
        <p className="-mt-2 text-xs font-semibold text-danger" role="alert">
          Escribe el nombre del servicio
        </p>
      )}
      {/* Volver a contratar un servicio no es crear otro: se ofrece retomar
          el que ya existe, con su historial de pagos. */}
      {inactiveMatch && (
        <div className="-mt-1 flex items-center justify-between gap-3 flex-wrap rounded-xl bg-amber-soft px-3 py-2">
          <p className="text-xs text-fg">
            <strong>{inactiveMatch.name}</strong> está dado de baja. ¿Lo retomas con
            su historial?
          </p>
          <Button
            size="sm"
            variant="primary"
            icon="undo"
            className="min-h-11 sm:min-h-0"
            onClick={() => onReactivate(inactiveMatch)}
          >
            Reactivar
          </Button>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Proveedor">
          <input
            value={draft.provider}
            onChange={(e) => onChange({ provider: e.target.value })}
            placeholder="Ej. ACME Energía"
            autoFocus={!!draft.name}
            className={inputClass}
          />
        </Field>
        <Field label="N.º de cuenta o contrato">
          <input
            value={draft.accountNumber}
            onChange={(e) => onChange({ accountNumber: e.target.value })}
            placeholder="Opcional"
            className={inputClass}
          />
        </Field>
      </div>

      <Field
        label="¿Cada cuánto llega la factura?"
        hint={
          nextBills.length > 0
            ? `Próximas facturas: ${nextBills.join(", ")}`
            : undefined
        }
      >
        <select
          value={draft.frequency}
          onChange={(e) =>
            onChange({ frequency: Number(e.target.value) as FixedExpenseFrequency })
          }
          className={inputClass}
        >
          {FREQUENCIES.map((f) => (
            <option key={f} value={f}>
              {FREQUENCY_LABEL[f]}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid sm:grid-cols-2 gap-4">
        <Field
          label="Monto aproximado (USD)"
          hint="Se usa mientras no haya facturas anteriores"
        >
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={draft.estimatedAmount || ""}
            onChange={(e) =>
              onChange({ estimatedAmount: Math.max(0, parseFloat(e.target.value) || 0) })
            }
            placeholder="0.00"
            className={inputNumClass}
          />
        </Field>
        <Field
          label="Vence el día"
          hint={
            draft.frequency === 1
              ? "Vacío si no tiene fecha fija"
              : "Del mes en que llega la factura; vacío si no tiene fecha fija"
          }
        >
          <input
            type="number"
            inputMode="numeric"
            min="1"
            max="31"
            step="1"
            value={draft.dueDay || ""}
            onChange={(e) => {
              const day = parseInt(e.target.value, 10)
              onChange({ dueDay: day >= 1 && day <= 31 ? day : 0 })
            }}
            placeholder="Ej. 15"
            className={inputNumClass}
          />
        </Field>
      </div>

      {/* Dos listas y no `type="month"`: Firefox y Safari de escritorio no
          lo soportan y lo convierten en un campo donde hay que teclear
          "2026-08" a mano. */}
      <div>
        <span className="block text-xs font-semibold text-muted mb-1.5">
          {draft.frequency === 1 ? "Controlar desde" : "Primera factura"}
        </span>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <select
            aria-label="Mes desde el que se controla"
            value={startMonthNum}
            onChange={(e) =>
              onChange({ startMonth: `${startYear}-${e.target.value}` })
            }
            className={inputClass}
          >
            {MONTHS_ES.map((name, i) => (
              <option key={name} value={String(i + 1).padStart(2, "0")}>
                {name}
              </option>
            ))}
          </select>
          <select
            aria-label="Año desde el que se controla"
            value={startYear}
            onChange={(e) =>
              onChange({ startMonth: `${e.target.value}-${startMonthNum}` })
            }
            className={inputClass}
          >
            {years.map((y) => (
              <option key={y} value={String(y)}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <span className="block text-[11px] text-muted mt-1">
          {draft.frequency === 1
            ? "Los meses anteriores no aparecen como pendientes"
            : "Desde ese mes se cuentan los siguientes cobros"}
        </span>
      </div>

      <Field label="Notas">
        <input
          value={draft.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          placeholder="Ej. Se paga en línea con la tarjeta de la empresa"
          className={inputClass}
        />
      </Field>

      {accounting && (
        <div className="flex items-center justify-between gap-3 pt-1">
          <div>
            <p className="text-sm font-semibold text-fg">Anotar los pagos en Contabilidad</p>
            <p className="text-[11px] text-muted">
              Cada pago se registra también como gasto, para que el flujo de caja
              y el estado de resultados lo incluyan sin escribirlo dos veces.
            </p>
          </div>
          <Toggle
            checked={draft.recordInAccounting}
            onChange={(recordInAccounting) => onChange({ recordInAccounting })}
            label="Anotar los pagos en Contabilidad"
          />
        </div>
      )}

      {editing && (
        <div className="flex items-center justify-between gap-3 pt-1">
          <div>
            <p className="text-sm font-semibold text-fg">Servicio activo</p>
            <p className="text-[11px] text-muted">
              Desactívalo si se dio de baja: deja de pedirse cada mes y se
              conserva lo ya pagado.
            </p>
          </div>
          <Toggle
            checked={draft.active}
            onChange={(active) => onChange({ active })}
            label="Servicio activo"
          />
        </div>
      )}
    </div>
  )
}

/** Abonos ya registrados del mes, con la opción de quitar cada uno. */
function AbonosList({
  abonos,
  readOnly,
  onRemove,
}: {
  abonos: FixedExpensePayment[]
  readOnly: boolean
  onRemove: (p: FixedExpensePayment) => void
}) {
  const total = abonos.reduce((a, p) => a + p.amount, 0)
  return (
    <div className="mb-4 rounded-xl bg-amber-soft px-3 py-2">
      <p className="text-xs font-semibold text-fg">
        Abonado este mes: <span className="num">${fmt(total)}</span>
      </p>
      <ul className="mt-1 space-y-0.5">
        {abonos.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2 text-xs text-fg">
            <span>
              <span className="num font-semibold">${fmt(p.amount)}</span> el{" "}
              {shortDate(p.paidOn)} · {PAYMENT_METHOD_LABEL[p.paymentMethod]}
            </span>
            {!readOnly && (
              <IconButton
                icon="trash"
                tone="danger"
                label={`Quitar abono de $${fmt(p.amount)}`}
                className="p-2.5 sm:p-1.5"
                onClick={() => onRemove(p)}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Elige desde qué mes vuelve a cobrarse un servicio dado de baja. */
function ReactivateDialog({
  expense,
  month,
  thisMonth,
  onMonth,
  onConfirm,
  onCancel,
}: {
  expense: FixedExpense
  month: string
  thisMonth: string
  onMonth: (m: string) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  // Desde el mes en que se dio de baja hasta el actual: volver antes de
  // darse de baja no tiene sentido, y en el futuro aún no se sabe.
  const since = pausedSince(expense) || thisMonth
  const options: string[] = []
  for (let m = since < thisMonth ? since : thisMonth; m <= thisMonth; m = addMonths(m, 1)) {
    options.push(m)
  }
  return (
    <Modal
      title={`Reactivar ${expense.name}`}
      onClose={onCancel}
      width="max-w-sm"
      footer={
        <>
          <Button className="flex-1" onClick={onCancel}>
            Cancelar
          </Button>
          <Button variant="primary" className="flex-1" onClick={onConfirm}>
            Reactivar
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field
          label="¿Desde qué mes vuelve a cobrarse?"
          hint="Los meses de antes quedan como de baja y no aparecen como vencidos."
        >
          <select
            value={month}
            onChange={(e) => onMonth(e.target.value)}
            autoFocus
            className={inputClass}
          >
            {options.map((m) => (
              <option key={m} value={m}>
                {longMonth(m)}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </Modal>
  )
}

/** Un pago visto por Solo lectura: los datos como texto, sin campos. */
function PaymentSummary({ payment }: { payment: PaymentDraft }) {
  const rows: [string, string][] = [
    [payment.partial ? "Monto del abono" : "Monto de la factura", `$${fmt(payment.amount)}`],
    ["Fecha de pago", formatDate(payment.paidOn)],
    ["Forma de pago", PAYMENT_METHOD_LABEL[payment.paymentMethod]],
  ]
  if (payment.reference) rows.push(["N.º de factura o comprobante", payment.reference])
  if (payment.notes) rows.push(["Notas", payment.notes])

  return (
    <div className="space-y-4">
      <dl className="divide-y divide-line rounded-xl border border-line">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-4 px-3 py-2.5">
            <dt className="text-xs font-semibold text-muted">{label}</dt>
            <dd className={`text-sm text-fg text-right ${label.startsWith("Monto") ? "num font-bold" : ""}`}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
      {payment.attachments.length > 0 && (
        <div>
          <span className="block text-xs font-semibold text-muted mb-1.5">
            Recibo o factura
          </span>
          <AttachmentList items={payment.attachments} />
        </div>
      )}
    </div>
  )
}

function PaymentFields({
  draft,
  expense,
  payments,
  abonado,
  arrears,
  editing,
  accounting,
  showErrors,
  onChange,
  onArrearsChange,
  onNotify,
}: {
  draft: PaymentDraft
  expense: FixedExpense
  payments: FixedExpensePayment[]
  /** Lo ya abonado este mes sin contar este pago. */
  abonado: number
  arrears: ArrearDraft[]
  editing: boolean
  accounting: boolean
  showErrors: boolean
  onChange: (patch: Partial<PaymentDraft>) => void
  onArrearsChange: (arrears: ArrearDraft[]) => void
  onNotify: (text: string, tone?: Tone) => void
}) {
  const expected = expectedAmount(expense, payments, draft.month)
  // Lo que falta de la factura: si ya hubo abonos, se sugiere el resto.
  const suggested = Math.max(0, Math.round((expected - abonado) * 100) / 100)
  const missingAmount = showErrors && !(draft.amount > 0)
  const missingDate = showErrors && !draft.paidOn
  // Una factura muy por encima de lo normal casi siempre es un dedo de más
  // (800 en vez de 80): se avisa antes de guardar, no después. Se compara la
  // factura entera (abonos incluidos) con el mismo mes del año pasado si lo
  // hay, o con la costumbre.
  const ref = comparisonFor(expense, payments, draft.month, true)
  const billTotal = abonado + draft.amount
  const tooHigh = !draft.partial && ref !== null && billTotal > ref.amount * UNUSUAL_RATIO
  const hasExtras = Boolean(draft.reference || draft.notes)
  // Se decide al abrir y no se vuelve a tocar: si siguiera a `hasExtras`, el
  // panel se cerraría solo al borrar la última letra de las notas.
  const [extrasOpen] = useState(hasExtras)
  const records = accounting && (expense.recordInAccounting || !!draft.transactionId)

  return (
    <div className="space-y-4 min-w-0">
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <Field label={draft.partial ? "Monto del abono (USD)" : abonado > 0 ? "Monto que se paga ahora (USD)" : "Monto de la factura (USD)"}>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={draft.amount || ""}
              onChange={(e) =>
                onChange({ amount: Math.max(0, parseFloat(e.target.value) || 0) })
              }
              placeholder={suggested > 0 ? `aprox. ${fmt(suggested)}` : "0.00"}
              autoFocus
              aria-invalid={missingAmount || undefined}
              aria-describedby={missingAmount ? "pago-monto-error" : undefined}
              // La pista va en letra normal y cursiva: en la de números se
              // confundía con un monto ya escrito.
              className={`${inputNumClass} placeholder:font-sans placeholder:italic ${
                missingAmount ? "border-danger" : ""
              }`}
            />
          </Field>
          {missingAmount && (
            <p id="pago-monto-error" className="mt-1.5 text-xs font-semibold text-danger" role="alert">
              Escribe el monto {draft.partial ? "del abono" : "de la factura"}
            </p>
          )}
          {suggested > 0 && !draft.amount && !draft.partial && (
            <button
              type="button"
              onClick={() => onChange({ amount: suggested })}
              className="mt-1.5 text-xs font-semibold text-brand hover:underline min-h-8"
            >
              {abonado > 0
                ? `Pagar lo que falta: $${fmt(suggested)}`
                : `Vino igual que siempre: usar $${fmt(suggested)}`}
            </button>
          )}
          {tooHigh && ref && (
            <p className="mt-1.5 text-xs font-semibold text-amber flex items-start gap-1" role="status">
              <Icon name="alert" className="w-3.5 h-3.5 shrink-0 mt-px" />
              Es {Math.round((billTotal / ref.amount - 1) * 100)}% más que{" "}
              {ref.basis === "año-pasado" ? "el mismo mes del año pasado" : "de costumbre"} (aprox.
              ${fmt(ref.amount)}). Revisa que esté bien escrito.
            </p>
          )}
        </div>
        <Field
          label="Fecha de pago"
          hint={
            missingDate ? (
              <span className="font-semibold text-danger" role="alert">
                Elige la fecha en que se pagó
              </span>
            ) : draft.paidOn ? (
              formatDate(draft.paidOn)
            ) : undefined
          }
        >
          <input
            type="date"
            value={draft.paidOn}
            onChange={(e) => onChange({ paidOn: e.target.value })}
            aria-invalid={missingDate || undefined}
            className={`${inputClass} ${missingDate ? "border-danger" : ""}`}
          />
        </Field>
      </div>

      {/* Abono: se pagó una parte y la factura sigue pendiente. */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-fg">Es un abono</p>
          <p className="text-[11px] text-muted">
            Se pagó solo una parte: la factura sigue pendiente hasta saldarla.
          </p>
        </div>
        <Toggle
          checked={draft.partial}
          onChange={(partial) => onChange({ partial })}
          label="Es un abono"
        />
      </div>

      {!editing && arrears.length > 0 && (
        <ArrearsFields arrears={arrears} showErrors={showErrors} onChange={onArrearsChange} />
      )}

      <Field label="Forma de pago">
        <select
          value={draft.paymentMethod}
          onChange={(e) => onChange({ paymentMethod: e.target.value as PaymentMethod })}
          className={inputClass}
        >
          {(Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[]).map((m) => (
            <option key={m} value={m}>
              {PAYMENT_METHOD_LABEL[m]}
            </option>
          ))}
        </select>
      </Field>

      {/* Lo opcional va plegado: en el celular el botón de guardar quedaba
          al fondo de siete campos cuando solo dos son obligatorios. */}
      <details open={extrasOpen} className="group rounded-xl border border-line">
        <summary className="flex items-center gap-2 px-3 min-h-11 cursor-pointer text-sm font-semibold text-muted hover:text-fg list-none [&::-webkit-details-marker]:hidden">
          <Icon
            name="chevronRight"
            className="w-4 h-4 transition-transform group-open:rotate-90"
          />
          Más detalles
          <span className="font-normal text-muted">· N.º de factura y notas</span>
        </summary>
        <div className="px-3 pb-3 space-y-4">
          <Field label="N.º de factura o comprobante">
            <input
              value={draft.reference}
              onChange={(e) => onChange({ reference: e.target.value })}
              placeholder="Opcional"
              className={inputClass}
            />
          </Field>
          <Field label="Notas">
            <input
              value={draft.notes}
              onChange={(e) => onChange({ notes: e.target.value })}
              placeholder="Opcional"
              className={inputClass}
            />
          </Field>
        </div>
      </details>

      {/* No es <Field>: ese es un <label>, y con los botones del selector
          adentro un toque en el texto abriría el explorador de archivos. */}
      <div>
        <span className="block text-xs font-semibold text-muted mb-1.5">
          Recibo o factura <span className="font-normal">· opcional</span>
        </span>
        <AttachmentList
          items={draft.attachments}
          onRemove={(a) =>
            onChange({ attachments: draft.attachments.filter((x) => x.id !== a.id) })
          }
        />
        <AttachmentPicker
          scope="movimientos"
          max={MAX_ATTACHMENTS_PER_TX}
          current={draft.attachments.length}
          label="Agregar foto del recibo"
          onNotify={onNotify}
          onAdd={(added) => onChange({ attachments: [...draft.attachments, ...added] })}
        />
      </div>

      {records && (
        <p className="text-[11px] text-muted flex items-start gap-1">
          <Icon name="receipt" className="w-3.5 h-3.5 shrink-0 mt-px" />
          {draft.transactionId
            ? "Su gasto en Contabilidad se actualiza al guardar."
            : "Se anota también como gasto en Contabilidad."}
        </p>
      )}
    </div>
  )
}

/**
 * Meses atrasados del mismo servicio que se pagan junto con este. Cada uno
 * lleva su propio monto: es lo que costó su factura, no un reparto del total.
 */
function ArrearsFields({
  arrears,
  showErrors,
  onChange,
}: {
  arrears: ArrearDraft[]
  showErrors: boolean
  onChange: (arrears: ArrearDraft[]) => void
}) {
  const set = (i: number, patch: Partial<ArrearDraft>) =>
    onChange(arrears.map((a, j) => (j === i ? { ...a, ...patch } : a)))
  const total = arrears.filter((a) => a.selected).reduce((s, a) => s + a.amount, 0)

  return (
    <fieldset className="rounded-xl border border-danger/30 bg-danger-soft px-3 py-2.5">
      <legend className="sr-only">Meses atrasados</legend>
      <p className="text-sm font-semibold text-fg">¿Pagaste también meses atrasados?</p>
      <p className="text-[11px] text-muted mb-2">
        Márcalos y escribe lo que costó cada factura: quedan saldados con este mismo pago.
      </p>
      <ul className="space-y-2">
        {arrears.map((a, i) => {
          const missing = showErrors && a.selected && !(a.amount > 0)
          return (
            <li key={a.month} className="flex items-center gap-2 flex-wrap">
              <label className="flex items-center gap-2 min-h-11 sm:min-h-8 flex-1 min-w-[140px] cursor-pointer">
                <input
                  type="checkbox"
                  checked={a.selected}
                  onChange={(e) => set(i, { selected: e.target.checked })}
                  className="w-4 h-4 accent-[var(--brand)]"
                />
                <span className="text-sm text-fg">{longMonth(a.month)}</span>
              </label>
              {a.selected && (
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={a.amount || ""}
                  onChange={(e) => set(i, { amount: Math.max(0, parseFloat(e.target.value) || 0) })}
                  placeholder="Monto"
                  aria-label={`Monto de ${longMonth(a.month)}`}
                  aria-invalid={missing || undefined}
                  className={`${inputNumClass} w-32 placeholder:font-sans placeholder:italic ${missing ? "border-danger" : ""}`}
                />
              )}
            </li>
          )
        })}
      </ul>
      {total > 0 && (
        <p className="text-[11px] text-muted mt-2">
          Atrasados: <span className="num font-semibold text-fg">${fmt(total)}</span>
        </p>
      )}
      {showErrors && arrears.some((a) => a.selected && !(a.amount > 0)) && (
        <p className="text-xs font-semibold text-danger mt-1" role="alert">
          Escribe el monto de cada mes marcado
        </p>
      )}
    </fieldset>
  )
}
