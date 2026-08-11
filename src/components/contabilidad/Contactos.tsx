import { useMemo, useState } from "react"
import type { Counterparty, CounterpartyKind } from "../../types"
import { fmt, initials, pct } from "../../utils/calculations"
import Icon from "../Icon"
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
  Segmented,
  inputClass,
} from "../ui"
import type { Tone } from "../ui"
import type { ViewProps } from "../Contabilidad"
import { ProgressBar } from "./shared"

type Draft = Omit<Counterparty, "id">

const emptyDraft = (kind: CounterpartyKind = "cliente"): Draft => ({
  name: "",
  kind,
  taxId: "",
  contact: "",
  notes: "",
})

const GROUPS: {
  kind: CounterpartyKind
  label: string
  tone: Tone
  avatar: string
  metric: string
}[] = [
  {
    kind: "cliente",
    label: "Clientes",
    tone: "ok",
    avatar: "bg-ok",
    metric: "facturado",
  },
  {
    kind: "proveedor",
    label: "Proveedores",
    tone: "violet",
    avatar: "bg-violet",
    metric: "comprado",
  },
]

export default function Contactos({ data, onChange, onNotify }: ViewProps) {
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Counterparty | null>(null)
  const [form, setForm] = useState<Draft>(emptyDraft())
  const [pendingDelete, setPendingDelete] = useState<Counterparty | null>(null)

  /** Totales por contacto: cuánto representa cada uno del volumen de su tipo. */
  const stats = useMemo(() => {
    const map = new Map<string, {
      total: number
      pending: number
      count: number
    }>()
    for (const t of data.transactions) {
      if (!t.counterpartyId) continue
      const cur = map.get(t.counterpartyId) ?? {
        total: 0,
        pending: 0,
        count: 0,
      }
      cur.total += t.amount
      if (t.status === "pendiente") cur.pending += t.amount
      cur.count += 1
      map.set(t.counterpartyId, cur)
    }
    return map
  }, [data.transactions])

  function openNew(kind: CounterpartyKind) {
    setEditing(null)
    setForm(emptyDraft(kind))
    setShowForm(true)
  }

  function openEdit(c: Counterparty) {
    setEditing(c)
    const { id: _id, ...rest } = c
    setForm(rest)
    setShowForm(true)
  }

  function handleSave() {
    if (!form.name.trim()) return
    if (editing) {
      onChange({
        counterparties: data.counterparties.map((c) =>
          c.id === editing.id ? { ...c, ...form } : c,
        ),
      })
      onNotify("Contacto actualizado")
    } else {
      onChange({
        counterparties: [
          ...data.counterparties,
          { ...form, id: crypto.randomUUID() },
        ],
      })
      onNotify(
        form.kind === "cliente" ? "Cliente agregado" : "Proveedor agregado",
      )
    }
    setShowForm(false)
  }

  function confirmDelete() {
    if (!pendingDelete) return
    // Los movimientos se conservan; solo pierden la referencia al contacto.
    onChange({
      counterparties: data.counterparties.filter(
        (c) => c.id !== pendingDelete.id,
      ),
      transactions: data.transactions.map((t) =>
        t.counterpartyId === pendingDelete.id
          ? { ...t, counterpartyId: "" }
          : t,
      ),
    })
    onNotify(`${pendingDelete.name} eliminado`, "danger")
    setPendingDelete(null)
  }

  const linked = pendingDelete
    ? data.transactions.filter((t) => t.counterpartyId === pendingDelete.id)
        .length
    : 0

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Clientes y proveedores"
        subtitle={`${data.counterparties.length} contactos registrados`}
        action={
          <div className="flex gap-2">
            <Button icon="plus" onClick={() => openNew("cliente")}>
              Cliente
            </Button>
            <Button
              variant="primary"
              icon="plus"
              onClick={() => openNew("proveedor")}
            >
              Proveedor
            </Button>
          </div>
        }
      />

      {data.counterparties.length === 0 ? (
        <EmptyState
          icon="briefcase"
          title="Sin clientes ni proveedores"
          message="Al asociar los movimientos a un contacto, puedes saber cuánto representa cada cliente en tus ingresos y cada proveedor en tus gastos."
          action={
            <Button
              variant="primary"
              icon="plus"
              onClick={() => openNew("cliente")}
            >
              Agregar el primero
            </Button>
          }
        />
      ) : (
        GROUPS.map((g) => {
          const list = data.counterparties.filter((c) => c.kind === g.kind)
          const groupTotal = list.reduce(
            (a, c) => a + (stats.get(c.id)?.total ?? 0),
            0,
          )
          return (
            <section key={g.kind}>
              <div className="flex items-center gap-2 mb-3">
                <h3
                  className={`text-xs font-bold uppercase tracking-widest ${
                    g.tone === "ok" ? "text-ok" : "text-violet"
                  }`}
                >
                  {g.label}
                </h3>
                <Badge tone={g.tone}>{list.length}</Badge>
                {groupTotal > 0 && (
                  <span className="text-xs text-muted num">
                    ${fmt(groupTotal)} {g.metric}
                  </span>
                )}
              </div>

              {list.length === 0 ? (
                <p className="border border-dashed border-line rounded-2xl p-5 text-center text-sm text-muted">
                  Ninguno registrado todavía
                </p>
              ) : (
                <div className="grid gap-2.5 md:grid-cols-2">
                  {list
                    .slice()
                    .sort(
                      (a, b) =>
                        (stats.get(b.id)?.total ?? 0) -
                        (stats.get(a.id)?.total ?? 0),
                    )
                    .map((c) => {
                      const s = stats.get(c.id) ?? {
                        total: 0,
                        pending: 0,
                        count: 0,
                      }
                      const share = pct(s.total, groupTotal)
                      return (
                        <Card key={c.id} padded={false} className="p-3.5">
                          <div className="flex items-center gap-3">
                            <span
                              className={`w-10 h-10 rounded-full shrink-0 grid place-items-center text-white font-bold text-sm ${g.avatar}`}
                            >
                              {initials(c.name)}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-fg truncate">
                                {c.name}
                              </p>
                              <p className="text-xs text-muted truncate">
                                {c.contact || "Sin contacto"}
                                {c.taxId && (
                                  <span className="num"> · {c.taxId}</span>
                                )}
                              </p>
                            </div>
                            <div className="flex items-center shrink-0">
                              <IconButton
                                icon="edit"
                                tone="brand"
                                label={`Editar ${c.name}`}
                                onClick={() => openEdit(c)}
                              />
                              <IconButton
                                icon="trash"
                                tone="danger"
                                label={`Eliminar ${c.name}`}
                                onClick={() => setPendingDelete(c)}
                              />
                            </div>
                          </div>

                          <div className="mt-3 pt-3 border-t border-line">
                            <div className="flex items-center justify-between text-xs mb-1.5">
                              <span className="text-muted">
                                {s.count} movimiento{s.count === 1 ? "" : "s"}
                              </span>
                              <span className="num font-bold text-fg">
                                ${fmt(s.total)}
                              </span>
                            </div>
                            <ProgressBar
                              value={s.total}
                              max={groupTotal || 1}
                              tone={g.tone}
                            />
                            <div className="flex items-center justify-between text-[11px] mt-1.5">
                              <span className="text-subtle">
                                {share.toFixed(1)}% del total
                              </span>
                              {s.pending > 0 && (
                                <span className="text-amber font-semibold num">
                                  ${fmt(s.pending)} pendiente
                                </span>
                              )}
                            </div>
                          </div>
                        </Card>
                      )
                    })}
                </div>
              )}
            </section>
          )
        })
      )}

      {showForm && (
        <Modal
          title={editing ? "Editar contacto" : "Nuevo contacto"}
          onClose={() => setShowForm(false)}
          footer={
            <>
              <Button className="flex-1" onClick={() => setShowForm(false)}>
                Cancelar
              </Button>
              <Button
                variant="primary"
                className="flex-1"
                disabled={!form.name.trim()}
                onClick={handleSave}
              >
                {editing ? "Guardar cambios" : "Agregar"}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <Field label="Tipo">
              <Segmented
                value={form.kind}
                onChange={(kind: CounterpartyKind) =>
                  setForm((f) => ({ ...f, kind }))
                }
                options={[
                  { value: "cliente" as CounterpartyKind, label: "Cliente" },
                  {
                    value: "proveedor" as CounterpartyKind,
                    label: "Proveedor",
                  },
                ]}
              />
            </Field>
            <Field label="Nombre o razón social">
              <input
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder="Ej. Distribuidora del Istmo, S.A."
                autoFocus
                className={inputClass}
              />
            </Field>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="RUC o cédula">
                <input
                  value={form.taxId}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, taxId: e.target.value }))
                  }
                  placeholder="8-123-4567 DV 12"
                  className={inputClass}
                />
              </Field>
              <Field label="Teléfono o correo">
                <input
                  value={form.contact}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, contact: e.target.value }))
                  }
                  placeholder="6000-0000"
                  className={inputClass}
                />
              </Field>
            </div>
            <Field label="Notas">
              <input
                value={form.notes}
                onChange={(e) =>
                  setForm((f) => ({ ...f, notes: e.target.value }))
                }
                placeholder="Condiciones de pago, contacto principal…"
                className={inputClass}
              />
            </Field>
          </div>
        </Modal>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Eliminar contacto"
          message={
            <>
              Se eliminará{" "}
              <strong className="text-fg">{pendingDelete.name}</strong>.
              {linked > 0 && (
                <>
                  {" "}
                  Sus {linked} movimiento{linked === 1 ? "" : "s"} se conservan,
                  pero quedan sin contacto asignado.
                </>
              )}
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
