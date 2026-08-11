import { useMemo, useState } from "react"
import type { Budget } from "../../types"
import { fmt } from "../../utils/calculations"
import {
  EXPENSE_CATEGORIES,
  currentMonthKey,
  monthLabel,
} from "../../utils/accounting"
import { budgetStatuses } from "../../utils/finance"
import Icon from "../Icon"
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  Field,
  IconButton,
  Modal,
  inputClass,
  inputNumClass,
} from "../ui"
import type { ViewProps } from "../Contabilidad"
import { LEVEL_TONE, ProgressBar, TONE_FG } from "./shared"

export default function Presupuestos({ data, onChange, onNotify }: ViewProps) {
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Budget | null>(null)
  const [category, setCategory] = useState("")
  const [limit, setLimit] = useState(0)
  const [pendingDelete, setPendingDelete] = useState<Budget | null>(null)

  const cur = currentMonthKey()
  const statuses = useMemo(() => budgetStatuses(data, cur), [data, cur])

  const totals = useMemo(
    () => ({
      limit: statuses.reduce((a, s) => a + s.limit, 0),
      spent: statuses.reduce((a, s) => a + s.spent, 0),
    }),
    [statuses],
  )

  // Categorías con gasto real este mes que aún no tienen techo definido.
  const uncovered = useMemo(() => {
    const covered = new Set(data.budgets.map((b) => b.category))
    const seen = new Map<string, number>()
    for (const t of data.transactions) {
      if (t.type !== "gasto" || t.date.slice(0, 7) !== cur) continue
      if (covered.has(t.category)) continue
      seen.set(t.category, (seen.get(t.category) ?? 0) + t.amount)
    }
    return [...seen.entries()]
      .map(([cat, amount]) => ({ cat, amount }))
      .sort((a, b) => b.amount - a.amount)
  }, [data.budgets, data.transactions, cur])

  function openNew(preset = "") {
    setEditing(null)
    setCategory(preset)
    setLimit(0)
    setShowForm(true)
  }

  function openEdit(b: Budget) {
    setEditing(b)
    setCategory(b.category)
    setLimit(b.monthlyLimit)
    setShowForm(true)
  }

  function handleSave() {
    const clean = category.trim()
    if (!clean || limit <= 0) return

    const duplicate = data.budgets.find(
      (b) => b.category === clean && b.id !== editing?.id,
    )
    if (duplicate) {
      onNotify(`Ya existe un presupuesto para ${clean}`, "amber")
      return
    }

    if (editing) {
      onChange({
        budgets: data.budgets.map((b) =>
          b.id === editing.id
            ? { ...b, category: clean, monthlyLimit: limit }
            : b,
        ),
      })
      onNotify("Presupuesto actualizado")
    } else {
      onChange({
        budgets: [
          ...data.budgets,
          { id: crypto.randomUUID(), category: clean, monthlyLimit: limit },
        ],
      })
      onNotify("Presupuesto creado")
    }
    setShowForm(false)
  }

  function confirmDelete() {
    if (!pendingDelete) return
    onChange({ budgets: data.budgets.filter((b) => b.id !== pendingDelete.id) })
    onNotify("Presupuesto eliminado", "danger")
    setPendingDelete(null)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-lg font-bold text-fg">
            Presupuesto de {monthLabel(cur)}
          </h3>
          <p className="text-sm text-muted">
            {statuses.length > 0
              ? `$${fmt(totals.spent)} gastados de $${fmt(totals.limit)} presupuestados`
              : "Define cuánto esperas gastar por categoría"}
          </p>
        </div>
        <Button variant="primary" icon="plus" onClick={() => openNew()}>
          Nuevo presupuesto
        </Button>
      </div>

      {statuses.length === 0 ? (
        <EmptyState
          icon="grid"
          title="Sin presupuestos definidos"
          message="Al fijar un techo por categoría, el sistema avisa cuando el gasto se acerca o lo supera."
          action={
            <Button variant="primary" icon="plus" onClick={() => openNew()}>
              Crear el primero
            </Button>
          }
        />
      ) : (
        <>
          <Card>
            <CardHeader
              title="Consumo total del presupuesto"
              subtitle={`${
                totals.limit > 0
                  ? ((totals.spent / totals.limit) * 100).toFixed(0)
                  : 0
              }% del techo mensual`}
              action={
                <span
                  className={`num text-xl font-extrabold ${
                    totals.spent > totals.limit ? "text-danger" : "text-ok"
                  }`}
                >
                  ${fmt(Math.max(0, totals.limit - totals.spent))}
                </span>
              }
            />
            <ProgressBar
              value={totals.spent}
              max={totals.limit}
              tone={totals.spent > totals.limit ? "danger" : "ok"}
            />
            <p className="text-[11px] text-subtle mt-2">
              {totals.spent > totals.limit
                ? `Excedido por $${fmt(totals.spent - totals.limit)}`
                : `Quedan $${fmt(totals.limit - totals.spent)} disponibles este mes`}
            </p>
          </Card>

          <div className="grid gap-3 md:grid-cols-2">
            {statuses.map((s) => {
              const tone = LEVEL_TONE[s.level]
              return (
                <Card key={s.id}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-fg truncate">
                        {s.category}
                      </p>
                      <p className="text-[11px] text-muted">
                        Techo mensual ${fmt(s.limit)}
                      </p>
                    </div>
                    <div className="flex items-center shrink-0">
                      <Badge tone={tone}>{s.pct.toFixed(0)}%</Badge>
                      <IconButton
                        icon="edit"
                        tone="brand"
                        label={`Editar presupuesto de ${s.category}`}
                        onClick={() =>
                          openEdit(
                            data.budgets.find((b) => b.id === s.id) as Budget,
                          )
                        }
                      />
                      <IconButton
                        icon="trash"
                        tone="danger"
                        label={`Eliminar presupuesto de ${s.category}`}
                        onClick={() =>
                          setPendingDelete(
                            data.budgets.find((b) => b.id === s.id) as Budget,
                          )
                        }
                      />
                    </div>
                  </div>
                  <ProgressBar value={s.spent} max={s.limit} tone={tone} />
                  <div className="flex items-center justify-between mt-2 text-xs">
                    <span className="text-muted">
                      Gastado{" "}
                      <span className="num font-bold text-fg">
                        ${fmt(s.spent)}
                      </span>
                    </span>
                    <span className={`num font-bold ${TONE_FG[tone]}`}>
                      {s.remaining >= 0
                        ? `$${fmt(s.remaining)} libres`
                        : `$${fmt(-s.remaining)} de más`}
                    </span>
                  </div>
                </Card>
              )
            })}
          </div>
        </>
      )}

      {uncovered.length > 0 && (
        <Card>
          <CardHeader
            title="Categorías con gasto y sin presupuesto"
            subtitle="Estás gastando aquí sin un techo definido"
          />
          <ul className="space-y-1.5">
            {uncovered.map((u) => (
              <li
                key={u.cat}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span className="text-muted truncate">{u.cat}</span>
                <span className="flex items-center gap-3 shrink-0">
                  <span className="num font-bold text-fg">
                    ${fmt(u.amount)}
                  </span>
                  <button
                    onClick={() => openNew(u.cat)}
                    className="flex items-center gap-1 text-xs font-semibold text-brand hover:underline"
                  >
                    <Icon name="plus" className="w-3 h-3" />
                    Presupuestar
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {showForm && (
        <Modal
          title={editing ? "Editar presupuesto" : "Nuevo presupuesto"}
          onClose={() => setShowForm(false)}
          footer={
            <>
              <Button className="flex-1" onClick={() => setShowForm(false)}>
                Cancelar
              </Button>
              <Button
                variant="primary"
                className="flex-1"
                disabled={!category.trim() || limit <= 0}
                onClick={handleSave}
              >
                {editing ? "Guardar cambios" : "Crear"}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <Field
              label="Categoría de gasto"
              hint="Elige una de la lista o escribe la tuya"
            >
              <input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                list="presupuesto-categorias"
                placeholder="Ej. Alquiler"
                autoFocus
                className={inputClass}
              />
              <datalist id="presupuesto-categorias">
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
            <Field
              label="Techo mensual (USD)"
              hint="Se compara contra los gastos registrados de esa categoría cada mes"
            >
              <input
                type="number"
                min="0"
                step="0.01"
                value={limit || ""}
                onChange={(e) => setLimit(parseFloat(e.target.value) || 0)}
                placeholder="0.00"
                className={inputNumClass}
              />
            </Field>
          </div>
        </Modal>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Eliminar presupuesto"
          message={
            <>
              Se eliminará el techo de{" "}
              <strong className="text-fg">{pendingDelete.category}</strong>. Los
              gastos registrados no se tocan.
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
