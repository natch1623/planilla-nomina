import { useMemo, useState } from "react"
import type { Loan } from "../../types"
import { fmt, initials } from "../../utils/calculations"
import { periodKeyForDate, periodLabel } from "../../store"
import { installmentCount, loanStatus } from "../../utils/loans"
import { formatDate, todayISO } from "../../utils/dates"
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
  Toggle,
  inputClass,
  inputNumClass,
} from "../ui"
import type { ViewProps } from "../Contabilidad"
import { Kpi, ProgressBar } from "./shared"

type Draft = Omit<Loan, "id">

const emptyDraft = (employeeId = ""): Draft => ({
  employeeId,
  date: todayISO(),
  amount: 0,
  installment: 0,
  startPeriodKey: periodKeyForDate(todayISO()),
  notes: "",
  active: true,
})

export default function Prestamos({ data, onChange, onNotify }: ViewProps) {
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Loan | null>(null)
  const [form, setForm] = useState<Draft>(emptyDraft())
  const [pendingDelete, setPendingDelete] = useState<Loan | null>(null)

  const period = data.currentPeriod
  const activeEmployees = data.employees.filter((e) => e.active)

  const rows = useMemo(
    () =>
      data.loans
        .map((l) => ({
          status: loanStatus(l, period),
          employee: data.employees.find((e) => e.id === l.employeeId),
        }))
        .sort((a, b) => {
          // Los que aún deben, primero: son los que hay que vigilar.
          if (a.status.settled !== b.status.settled) {
            return a.status.settled ? 1 : -1
          }
          return b.status.balance - a.status.balance
        }),
    [data.loans, data.employees, period],
  )

  const totals = useMemo(
    () => ({
      prestado: data.loans.reduce((a, l) => a + l.amount, 0),
      saldo: rows.reduce((a, r) => a + r.status.balance, 0),
      cuota: rows.reduce((a, r) => a + r.status.currentInstallment, 0),
    }),
    [data.loans, rows],
  )

  function openNew() {
    setEditing(null)
    setForm(emptyDraft(activeEmployees[0]?.id ?? ""))
    setShowForm(true)
  }

  function openEdit(l: Loan) {
    setEditing(l)
    const { id: _id, ...rest } = l
    setForm(rest)
    setShowForm(true)
  }

  const canSave =
    !!form.employeeId && form.amount > 0 && form.installment > 0 && !!form.date

  function handleSave() {
    if (!canSave) return
    if (editing) {
      onChange({
        loans: data.loans.map((l) =>
          l.id === editing.id ? { ...l, ...form } : l,
        ),
      })
      onNotify("Préstamo actualizado")
    } else {
      onChange({
        loans: [...data.loans, { ...form, id: crypto.randomUUID() }],
      })
      onNotify("Préstamo registrado; se descontará de la planilla")
    }
    setShowForm(false)
  }

  function toggleActive(l: Loan) {
    onChange({
      loans: data.loans.map((x) =>
        x.id === l.id ? { ...x, active: !x.active } : x,
      ),
    })
    onNotify(
      l.active ? "Descuento suspendido" : "Descuento reanudado",
      l.active ? "amber" : "ok",
    )
  }

  function confirmDelete() {
    if (!pendingDelete) return
    onChange({ loans: data.loans.filter((l) => l.id !== pendingDelete.id) })
    onNotify("Préstamo eliminado", "danger")
    setPendingDelete(null)
  }

  if (activeEmployees.length === 0 && data.loans.length === 0) {
    return (
      <EmptyState
        icon="users"
        title="No hay colaboradores activos"
        message="Agrega colaboradores para poder registrarles préstamos o adelantos."
      />
    )
  }

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Préstamos y adelantos"
        subtitle="Las cuotas se descuentan solas de cada quincena de nómina"
        action={
          <Button variant="primary" icon="plus" onClick={openNew}>
            Nuevo préstamo
          </Button>
        }
      />

      {data.loans.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <Kpi
            label="Total prestado"
            value={`$${fmt(totals.prestado)}`}
            tone="muted"
            icon="creditCard"
          />
          <Kpi
            label="Saldo por recuperar"
            value={`$${fmt(totals.saldo)}`}
            tone={totals.saldo > 0 ? "amber" : "ok"}
            icon="wallet"
            emphasis
          />
          <Kpi
            label={`Se descuenta en ${periodLabel(period, true)}`}
            value={`$${fmt(totals.cuota)}`}
            tone="brand"
            icon="scale"
          />
        </div>
      )}

      {data.loans.length === 0 ? (
        <EmptyState
          icon="creditCard"
          title="Sin préstamos registrados"
          message="Registra un préstamo o adelanto y el sistema descontará la cuota automáticamente de cada quincena hasta saldarlo."
          action={
            <Button variant="primary" icon="plus" onClick={openNew}>
              Registrar el primero
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map(({ status, employee }) => {
            const l = status.loan
            const progress = l.amount > 0 ? (status.paid / l.amount) * 100 : 0
            return (
              <Card key={l.id} className={l.active ? "" : "opacity-60"}>
                <div className="flex items-center gap-3">
                  <span className="w-10 h-10 rounded-full shrink-0 grid place-items-center text-white font-bold text-sm bg-brand">
                    {initials(employee?.name ?? "?")}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-fg truncate">
                        {employee?.name ?? "Colaborador eliminado"}
                      </p>
                      {status.settled ? (
                        <Badge tone="ok">Saldado</Badge>
                      ) : !l.active ? (
                        <Badge tone="muted">Suspendido</Badge>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted">
                      ${fmt(l.amount)} el {formatDate(l.date)} ·{" "}
                      {installmentCount(l)} cuotas de ${fmt(l.installment)}
                    </p>
                  </div>
                  <div className="flex items-center shrink-0">
                    <IconButton
                      icon={l.active ? "eye" : "eyeOff"}
                      label={
                        l.active
                          ? "Suspender el descuento"
                          : "Reanudar el descuento"
                      }
                      onClick={() => toggleActive(l)}
                    />
                    <IconButton
                      icon="edit"
                      tone="brand"
                      label="Editar préstamo"
                      onClick={() => openEdit(l)}
                    />
                    <IconButton
                      icon="trash"
                      tone="danger"
                      label="Eliminar préstamo"
                      onClick={() => setPendingDelete(l)}
                    />
                  </div>
                </div>

                <div className="mt-3 pt-3 border-t border-line">
                  <ProgressBar
                    value={status.paid}
                    max={l.amount}
                    tone={status.settled ? "ok" : "brand"}
                  />
                  <div className="flex items-center justify-between text-xs mt-2">
                    <span className="text-muted">
                      Pagado{" "}
                      <span className="num font-bold text-fg">
                        ${fmt(status.paid)}
                      </span>{" "}
                      ({progress.toFixed(0)}%)
                    </span>
                    <span
                      className={`num font-bold ${
                        status.balance > 0 ? "text-amber" : "text-ok"
                      }`}
                    >
                      {status.balance > 0
                        ? `Debe $${fmt(status.balance)}`
                        : "Sin saldo"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-subtle mt-1">
                    <span>
                      {status.currentInstallment > 0
                        ? `Se descuenta $${fmt(status.currentInstallment)} en ${periodLabel(period, true)}`
                        : status.settled
                          ? "Nada que descontar"
                          : "Sin descuento en esta quincena"}
                    </span>
                    {l.notes && (
                      <span className="truncate ml-2">{l.notes}</span>
                    )}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {showForm && (
        <Modal
          title={editing ? "Editar préstamo" : "Nuevo préstamo o adelanto"}
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
                {editing ? "Guardar cambios" : "Registrar"}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <Field label="Colaborador">
              <select
                value={form.employeeId}
                onChange={(e) =>
                  setForm((f) => ({ ...f, employeeId: e.target.value }))
                }
                className={inputClass}
              >
                <option value="">Selecciona…</option>
                {data.employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                    {e.active ? "" : " (inactivo)"}
                  </option>
                ))}
              </select>
            </Field>

            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Monto prestado (USD)">
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
              <Field
                label="Cuota por quincena (USD)"
                hint={
                  form.amount > 0 && form.installment > 0
                    ? `Se salda en ${Math.ceil(form.amount / form.installment)} quincenas`
                    : "Cuánto descontar en cada planilla"
                }
              >
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.installment || ""}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      installment: parseFloat(e.target.value) || 0,
                    }))
                  }
                  placeholder="0.00"
                  className={inputNumClass}
                />
              </Field>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Fecha de entrega">
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      date: e.target.value,
                      startPeriodKey: periodKeyForDate(e.target.value),
                    }))
                  }
                  className={inputNumClass}
                />
              </Field>
              <Field
                label="Primer descuento"
                hint="Quincena en la que empieza a cobrarse"
              >
                <input
                  value={form.startPeriodKey}
                  readOnly
                  className={`${inputNumClass} opacity-70`}
                />
              </Field>
            </div>

            <Field label="Nota">
              <input
                value={form.notes}
                onChange={(e) =>
                  setForm((f) => ({ ...f, notes: e.target.value }))
                }
                placeholder="Motivo o acuerdo"
                className={inputClass}
              />
            </Field>

            <div className="flex items-center justify-between bg-sunken rounded-xl px-3.5 py-2.5">
              <div>
                <p className="text-sm font-semibold text-fg">
                  Descontar de la planilla
                </p>
                <p className="text-[11px] text-muted">
                  Al desactivarlo se detiene el cobro sin borrar el historial.
                </p>
              </div>
              <Toggle
                checked={form.active}
                onChange={(active) => setForm((f) => ({ ...f, active }))}
                label="Descontar de la planilla"
              />
            </div>
          </div>
        </Modal>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Eliminar préstamo"
          message={
            <>
              Se eliminará el préstamo de{" "}
              <strong className="text-fg">${fmt(pendingDelete.amount)}</strong>{" "}
              y dejará de descontarse de la planilla, incluso en quincenas ya
              calculadas. Si solo quieres detener el cobro, suspéndelo.
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
