import { useMemo, useRef, useState } from "react"
import type {
  Attachment,
  PaymentMethod,
  Recurrence,
  Transaction,
  TransactionStatus,
  TransactionType,
} from "../../types"
import { MAX_ATTACHMENTS_PER_TX } from "../../store"
import { fmt } from "../../utils/calculations"
import {
  PAYMENT_METHOD_LABEL,
  RECURRENCE_LABEL,
  categoriesFor,
} from "../../utils/accounting"
import { formatDate, todayISO } from "../../utils/dates"
import Icon from "../Icon"
import { AttachmentList, AttachmentPicker } from "../Adjuntos"
import { removeAttachment } from "../../cloud/attachments"
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  IconButton,
  Modal,
  Segmented,
  inputClass,
  inputNumClass,
} from "../ui"
import type { ViewProps } from "../Contabilidad"

type Draft = Omit<Transaction, "id">
type TypeFilter = "todos" | TransactionType
type StatusFilter = "todos" | TransactionStatus

const emptyTransaction = (type: TransactionType = "gasto"): Draft => ({
  date: todayISO(),
  dueDate: todayISO(),
  type,
  status: "pagado",
  category: categoriesFor(type)[0],
  description: "",
  amount: 0,
  recurrence: "ninguna",
  paymentMethod: "efectivo",
  counterpartyId: "",
  tags: [],
  attachments: [],
})

export default function Movimientos({ data, onChange, onNotify }: ViewProps) {
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [form, setForm] = useState<Draft>(emptyTransaction())
  const [pendingDelete, setPendingDelete] = useState<Transaction | null>(null)
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("todos")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("todos")
  const [query, setQuery] = useState("")

  const transactions = data.transactions
  const nameOf = (id: string) =>
    data.counterparties.find((c) => c.id === id)?.name ?? ""

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return [...transactions]
      .sort((a, b) => b.date.localeCompare(a.date))
      .filter((t) => typeFilter === "todos" || t.type === typeFilter)
      .filter((t) => statusFilter === "todos" || t.status === statusFilter)
      .filter((t) => {
        if (!q) return true
        return (
          t.description.toLowerCase().includes(q) ||
          t.category.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q)) ||
          nameOf(t.counterpartyId).toLowerCase().includes(q)
        )
      })
  }, [transactions, typeFilter, statusFilter, query, data.counterparties])

  const shown = useMemo(() => {
    const ingresos = filtered
      .filter((t) => t.type === "ingreso")
      .reduce((a, t) => a + t.amount, 0)
    const gastos = filtered
      .filter((t) => t.type === "gasto")
      .reduce((a, t) => a + t.amount, 0)
    return { ingresos, gastos }
  }, [filtered])

  function openNew(type: TransactionType = "gasto") {
    setEditing(null)
    setForm(emptyTransaction(type))
    setShowForm(true)
  }

  function openEdit(t: Transaction) {
    setEditing(t)
    const { id: _id, ...rest } = t
    setForm(rest)
    setShowForm(true)
  }

  function handleSave() {
    if (form.amount <= 0 || !form.date) return
    if (editing) {
      // Los archivos quitados se borran del almacenamiento recién ahora: si
      // se hiciera al quitar la fila, cancelar el diálogo dejaría el
      // movimiento apuntando a un archivo que ya no existe.
      const kept = new Set(form.attachments.map((a) => a.id))
      for (const a of editing.attachments) {
        if (!kept.has(a.id)) void removeAttachment(a)
      }
      onChange({
        transactions: transactions.map((t) =>
          t.id === editing.id ? { ...t, ...form } : t,
        ),
      })
      onNotify("Movimiento actualizado")
    } else {
      onChange({
        transactions: [...transactions, { ...form, id: crypto.randomUUID() }],
      })
      onNotify(form.type === "ingreso" ? "Ingreso agregado" : "Gasto agregado")
    }
    setShowForm(false)
  }

  /** Marcar como pagado es la acción más repetida: merece un solo clic. */
  function togglePaid(t: Transaction) {
    const next: TransactionStatus =
      t.status === "pagado" ? "pendiente" : "pagado"
    onChange({
      transactions: transactions.map((x) =>
        x.id === t.id ? { ...x, status: next } : x,
      ),
    })
    onNotify(
      next === "pagado"
        ? `Marcado como ${t.type === "ingreso" ? "cobrado" : "pagado"}`
        : "Marcado como pendiente",
      next === "pagado" ? "ok" : "amber",
    )
  }

  function confirmDelete() {
    if (!pendingDelete) return
    onChange({
      transactions: transactions.filter((t) => t.id !== pendingDelete.id),
    })
    onNotify("Movimiento eliminado", "danger")
    setPendingDelete(null)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Segmented
            value={typeFilter}
            onChange={setTypeFilter}
            size="sm"
            options={[
              { value: "todos" as TypeFilter, label: "Todos" },
              { value: "ingreso" as TypeFilter, label: "Ingresos" },
              { value: "gasto" as TypeFilter, label: "Gastos" },
            ]}
          />
          <Segmented
            value={statusFilter}
            onChange={setStatusFilter}
            size="sm"
            options={[
              { value: "todos" as StatusFilter, label: "Todo estado" },
              { value: "pagado" as StatusFilter, label: "Liquidados" },
              { value: "pendiente" as StatusFilter, label: "Pendientes" },
            ]}
          />
        </div>
        <div className="flex gap-2">
          <Button icon="plus" onClick={() => openNew("ingreso")}>
            Ingreso
          </Button>
          <Button
            variant="primary"
            icon="plus"
            onClick={() => openNew("gasto")}
          >
            Gasto
          </Button>
        </div>
      </div>

      {transactions.length > 4 && (
        <div className="relative max-w-sm">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle">
            <Icon name="search" />
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por descripción, categoría, etiqueta o contacto"
            aria-label="Buscar movimientos"
            className={`${inputClass} pl-9`}
          />
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          icon="receipt"
          title={
            transactions.length === 0
              ? "Sin movimientos registrados"
              : "Ningún movimiento coincide con el filtro"
          }
          message={
            transactions.length === 0
              ? "Agrega los ingresos y gastos del negocio para llevar la contabilidad al día."
              : "Prueba con otros filtros o limpia la búsqueda."
          }
          action={
            transactions.length === 0 ? (
              <Button variant="primary" icon="plus" onClick={() => openNew()}>
                Agregar el primero
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-raised">
                  {[
                    "Fecha",
                    "Concepto",
                    "Categoría",
                    "Contacto",
                    "Estado",
                    "Monto",
                    "",
                  ].map((h, i) => (
                    <th
                      key={h || i}
                      scope="col"
                      className={`px-3 py-2.5 text-xs font-bold text-muted uppercase tracking-wide whitespace-nowrap ${
                        i === 5 ? "text-right" : "text-left"
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => {
                  const overdue =
                    t.status === "pendiente" &&
                    (t.dueDate || t.date) < todayISO()
                  return (
                    <tr
                      key={t.id}
                      className="border-t border-line hover:bg-raised align-top"
                    >
                      <td className="px-3 py-2.5 whitespace-nowrap text-fg">
                        {formatDate(t.date)}
                        {t.dueDate && t.dueDate !== t.date && (
                          <span className="block text-[11px] text-subtle">
                            vence {formatDate(t.dueDate)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 max-w-[280px]">
                        <span className="block text-fg truncate">
                          {t.description || "—"}
                        </span>
                        <span className="flex items-center gap-1.5 flex-wrap mt-1">
                          {t.recurrence !== "ninguna" && (
                            <span className="text-[10px] font-bold text-brand">
                              ↻ {RECURRENCE_LABEL[t.recurrence]}
                            </span>
                          )}
                          {t.tags.map((tag) => (
                            <span
                              key={tag}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-sunken text-muted"
                            >
                              {tag}
                            </span>
                          ))}
                          {t.attachments.length > 0 && (
                            <span className="text-[10px] text-muted flex items-center gap-0.5">
                              <Icon name="paperclip" className="w-3 h-3" />
                              {t.attachments.length}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-muted whitespace-nowrap">
                        {t.category}
                        <span className="block text-[11px] text-subtle">
                          {PAYMENT_METHOD_LABEL[t.paymentMethod]}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-muted whitespace-nowrap max-w-[150px] truncate">
                        {nameOf(t.counterpartyId) || "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <button
                          onClick={() => togglePaid(t)}
                          title={
                            t.status === "pagado"
                              ? "Marcar como pendiente"
                              : "Marcar como liquidado"
                          }
                        >
                          <Badge
                            tone={
                              t.status === "pagado"
                                ? "ok"
                                : overdue
                                  ? "danger"
                                  : "amber"
                            }
                          >
                            {t.status === "pagado"
                              ? t.type === "ingreso"
                                ? "Cobrado"
                                : "Pagado"
                              : overdue
                                ? "Vencido"
                                : "Pendiente"}
                          </Badge>
                        </button>
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right num font-bold whitespace-nowrap ${
                          t.type === "ingreso" ? "text-ok" : "text-danger"
                        }`}
                      >
                        {t.type === "ingreso" ? "+" : "−"}${fmt(t.amount)}
                      </td>
                      <td className="px-2 py-2.5 text-right whitespace-nowrap">
                        <IconButton
                          icon="edit"
                          tone="brand"
                          label={`Editar movimiento del ${formatDate(t.date)}`}
                          onClick={() => openEdit(t)}
                        />
                        <IconButton
                          icon="trash"
                          tone="danger"
                          label={`Eliminar movimiento del ${formatDate(t.date)}`}
                          onClick={() => setPendingDelete(t)}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="bg-nav text-nav-fg">
                  <td colSpan={5} className="px-3 py-3 font-bold text-sm">
                    {filtered.length} movimientos mostrados
                  </td>
                  <td className="px-3 py-3 text-right num font-bold whitespace-nowrap">
                    <span className="text-ok">+${fmt(shown.ingresos)}</span>
                    <span className="block text-danger">
                      −${fmt(shown.gastos)}
                    </span>
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}

      {showForm && (
        <MovimientoForm
          form={form}
          setForm={setForm}
          editing={!!editing}
          counterparties={data.counterparties}
          existingTags={collectTags(transactions)}
          onSave={handleSave}
          onClose={() => setShowForm(false)}
          onNotify={onNotify}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Eliminar movimiento"
          message={
            <>
              Se eliminará el {pendingDelete.type} de{" "}
              <strong className="text-fg">${fmt(pendingDelete.amount)}</strong>{" "}
              del {formatDate(pendingDelete.date)}.
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

function collectTags(transactions: Transaction[]): string[] {
  const set = new Set<string>()
  for (const t of transactions) for (const tag of t.tags) set.add(tag)
  return [...set].sort((a, b) => a.localeCompare(b, "es"))
}

/* ------------------------------------------------------ Formulario */

function MovimientoForm({
  form,
  setForm,
  editing,
  counterparties,
  existingTags,
  onSave,
  onClose,
  onNotify,
}: {
  form: Draft
  setForm: React.Dispatch<React.SetStateAction<Draft>>
  editing: boolean
  counterparties: ViewProps["data"]["counterparties"]
  existingTags: string[]
  onSave: () => void
  onClose: () => void
  onNotify: ViewProps["onNotify"]
}) {
  const [tagInput, setTagInput] = useState("")
  const canSave = form.amount > 0 && !!form.date

  function setType(type: TransactionType) {
    setForm((f) => ({ ...f, type, category: categoriesFor(type)[0] }))
  }

  function addTag(raw: string) {
    const tag = raw.trim()
    if (!tag || form.tags.includes(tag) || form.tags.length >= 12) return
    setForm((f) => ({ ...f, tags: [...f.tags, tag] }))
    setTagInput("")
  }

  const relevantContacts = counterparties.filter((c) =>
    form.type === "ingreso" ? c.kind === "cliente" : c.kind === "proveedor",
  )

  return (
    <Modal
      title={editing ? "Editar movimiento" : "Nuevo movimiento"}
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <>
          <Button className="flex-1" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            disabled={!canSave}
            onClick={onSave}
          >
            {editing ? "Guardar cambios" : "Agregar"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Tipo">
            <Segmented
              value={form.type}
              onChange={setType}
              options={[
                { value: "gasto" as TransactionType, label: "Gasto" },
                { value: "ingreso" as TransactionType, label: "Ingreso" },
              ]}
            />
          </Field>
          <Field
            label="Estado"
            hint={
              form.status === "pendiente"
                ? "Cuenta por cobrar o pagar: no afecta el saldo de caja"
                : "Ya movió dinero real"
            }
          >
            <Segmented
              value={form.status}
              onChange={(status: TransactionStatus) =>
                setForm((f) => ({ ...f, status }))
              }
              options={[
                {
                  value: "pagado" as TransactionStatus,
                  label: form.type === "ingreso" ? "Cobrado" : "Pagado",
                },
                { value: "pendiente" as TransactionStatus, label: "Pendiente" },
              ]}
            />
          </Field>
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          <Field label="Fecha del movimiento">
            <input
              type="date"
              value={form.date}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  date: e.target.value,
                  // El vencimiento sigue a la fecha mientras no se separen.
                  dueDate: f.dueDate === f.date ? e.target.value : f.dueDate,
                }))
              }
              className={inputNumClass}
            />
          </Field>
          <Field
            label={form.type === "ingreso" ? "Fecha de cobro" : "Fecha de pago"}
          >
            <input
              type="date"
              value={form.dueDate}
              onChange={(e) =>
                setForm((f) => ({ ...f, dueDate: e.target.value }))
              }
              className={inputNumClass}
            />
          </Field>
          <Field label="Monto (USD)">
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.amount || ""}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  amount: parseFloat(e.target.value) || 0,
                }))
              }
              placeholder="0.00"
              className={inputNumClass}
            />
          </Field>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Categoría">
            <input
              value={form.category}
              onChange={(e) =>
                setForm((f) => ({ ...f, category: e.target.value }))
              }
              list="categoria-sugerencias"
              className={inputClass}
            />
            <datalist id="categoria-sugerencias">
              {categoriesFor(form.type).map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label="Método de pago">
            <select
              value={form.paymentMethod}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  paymentMethod: e.target.value as PaymentMethod,
                }))
              }
              className={inputClass}
            >
              {(Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[]).map(
                (m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABEL[m]}
                  </option>
                ),
              )}
            </select>
          </Field>
        </div>

        <Field label="Descripción">
          <input
            value={form.description}
            onChange={(e) =>
              setForm((f) => ({ ...f, description: e.target.value }))
            }
            placeholder="Detalle del movimiento"
            className={inputClass}
          />
        </Field>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field
            label={form.type === "ingreso" ? "Cliente" : "Proveedor"}
            hint={
              relevantContacts.length === 0
                ? "Agrégalos en la pestaña Clientes y proveedores"
                : undefined
            }
          >
            <select
              value={form.counterpartyId}
              onChange={(e) =>
                setForm((f) => ({ ...f, counterpartyId: e.target.value }))
              }
              className={inputClass}
            >
              <option value="">Sin asignar</option>
              {relevantContacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Se repite">
            <select
              value={form.recurrence}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  recurrence: e.target.value as Recurrence,
                }))
              }
              className={inputClass}
            >
              {(Object.keys(RECURRENCE_LABEL) as Recurrence[]).map((r) => (
                <option key={r} value={r}>
                  {RECURRENCE_LABEL[r]}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field
          label="Etiquetas"
          hint="Proyecto, sucursal, departamento… Enter para agregar."
        >
          <div className="flex flex-wrap gap-1.5 mb-2">
            {form.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-brand-soft text-brand"
              >
                {tag}
                <button
                  type="button"
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      tags: f.tags.filter((x) => x !== tag),
                    }))
                  }
                  aria-label={`Quitar etiqueta ${tag}`}
                >
                  <Icon name="x" className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
          <input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                addTag(tagInput)
              }
            }}
            list="etiqueta-sugerencias"
            placeholder="Escribe y presiona Enter"
            className={inputClass}
          />
          <datalist id="etiqueta-sugerencias">
            {existingTags.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </Field>

        <Field label="Comprobantes">
          <AttachmentList
            items={form.attachments}
            onRemove={(a) =>
              setForm((f) => ({
                ...f,
                attachments: f.attachments.filter((x) => x.id !== a.id),
              }))
            }
          />
          <AttachmentPicker
            scope="movimientos"
            max={MAX_ATTACHMENTS_PER_TX}
            current={form.attachments.length}
            onNotify={onNotify}
            onAdd={(added) =>
              setForm((f) => ({ ...f, attachments: [...f.attachments, ...added] }))
            }
          />
        </Field>
      </div>
    </Modal>
  )
}

