import { useMemo, useRef, useState } from "react"
import type {
  AppData,
  CostEntry,
  CostCashCount,
  CostCashCountKind,
  CostMovementKind,
  CostOperator,
  CostTemplate,
} from "../types"
import { fmt } from "../utils/calculations"
import { hashPin, recipientOptions, signedAmount } from "../utils/costs"
import { formatDate, formatDateTime, localDay, todayISO } from "../utils/dates"
import { exportCajaWorkbook, printCaja, printShift } from "../utils/exportCaja"
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
  /**
   * Falso solo con una cuenta de nube de rango restringido (p. ej. "costos"
   * compartida por estación). Sin nube, o con una cuenta que administra la
   * empresa, se trata como administrador: no hay nadie de rango más alto a
   * quien pedirle el PIN.
   */
  isAdmin?: boolean
  onChange: (patch: Partial<AppData>) => void
  onNotify: (text: string, tone?: Tone) => void
}

type Draft = Omit<CostEntry, "id">

const KIND_LABEL: Record<CostMovementKind, string> = {
  cobro: "Cobro",
  pago: "Pago",
}

const KIND_OPTIONS = [
  { value: "cobro" as CostMovementKind, label: "Cobro" },
  { value: "pago" as CostMovementKind, label: "Pago" },
]

type KindFilter = "todos" | CostMovementKind

/** Monto con signo y color: los cobros suman a caja, los pagos restan. */
function formatSigned(n: number): string {
  return `${n < 0 ? "−" : "+"}$${fmt(Math.abs(n))}`
}

function signedTone(n: number): string {
  return n < 0 ? "text-danger" : "text-ok"
}

/**
 * Quién tiene el turno abierto se guarda solo para esta pestaña (no para
 * todo el navegador): así, si se deja la sesión abierta en una computadora
 * compartida, basta con cerrar la pestaña para que quede cerrada. Un
 * refresco de página no debería botar a mitad de turno, por eso es
 * sessionStorage y no un simple estado de React.
 */
const ACTIVE_OPERATOR_KEY = "costos_active_operator_id"
/** Cuándo empezó el turno abierto: delimita qué se imprime como "mi turno". */
const SHIFT_STARTED_KEY = "costos_shift_started_at"

function readSession(key: string): string {
  try {
    return sessionStorage.getItem(key) ?? ""
  } catch {
    return ""
  }
}

function writeSession(key: string, value: string) {
  try {
    if (value) sessionStorage.setItem(key, value)
    else sessionStorage.removeItem(key)
  } catch {
    // Almacenamiento no disponible (modo privado, cuota llena…): no es crítico.
  }
}

/**
 * Cuando lo escrito calza exactamente con una plantilla guardada (por
 * ejemplo al elegirla de la lista de autocompletar del navegador), se trae
 * también su RUC — igual que al tocar un chip de plantilla, pero sin soltar
 * el teclado.
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
    ? { ...prev, recipientName: name, taxId: match.taxId }
    : { ...prev, recipientName: name }
}

const emptyCost = (): Draft => ({
  date: todayISO(),
  recipientName: "",
  kind: "pago",
  taxId: "",
  concept: "",
  quantity: 1,
  amount: 0,
  comment: "",
  processedBy: "",
  createdAt: "",
})

export default function Costos({
  data,
  isAdmin = true,
  onChange,
  onNotify,
}: Props) {
  const [quick, setQuick] = useState<Draft>(emptyCost)
  const [activeOperatorId, setActiveOperatorId] = useState(() =>
    readSession(ACTIVE_OPERATOR_KEY),
  )
  const [shiftStartedAt, setShiftStartedAt] = useState(() =>
    readSession(SHIFT_STARTED_KEY),
  )
  const [editing, setEditing] = useState<CostEntry | null>(null)
  const [form, setForm] = useState<Draft>(emptyCost())
  const [pendingDelete, setPendingDelete] = useState<CostEntry | null>(null)
  const [pendingDeleteOperator, setPendingDeleteOperator] =
    useState<CostOperator | null>(null)
  const [closingShift, setClosingShift] = useState(false)
  const [openingShift, setOpeningShift] = useState(false)
  const [kindFilter, setKindFilter] = useState<KindFilter>("todos")
  const [query, setQuery] = useState("")
  const nameRef = useRef<HTMLInputElement>(null)

  const costs = data.costs
  const templates = data.costTemplates
  const operators = data.costOperators
  const cashCounts = data.costCashCounts
  const activeOperator =
    operators.find((o) => o.id === activeOperatorId) ?? null

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return [...costs]
      .sort((a, b) => b.date.localeCompare(a.date))
      .filter((c) => kindFilter === "todos" || c.kind === kindFilter)
      .filter((c) => {
        if (!q) return true
        return (
          c.recipientName.toLowerCase().includes(q) ||
          c.concept.toLowerCase().includes(q) ||
          c.taxId.toLowerCase().includes(q) ||
          c.processedBy.toLowerCase().includes(q)
        )
      })
  }, [costs, kindFilter, query])

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
    () => filtered.reduce((a, c) => a + signedAmount(c), 0),
    [filtered],
  )

  const recipientSuggestions = useMemo(
    () => recipientOptions(costs, templates),
    [costs, templates],
  )
  const sortedCashCounts = useMemo(
    () => [...cashCounts].sort((a, b) => b.at.localeCompare(a.at)),
    [cashCounts],
  )

  // Si lo último que dejó esta encargada fue una apertura, es la de su turno
  // actual: se muestra al cerrar para que tenga contra qué cuadrar.
  const openingCount = activeOperator
    ? sortedCashCounts.find((c) => c.operatorName === activeOperator.name)
    : undefined
  const currentOpening =
    openingCount?.kind === "apertura" ? openingCount : undefined

  // Lo mismo que muestra la tabla en el renglón de hoy, para el cierre.
  const today = todayISO()
  const todayBalance = costs
    .filter((c) => c.date === today)
    .reduce((a, c) => a + signedAmount(c), 0)
  // Teórico en caja: con apertura propia se cuadra contra ella; si la
  // encargada la omitió, contra la última apertura registrada hoy.
  const baseOpening =
    currentOpening ??
    sortedCashCounts.find(
      (c) => c.kind === "apertura" && localDay(c.at) === today,
    )
  const expectedCash = baseOpening
    ? cashSinceOpening(costs, baseOpening)
    : undefined

  // Lo que registró esta encargada desde que inició el turno. Un turno
  // abierto antes de guardar la hora de inicio cae a lo suyo de hoy.
  const shiftEntries = activeOperator
    ? costs.filter(
        (c) =>
          c.processedBy === activeOperator.name &&
          (shiftStartedAt
            ? c.createdAt >= shiftStartedAt
            : c.date === today),
      )
    : []

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
        {
          ...quick,
          processedBy: activeOperator.name,
          createdAt: new Date().toISOString(),
          id: crypto.randomUUID(),
        },
      ],
    })
    onNotify(quick.kind === "cobro" ? "Cobro registrado" : "Pago registrado")
    // La fecha casi nunca cambia entre un movimiento y el siguiente durante
    // el mismo turno: solo se limpia lo propio de cada uno.
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
      startSession(existing.id)
      return null
    }
    if (!/^\d{4}$/.test(pin)) return "El PIN debe tener 4 dígitos"
    const operator: CostOperator = {
      id: crypto.randomUUID(),
      name: trimmed,
      pin: await hashPin(pin),
    }
    onChange({ costOperators: [...operators, operator] })
    startSession(operator.id)
    return null
  }

  function startSession(operatorId: string) {
    const startedAt = new Date().toISOString()
    setActiveOperatorId(operatorId)
    writeSession(ACTIVE_OPERATOR_KEY, operatorId)
    setShiftStartedAt(startedAt)
    writeSession(SHIFT_STARTED_KEY, startedAt)
    setOpeningShift(true)
  }

  function endSession() {
    setActiveOperatorId("")
    writeSession(ACTIVE_OPERATOR_KEY, "")
    setShiftStartedAt("")
    writeSession(SHIFT_STARTED_KEY, "")
    setOpeningShift(false)
  }

  function recordCashCount(
    kind: CostCashCountKind,
    cashOnHand: number,
    notes: string,
  ) {
    if (!activeOperator) return
    onChange({
      costCashCounts: [
        ...cashCounts,
        {
          id: crypto.randomUUID(),
          kind,
          operatorName: activeOperator.name,
          at: new Date().toISOString(),
          cashOnHand,
          notes: notes.trim(),
        },
      ],
    })
  }

  function openShift(cashOnHand: number) {
    recordCashCount("apertura", cashOnHand, "")
    setOpeningShift(false)
    onNotify("Efectivo inicial registrado")
  }

  function closeShift(cashOnHand: number, notes: string) {
    recordCashCount("cierre", cashOnHand, notes)
    setClosingShift(false)
    endSession()
    onNotify("Turno cerrado")
  }

  function deleteOperator(id: string) {
    onChange({ costOperators: operators.filter((o) => o.id !== id) })
    if (activeOperatorId === id) endSession()
  }

  function confirmDeleteOperator() {
    if (!pendingDeleteOperator) return
    deleteOperator(pendingDeleteOperator.id)
    onNotify(`Perfil de ${pendingDeleteOperator.name} eliminado`, "danger")
    setPendingDeleteOperator(null)
  }

  function handleEditSave() {
    if (!editing) return
    if (form.amount <= 0 || !form.date || !form.recipientName.trim()) return
    onChange({
      costs: costs.map((c) => (c.id === editing.id ? { ...c, ...form } : c)),
    })
    onNotify("Movimiento actualizado")
    setEditing(null)
  }

  function confirmDelete() {
    if (!pendingDelete) return
    onChange({ costs: costs.filter((c) => c.id !== pendingDelete.id) })
    onNotify("Movimiento eliminado", "danger")
    setPendingDelete(null)
  }

  /**
   * Se identifica por nombre (sin importar mayúsculas) para que "guardar
   * como plantilla" sobre un beneficiario ya guardado actualice su RUC en
   * vez de duplicarlo.
   */
  function saveTemplate(t: Pick<CostTemplate, "recipientName" | "taxId">) {
    const name = t.recipientName.trim()
    if (!name) return
    const existing = templates.find(
      (x) => x.recipientName.toLowerCase() === name.toLowerCase(),
    )
    if (existing) {
      onChange({
        costTemplates: templates.map((x) =>
          x.id === existing.id ? { ...x, taxId: t.taxId } : x,
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
        title="Caja"
        subtitle="Movimientos en caja"
      />

      {!activeOperator ? (
        <TurnoLoginGate
          operators={operators}
          onLogin={login}
          onRequestDelete={setPendingDeleteOperator}
        />
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 rounded-2xl border border-line bg-surface px-4 py-2.5">
            <span className="text-sm font-semibold text-fg flex items-center gap-2">
              <Icon name="unlock" className="w-4 h-4 text-ok shrink-0" />
              Turno activo: {activeOperator.name}
            </span>
            <Button
              size="sm"
              variant="ghost"
              icon="lock"
              onClick={() => setClosingShift(true)}
            >
              Cerrar turno
            </Button>
          </div>

          <QuickAddBar
            nameRef={nameRef}
            quick={quick}
            setQuick={setQuick}
            templates={templates}
            recipientSuggestions={recipientSuggestions}
            onAdd={handleQuickAdd}
            onSaveTemplate={saveTemplate}
            onDeleteTemplate={deleteTemplate}
          />
        </>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Segmented
          value={kindFilter}
          onChange={setKindFilter}
          size="sm"
          options={[
            { value: "todos" as KindFilter, label: "Todos" },
            { value: "cobro" as KindFilter, label: "Cobros" },
            { value: "pago" as KindFilter, label: "Pagos" },
          ]}
        />
        {filtered.length > 0 && (
          <div className="flex gap-2">
            <Button
              size="sm"
              icon="document"
              onClick={() => printCaja(filtered, cashCounts, data.companyName)}
            >
              Imprimir
            </Button>
            <Button
              size="sm"
              icon="download"
              onClick={() =>
                exportCajaWorkbook(filtered, cashCounts, data.companyName)
              }
            >
              Excel
            </Button>
          </div>
        )}
        {costs.length > 4 && (
          <div className="relative max-w-sm flex-1 min-w-[220px]">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle">
              <Icon name="search" />
            </span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nombre, RUC, consulta o encargada"
              aria-label="Buscar movimientos"
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
              ? "Sin movimientos registrados"
              : "Ningún movimiento coincide con el filtro"
          }
          message={
            costs.length === 0
              ? "Usa el formulario de arriba para registrar el primer cobro o pago."
              : "Prueba con otros filtros o limpia la búsqueda."
          }
        />
      ) : (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-raised">
                  {["Nombre", "RUC", "Consulta", "Cant.", "Total", "Encargada", ""].map(
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
                const groupTotal = entries.reduce(
                  (a, c) => a + signedAmount(c),
                  0,
                )
                return (
                  <tbody key={date} className="border-t border-line">
                    <tr className="bg-sunken">
                      <td colSpan={7} className="px-3 py-2">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="text-xs font-bold text-fg">
                            {formatDate(date)}{" "}
                            <span className="text-subtle font-normal">
                              · {entries.length}{" "}
                              {entries.length === 1 ? "movimiento" : "movimientos"}
                            </span>
                          </span>
                          <span
                            className={`text-xs font-bold whitespace-nowrap ${signedTone(groupTotal)}`}
                          >
                            Balance diario {formatSigned(groupTotal)}
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
                            {KIND_LABEL[c.kind]}
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
                        <td
                          className={`px-3 py-2.5 text-right num font-bold whitespace-nowrap ${signedTone(signedAmount(c))}`}
                        >
                          {formatSigned(signedAmount(c))}
                        </td>
                        <td className="px-3 py-2.5 text-muted whitespace-nowrap max-w-[140px] truncate">
                          {c.processedBy || "—"}
                        </td>
                        <td className="px-2 py-2.5 text-right whitespace-nowrap">
                          <IconButton
                            icon="edit"
                            tone="brand"
                            label={`Editar ${KIND_LABEL[c.kind].toLowerCase()} de ${c.recipientName}`}
                            onClick={() => openEdit(c)}
                          />
                          <IconButton
                            icon="trash"
                            tone="danger"
                            label={`Eliminar ${KIND_LABEL[c.kind].toLowerCase()} de ${c.recipientName}`}
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
                    {filtered.length} movimientos mostrados
                  </td>
                  <td
                    className={`px-3 py-3 text-right num font-bold whitespace-nowrap ${signedTone(totalShown)}`}
                  >
                    {formatSigned(totalShown)}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}

      {sortedCashCounts.length > 0 && (
        <Card>
          <h3 className="text-sm font-bold text-fg mb-2">
            Arqueos de caja recientes
          </h3>
          <ul className="divide-y divide-line">
            {sortedCashCounts.slice(0, 8).map((s) => (
              <li
                key={s.id}
                className="py-2 flex items-start justify-between gap-3 text-sm"
              >
                <div className="min-w-0">
                  <span className="block text-fg font-semibold truncate">
                    {s.operatorName || "—"}{" "}
                    <span className="text-xs font-normal text-subtle">
                      · {s.kind === "apertura" ? "Inicio de turno" : "Cierre de turno"}
                    </span>
                  </span>
                  <span className="block text-[11px] text-subtle">
                    {formatDateTime(s.at)}
                  </span>
                  {s.notes && (
                    <span className="block text-xs text-muted mt-0.5 break-words">
                      {s.notes}
                    </span>
                  )}
                </div>
                <span className="num font-bold text-fg whitespace-nowrap">
                  ${fmt(s.cashOnHand)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {openingShift && activeOperator && (
        <OpenShiftDialog
          operatorName={activeOperator.name}
          onSkip={() => setOpeningShift(false)}
          onConfirm={openShift}
        />
      )}

      {closingShift && activeOperator && (
        <CloseShiftDialog
          operatorName={activeOperator.name}
          openingCash={currentOpening?.cashOnHand}
          dayBalance={todayBalance}
          expectedCash={expectedCash}
          shiftCount={shiftEntries.length}
          onPrint={(countedCash, notes) =>
            printShift(
              {
                operatorName: activeOperator.name,
                startedAt: shiftStartedAt,
                entries: shiftEntries,
                openingCash: currentOpening?.cashOnHand,
                expectedCash,
                countedCash,
                notes,
              },
              data.companyName,
            )
          }
          onCancel={() => setClosingShift(false)}
          onConfirm={closeShift}
        />
      )}

      {editing && (
        <CostoEditModal
          form={form}
          setForm={setForm}
          templates={templates}
          recipientSuggestions={recipientSuggestions}
          onSave={handleEditSave}
          onClose={() => setEditing(null)}
          onSaveTemplate={saveTemplate}
          onDeleteTemplate={deleteTemplate}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Eliminar movimiento"
          message={
            <>
              Se eliminará el {KIND_LABEL[pendingDelete.kind].toLowerCase()} de{" "}
              <strong className="text-fg">${fmt(pendingDelete.amount)}</strong>{" "}
              ({pendingDelete.recipientName}) del{" "}
              {formatDate(pendingDelete.date)}.
            </>
          }
          confirmLabel="Eliminar"
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {pendingDeleteOperator && (
        <DeleteOperatorDialog
          operator={pendingDeleteOperator}
          isAdmin={isAdmin}
          onCancel={() => setPendingDeleteOperator(null)}
          onConfirm={confirmDeleteOperator}
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
    t: Pick<CostTemplate, "recipientName" | "taxId">,
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
  onRequestDelete,
}: {
  operators: CostOperator[]
  onLogin: (name: string, pin: string) => Promise<string | null>
  onRequestDelete: (operator: CostOperator) => void
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
            Identifícate para registrar los movimientos de tu turno.
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
                  onClick={() => onRequestDelete(o)}
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

/**
 * Borrar un perfil exige su PIN, igual que iniciar turno con él — así una
 * encargada no puede desaparecer el perfil de otra por error o a propósito.
 * "Soy administradora" salta esa verificación, pero deja bien claro lo que
 * implica antes de dejar confirmar: no hay una cuenta de administrador real
 * detrás, solo una advertencia más fuerte.
 */
function DeleteOperatorDialog({
  operator,
  isAdmin,
  onCancel,
  onConfirm,
}: {
  operator: CostOperator
  isAdmin: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const [mode, setMode] = useState<"pin" | "admin">("pin")
  const [pin, setPin] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function confirmWithPin() {
    if (!/^\d{4}$/.test(pin)) {
      setError("El PIN debe tener 4 dígitos")
      return
    }
    setBusy(true)
    const ok = (await hashPin(pin)) === operator.pin
    setBusy(false)
    if (!ok) {
      setError("PIN incorrecto")
      return
    }
    onConfirm()
  }

  return (
    <Modal
      title={`Eliminar perfil de ${operator.name}`}
      onClose={onCancel}
      width="max-w-sm"
      footer={
        mode === "pin" ? (
          <>
            <Button className="flex-1" onClick={onCancel}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              disabled={busy}
              onClick={confirmWithPin}
            >
              {busy ? "Verificando…" : "Eliminar"}
            </Button>
          </>
        ) : (
          <>
            <Button className="flex-1" onClick={onCancel}>
              Cancelar
            </Button>
            <Button variant="danger" className="flex-1" onClick={onConfirm}>
              Eliminar de todas formas
            </Button>
          </>
        )
      }
    >
      {mode === "pin" ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            Pide a {operator.name} que escriba su PIN para confirmar que ella
            misma quiere eliminar su perfil.
          </p>
          <Field label="PIN">
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
              autoFocus
            />
          </Field>
          {error && <p className="text-xs text-danger font-semibold">{error}</p>}
          {isAdmin && (
            <button
              type="button"
              onClick={() => {
                setMode("admin")
                setError("")
              }}
              className="text-xs text-brand font-semibold"
            >
              ¿Eres administradora? Eliminar sin PIN
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="flex items-start gap-2 text-sm text-danger font-semibold bg-danger-soft rounded-xl p-3">
            <Icon name="alert" className="w-4 h-4 shrink-0 mt-0.5" />
            Vas a eliminar el perfil de {operator.name} sin verificar su PIN.
            Hazlo solo si tienes autoridad para decidirlo — perderá acceso
            para iniciar turno con este nombre y no se puede deshacer.
          </p>
          <button
            type="button"
            onClick={() => setMode("pin")}
            className="text-xs text-muted font-semibold"
          >
            ← Volver a pedir el PIN
          </button>
        </div>
      )}
    </Modal>
  )
}

/**
 * Efectivo esperado en caja desde una apertura: lo contado al abrir más los
 * cobros y menos los pagos de ese día registrados después. Los registros
 * viejos no tienen hora; para esos se cuentan los de la encargada que abrió.
 */
function cashSinceOpening(costs: CostEntry[], opening: CostCashCount): number {
  const day = localDay(opening.at)
  const net = costs
    .filter((c) => c.date === day)
    .filter((c) =>
      c.createdAt
        ? c.createdAt >= opening.at
        : c.processedBy === opening.operatorName,
    )
    .reduce((a, c) => a + signedAmount(c), 0)
  return opening.cashOnHand + net
}

function parseCash(value: string): number | null {
  const n = parseFloat(value)
  return value.trim() !== "" && !Number.isNaN(n) && n >= 0 ? n : null
}

/**
 * Efectivo al iniciar turno: opcional. Cerrar la ventana o tocar "Omitir"
 * no registra nada y deja trabajar igual; solo sirve para que al cerrar
 * haya contra qué cuadrar.
 */
function OpenShiftDialog({
  operatorName,
  onSkip,
  onConfirm,
}: {
  operatorName: string
  onSkip: () => void
  onConfirm: (cashOnHand: number) => void
}) {
  const [cash, setCash] = useState("")
  const cashValue = parseCash(cash)

  return (
    <Modal
      title="Efectivo al iniciar turno"
      onClose={onSkip}
      width="max-w-sm"
      footer={
        <>
          <Button className="flex-1" onClick={onSkip}>
            Omitir
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            disabled={cashValue === null}
            onClick={() => cashValue !== null && onConfirm(cashValue)}
          >
            Guardar
          </Button>
        </>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (cashValue !== null) onConfirm(cashValue)
        }}
      >
        <p className="text-sm text-muted">
          Hola, {operatorName}. Si quieres, anota cuánto efectivo hay en caja
          ahora; al cerrar el turno te servirá para cuadrar las cuentas.
        </p>
        <Field label="Efectivo en caja (USD)" hint="Opcional">
          <input
            type="number"
            min="0"
            step="0.01"
            value={cash}
            onChange={(e) => setCash(e.target.value)}
            placeholder="0.00"
            className={inputNumClass}
            autoFocus
          />
        </Field>
        {/* Los botones viven en el pie del modal, fuera del form: este deja que Enter guarde. */}
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

/**
 * Arqueo al cerrar turno: el efectivo que queda en caja es obligatorio (un
 * cierre sin ese dato no sirve para cuadrar), las notas no.
 */
function CloseShiftDialog({
  operatorName,
  openingCash,
  dayBalance,
  expectedCash,
  shiftCount,
  onPrint,
  onCancel,
  onConfirm,
}: {
  operatorName: string
  openingCash?: number
  /** Cobros menos pagos de hoy, igual que el renglón de la tabla. */
  dayBalance: number
  /** Efectivo que debería haber según la apertura; sin apertura, no hay. */
  expectedCash?: number
  /** Movimientos que registró esta encargada en su turno. */
  shiftCount: number
  onPrint: (countedCash: number | undefined, notes: string) => void
  onCancel: () => void
  onConfirm: (cashOnHand: number, notes: string) => void
}) {
  const [cash, setCash] = useState("")
  const [notes, setNotes] = useState("")
  const parsed = parseCash(cash)
  const canConfirm = parsed !== null
  const cashValue = parsed ?? 0

  return (
    <Modal
      title="Cerrar turno"
      onClose={onCancel}
      width="max-w-sm"
      footer={
        <>
          <Button className="flex-1" onClick={onCancel}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            icon="lock"
            className="flex-1"
            disabled={!canConfirm}
            onClick={() => onConfirm(cashValue, notes)}
          >
            Cerrar turno
          </Button>
        </>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (canConfirm) onConfirm(cashValue, notes)
        }}
      >
        <p className="text-sm text-muted">
          {operatorName}, antes de salir indica cuánto efectivo queda en caja.
        </p>
        <dl className="text-xs bg-sunken rounded-xl px-3 py-2 space-y-1">
          {openingCash !== undefined && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Al iniciar el turno</dt>
              <dd className="num font-bold text-fg">${fmt(openingCash)}</dd>
            </div>
          )}
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Balance diario</dt>
            <dd className={`num font-bold ${signedTone(dayBalance)}`}>
              {formatSigned(dayBalance)}
            </dd>
          </div>
        </dl>
        <Field label="Efectivo en caja (USD)">
          <input
            type="number"
            min="0"
            step="0.01"
            value={cash}
            onChange={(e) => setCash(e.target.value)}
            placeholder="0.00"
            className={inputNumClass}
            autoFocus
          />
        </Field>
        {expectedCash !== undefined && (
          <div className="flex justify-between gap-3 text-xs bg-sunken rounded-xl px-3 py-2">
            <span className="text-muted">En caja</span>
            <span
              className={`num font-bold ${expectedCash < 0 ? "text-danger" : "text-ok"}`}
            >
              ${fmt(expectedCash)}
            </span>
          </div>
        )}
        <Field label="Detalles" hint="Opcional">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Faltantes, sobrantes, pendientes para el siguiente turno…"
            rows={3}
            className={inputClass}
          />
        </Field>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted">
            {shiftCount} {shiftCount === 1 ? "movimiento" : "movimientos"} en
            tu turno
          </span>
          <Button
            size="sm"
            icon="document"
            onClick={() => onPrint(parsed ?? undefined, notes)}
          >
            Imprimir turno
          </Button>
        </div>
        <button type="submit" hidden />
      </form>
    </Modal>
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
  onAdd,
  onSaveTemplate,
  onDeleteTemplate,
}: {
  nameRef: React.RefObject<HTMLInputElement | null>
  quick: Draft
  setQuick: React.Dispatch<React.SetStateAction<Draft>>
  templates: CostTemplate[]
  recipientSuggestions: string[]
  onAdd: () => void
  onSaveTemplate: (
    t: Pick<CostTemplate, "recipientName" | "taxId">,
  ) => void
  onDeleteTemplate: (id: string) => void
}) {
  const canAdd = quick.amount > 0 && !!quick.date && !!quick.recipientName.trim()

  function applyTemplate(t: CostTemplate) {
    setQuick((q) => ({
      ...q,
      recipientName: t.recipientName,
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
          <Field label="Nombre" className="sm:col-span-2">
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
              value={quick.kind}
              onChange={(kind: CostMovementKind) =>
                setQuick((q) => ({ ...q, kind }))
              }
              options={KIND_OPTIONS}
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
          <Field label="Consulta" hint="¿De qué es el movimiento?">
            <input
              value={quick.concept}
              onChange={(e) =>
                setQuick((q) => ({ ...q, concept: e.target.value }))
              }
              placeholder="Consultoría, materiales, trámite…"
              autoComplete="off"
              className={inputClass}
            />
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
  onSave,
  onClose,
  onSaveTemplate,
  onDeleteTemplate,
}: {
  form: Draft
  setForm: React.Dispatch<React.SetStateAction<Draft>>
  templates: CostTemplate[]
  recipientSuggestions: string[]
  onSave: () => void
  onClose: () => void
  onSaveTemplate: (
    t: Pick<CostTemplate, "recipientName" | "taxId">,
  ) => void
  onDeleteTemplate: (id: string) => void
}) {
  const canSave = form.amount > 0 && !!form.date && !!form.recipientName.trim()

  function applyTemplate(t: CostTemplate) {
    setForm((f) => ({
      ...f,
      recipientName: t.recipientName,
      taxId: t.taxId,
    }))
  }

  return (
    <Modal
      title="Editar movimiento"
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
          <Field label="Nombre">
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
              value={form.kind}
              onChange={(kind: CostMovementKind) =>
                setForm((f) => ({ ...f, kind }))
              }
              options={KIND_OPTIONS}
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

        <Field label="Consulta" hint="¿De qué es el movimiento?">
          <input
            value={form.concept}
            onChange={(e) => setForm((f) => ({ ...f, concept: e.target.value }))}
            placeholder="Consultoría, materiales, trámite…"
            autoComplete="off"
            className={inputClass}
          />
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

        <Field label="Encargada/o" hint="Quién registró el movimiento">
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
