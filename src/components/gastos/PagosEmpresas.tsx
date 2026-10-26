import { useMemo, useState } from "react"
import type { AppData, PaymentMethod, SupplierPayment } from "../../types"
import { MAX_ATTACHMENTS_PER_TX } from "../../store"
import { fmt } from "../../utils/calculations"
import { PAYMENT_METHOD_LABEL, currentMonthKey } from "../../utils/accounting"
import { formatDate, todayISO } from "../../utils/dates"
import {
  breakdown,
  groupByDay,
  inMonth,
  itbmsFromTotal,
  removeRecordTransactions,
  rucText,
  sameText,
  supplierDirectory,
  supplierTransaction,
  syncRecordTransaction,
} from "../../utils/variableExpenses"
import type { SupplierInfo } from "../../utils/variableExpenses"
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

type Draft = Omit<SupplierPayment, "id" | "createdAt">

const FORM_ID = "pago-empresa"
const money = (n: number) => `$${fmt(n)}`

/**
 * Pagos de administración a empresas y proveedores: como un pago de Caja,
 * pero con lo que pide una factura en Panamá —RUC, DV, número de factura e
 * ITBMS— y sin turnos ni encargadas.
 */
export default function PagosEmpresas({ data, readOnly = false, onChange, onNotify }: Props) {
  const today = todayISO()
  const thisMonth = currentMonthKey()
  const [month, setMonth] = useState(thisMonth)
  const [supplier, setSupplier] = useState<string | null>(null)
  const [form, setForm] = useState<{
    editing: SupplierPayment | null
    draft: Draft
    tried?: boolean
  } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<SupplierPayment | null>(null)
  const [exporting, setExporting] = useState(false)

  const list = data.supplierPayments
  const toAccounting = data.accountingEnabled && data.expenseSettings.suppliersToAccounting

  const ofMonth = useMemo(() => inMonth(list, month), [list, month])
  const bySupplier = useMemo(() => breakdown(ofMonth, (x) => x.supplierName), [ofMonth])
  const shown = useMemo(
    () => (supplier ? ofMonth.filter((x) => sameText(x.supplierName, supplier)) : ofMonth),
    [ofMonth, supplier],
  )
  const days = useMemo(() => groupByDay(shown), [shown])
  const total = ofMonth.reduce((s, x) => s + x.amount, 0)
  const itbms = ofMonth.reduce((s, x) => s + x.itbms, 0)
  const directory = useMemo(() => supplierDirectory(list), [list])

  function openNew() {
    setForm({
      editing: null,
      draft: {
        date: today,
        supplierName: "",
        taxId: "",
        dv: "",
        concept: "",
        invoiceNumber: "",
        // Vacío a propósito: el total se copia de la factura, no se adivina.
        amount: 0,
        itbms: 0,
        paymentMethod: "transferencia",
        notes: "",
        attachments: [],
        transactionId: "",
      },
    })
  }

  function openEdit(p: SupplierPayment) {
    const { id: _id, createdAt: _c, ...draft } = p
    setForm({ editing: p, draft })
  }

  function save() {
    if (!form || readOnly) return
    const { editing, draft } = form
    const clean: Draft = {
      ...draft,
      supplierName: draft.supplierName.trim(),
      taxId: draft.taxId.trim(),
      dv: draft.dv.trim(),
      concept: draft.concept.trim(),
      invoiceNumber: draft.invoiceNumber.trim(),
      notes: draft.notes.trim(),
    }
    if (!clean.supplierName || !(clean.amount > 0) || !clean.date || clean.itbms > clean.amount) {
      setForm({ ...form, tried: true })
      return
    }
    // Mismo nombre con otras mayúsculas: se usa como ya estaba guardado,
    // para que el filtro y el Excel no lo cuenten como otra empresa.
    const known = directory.find((d) => sameText(d.supplierName, clean.supplierName))
    if (known) clean.supplierName = known.supplierName

    const base: SupplierPayment = editing
      ? { ...editing, ...clean }
      : { ...clean, id: crypto.randomUUID(), createdAt: new Date().toISOString() }
    const { record, transactions } = syncRecordTransaction(
      base,
      toAccounting,
      supplierTransaction,
      data.transactions,
      () => crypto.randomUUID(),
    )
    onChange({
      supplierPayments: editing
        ? list.map((x) => (x.id === editing.id ? record : x))
        : [...list, record],
      transactions,
    })
    onNotify(editing ? "Pago actualizado" : `Pago a ${record.supplierName} anotado`)
    setForm(null)
    setMonth(record.date.slice(0, 7))
  }

  function confirmDelete() {
    if (!pendingDelete) return
    onChange({
      supplierPayments: list.filter((x) => x.id !== pendingDelete.id),
      transactions: removeRecordTransactions([pendingDelete], data.transactions),
    })
    onNotify("Pago eliminado", "danger")
    setPendingDelete(null)
    setForm(null)
  }

  async function exportYear() {
    setExporting(true)
    try {
      const { exportSuppliersYear } = await import("../../utils/exportGastosVariables")
      const year = Number(month.slice(0, 4))
      exportSuppliersYear(list, year, data.companyName)
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
      const { printSuppliersMonth } = await import("../../utils/exportGastosVariables")
      printSuppliersMonth(shown, month, data.companyName, today, supplier)
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
          Pagos a proveedores y empresas, con su RUC, DV y factura.
        </p>
        {!readOnly && (
          <Button
            variant="primary"
            icon="plus"
            onClick={openNew}
            className="min-h-11 sm:min-h-0"
          >
            Anotar pago
          </Button>
        )}
      </div>

      <MonthNav
        month={month}
        thisMonth={thisMonth}
        onChange={(m) => {
          setMonth(m)
          setSupplier(null)
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
              title={`Todos los pagos de ${month.slice(0, 4)} en Excel`}
            >
              Excel {month.slice(0, 4)}
            </Button>
          </>
        }
      />

      <div className="grid gap-2 sm:gap-3 grid-cols-3">
        <SummaryCard label="Total del mes" value={money(total)} hint={longMonth(month)} tone="muted" />
        <SummaryCard
          label="ITBMS"
          value={money(itbms)}
          hint="Incluido en el total"
          tone="muted"
        />
        <SummaryCard
          label="Pagos"
          value={String(ofMonth.length)}
          hint={`${bySupplier.length} ${bySupplier.length === 1 ? "empresa" : "empresas"}`}
          tone="muted"
        />
      </div>

      <BreakdownFilter
        items={bySupplier}
        selected={supplier}
        onSelect={setSupplier}
        money={money}
        label="Filtrar por empresa"
      />

      {days.length === 0 ? (
        <EmptyState
          icon="briefcase"
          title={`Sin pagos en ${longMonth(month).toLowerCase()}`}
          message="Anota aquí lo que se le paga a proveedores y empresas. El RUC y el DV se recuerdan para la próxima vez."
          action={
            !readOnly && (
              <Button variant="primary" icon="plus" onClick={openNew} className="min-h-11">
                Anotar pago
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
                        <p className="font-semibold text-fg">{x.supplierName}</p>
                        <p className="text-xs text-muted">
                          {[x.concept, x.invoiceNumber && `Factura ${x.invoiceNumber}`]
                            .filter(Boolean)
                            .join(" · ") || PAYMENT_METHOD_LABEL[x.paymentMethod]}
                        </p>
                        {x.taxId && (
                          <p className="text-[11px] text-muted">RUC {rucText(x.taxId, x.dv)}</p>
                        )}
                      </div>
                      {x.attachments.length > 0 && (
                        <Icon name="paperclip" className="w-4 h-4 text-muted shrink-0" />
                      )}
                      <span className="text-right shrink-0">
                        <span className="block num font-bold text-fg">{money(x.amount)}</span>
                        {x.itbms > 0 && (
                          <span className="block text-[11px] text-muted">
                            ITBMS <span className="num">{money(x.itbms)}</span>
                          </span>
                        )}
                      </span>
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
          checked={data.expenseSettings.suppliersToAccounting}
          onChange={(suppliersToAccounting) =>
            onChange({ expenseSettings: { ...data.expenseSettings, suppliersToAccounting } })
          }
        />
      )}

      {form && (
        <Modal
          title={form.editing ? (readOnly ? "Pago" : "Editar pago") : "Anotar pago"}
          subtitle={form.editing ? `${form.editing.supplierName} · ${formatDate(form.editing.date)}` : undefined}
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
                    label="Eliminar pago"
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
                ["Empresa", form.draft.supplierName],
                ["RUC", rucText(form.draft.taxId, form.draft.dv)],
                ["Concepto", form.draft.concept],
                ["N.º de factura", form.draft.invoiceNumber],
                ["Fecha", formatDate(form.draft.date)],
                ["Total", money(form.draft.amount)],
                ["ITBMS", form.draft.itbms ? money(form.draft.itbms) : ""],
                ["Forma de pago", PAYMENT_METHOD_LABEL[form.draft.paymentMethod]],
                ["Notas", form.draft.notes],
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
              <SupplierFields
                draft={form.draft}
                directory={directory}
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
          title="Eliminar pago"
          message={
            <>
              Se eliminará el pago de{" "}
              <strong className="text-fg">{money(pendingDelete.amount)}</strong> a{" "}
              {pendingDelete.supplierName} del {formatDate(pendingDelete.date)}.
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

function SupplierFields({
  draft,
  directory,
  showErrors,
  willRecord,
  onChange,
  onNotify,
}: {
  draft: Draft
  directory: SupplierInfo[]
  showErrors: boolean
  willRecord: boolean
  onChange: (patch: Partial<Draft>) => void
  onNotify: (text: string, tone?: Tone) => void
}) {
  const missingName = showErrors && !draft.supplierName.trim()
  const missingAmount = showErrors && !(draft.amount > 0)
  const itbmsTooHigh = draft.itbms > draft.amount && draft.amount > 0
  const suggestedItbms = itbmsFromTotal(draft.amount)

  /**
   * Al elegir o escribir una empresa ya conocida se completan su RUC y DV:
   * buscarlos en la factura cada vez es lo que más demora el registro.
   */
  function setName(name: string) {
    const match = directory.find((d) => sameText(d.supplierName, name))
    onChange(
      match
        ? { supplierName: name, taxId: match.taxId, dv: match.dv }
        : { supplierName: name },
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <Field label="Empresa o proveedor">
          <input
            value={draft.supplierName}
            onChange={(e) => setName(e.target.value)}
            list="pagos-empresas-nombres"
            placeholder="Nombre o razón social"
            autoFocus
            aria-invalid={missingName || undefined}
            className={`${inputClass} ${missingName ? "border-danger" : ""}`}
          />
          <datalist id="pagos-empresas-nombres">
            {directory.map((d) => (
              <option key={d.supplierName} value={d.supplierName}>
                {rucText(d.taxId, d.dv)}
              </option>
            ))}
          </datalist>
        </Field>
        {missingName && (
          <p className="mt-1.5 text-xs font-semibold text-danger" role="alert">
            Escribe el nombre de la empresa
          </p>
        )}
      </div>

      {/* RUC y DV juntos, como vienen en la factura. */}
      <div className="grid grid-cols-[1fr_5.5rem] gap-3">
        <Field label="RUC o cédula">
          <input
            value={draft.taxId}
            onChange={(e) => onChange({ taxId: e.target.value })}
            placeholder="Ej. 155596713-2-2015"
            inputMode="text"
            autoComplete="off"
            className={inputClass}
          />
        </Field>
        <Field label="DV">
          <input
            value={draft.dv}
            onChange={(e) => onChange({ dv: e.target.value.replace(/\D/g, "").slice(0, 3) })}
            placeholder="Ej. 59"
            inputMode="numeric"
            autoComplete="off"
            aria-label="Dígito verificador"
            className={inputNumClass}
          />
        </Field>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Concepto">
          <input
            value={draft.concept}
            onChange={(e) => onChange({ concept: e.target.value })}
            placeholder="Qué se compró o pagó"
            className={inputClass}
          />
        </Field>
        <Field label="N.º de factura">
          <input
            value={draft.invoiceNumber}
            onChange={(e) => onChange({ invoiceNumber: e.target.value })}
            placeholder="Opcional"
            className={inputClass}
          />
        </Field>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <Field label="Total pagado (USD)" hint="Con ITBMS incluido, como dice la factura">
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={draft.amount || ""}
              onChange={(e) => onChange({ amount: Math.max(0, parseFloat(e.target.value) || 0) })}
              placeholder="0.00"
              aria-invalid={missingAmount || undefined}
              className={`${inputNumClass} placeholder:font-sans placeholder:italic ${missingAmount ? "border-danger" : ""}`}
            />
          </Field>
          {missingAmount && (
            <p className="mt-1.5 text-xs font-semibold text-danger" role="alert">
              Escribe el total pagado
            </p>
          )}
        </div>
        <div>
          <Field label="ITBMS (USD)" hint="Opcional; el impuesto que trae la factura">
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={draft.itbms || ""}
              onChange={(e) => onChange({ itbms: Math.max(0, parseFloat(e.target.value) || 0) })}
              placeholder="0.00"
              aria-invalid={itbmsTooHigh || undefined}
              className={`${inputNumClass} placeholder:font-sans placeholder:italic ${itbmsTooHigh ? "border-danger" : ""}`}
            />
          </Field>
          {suggestedItbms > 0 && !draft.itbms && (
            <button
              type="button"
              onClick={() => onChange({ itbms: suggestedItbms })}
              className="mt-1.5 text-xs font-semibold text-brand hover:underline min-h-8"
            >
              Calcular 7 %: {money(suggestedItbms)}
            </button>
          )}
          {itbmsTooHigh && (
            <p className="mt-1.5 text-xs font-semibold text-danger" role="alert">
              El ITBMS no puede ser mayor que el total
            </p>
          )}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Fecha de pago" hint={draft.date ? formatDate(draft.date) : undefined}>
          <input
            type="date"
            value={draft.date}
            onChange={(e) => onChange({ date: e.target.value })}
            className={inputClass}
          />
        </Field>
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
      </div>

      <Field label="Notas">
        <input
          value={draft.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          placeholder="Opcional"
          className={inputClass}
        />
      </Field>

      <div>
        <span className="block text-xs font-semibold text-muted mb-1.5">
          Factura o comprobante <span className="font-normal">· opcional</span>
        </span>
        <AttachmentList
          items={draft.attachments}
          onRemove={(a) => onChange({ attachments: draft.attachments.filter((x) => x.id !== a.id) })}
        />
        <AttachmentPicker
          scope="movimientos"
          max={MAX_ATTACHMENTS_PER_TX}
          current={draft.attachments.length}
          label="Agregar foto de la factura"
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
