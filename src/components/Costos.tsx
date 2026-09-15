import { useMemo, useRef, useState } from "react"
import type {
  AppData,
  CostEntry,
  CostOperator,
  CostRecipientKind,
  CostTemplate,
} from "../types"
import { fmt } from "../utils/calculations"
import { conceptOptions, hashPin, recipientOptions } from "../utils/costs"
import { formatDate, todayISO } from "../utils/dates"
import Icon from "./Icon"
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  IconButton,
  Modal,
  Segmented,
  SectionTitle,
  inputClass,
  inputNumClass,
} from "./ui"
import type { Tone } from "./ui"

interface Props {
  data: AppData
  onChange: (patch: Partial<AppData>) => void
  onNotify: (text: string, tone?: Tone) => void
}

type Draft = Omit<CostEntry, "id">

const RECIPIENT_LABEL: Record<CostRecipientKind, string> = {
  empresa: "Empresa",
  persona: "Persona",
}

type RecipientFilter = "todos" | CostRecipientKind

/**
 * Quién tiene el turno abierto se guarda solo para esta pestaña (no para
 * todo el navegador): así, si se deja la sesión abierta en una computadora
 * compartida, basta con cerrar la pestaña para que quede cerrada. Un
 * refresco de página no debería botar a mitad de turno, por eso es
 * sessionStorage y no un simple estado de React.
 */
const ACTIVE_OPERATOR_KEY = "costos_active_operator_id"

function readActiveOperatorId(): string {
  try {
    return sessionStorage.getItem(ACTIVE_OPERATOR_KEY) ?? ""
  } catch {
    return ""
  }
}

function writeActiveOperatorId(id: string) {
  try {
    if (id) sessionStorage.setItem(ACTIVE_OPERATOR_KEY, id)
    else sessionStorage.removeItem(ACTIVE_OPERATOR_KEY)
  } catch {
    // Almacenamiento no disponible (modo privado, cuota llena…): no es crítico.
  }
}

/**
 * Cuando lo escrito calza exactamente con una plantilla guardada (por
 * ejemplo al elegirla de la lista de autocompletar del navegador), se trae
 * también su tipo y RUC — igual que al tocar un chip de plantilla, pero sin
 * soltar el teclado.
 */
function withRecipientName<T extends Draft>(
  prev: T,
  name: string,
  templates: CostTemplate[],
): T {
  const match = templates.find(
    (t) => t.recipientName.toLowerCase() === name.trim().toLowerCase(),
  )
  return match
    ? {
        ...prev,
        recipientName: name,
        recipientKind: match.recipientKind,
        taxId: match.taxId,
      }
    : { ...prev, recipientName: name }
}

const emptyCost = (): Draft => ({
  date: todayISO(),
  recipientName: "",
  recipientKind: "empresa",
  taxId: "",
  concept: "",
  quantity: 1,
  amount: 0,
  comment: "",
  processedBy: "",
})

export default function Costos({ data, onChange, onNotify }: Props) {
  const [quick, setQuick] = useState<Draft>(emptyCost)
  const [activeOperatorId, setActiveOperatorId] = useState(readActiveOperatorId)
  const [editing, setEditing] = useState<CostEntry | null>(null)
  const [form, setForm] = useState<Draft>(emptyCost())
  const [pendingDelete, setPendingDelete] = useState<CostEntry | null>(null)
  const [recipientFilter, setRecipientFilter] =
    useState<RecipientFilter>("todos")
  const [query, setQuery] = useState("")
  const nameRef = useRef<HTMLInputElement>(null)

  const costs = data.costs
  const templates = data.costTemplates
  const operators = data.costOperators
  const activeOperator =
    operators.find((o) => o.id === activeOperatorId) ?? null

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return [...costs]
      .sort((a, b) => b.date.localeCompare(a.date))
      .filter(
        (c) => recipientFilter === "todos" || c.recipientKind === recipientFilter,
      )
      .filter((c) => {
        if (!q) return true
        return (
          c.recipientName.toLowerCase().includes(q) ||
          c.concept.toLowerCase().includes(q) ||
          c.taxId.toLowerCase().includes(q) ||
          c.processedBy.toLowerCase().includes(q)
        )
      })
  }, [costs, recipientFilter, query])

  // El orden de `filtered` ya es por fecha descendente, así que agrupar al
  // recorrerlo conserva ese orden entre grupos sin ordenar de nuevo.
  const groups = useMemo(() => {
    const map = new Map<string, CostEntry[]>()
    for (const c of filtered) {
      const arr = map.get(c.date)
      if (arr) arr.push(c)
      else map.set(c.date, [c])
    }
    return [...map.entries()]
  }, [filtered])

  const totalShown = useMemo(
    () => filtered.reduce((a, c) => a + c.amount, 0),
    [filtered],
  )

  const recipientSuggestions = useMemo(
    () => recipientOptions(costs, templates),
    [costs, templates],
  )
  const conceptSuggestions = useMemo(() => conceptOptions(costs), [costs])

  function openEdit(c: CostEntry) {
    setEditing(c)
    const { id: _id, ...rest } = c
    setForm(rest)
  }

  function handleQuickAdd() {
    if (
      !activeOperator ||
      quick.amount <= 0 ||
      !quick.date ||
      !quick.recipientName.trim()
    )
      return
    onChange({
      costs: [
        ...costs,
        { ...quick, processedBy: activeOperator.name, id: crypto.randomUUID() },
      ],
    })
    onNotify("Costo agregado")
    // La fecha casi nunca cambia entre un pago y el siguiente durante el
    // mismo turno: solo se limpia lo propio de cada pago.
    setQuick((q) => ({ ...emptyCost(), date: q.date }))
    nameRef.current?.focus()
  }

  async function login(name: string, pin: string): Promise<string | null> {
    const trimmed = name.trim()
    if (!trimmed) return "Escribe tu nombre"
    const existing = operators.find(
      (o) => o.name.toLowerCase() === trimmed.toLowerCase(),
    )
    if (existing) {
      if ((await hashPin(pin)) !== existing.pin) return "PIN incorrecto"
      setActiveOperatorId(existing.id)
      writeActiveOperatorId(existing.id)
      return null
    }
    if (!/^\d{4}$/.test(pin)) return "El PIN debe tener 4 dígitos"
    const operator: CostOperator = {
      id: crypto.randomUUID(),
      name: trimmed,
      pin: await hashPin(pin),
    }
    onChange({ costOperators: [...operators, operator] })
    setActiveOperatorId(operator.id)
    writeActiveOperatorId(operator.id)
    return null
  }

  function logout() {
    setActiveOperatorId("")
    writeActiveOperatorId("")
    onNotify("Turno cerrado")
  }

  function deleteOperator(id: string) {
    onChange({ costOperators: operators.filter((o) => o.id !== id) })
    if (activeOperatorId === id) logout()
  }

  function handleEditSave() {
    if (!editing) return
    if (form.amount <= 0 || !form.date || !form.recipientName.trim()) return
    onChange({
      costs: costs.map((c) => (c.id === editing.id ? { ...c, ...form } : c)),
    })
    onNotify("Costo actualizado")
    setEditing(null)
  }

  function confirmDelete() {
    if (!pendingDelete) return
    onChange({ costs: costs.filter((c) => c.id !== pendingDelete.id) })
    onNotify("Costo eliminado", "danger")
    setPendingDelete(null)
  }

  /**
   * Se identifica por nombre (sin importar mayúsculas) para que "guardar
   * como plantilla" sobre un beneficiario ya guardado actualice su RUC en
   * vez de duplicarlo.
   */
  function saveTemplate(
    t: Pick<CostTemplate, "recipientName" | "recipientKind" | "taxId">,
  ) {
    const name = t.recipientName.trim()
    if (!name) return
    const existing = templates.find(
      (x) => x.recipientName.toLowerCase() === name.toLowerCase(),
    )
    if (existing) {
      onChange({
        costTemplates: templates.map((x) =>
          x.id === existing.id
            ? { ...x, recipientKind: t.recipientKind, taxId: t.taxId }
            : x,
        ),
      })
    } else {
      onChange({
        costTemplates: [
          ...templates,
          { id: crypto.randomUUID(), ...t, recipientName: name },
        ],
      })
    }
    onNotify("Plantilla guardada")
  }

  function deleteTemplate(id: string) {
    onChange({ costTemplates: templates.filter((t) => t.id !== id) })
  }

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Costos"
        subtitle="Pagos a empresas y personas fuera de la planilla"
      />

      {!activeOperator ? (
        <TurnoLoginGate
          operators={operators}
          onLogin={login}
          onDeleteOperator={deleteOperator}
        />
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 rounded-2xl border border-line bg-surface px-4 py-2.5">
            <span className="text-sm font-semibold text-fg flex items-center gap-2">
              <Icon name="unlock" className="w-4 h-4 text-ok shrink-0" />
              Turno activo: {activeOperator.name}
            </span>
            <Button size="sm" variant="ghost" icon="lock" onClick={logout}>
              Cerrar turno
            </Button>
          </div>

          <QuickAddBar
            nameRef={nameRef}
            quick={quick}
            setQuick={setQuick}
            templates={templates}
            recipientSuggestions={recipientSuggestions}
            conceptSuggestions={conceptSuggestions}
            onAdd={handleQuickAdd}
            onSaveTemplate={saveTemplate}
            onDeleteTemplate={deleteTemplate}
          />
        </>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Segmented
          value={recipientFilter}
          onChange={setRecipientFilter}
          size="sm"
          options={[
            { value: "todos" as RecipientFilter, label: "Todos" },
            { value: "empresa" as RecipientFilter, label: "Empresas" },
            { value: "persona" as RecipientFilter, label: "Personas" },
          ]}
        />
        {costs.length > 4 && (
          <div className="relative max-w-sm flex-1 min-w-[220px]">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle">
              <Icon name="search" />
            </span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nombre, RUC, consulta o encargada"
              aria-label="Buscar costos"
              className={`${inputClass} pl-9`}
            />
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon="building"
          title={
            costs.length === 0
              ? "Sin costos registrados"
              : "Ningún costo coincide con el filtro"
          }
          message={
            costs.length === 0
              ? "Usa el formulario de arriba para registrar el primer pago."
              : "Prueba con otros filtros o limpia la búsqueda."
          }
        />
      ) : (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-raised">
                  {["A quién", "RUC", "Consulta", "Cant.", "Total", "Encargada", ""].map(
                    (h, i) => (
                      <th
                        key={h || i}
                        scope="col"
                        className={`px-3 py-2.5 text-xs font-bold text-muted uppercase tracking-wide whitespace-nowrap ${
                          i === 4 ? "text-right" : "text-left"
                        }`}
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              {groups.map(([date, entries]) => {
                const groupTotal = entries.reduce((a, c) => a + c.amount, 0)
                return (
                  <tbody key={date} className="border-t border-line">
                    <tr className="bg-sunken">
                      <td colSpan={7} className="px-3 py-2">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="text-xs font-bold text-fg">
                            {formatDate(date)}{" "}
                            <span className="text-subtle font-normal">
                              · {entries.length}{" "}
                              {entries.length === 1 ? "pago" : "pagos"}
                            </span>
                          </span>
                          <span className="text-xs font-bold text-danger whitespace-nowrap">
                            Balance diario −${fmt(groupTotal)}
                          </span>
                        </div>
                      </td>
                    </tr>
                    {entries.map((c) => (
                      <tr
                        key={c.id}
                        className="border-t border-line hover:bg-raised align-top"
                      >
                        <td className="px-3 py-2.5 max-w-[220px]">
                          <span className="block text-fg truncate">
                            {c.recipientName}
                          </span>
                          <span className="block text-[11px] text-subtle">
                            {RECIPIENT_LABEL[c.recipientKind]}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-muted whitespace-nowrap">
                          {c.taxId || "—"}
                        </td>
                        <td className="px-3 py-2.5 max-w-[240px]">
                          <span className="block text-fg truncate">
                            {c.concept || "—"}
                          </span>
                          {c.comment && (
                            <span className="block text-[11px] text-subtle truncate">
                              {c.comment}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-muted whitespace-nowrap num">
                          {c.quantity}
                        </td>
                        <td className="px-3 py-2.5 text-right num font-bold whitespace-nowrap text-danger">
                          −${fmt(c.amount)}
                        </td>
                        <td className="px-3 py-2.5 text-muted whitespace-nowrap max-w-[140px] truncate">
                          {c.processedBy || "—"}
                        </td>
                        <td className="px-2 py-2.5 text-right whitespace-nowrap">
                          <IconButton
                            icon="edit"
                            tone="brand"
                            label={`Editar pago a ${c.recipientName}`}
                            onClick={() => openEdit(c)}
                          />
                          <IconButton
                            icon="trash"
                            tone="danger"
                            label={`Eliminar pago a ${c.recipientName}`}
                            onClick={() => setPendingDelete(c)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                )
              })}
              <tfoot>
                <tr className="bg-nav text-nav-fg">
                  <td colSpan={4} className="px-3 py-3 font-bold text-sm">
                    {filtered.length} pagos mostrados
                  </td>
                  <td className="px-3 py-3 text-right num font-bold whitespace-nowrap text-danger">
                    −${fmt(totalShown)}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}

      {editing && (
        <CostoEditModal
          form={form}
          setForm={setForm}
          templates={templates}
          recipientSuggestions={recipientSuggestions}
          conceptSuggestions={conceptSuggestions}
          onSave={handleEditSave}
          onClose={() => setEditing(null)}
          onSaveTemplate={saveTemplate}
          onDeleteTemplate={deleteTemplate}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Eliminar costo"
          message={
            <>
              Se eliminará el pago de{" "}
              <strong className="text-fg">${fmt(pendingDelete.amount)}</strong>{" "}
              a {pendingDelete.recipientName} del{" "}
              {formatDate(pendingDelete.date)}.
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

/* ------------------------------------------------------- Plantillas */

function TemplateChips({
  templates,
  onApply,
  onDelete,
}: {
  templates: CostTemplate[]
  onApply: (t: CostTemplate) => void
  onDelete: (id: string) => void
}) {
  if (templates.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {templates.map((t) => (
        <span
          key={t.id}
          className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full text-xs font-semibold bg-sunken text-fg"
        >
          <button
            type="button"
            onClick={() => onApply(t)}
            className="hover:text-brand"
          >
            {t.recipientName}
          </button>
          <button
            type="button"
            onClick={() => onDelete(t.id)}
            aria-label={`Quitar plantilla ${t.recipientName}`}
            className="p-0.5 text-subtle hover:text-danger"
          >
            <Icon name="x" className="w-3 h-3" />
          </button>
        </span>
      ))}
    </div>
  )
}

function SaveTemplateLink({
  draft,
  templates,
  onSaveTemplate,
}: {
  draft: Draft
  templates: CostTemplate[]
  onSaveTemplate: (
    t: Pick<CostTemplate, "recipientName" | "recipientKind" | "taxId">,
  ) => void
}) {
  const name = draft.recipientName.trim()
  if (!name) return null
  const alreadySaved = templates.some(
    (t) => t.recipientName.toLowerCase() === name.toLowerCase(),
  )
  return (
    <button
      type="button"
      disabled={alreadySaved}
      onClick={() =>
        onSaveTemplate({
          recipientName: draft.recipientName,
          recipientKind: draft.recipientKind,
          taxId: draft.taxId,
        })
      }
      className="text-xs text-brand font-semibold disabled:text-subtle disabled:cursor-default"
    >
      {alreadySaved ? "Ya guardado como plantilla" : "+ Guardar como plantilla"}
    </button>
  )
}

/* ------------------------------------------------------- Turno */

/**
 * Pantalla de inicio de turno: cada encargada tiene un PIN de 4 dígitos
 * propio, así que un pago queda atribuido a quien realmente lo escribió y
 * no a quien haya dejado su nombre puesto la última vez.
 */
function TurnoLoginGate({
  operators,
  onLogin,
  onDeleteOperator,
}: {
  operators: CostOperator[]
  onLogin: (name: string, pin: string) => Promise<string | null>
  onDeleteOperator: (id: string) => void
}) {
  const [name, setName] = useState("")
  const [pin, setPin] = useState("")
  const [confirmPin, setConfirmPin] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  const isNew =
    name.trim().length > 0 &&
    !operators.some((o) => o.name.toLowerCase() === name.trim().toLowerCase())

  async function submit() {
    if (!name.trim()) {
      setError("Escribe tu nombre")
      return
    }
    if (!/^\d{4}$/.test(pin)) {
      setError("El PIN debe tener 4 dígitos")
      return
    }
    if (isNew && pin !== confirmPin) {
      setError("Los PIN no coinciden")
      return
    }
    setBusy(true)
    const err = await onLogin(name, pin)
    setBusy(false)
    if (err) setError(err)
  }

  return (
    <Card>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <div>
          <h3 className="text-sm font-bold text-fg">Inicio de turno</h3>
          <p className="text-xs text-muted mt-0.5">
            Identifícate para registrar los pagos de tu turno.
          </p>
        </div>

        {operators.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {operators.map((o) => (
              <span
                key={o.id}
                className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full text-xs font-semibold bg-sunken text-fg"
              >
                <button
                  type="button"
                  onClick={() => {
                    setName(o.name)
                    setError("")
                  }}
                  className="hover:text-brand"
                >
                  {o.name}
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteOperator(o.id)}
                  aria-label={`Quitar perfil ${o.name}`}
                  className="p-0.5 text-subtle hover:text-danger"
                >
                  <Icon name="x" className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Nombre">
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setError("")
              }}
              placeholder="Tu nombre"
              className={inputClass}
              autoComplete="off"
            />
          </Field>
          <Field
            label="PIN (4 dígitos)"
            hint={isNew ? "Nueva encargada: crea tu PIN" : undefined}
          >
            <input
              value={pin}
              onChange={(e) => {
                setPin(e.target.value.replace(/\D/g, "").slice(0, 4))
                setError("")
              }}
              type="password"
              inputMode="numeric"
              placeholder="••••"
              className={inputNumClass}
              autoComplete="off"
            />
          </Field>
        </div>

        {isNew && (
          <Field label="Confirmar PIN">
            <input
              value={confirmPin}
              onChange={(e) => {
                setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 4))
                setError("")
              }}
              type="password"
              inputMode="numeric"
              placeholder="••••"
              className={inputNumClass}
              autoComplete="off"
            />
          </Field>
        )}

        {error && <p className="text-xs text-danger font-semibold">{error}</p>}

        <Button
          type="submit"
          variant="primary"
          icon="unlock"
          disabled={busy}
          className="w-full"
        >
          {busy ? "Verificando…" : isNew ? "Crear perfil e iniciar turno" : "Iniciar turno"}
        </Button>
      </form>
    </Card>
  )
}

/* ------------------------------------------------------ Registro rápido */

/**
 * Barra siempre visible en vez de un modal: durante un turno la encargada
 * registra varios pagos seguidos, uno tras otro, casi como llenar una fila
 * de Excel. Un modal por cada pago sería más lento y rompería ese ritmo.
 */
function QuickAddBar({
  nameRef,
  quick,
  setQuick,
  templates,
  recipientSuggestions,
  conceptSuggestions,
  onAdd,
  onSaveTemplate,
  onDeleteTemplate,
}: {
  nameRef: React.RefObject<HTMLInputElement | null>
  quick: Draft
  setQuick: React.Dispatch<React.SetStateAction<Draft>>
  templates: CostTemplate[]
  recipientSuggestions: string[]
  conceptSuggestions: string[]
  onAdd: () => void
  onSaveTemplate: (
    t: Pick<CostTemplate, "recipientName" | "recipientKind" | "taxId">,
  ) => void
  onDeleteTemplate: (id: string) => void
}) {
  const canAdd = quick.amount > 0 && !!quick.date && !!quick.recipientName.trim()

  function applyTemplate(t: CostTemplate) {
    setQuick((q) => ({
      ...q,
      recipientName: t.recipientName,
      recipientKind: t.recipientKind,
      taxId: t.taxId,
    }))
    nameRef.current?.focus()
  }

  return (
    <Card>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (canAdd) onAdd()
        }}
      >
        <TemplateChips
          templates={templates}
          onApply={applyTemplate}
          onDelete={onDeleteTemplate}
        />

        <div className="grid sm:grid-cols-4 gap-3">
          <Field label="A quién se le pagó" className="sm:col-span-2">
            <input
              ref={nameRef}
              value={quick.recipientName}
              onChange={(e) =>
                setQuick((q) => withRecipientName(q, e.target.value, templates))
              }
              placeholder="Nombre de la empresa o persona"
              list="quick-recipiente-sugerencias"
              className={inputClass}
            />
            <datalist id="quick-recipiente-sugerencias">
              {recipientSuggestions.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </Field>
          <Field label="Tipo">
            <Segmented
              value={quick.recipientKind}
              onChange={(recipientKind: CostRecipientKind) =>
                setQuick((q) => ({ ...q, recipientKind }))
              }
              options={[
                { value: "empresa" as CostRecipientKind, label: "Empresa" },
                { value: "persona" as CostRecipientKind, label: "Persona" },
              ]}
            />
          </Field>
          <Field label="RUC / cédula">
            <input
              value={quick.taxId}
              onChange={(e) =>
                setQuick((q) => ({ ...q, taxId: e.target.value }))
              }
              placeholder="Opcional"
              className={inputClass}
            />
          </Field>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Consulta" hint="¿De qué es el pago?">
            <input
              value={quick.concept}
              onChange={(e) =>
                setQuick((q) => ({ ...q, concept: e.target.value }))
              }
              placeholder="Consultoría, materiales, trámite…"
              list="quick-consulta-sugerencias"
              className={inputClass}
            />
            <datalist id="quick-consulta-sugerencias">
              {conceptSuggestions.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label="Detalle" hint="Opcional">
            <input
              value={quick.comment}
              onChange={(e) =>
                setQuick((q) => ({ ...q, comment: e.target.value }))
              }
              placeholder="Notas adicionales"
              className={inputClass}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Field label="Cant.">
            <input
              type="number"
              min="0"
              step="1"
              value={quick.quantity || ""}
              onChange={(e) =>
                setQuick((q) => ({
                  ...q,
                  quantity: parseFloat(e.target.value) || 0,
                }))
              }
              placeholder="1"
              className={inputNumClass}
            />
          </Field>
          <Field label="Total (USD)">
            <input
              type="number"
              min="0"
              step="0.01"
              value={quick.amount || ""}
              onChange={(e) =>
                setQuick((q) => ({
                  ...q,
                  amount: parseFloat(e.target.value) || 0,
                }))
              }
              placeholder="0.00"
              className={inputNumClass}
            />
          </Field>
          <Field label="Fecha">
            <input
              type="date"
              value={quick.date}
              onChange={(e) =>
                setQuick((q) => ({ ...q, date: e.target.value }))
              }
              className={inputNumClass}
            />
          </Field>
          <div className="flex items-end">
            <Button
              type="submit"
              variant="primary"
              icon="plus"
              disabled={!canAdd}
              className="w-full"
            >
              Agregar
            </Button>
          </div>
        </div>

        <SaveTemplateLink
          draft={quick}
          templates={templates}
          onSaveTemplate={onSaveTemplate}
        />
      </form>
    </Card>
  )
}

/* ------------------------------------------------------ Edición */

function CostoEditModal({
  form,
  setForm,
  templates,
  recipientSuggestions,
  conceptSuggestions,
  onSave,
  onClose,
  onSaveTemplate,
  onDeleteTemplate,
}: {
  form: Draft
  setForm: React.Dispatch<React.SetStateAction<Draft>>
  templates: CostTemplate[]
  recipientSuggestions: string[]
  conceptSuggestions: string[]
  onSave: () => void
  onClose: () => void
  onSaveTemplate: (
    t: Pick<CostTemplate, "recipientName" | "recipientKind" | "taxId">,
  ) => void
  onDeleteTemplate: (id: string) => void
}) {
  const canSave = form.amount > 0 && !!form.date && !!form.recipientName.trim()

  function applyTemplate(t: CostTemplate) {
    setForm((f) => ({
      ...f,
      recipientName: t.recipientName,
      recipientKind: t.recipientKind,
      taxId: t.taxId,
    }))
  }

  return (
    <Modal
      title="Editar costo"
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
            Guardar cambios
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {templates.length > 0 && (
          <Field
            label="Plantillas"
            hint="Toca un beneficiario frecuente para autorrellenar sus datos"
          >
            <TemplateChips
              templates={templates}
              onApply={applyTemplate}
              onDelete={onDeleteTemplate}
            />
          </Field>
        )}

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="A quién se le pagó">
            <input
              value={form.recipientName}
              onChange={(e) =>
                setForm((f) => withRecipientName(f, e.target.value, templates))
              }
              placeholder="Nombre de la empresa o persona"
              list="editar-recipiente-sugerencias"
              className={inputClass}
            />
            <datalist id="editar-recipiente-sugerencias">
              {recipientSuggestions.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </Field>
          <Field label="Tipo">
            <Segmented
              value={form.recipientKind}
              onChange={(recipientKind: CostRecipientKind) =>
                setForm((f) => ({ ...f, recipientKind }))
              }
              options={[
                { value: "empresa" as CostRecipientKind, label: "Empresa" },
                { value: "persona" as CostRecipientKind, label: "Persona" },
              ]}
            />
          </Field>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field
            label="RUC / cédula"
            hint={
              <SaveTemplateLink
                draft={form}
                templates={templates}
                onSaveTemplate={onSaveTemplate}
              />
            }
          >
            <input
              value={form.taxId}
              onChange={(e) => setForm((f) => ({ ...f, taxId: e.target.value }))}
              placeholder="Opcional"
              className={inputClass}
            />
          </Field>
          <Field label="Fecha">
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              className={inputNumClass}
            />
          </Field>
        </div>

        <Field label="Consulta" hint="¿De qué es el pago?">
          <input
            value={form.concept}
            onChange={(e) => setForm((f) => ({ ...f, concept: e.target.value }))}
            placeholder="Consultoría, materiales, trámite…"
            list="editar-consulta-sugerencias"
            className={inputClass}
          />
          <datalist id="editar-consulta-sugerencias">
            {conceptSuggestions.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Cantidad" hint="Unidades o servicios pagados">
            <input
              type="number"
              min="0"
              step="1"
              value={form.quantity || ""}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  quantity: parseFloat(e.target.value) || 0,
                }))
              }
              placeholder="1"
              className={inputNumClass}
            />
          </Field>
          <Field label="Total (USD)">
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

        <Field label="Detalle">
          <input
            value={form.comment}
            onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))}
            placeholder="Notas adicionales"
            className={inputClass}
          />
        </Field>

        <Field label="Encargada/o" hint="Quién procesó el pago">
          <input
            value={form.processedBy}
            onChange={(e) =>
              setForm((f) => ({ ...f, processedBy: e.target.value }))
            }
            placeholder="Nombre"
            className={inputClass}
          />
        </Field>
      </div>
    </Modal>
  )
}
