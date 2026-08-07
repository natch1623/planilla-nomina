import { useMemo, useState } from "react"
import type { Employee, EmployeeCategory, WeeklySchedule } from "../types"
import { defaultWeeklySchedule } from "../store"
import { fmtHours, initials } from "../utils/calculations"
import { formatDate } from "../utils/dates"
import {
  describeSchedule,
  weeklyHours,
  workingDaysCount,
} from "../utils/schedule"
import HorarioSemanal from "./HorarioSemanal"
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
  SectionTitle,
  Segmented,
  inputClass,
  inputNumClass,
} from "./ui"
import type { Tone } from "./ui"

interface Props {
  employees: Employee[]
  onChange: (employees: Employee[]) => void
  onNotify: (text: string, tone?: Tone) => void
}

type Draft = Omit<Employee, "id">
type FormTab = "datos" | "horario"

const emptyEmployee = (): Draft => ({
  name: "",
  idNumber: "",
  position: "",
  startDate: "",
  category: "empleado",
  hourlyRate: 0,
  schedule: defaultWeeklySchedule(),
  socialSecurityRate: 9.75,
  educationRate: 1.25,
  active: true,
})

interface GroupDef {
  category: EmployeeCategory
  label: string
  tone: Tone
  avatar: string
}

const GROUPS: GroupDef[] = [
  {
    category: "profesional",
    label: "Servicio profesional",
    tone: "violet",
    avatar: "bg-violet",
  },
  {
    category: "empleado",
    label: "Empleados regulares",
    tone: "ok",
    avatar: "bg-ok",
  },
]

export default function Empleados({ employees, onChange, onNotify }: Props) {
  const [editing, setEditing] = useState<Employee | null>(null)
  const [form, setForm] = useState<Draft>(emptyEmployee())
  const [showForm, setShowForm] = useState(false)
  const [tab, setTab] = useState<FormTab>("datos")
  const [query, setQuery] = useState("")
  const [pendingDelete, setPendingDelete] = useState<Employee | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return employees
    return employees.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.position.toLowerCase().includes(q) ||
        e.idNumber.toLowerCase().includes(q),
    )
  }, [employees, query])

  function openNew() {
    setEditing(null)
    setForm(emptyEmployee())
    setTab("datos")
    setShowForm(true)
  }

  function openEdit(emp: Employee, startTab: FormTab = "datos") {
    setEditing(emp)
    const { id: _id, ...rest } = emp
    setForm(rest)
    setTab(startTab)
    setShowForm(true)
  }

  function setCategory(category: EmployeeCategory) {
    setForm((f) => ({
      ...f,
      category,
      socialSecurityRate: category === "profesional" ? 0 : 9.75,
      educationRate: category === "profesional" ? 0 : 1.25,
    }))
  }

  function setSchedule(schedule: WeeklySchedule) {
    setForm((f) => ({ ...f, schedule }))
  }

  const nameOk = form.name.trim().length > 0
  const rateOk = form.hourlyRate > 0
  const canSave = nameOk && rateOk

  function handleSave() {
    if (!canSave) {
      // Los campos obligatorios viven en la primera pestaña: llevar al usuario
      // allí evita un botón deshabilitado sin explicación visible.
      setTab("datos")
      return
    }
    if (editing) {
      onChange(
        employees.map((e) => (e.id === editing.id ? { ...e, ...form } : e)),
      )
      onNotify("Colaborador actualizado")
    } else {
      onChange([...employees, { ...form, id: crypto.randomUUID() }])
      onNotify("Colaborador agregado")
    }
    setShowForm(false)
  }

  function toggleActive(emp: Employee) {
    onChange(
      employees.map((e) => (e.id === emp.id ? { ...e, active: !e.active } : e)),
    )
    onNotify(
      emp.active ? `${emp.name} desactivado` : `${emp.name} activado`,
      emp.active ? "amber" : "ok",
    )
  }

  function confirmDelete() {
    if (!pendingDelete) return
    onChange(employees.filter((e) => e.id !== pendingDelete.id))
    onNotify(`${pendingDelete.name} eliminado`, "danger")
    setPendingDelete(null)
  }

  const activeCount = employees.filter((e) => e.active).length

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Colaboradores"
        subtitle={`${employees.length} registrados · ${activeCount} activos`}
        action={
          <Button variant="primary" icon="plus" onClick={openNew}>
            Nuevo colaborador
          </Button>
        }
      />

      {employees.length > 3 && (
        <div className="relative max-w-sm">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle">
            <Icon name="search" />
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre, cargo o cédula"
            aria-label="Buscar colaboradores"
            className={`${inputClass} pl-9`}
          />
        </div>
      )}

      {employees.length === 0 ? (
        <EmptyState
          icon="users"
          title="Todavía no hay colaboradores"
          message="Agrega a tu equipo para poder registrar horas y calcular la planilla."
          action={
            <Button variant="primary" icon="plus" onClick={openNew}>
              Agregar el primero
            </Button>
          }
        />
      ) : (
        GROUPS.map(({ category, label, tone, avatar }) => {
          const list = filtered.filter((e) => e.category === category)
          return (
            <section key={category}>
              <div className="flex items-center gap-2 mb-3">
                <h3
                  className={`text-xs font-bold uppercase tracking-widest ${
                    tone === "violet" ? "text-violet" : "text-ok"
                  }`}
                >
                  {label}
                </h3>
                <Badge tone={tone}>{list.length}</Badge>
              </div>

              {list.length === 0 ? (
                <p className="border border-dashed border-line rounded-2xl p-5 text-center text-sm text-muted">
                  {query
                    ? "Ningún resultado en esta categoría"
                    : "No hay colaboradores en esta categoría"}
                </p>
              ) : (
                <div className="grid gap-2.5 md:grid-cols-2">
                  {list.map((emp) => (
                    <EmployeeCard
                      key={emp.id}
                      employee={emp}
                      avatar={avatar}
                      onEdit={openEdit}
                      onToggleActive={toggleActive}
                      onDelete={setPendingDelete}
                    />
                  ))}
                </div>
              )}
            </section>
          )
        })
      )}

      {showForm && (
        <Modal
          title={editing ? "Editar colaborador" : "Nuevo colaborador"}
          subtitle={
            editing
              ? editing.name
              : "Define sus datos y su horario habitual de trabajo"
          }
          onClose={() => setShowForm(false)}
          width="max-w-2xl"
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
                {editing ? "Guardar cambios" : "Agregar colaborador"}
              </Button>
            </>
          }
        >
          <div className="space-y-5">
            <Segmented
              value={tab}
              onChange={setTab}
              options={[
                { value: "datos" as FormTab, label: "Datos y pago" },
                {
                  value: "horario" as FormTab,
                  label: `Horario · ${fmtHours(weeklyHours(form.schedule))}`,
                },
              ]}
            />

            {tab === "datos" ? (
              <DatosTab
                form={form}
                setForm={setForm}
                setCategory={setCategory}
              />
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-muted">
                  Este horario se usa para prellenar el registro diario y para
                  el llenado rápido. Siempre puedes ajustar un día concreto
                  desde el registro.
                </p>
                <HorarioSemanal
                  schedule={form.schedule}
                  onChange={setSchedule}
                />
              </div>
            )}

            {!canSave && (
              <p className="flex items-center gap-2 text-[11px] text-amber">
                <Icon name="alert" className="w-3.5 h-3.5 shrink-0" />
                Falta {!nameOk ? "el nombre" : "el salario por hora"} en la
                pestaña «Datos y pago».
              </p>
            )}
          </div>
        </Modal>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Eliminar colaborador"
          message={
            <>
              Se eliminará a{" "}
              <strong className="text-fg">{pendingDelete.name}</strong> y todos
              sus registros dejarán de aparecer en la planilla. Si solo quieres
              sacarlo de la nómina actual, desactívalo en vez de eliminarlo.
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

/* --------------------------------------------------------------- Tarjeta */

interface EmployeeCardProps {
  employee: Employee
  avatar: string
  onEdit: (emp: Employee, tab?: FormTab) => void
  onToggleActive: (emp: Employee) => void
  onDelete: (emp: Employee) => void
}

function EmployeeCard({
  employee,
  avatar,
  onEdit,
  onToggleActive,
  onDelete,
}: EmployeeCardProps) {
  const hours = weeklyHours(employee.schedule)
  const days = workingDaysCount(employee.schedule)

  return (
    <Card
      padded={false}
      className={`p-3.5 ${employee.active ? "" : "opacity-55"}`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`w-10 h-10 rounded-full shrink-0 grid place-items-center text-white font-bold text-sm ${avatar}`}
        >
          {initials(employee.name)}
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-fg truncate">
              {employee.name}
            </span>
            {!employee.active && <Badge tone="muted">Inactivo</Badge>}
          </div>
          <div className="text-xs text-muted truncate">
            {employee.position || "Sin cargo"}
            {employee.idNumber && (
              <span className="font-mono"> · {employee.idNumber}</span>
            )}
          </div>
        </div>

        <div className="flex items-center shrink-0">
          <IconButton
            icon={employee.active ? "eye" : "eyeOff"}
            label={
              employee.active
                ? `Desactivar a ${employee.name}`
                : `Activar a ${employee.name}`
            }
            onClick={() => onToggleActive(employee)}
          />
          <IconButton
            icon="edit"
            tone="brand"
            label={`Editar a ${employee.name}`}
            onClick={() => onEdit(employee)}
          />
          <IconButton
            icon="trash"
            tone="danger"
            label={`Eliminar a ${employee.name}`}
            onClick={() => onDelete(employee)}
          />
        </div>
      </div>

      {/* Pago y horario: los dos datos que se consultan a diario */}
      <div className="flex items-center gap-2 flex-wrap mt-3 pt-3 border-t border-line text-xs">
        <span className="font-mono font-bold text-fg">
          ${employee.hourlyRate.toFixed(2)}/h
        </span>
        {employee.category === "empleado" && (
          <span className="font-mono text-danger">
            −{(employee.socialSecurityRate + employee.educationRate).toFixed(2)}
            %
          </span>
        )}
        {employee.startDate && (
          <span className="text-subtle">
            desde {formatDate(employee.startDate)}
          </span>
        )}

        <button
          type="button"
          onClick={() => onEdit(employee, "horario")}
          title={`Editar el horario de ${employee.name}`}
          className="ml-auto flex items-center gap-1.5 px-2 py-1 rounded-lg text-muted hover:text-brand hover:bg-brand-soft max-w-full"
        >
          <Icon name="clock" className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">
            {describeSchedule(employee.schedule)}
          </span>
          <span className="font-mono font-semibold shrink-0">
            · {fmtHours(hours)}/{days}d
          </span>
        </button>
      </div>
    </Card>
  )
}

/* ------------------------------------------------------------ Pestaña 1 */

interface DatosTabProps {
  form: Draft
  setForm: React.Dispatch<React.SetStateAction<Draft>>
  setCategory: (c: EmployeeCategory) => void
}

function DatosTab({ form, setForm, setCategory }: DatosTabProps) {
  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Nombre completo" className="sm:col-span-2">
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Ej. María González"
            autoFocus
            className={inputClass}
          />
        </Field>

        <Field label="Cédula o pasaporte">
          <input
            value={form.idNumber}
            onChange={(e) =>
              setForm((f) => ({ ...f, idNumber: e.target.value }))
            }
            placeholder="8-123-4567"
            className={inputNumClass}
          />
        </Field>

        <Field label="Fecha de ingreso">
          <input
            type="date"
            value={form.startDate}
            onChange={(e) =>
              setForm((f) => ({ ...f, startDate: e.target.value }))
            }
            className={inputNumClass}
          />
        </Field>

        <Field label="Cargo" className="sm:col-span-2">
          <input
            value={form.position}
            onChange={(e) =>
              setForm((f) => ({ ...f, position: e.target.value }))
            }
            placeholder="Ej. Asistente administrativa"
            className={inputClass}
          />
        </Field>

        <Field label="Categoría">
          <Segmented
            value={form.category}
            onChange={setCategory}
            options={[
              {
                value: "profesional" as EmployeeCategory,
                label: "Serv. profesional",
              },
              {
                value: "empleado" as EmployeeCategory,
                label: "Empleado regular",
              },
            ]}
          />
        </Field>

        <Field label="Salario por hora (USD)">
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.hourlyRate || ""}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                hourlyRate: parseFloat(e.target.value) || 0,
              }))
            }
            placeholder="0.00"
            className={inputNumClass}
          />
        </Field>
      </div>

      {form.category === "empleado" ? (
        <div className="bg-amber-soft border border-line rounded-2xl p-4 space-y-3">
          <p className="text-xs font-bold text-amber uppercase tracking-wide">
            Descuentos sobre el salario base
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Seguro social (%)">
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={form.socialSecurityRate}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    socialSecurityRate: parseFloat(e.target.value) || 0,
                  }))
                }
                className={inputNumClass}
              />
            </Field>
            <Field label="Seguro educativo (%)">
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={form.educationRate}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    educationRate: parseFloat(e.target.value) || 0,
                  }))
                }
                className={inputNumClass}
              />
            </Field>
          </div>
          <p className="text-[11px] text-amber">
            Los descuentos se aplican al salario base y a los días pagados, no a
            los recargos de horas extra ni de feriado.
          </p>
        </div>
      ) : (
        <p className="bg-violet-soft border border-line rounded-2xl p-3 text-xs text-violet">
          <strong>Sin descuentos</strong> de seguro social ni educativo para
          servicios profesionales.
        </p>
      )}
    </div>
  )
}
