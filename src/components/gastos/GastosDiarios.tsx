import { useMemo, useState } from "react"
import type { AppData, DailyExpense, PaymentMethod } from "../../types"
import { MAX_ATTACHMENTS_PER_TX } from "../../store"
import { fmt } from "../../utils/calculations"
import { PAYMENT_METHOD_LABEL, currentMonthKey } from "../../utils/accounting"
import { formatDate, todayISO } from "../../utils/dates"
import {
  breakdown,
  dailyCategoryOptions,
  dailyTransaction,
  groupByDay,
  inMonth,
  lastDaily,
  payerOptions,
  removeRecordTransactions,
  sameText,
  syncRecordTransaction,
} from "../../utils/variableExpenses"
import { AttachmentList, AttachmentPicker } from "../Adjuntos"
import Icon from "../Icon"
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  IconButton,
  Modal,
  inputClass,
  inputNumClass,
} from "../ui"
import type { Tone } from "../ui"
import {
  AccountingSetting,
  BreakdownFilter,
  MonthNav,
  ReadOnlySummary,
  SummaryCard,
  dayHeading,
  longMonth,
} from "./shared"

interface Props {
  data: AppData
  readOnly?: boolean
  onChange: (patch: Partial<AppData>) => void
  onNotify: (text: string, tone?: Tone) => void
}

type Draft = Omit<DailyExpense, "id" | "createdAt">

const FORM_ID = "gasto-diario"
const money = (n: number) => `$${fmt(n)}`

/**
 * Gastos sueltos del día a día: gasolina, comida, un taxi. Hay días con
 * varios y semanas sin ninguno, así que se anotan rápido —monto y tipo
 * bastan— y se miran por mes, agrupados por día.
 */
export default function GastosDiarios({ data, readOnly = false, onChange, onNotify }: Props) {
  const today = todayISO()
  const thisMonth = currentMonthKey()
  const [month, setMonth] = useState(thisMonth)
  const [category, setCategory] = useState<string | null>(null)
  const [form, setForm] = useState<{
    editing: DailyExpense | null
    draft: Draft
    tried?: boolean
  } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<DailyExpense | null>(null)
  const [exporting, setExporting] = useState(false)

  const list = data.dailyExpenses
  const toAccounting = data.accountingEnabled && data.expenseSettings.dailyToAccounting

  const ofMonth = useMemo(() => inMonth(list, month), [list, month])
  const byCategory = useMemo(() => breakdown(ofMonth, (x) => x.category), [ofMonth])
  const shown = useMemo(
    () => (category ? ofMonth.filter((x) => sameText(x.category, category)) : ofMonth),
    [ofMonth, category],
  )
  const days = useMemo(() => groupByDay(shown), [shown])
  const total = ofMonth.reduce((s, x) => s + x.amount, 0)
  const last = useMemo(() => lastDaily(list), [list])
  const categories = useMemo(() => dailyCategoryOptions(list), [list])
  const payers = useMemo(() => payerOptions(list), [list])

  function openNew(from?: DailyExpense) {
    setForm({
      editing: null,
      draft: {
        date: today,
        // "Otra vez" copia el último gasto: la gasolina de todos los días
        // queda en dos toques. Sin él, el monto va vacío a propósito.
        category: from?.category ?? "",
        amount: from?.amount ?? 0,
        paymentMethod: from?.paymentMethod ?? "efectivo",
        paidBy: from?.paidBy ?? "",
        notes: from?.notes ?? "",
        attachments: [],
        transactionId: "",
      },
    })
  }

  function openEdit(e: DailyExpense) {
    const { id: _id, createdAt: _c, ...draft } = e
    setForm({ editing: e, draft })
  }

  function save() {
    if (!form || readOnly) return
    const { editing, draft } = form
    const clean: Draft = {
      ...draft,
      category: draft.category.trim(),
      paidBy: draft.paidBy.trim(),
      notes: draft.notes.trim(),
    }
    if (!(clean.amount > 0) || !clean.category || !clean.date) {
      setForm({ ...form, tried: true })
      return
    }
    // Un tipo escrito a mano que ya existe con otras mayúsculas se unifica.
    const known = categories.find((c) => sameText(c, clean.category))
    if (known) clean.category = known

    const base: DailyExpense = editing
      ? { ...editing, ...clean }
      : { ...clean, id: crypto.randomUUID(), createdAt: new Date().toISOString() }
    const { record, transactions } = syncRecordTransaction(
      base,
      toAccounting,
      dailyTransaction,
      data.transactions,
      () => crypto.randomUUID(),
    )
    onChange({
      dailyExpenses: editing
        ? list.map((x) => (x.id === editing.id ? record : x))
        : [...list, record],
      transactions,
    })
    onNotify(editing ? "Gasto actualizado" : `${record.category} ${money(record.amount)} anotado`)
    setForm(null)
    // Quien anota un gasto de otro mes quiere verlo en su mes.
    setMonth(record.date.slice(0, 7))
  }

  function confirmDelete() {
    if (!pendingDelete) return
    onChange({
      dailyExpenses: list.filter((x) => x.id !== pendingDelete.id),
      transactions: removeRecordTransactions([pendingDelete], data.transactions),
    })
    onNotify("Gasto eliminado", "danger")
    setPendingDelete(null)
    setForm(null)
  }

  async function exportYear() {
    setExporting(true)
    try {
      const { exportDailyYear } = await import("../../utils/exportGastosVariables")
      const year = Number(month.slice(0, 4))
      exportDailyYear(list, year, data.companyName)
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
      const { printDailyMonth } = await import("../../utils/exportGastosVariables")
      printDailyMonth(shown, month, data.companyName, today, category)
    } catch (err) {
      console.error("Falló la impresión", err)
      onNotify("No se pudo preparar la impresión. Intenta de nuevo.", "danger")
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted">
          Gasolina, comida, transporte y demás gastos sueltos que no llegan con
          fecha fija.
        </p>
        {!readOnly && (
          <div className="flex items-center gap-2 flex-wrap">
            {last && (
              <Button
                icon="undo"
                onClick={() => openNew(last)}
                className="min-h-11 sm:min-h-0"
                title="Anota otro gasto igual al último, con fecha de hoy"
              >
                Otra vez: {last.category} {money(last.amount)}
              </Button>
            )}
            <Button
              variant="primary"
              icon="plus"
              onClick={() => openNew()}
              className="min-h-11 sm:min-h-0"
            >
              Anotar gasto
            </Button>
          </div>
        )}
      </div>

      <MonthNav
        month={month}
        thisMonth={thisMonth}
        onChange={(m) => {
          setMonth(m)
          setCategory(null)
        }}
        actions={
          <>
            <Button
              size="sm"
              icon="document"
              disabled={exporting || shown.length === 0}
              onClick={printMonth}
              className="min-h-11 sm:min-h-0"
              title={`Imprimir ${longMonth(month).toLowerCase()}`}
            >
              Imprimir
            </Button>
            <Button
              size="sm"
              icon="download"
              disabled={exporting || list.length === 0}
              onClick={exportYear}
              className="min-h-11 sm:min-h-0"
              title={`Todos los gastos de ${month.slice(0, 4)} en Excel`}
            >
              Excel {month.slice(0, 4)}
            </Button>
          </>
        }
      />

      <div className="grid gap-2 sm:gap-3 grid-cols-3">
        <SummaryCard
          label="Total del mes"
          value={money(total)}
          hint={longMonth(month)}
          tone="muted"
        />
        <SummaryCard
          label="Gastos"
          value={String(ofMonth.length)}
          hint={`${new Set(ofMonth.map((x) => x.date)).size} días con gastos`}
          tone="muted"
        />
        <SummaryCard
          label="El que más"
          value={byCategory[0]?.key ?? "—"}
          hint={byCategory[0] ? money(byCategory[0].total) : "Sin gastos"}
          tone="muted"
        />
      </div>

      <BreakdownFilter
        items={byCategory}
        selected={category}
        onSelect={setCategory}
        money={money}
        label="Filtrar por tipo de gasto"
      />

      {days.length === 0 ? (
        <EmptyState
          icon="wallet"
          title={`Sin gastos en ${longMonth(month).toLowerCase()}`}
          message="Anota aquí la gasolina, la comida o cualquier gasto suelto. Con el monto y el tipo basta."
          action={
            !readOnly && (
              <Button variant="primary" icon="plus" onClick={() => openNew()} className="min-h-11">
                Anotar gasto
              </Button>
            )
          }
        />
      ) : (
        <Card padded={false}>
          {days.map((day) => (
            <section key={day.date} className="border-b border-line last:border-0">
              <header className="flex items-center justify-between gap-3 px-4 py-2 bg-raised text-xs font-bold text-muted">
                <span>{dayHeading(day.date, today)}</span>
                <span className="num text-fg">{money(day.total)}</span>
              </header>
              <ul className="divide-y divide-line">
                {day.items.map((x) => (
                  <li key={x.id}>
                    <button
                      type="button"
                      onClick={() => openEdit(x)}
                      className="w-full flex items-center gap-3 px-4 py-3 min-h-11 text-left hover:bg-raised"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-fg">{x.category}</p>
                        <p className="text-xs text-muted">
                          {[
                            x.notes,
                            x.paidBy && `Pagó ${x.paidBy}`,
                            PAYMENT_METHOD_LABEL[x.paymentMethod],
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      {x.attachments.length > 0 && (
                        <Icon name="paperclip" className="w-4 h-4 text-muted shrink-0" />
                      )}
                      <span className="num font-bold text-fg shrink-0">{money(x.amount)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </Card>
      )}

      {data.accountingEnabled && !readOnly && (
        <AccountingSetting
          checked={data.expenseSettings.dailyToAccounting}
          onChange={(dailyToAccounting) =>
            onChange({ expenseSettings: { ...data.expenseSettings, dailyToAccounting } })
          }
        />
      )}

      {form && (
        <Modal
          title={form.editing ? (readOnly ? "Gasto" : "Editar gasto") : "Anotar gasto"}
          subtitle={form.editing ? formatDate(form.editing.date) : undefined}
          onClose={() => setForm(null)}
          footer={
            readOnly ? (
              <Button className="flex-1" onClick={() => setForm(null)}>
                Cerrar
              </Button>
            ) : (
              <>
                {form.editing && (
                  <IconButton
                    icon="trash"
                    tone="danger"
                    label="Eliminar gasto"
                    onClick={() => setPendingDelete(form.editing)}
                  />
                )}
                <Button className="flex-1" onClick={() => setForm(null)}>
                  Cancelar
                </Button>
                <Button type="submit" form={FORM_ID} variant="primary" className="flex-1">
                  {form.editing ? "Guardar" : "Anotar"}
                </Button>
              </>
            )
          }
        >
          {readOnly ? (
            <ReadOnlySummary
              rows={[
                ["Tipo", form.draft.category],
                ["Monto", money(form.draft.amount)],
                ["Fecha", formatDate(form.draft.date)],
                ["Forma de pago", PAYMENT_METHOD_LABEL[form.draft.paymentMethod]],
                ["Lo pagó", form.draft.paidBy],
                ["Nota", form.draft.notes],
              ]}
              attachments={form.draft.attachments}
            />
          ) : (
            <form
              id={FORM_ID}
              noValidate
              onSubmit={(e) => {
                e.preventDefault()
                save()
              }}
            >
              <DailyFields
                draft={form.draft}
                categories={categories}
                payers={payers}
                showErrors={!!form.tried}
                willRecord={toAccounting || !!form.draft.transactionId}
                onNotify={onNotify}
                onChange={(patch) => setForm((f) => f && { ...f, draft: { ...f.draft, ...patch } })}
              />
            </form>
          )}
        </Modal>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Eliminar gasto"
          message={
            <>
              Se eliminará {pendingDelete.category} de{" "}
              <strong className="text-fg">{money(pendingDelete.amount)}</strong> del{" "}
              {formatDate(pendingDelete.date)}.
              {pendingDelete.transactionId && " También se quita su gasto en Contabilidad."}
            </>
          }
          confirmLabel="Eliminar"
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  )
}

function DailyFields({
  draft,
  categories,
  payers,
  showErrors,
  willRecord,
  onChange,
  onNotify,
}: {
  draft: Draft
  categories: string[]
  payers: string[]
  showErrors: boolean
  willRecord: boolean
  onChange: (patch: Partial<Draft>) => void
  onNotify: (text: string, tone?: Tone) => void
}) {
  const missingAmount = showErrors && !(draft.amount > 0)
  const missingCategory = showErrors && !draft.category.trim()
  const isCustom = draft.category.trim() !== "" && !categories.some((c) => sameText(c, draft.category))

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <Field label="Monto (USD)">
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={draft.amount || ""}
              onChange={(e) => onChange({ amount: Math.max(0, parseFloat(e.target.value) || 0) })}
              placeholder="0.00"
              autoFocus
              aria-invalid={missingAmount || undefined}
              className={`${inputNumClass} placeholder:font-sans placeholder:italic ${missingAmount ? "border-danger" : ""}`}
            />
          </Field>
          {missingAmount && (
            <p className="mt-1.5 text-xs font-semibold text-danger" role="alert">
              Escribe el monto
            </p>
          )}
        </div>
        <Field label="Fecha" hint={draft.date ? formatDate(draft.date) : undefined}>
          <input
            type="date"
            value={draft.date}
            onChange={(e) => onChange({ date: e.target.value })}
            className={inputClass}
          />
        </Field>
      </div>

      {/* Tipo con botones: en el celular es un toque, no escribir. */}
      <div>
        <span className="block text-xs font-semibold text-muted mb-1.5">Tipo de gasto</span>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Tipo de gasto">
          {categories.map((c) => {
            const on = sameText(c, draft.category)
            return (
              <button
                key={c}
                type="button"
                aria-pressed={on}
                onClick={() => onChange({ category: c })}
                className={`px-3 min-h-11 sm:min-h-9 rounded-xl border text-sm font-semibold transition-colors ${
                  on
                    ? "bg-brand-soft border-brand text-brand"
                    : missingCategory
                      ? "bg-surface border-danger text-muted"
                      : "bg-surface border-line text-muted hover:text-fg"
                }`}
              >
                {c}
              </button>
            )
          })}
        </div>
        <input
          value={isCustom ? draft.category : ""}
          onChange={(e) => onChange({ category: e.target.value })}
          placeholder="¿Otro? Escríbelo (p. ej. Peaje)"
          aria-label="Otro tipo de gasto"
          className={`${inputClass} mt-2`}
        />
        {missingCategory && (
          <p className="mt-1.5 text-xs font-semibold text-danger" role="alert">
            Elige o escribe el tipo de gasto
          </p>
        )}
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
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
        <Field label="¿Quién lo pagó?" hint="Opcional; sirve para reembolsos">
          <input
            value={draft.paidBy}
            onChange={(e) => onChange({ paidBy: e.target.value })}
            list="gastos-diarios-pagadores"
            placeholder="Opcional"
            className={inputClass}
          />
          <datalist id="gastos-diarios-pagadores">
            {payers.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </Field>
      </div>

      <Field label="Nota">
        <input
          value={draft.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          placeholder="Opcional (p. ej. Pick-up, viaje a Colón)"
          className={inputClass}
        />
      </Field>

      <div>
        <span className="block text-xs font-semibold text-muted mb-1.5">
          Recibo <span className="font-normal">· opcional</span>
        </span>
        <AttachmentList
          items={draft.attachments}
          onRemove={(a) => onChange({ attachments: draft.attachments.filter((x) => x.id !== a.id) })}
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

      {willRecord && (
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

