import { useMemo, useState } from "react"
import type { FinancialGoal, GoalKind } from "../../types"
import { fmt } from "../../utils/calculations"
import { currentMonthKey, monthLabel } from "../../utils/accounting"
import type { MonthSummary } from "../../utils/accounting"
import { goalProgress } from "../../utils/finance"
import { todayISO } from "../../utils/dates"
import Icon from "../Icon"
import type { IconName } from "../Icon"
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  IconButton,
  Modal,
  SectionTitle,
  inputClass,
  inputNumClass,
} from "../ui"
import type { Tone } from "../ui"
import type { ViewProps } from "../Contabilidad"
import { ProgressBar, TONE_FG } from "./shared"

interface Props extends ViewProps {
  series: MonthSummary[]
}

type Draft = Omit<FinancialGoal, "id">

const KIND_META: Record<GoalKind, {
  label: string
  icon: IconName
  tone: Tone
  hint: string
}> = {
  ahorro: {
    label: "Ahorrar",
    icon: "wallet",
    tone: "ok",
    hint: "Mide el flujo de caja acumulado desde que creaste la meta",
  },
  "reducir-gastos": {
    label: "Reducir gastos",
    icon: "trendDown",
    tone: "amber",
    hint: "Mide cuánto bajaron los gastos contra el mes en que la creaste",
  },
  "aumentar-ingresos": {
    label: "Aumentar ingresos",
    icon: "trendUp",
    tone: "brand",
    hint: "Mide cuánto subieron los ingresos contra el mes en que la creaste",
  },
}

const emptyDraft = (): Draft => ({
  kind: "ahorro",
  title: "",
  target: 0,
  deadline: currentMonthKey(),
  createdAt: todayISO(),
})

export default function Metas({ data, series, onChange, onNotify }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<FinancialGoal | null>(null)
  const [form, setForm] = useState<Draft>(emptyDraft())
  const [pendingDelete, setPendingDelete] = useState<FinancialGoal | null>(null)

  const progress = useMemo(() => goalProgress(data, series), [data, series])

  function openNew() {
    setEditing(null)
    setForm(emptyDraft())
    setShowForm(true)
  }

  function openEdit(g: FinancialGoal) {
    setEditing(g)
    const { id: _id, ...rest } = g
    setForm(rest)
    setShowForm(true)
  }

  const canSave = form.title.trim().length > 0 && form.target > 0

  function handleSave() {
    if (!canSave) return
    if (editing) {
      onChange({
        goals: data.goals.map((g) =>
          g.id === editing.id ? { ...g, ...form } : g,
        ),
      })
      onNotify("Meta actualizada")
    } else {
      onChange({
        goals: [...data.goals, { ...form, id: crypto.randomUUID() }],
      })
      onNotify("Meta creada")
    }
    setShowForm(false)
  }

  function confirmDelete() {
    if (!pendingDelete) return
    onChange({ goals: data.goals.filter((g) => g.id !== pendingDelete.id) })
    onNotify("Meta eliminada", "danger")
    setPendingDelete(null)
  }

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Metas financieras"
        subtitle="Objetivos medidos contra los datos reales del negocio"
        action={
          <Button variant="primary" icon="plus" onClick={openNew}>
            Nueva meta
          </Button>
        }
      />

      {data.goals.length === 0 ? (
        <EmptyState
          icon="flag"
          title="Sin metas definidas"
          message="Define un objetivo de ahorro, de reducción de gastos o de crecimiento y el sistema medirá el avance solo, con los movimientos que ya registras."
          action={
            <Button variant="primary" icon="plus" onClick={openNew}>
              Crear la primera
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {progress.map((p) => {
            const goal = data.goals.find((g) => g.id === p.id)
            if (!goal) return null
            const meta = KIND_META[goal.kind]
            const done = p.pct >= 100
            const tone: Tone = done ? "ok" : p.onTrack ? meta.tone : "danger"

            return (
              <Card key={p.id}>
                <div className="flex items-start gap-3">
                  <span
                    className={`w-9 h-9 rounded-xl grid place-items-center shrink-0 bg-sunken ${TONE_FG[meta.tone]}`}
                  >
                    <Icon name={meta.icon} className="w-4 h-4" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-fg truncate">
                        {goal.title}
                      </p>
                      {done ? (
                        <Badge tone="ok">
                          <Icon name="check" className="w-3 h-3" />
                          Cumplida
                        </Badge>
                      ) : (
                        <Badge tone={p.onTrack ? "brand" : "danger"}>
                          {p.onTrack ? "En ritmo" : "Atrasada"}
                        </Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-muted mt-0.5">
                      {meta.label} · meta ${fmt(goal.target)}
                      {goal.deadline && ` para ${monthLabel(goal.deadline)}`}
                    </p>
                  </div>
                  <div className="flex items-center shrink-0">
                    <IconButton
                      icon="edit"
                      tone="brand"
                      label={`Editar ${goal.title}`}
                      onClick={() => openEdit(goal)}
                    />
                    <IconButton
                      icon="trash"
                      tone="danger"
                      label={`Eliminar ${goal.title}`}
                      onClick={() => setPendingDelete(goal)}
                    />
                  </div>
                </div>

                <div className="mt-3">
                  <ProgressBar
                    value={p.achieved}
                    max={goal.target}
                    tone={tone}
                  />
                  <div className="flex items-center justify-between text-xs mt-2">
                    <span className="text-muted">
                      Logrado{" "}
                      <span className="num font-bold text-fg">
                        ${fmt(Math.max(0, p.achieved))}
                      </span>
                    </span>
                    <span className={`num font-bold ${TONE_FG[tone]}`}>
                      {Math.max(0, Math.min(999, p.pct)).toFixed(0)}%
                    </span>
                  </div>
                  <p className="text-[11px] text-subtle mt-1">
                    {p.monthsLeft > 0
                      ? `Quedan ${p.monthsLeft} mes${
                          p.monthsLeft === 1 ? "" : "es"
                        } · ${meta.hint.toLowerCase()}`
                      : meta.hint}
                  </p>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {showForm && (
        <Modal
          title={editing ? "Editar meta" : "Nueva meta financiera"}
          onClose={() => setShowForm(false)}
          footer={
            <>
              <Button className="flex-1" onClick={() => setShowForm(false)}>
                Cancelar
              </Button>
              <Button
                variant="primary"
                className="flex-1"
                disabled={!canSave}
                onClick={handleSave}
              >
                {editing ? "Guardar cambios" : "Crear meta"}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <Field label="Tipo de meta" hint={KIND_META[form.kind].hint}>
              <div className="grid grid-cols-3 gap-1.5">
                {(Object.keys(KIND_META) as GoalKind[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, kind: k }))}
                    aria-pressed={form.kind === k}
                    className={`flex flex-col items-center gap-1 px-2 py-2.5 rounded-xl border text-[11px] font-bold transition-colors ${
                      form.kind === k
                        ? "bg-brand-soft border-brand text-brand"
                        : "bg-surface border-line text-muted hover:border-line-strong"
                    }`}
                  >
                    <Icon name={KIND_META[k].icon} className="w-4 h-4" />
                    {KIND_META[k].label}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Nombre de la meta">
              <input
                value={form.title}
                onChange={(e) =>
                  setForm((f) => ({ ...f, title: e.target.value }))
                }
                placeholder="Ej. Fondo de reserva para tres meses"
                autoFocus
                className={inputClass}
              />
            </Field>

            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Monto objetivo (USD)">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.target || ""}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      target: parseFloat(e.target.value) || 0,
                    }))
                  }
                  placeholder="0.00"
                  className={inputNumClass}
                />
              </Field>
              <Field label="Fecha límite">
                <input
                  type="month"
                  value={form.deadline}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, deadline: e.target.value }))
                  }
                  className={inputNumClass}
                />
              </Field>
            </div>
          </div>
        </Modal>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Eliminar meta"
          message={
            <>
              Se eliminará{" "}
              <strong className="text-fg">{pendingDelete.title}</strong>. Los
              movimientos y el historial no se tocan.
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
