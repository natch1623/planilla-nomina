import { useEffect, useMemo, useRef, useState } from "react"
import type { DayType, Employee, PayPeriod, TimeEntry } from "../types"
import { getPeriodDates } from "../store"
import type { PayrollRules } from "../utils/calculations"
import {
  DAY_TYPE_META,
  DAY_TYPES,
  calcWorkedHours,
  fmtHours,
  initials,
  splitHours,
  usesSchedule,
} from "../utils/calculations"
import {
  datesBetween,
  dayName,
  dayNameLong,
  dayNum,
  formatDate,
  isWeekend,
  todayISO,
} from "../utils/dates"
import { scheduleForDate } from "../utils/schedule"
import Icon from "./Icon"
import LlenadoRapido, { applyFill, resolveFillTargets } from "./LlenadoRapido"
import type { FillOptions } from "./LlenadoRapido"
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Segmented,
  Toggle,
  inputClass,
  inputNumClass,
} from "./ui"
import type { Tone } from "./ui"

interface RowTotals {
  days: number
  hours: number
  overtime: number
}

interface Props {
  employees: Employee[]
  entries: TimeEntry[]
  period: PayPeriod
  rules: PayrollRules
  readOnly: boolean
  onChange: (entries: TimeEntry[]) => void
  onNotify: (text: string, tone?: Tone) => void
}

/* Clases estáticas: Tailwind no puede generar una clase construida en tiempo de ejecución. */
const CELL_BG: Record<DayType, string> = {
  trabajo: "bg-brand-soft",
  feriado: "bg-violet-soft",
  vacaciones: "bg-teal-soft",
  incapacidad: "bg-amber-soft",
  ausencia: "bg-danger-soft",
}

const CELL_FG: Record<DayType, string> = {
  trabajo: "text-brand",
  feriado: "text-violet",
  vacaciones: "text-teal",
  incapacidad: "text-amber",
  ausencia: "text-danger",
}

const DAY_TYPE_TONE: Record<DayType, Tone> = {
  trabajo: "brand",
  feriado: "violet",
  vacaciones: "teal",
  incapacidad: "amber",
  ausencia: "danger",
}

/**
 * Valores iniciales al abrir una celda vacía.
 *
 * Prioridad: el horario habitual del colaborador para ese día de la semana →
 * el último día que registró → el estándar. Con el horario definido, registrar
 * un día normal se reduce a un clic y confirmar.
 */
function blankEntry(
  employee: Employee,
  date: string,
  template?: TimeEntry | null,
): TimeEntry {
  const planned = scheduleForDate(employee, date)
  return {
    id: "",
    employeeId: employee.id,
    date,
    dayType: "trabajo",
    entryTime: planned?.entryTime || template?.entryTime || "08:00",
    exitTime: planned?.exitTime || template?.exitTime || "17:00",
    lunchBreak: planned?.lunchBreak ?? template?.lunchBreak ?? true,
    lunchDuration: planned?.lunchDuration ?? template?.lunchDuration ?? 60,
    overtimeRate: template?.overtimeRate ?? 1.5,
    notes: "",
  }
}

export default function RegistroDiario({
  employees,
  entries,
  period,
  rules,
  readOnly,
  onChange,
  onNotify,
}: Props) {
  const { start, end } = getPeriodDates(period)
  const dates = useMemo(() => datesBetween(start, end), [start, end])
  const activeEmployees = useMemo(
    () => employees.filter((e) => e.active),
    [employees],
  )

  const [view, setView] = useState<"grid" | "day">(() =>
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 767px)").matches
      ? "day"
      : "grid",
  )
  const [target, setTarget] = useState<{
    employeeId: string
    date: string
    rect: DOMRect | null
  } | null>(null)
  const [fillFor, setFillFor] = useState<string[] | null>(null)
  const [selectedDate, setSelectedDate] = useState(() => {
    const today = todayISO()
    return today >= start && today <= end ? today : start
  })

  useEffect(() => {
    // Al cambiar de quincena el día seleccionado debe caer dentro del nuevo rango.
    setSelectedDate((d) => (d >= start && d <= end ? d : start))
  }, [start, end])

  const entryMap = useMemo(() => {
    const m = new Map<string, TimeEntry>()
    for (const e of entries) m.set(`${e.employeeId}|${e.date}`, e)
    return m
  }, [entries])

  const getEntry = (employeeId: string, date: string) =>
    entryMap.get(`${employeeId}|${date}`) ?? null

  function previousEntry(employeeId: string, date: string): TimeEntry | null {
    const i = dates.indexOf(date)
    for (let k = i - 1; k >= 0; k--) {
      const prev = getEntry(employeeId, dates[k])
      if (prev && usesSchedule(prev.dayType)) return prev
    }
    return null
  }

  function saveEntry(draft: TimeEntry) {
    const existing = getEntry(draft.employeeId, draft.date)
    const full: TimeEntry = {
      ...draft,
      id: existing?.id ?? crypto.randomUUID(),
    }
    onChange(
      existing
        ? entries.map((e) => (e.id === full.id ? full : e))
        : [...entries, full],
    )
    setTarget(null)
  }

  function deleteEntry(employeeId: string, date: string) {
    const existing = getEntry(employeeId, date)
    if (existing) onChange(entries.filter((e) => e.id !== existing.id))
    setTarget(null)
  }

  function handleFill(opts: FillOptions) {
    const targets = resolveFillTargets(activeEmployees, dates, opts)
    const result = applyFill(entries, targets, opts)
    onChange(result.entries)
    setFillFor(null)
    const parts = [
      result.created ? `${result.created} creados` : "",
      result.updated ? `${result.updated} actualizados` : "",
      result.skipped ? `${result.skipped} respetados` : "",
    ].filter(Boolean)
    onNotify(parts.join(" · ") || "Sin cambios")
  }

  function clearRow(employeeId: string) {
    onChange(
      entries.filter(
        (e) =>
          !(e.employeeId === employeeId && e.date >= start && e.date <= end),
      ),
    )
    onNotify("Fila vaciada", "amber")
  }

  const totalsFor = useMemo(() => {
    const map = new Map<string, {
      days: number
      hours: number
      overtime: number
    }>()
    for (const emp of activeEmployees) {
      let days = 0
      let hours = 0
      let overtime = 0
      for (const d of dates) {
        const e = getEntry(emp.id, d)
        if (!e) continue
        const { total } = calcWorkedHours(e)
        if (total > 0) {
          days += 1
          hours += total
          overtime += splitHours(total, rules.overtimeThreshold).overtime
        }
      }
      map.set(emp.id, { days, hours, overtime })
    }
    return map
  }, [activeEmployees, dates, entryMap, rules.overtimeThreshold])

  if (activeEmployees.length === 0) {
    return (
      <EmptyState
        icon="users"
        title="No hay colaboradores activos"
        message="Agrega colaboradores en la pestaña Colaboradores para empezar a registrar horas."
      />
    )
  }

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight text-fg">
            Registro quincenal
          </h2>
          <p className="text-sm text-muted mt-1">
            {formatDate(start)} — {formatDate(end)} ·{" "}
            {readOnly
              ? "Quincena cerrada (solo lectura)"
              : "Clic en cualquier celda, o flechas y Enter con el teclado"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Segmented
            value={view}
            onChange={setView}
            size="sm"
            options={[
              {
                value: "grid",
                label: <Icon name="grid" className="w-4 h-4" />,
                title: "Vista cuadrícula",
              },
              {
                value: "day",
                label: <Icon name="list" className="w-4 h-4" />,
                title: "Vista por día",
              },
            ]}
          />
          {!readOnly && (
            <Button
              variant="primary"
              icon="bolt"
              onClick={() => setFillFor(activeEmployees.map((e) => e.id))}
            >
              Llenado rápido
            </Button>
          )}
        </div>
      </div>

      <Legend />

      {view === "grid" ? (
        <GridView
          employees={activeEmployees}
          dates={dates}
          getEntry={getEntry}
          totalsFor={totalsFor}
          rules={rules}
          readOnly={readOnly}
          onOpen={(employeeId, date, rect) =>
            setTarget({ employeeId, date, rect })
          }
          onFillRow={(id) => setFillFor([id])}
          onClearRow={clearRow}
        />
      ) : (
        <DayView
          employees={activeEmployees}
          dates={dates}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
          getEntry={getEntry}
          rules={rules}
          readOnly={readOnly}
          onOpen={(employeeId, date) =>
            setTarget({ employeeId, date, rect: null })
          }
        />
      )}

      {target && !readOnly && (
        <EntryEditor
          key={`${target.employeeId}|${target.date}`}
          employee={activeEmployees.find((e) => e.id === target.employeeId)!}
          date={target.date}
          existing={getEntry(target.employeeId, target.date)}
          previous={previousEntry(target.employeeId, target.date)}
          anchorRect={target.rect}
          rules={rules}
          onSave={saveEntry}
          onDelete={() => deleteEntry(target.employeeId, target.date)}
          onClose={() => setTarget(null)}
        />
      )}

      {fillFor && !readOnly && (
        <LlenadoRapido
          employees={activeEmployees}
          dates={dates}
          entries={entries.filter((e) => e.date >= start && e.date <= end)}
          preselected={fillFor}
          onApply={handleFill}
          onClose={() => setFillFor(null)}
        />
      )}
    </div>
  )
}

/* --------------------------------------------------------------- Leyenda */

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted">
      {DAY_TYPES.map((t) => (
        <span key={t} className="flex items-center gap-1.5">
          <span
            className={`w-3 h-3 rounded-sm ${CELL_BG[t]} border border-line`}
          />
          {DAY_TYPE_META[t].label}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="w-3 h-3 rounded-sm bg-weekend border border-line" />
        Día libre según su horario
      </span>
      <span className="flex items-center gap-1.5">
        <span className="text-amber font-bold">+extra</span>
        supera la jornada
      </span>
    </div>
  )
}

/* ------------------------------------------------------------- Cuadrícula */

interface GridProps {
  employees: Employee[]
  dates: string[]
  getEntry: (employeeId: string, date: string) => TimeEntry | null
  totalsFor: Map<string, RowTotals>
  rules: PayrollRules
  readOnly: boolean
  onOpen: (employeeId: string, date: string, rect: DOMRect) => void
  onFillRow: (employeeId: string) => void
  onClearRow: (employeeId: string) => void
}

function GridView({
  employees,
  dates,
  getEntry,
  totalsFor,
  rules,
  readOnly,
  onOpen,
  onFillRow,
  onClearRow,
}: GridProps) {
  const bodyRef = useRef<HTMLTableSectionElement>(null)
  const today = todayISO()

  function focusCell(r: number, c: number) {
    const el = bodyRef.current?.querySelector<HTMLButtonElement>(
      `[data-cell="${r}-${c}"]`,
    )
    el?.focus()
    el?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }

  /* La cuadrícula es una hoja de cálculo: se navega con flechas, no con 60 tabulaciones. */
  function onKeyDown(e: React.KeyboardEvent) {
    const cell = (e.target as HTMLElement).dataset.cell
    if (!cell) return
    const [r, c] = cell.split("-").map(Number)
    let nr = r
    let nc = c
    switch (e.key) {
      case "ArrowRight":
        nc += 1
        break
      case "ArrowLeft":
        nc -= 1
        break
      case "ArrowDown":
        nr += 1
        break
      case "ArrowUp":
        nr -= 1
        break
      case "Home":
        nc = 0
        break
      case "End":
        nc = dates.length - 1
        break
      case "PageUp":
        nr = 0
        break
      case "PageDown":
        nr = employees.length - 1
        break
      default:
        return
    }
    e.preventDefault()
    focusCell(
      Math.max(0, Math.min(employees.length - 1, nr)),
      Math.max(0, Math.min(dates.length - 1, nc)),
    )
  }

  return (
    <Card padded={false} className="overflow-hidden">
      <div className="overflow-x-auto">
        <table
          className="border-collapse w-full"
          style={{ minWidth: "max-content" }}
        >
          <caption className="sr-only-focusable">
            Registro de horas por colaborador y día de la quincena
          </caption>
          <thead>
            <tr className="bg-nav">
              <th
                scope="col"
                className="sticky left-0 z-20 bg-nav px-4 py-2 text-left min-w-[190px] border-r border-nav-line"
              >
                <span className="text-[10px] font-bold text-nav-muted uppercase tracking-widest">
                  Colaborador
                </span>
              </th>
              {dates.map((d) => (
                <th
                  key={d}
                  scope="col"
                  className={`px-0 py-1.5 text-center border-r border-nav-line min-w-[92px] ${
                    isWeekend(d) ? "bg-nav-raised" : ""
                  }`}
                >
                  <div
                    className={`text-xs font-bold font-mono ${
                      d === today ? "text-brand" : "text-nav-fg"
                    }`}
                  >
                    {dayNum(d)}
                  </div>
                  <div className="text-[10px] font-medium text-nav-muted">
                    {dayName(d)}
                  </div>
                </th>
              ))}
              <th
                scope="col"
                className="sticky right-0 z-20 bg-nav-raised px-3 py-2 text-center min-w-[104px] border-l border-nav-line"
              >
                <span className="text-[10px] font-bold text-nav-muted uppercase tracking-widest">
                  Total
                </span>
              </th>
            </tr>
            <tr className="bg-raised border-b border-line">
              <th className="sticky left-0 z-20 bg-raised px-4 py-1 border-r border-line" />
              {dates.map((d) => (
                <th
                  key={d}
                  className={`px-0 py-1 border-r border-line ${
                    isWeekend(d) ? "bg-weekend" : ""
                  }`}
                >
                  <div className="grid grid-cols-2 text-[9px] font-bold uppercase tracking-wide">
                    <span className="text-center border-r border-line text-ok">
                      Entr.
                    </span>
                    <span className="text-center text-danger">Sal.</span>
                  </div>
                </th>
              ))}
              <th className="sticky right-0 z-20 bg-raised border-l border-line" />
            </tr>
          </thead>

          <tbody ref={bodyRef} onKeyDown={onKeyDown}>
            {employees.map((emp, ri) => {
              const totals = totalsFor.get(emp.id) ?? {
                days: 0,
                hours: 0,
                overtime: 0,
              }
              const rowBg = ri % 2 === 1 ? "bg-raised" : "bg-surface"
              return (
                <tr key={emp.id} className="border-b border-line group/row">
                  <th
                    scope="row"
                    className={`sticky left-0 z-10 px-3 py-2 text-left border-r border-line ${rowBg}`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-6 h-6 rounded-full shrink-0 grid place-items-center text-white text-[9px] font-bold ${
                          emp.category === "profesional" ? "bg-violet" : "bg-ok"
                        }`}
                      >
                        {initials(emp.name)}
                      </span>
                      <span className="text-sm font-semibold text-fg whitespace-nowrap">
                        {emp.name}
                      </span>
                      {!readOnly && (
                        <span className="ml-auto flex opacity-0 group-hover/row:opacity-100 focus-within:opacity-100 transition-opacity">
                          <button
                            onClick={() => onFillRow(emp.id)}
                            title={`Llenar la quincena de ${emp.name}`}
                            aria-label={`Llenar la quincena de ${emp.name}`}
                            className="p-1 rounded text-muted hover:text-brand"
                          >
                            <Icon name="bolt" className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => onClearRow(emp.id)}
                            title={`Vaciar la quincena de ${emp.name}`}
                            aria-label={`Vaciar la quincena de ${emp.name}`}
                            className="p-1 rounded text-muted hover:text-danger"
                          >
                            <Icon name="trash" className="w-3.5 h-3.5" />
                          </button>
                        </span>
                      )}
                    </div>
                  </th>

                  {dates.map((d, ci) => {
                    const entry = getEntry(emp.id, d)
                    const worked = entry ? calcWorkedHours(entry) : null
                    const isOver =
                      !!worked && worked.total > rules.overtimeThreshold
                    // Un día libre según el horario del colaborador se atenúa
                    // igual que el fin de semana: así un martes libre por
                    // horario especial se distingue de un martes sin registrar.
                    const offDuty = !scheduleForDate(emp, d)
                    const bg = entry
                      ? CELL_BG[entry.dayType]
                      : offDuty
                        ? "bg-weekend"
                        : rowBg

                    return (
                      <td key={d} className={`p-0 border-r border-line ${bg}`}>
                        <button
                          data-cell={`${ri}-${ci}`}
                          disabled={readOnly}
                          onClick={(e) =>
                            onOpen(
                              emp.id,
                              d,
                              e.currentTarget.getBoundingClientRect(),
                            )
                          }
                          aria-label={`${emp.name}, ${dayNameLong(d)} ${dayNum(d)}${
                            entry
                              ? `: ${DAY_TYPE_META[entry.dayType].label}`
                              : ": sin registro"
                          }`}
                          className="w-full h-full px-0 py-1.5 block cursor-pointer disabled:cursor-default hover:ring-2 hover:ring-inset hover:ring-brand focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
                        >
                          {entry && usesSchedule(entry.dayType) ? (
                            <span className="grid grid-cols-2">
                              <span className="text-center text-[11px] font-mono font-semibold text-ok border-r border-line">
                                {entry.entryTime}
                              </span>
                              <span className="text-center text-[11px] font-mono font-semibold text-danger">
                                {entry.exitTime}
                              </span>
                            </span>
                          ) : entry ? (
                            <span
                              className={`block text-[10px] font-bold ${CELL_FG[entry.dayType]}`}
                            >
                              {DAY_TYPE_META[entry.dayType].label}
                            </span>
                          ) : (
                            <span className="grid grid-cols-2 text-[11px] text-subtle">
                              <span className="text-center border-r border-line">
                                —
                              </span>
                              <span className="text-center">—</span>
                            </span>
                          )}
                          <span className="block text-[9px] font-bold h-3 leading-3 mt-0.5">
                            {isOver && (
                              <span className="text-amber">+extra</span>
                            )}
                            {worked?.crossesMidnight && (
                              <span className="text-violet ml-1">↷</span>
                            )}
                          </span>
                        </button>
                      </td>
                    )
                  })}

                  <td className="sticky right-0 z-10 px-3 py-2 text-center border-l border-line bg-sunken">
                    <div className="text-xs font-mono font-bold text-fg">
                      {totals.hours > 0 ? (
                        fmtHours(totals.hours)
                      ) : (
                        <span className="text-subtle">—</span>
                      )}
                    </div>
                    <div className="text-[10px] text-muted">
                      {totals.days > 0 ? `${totals.days} d` : "—"}
                      {totals.overtime > 0 && (
                        <span className="text-amber font-bold">
                          {" "}
                          · {fmtHours(totals.overtime)} ex
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

/* ------------------------------------------------------------ Vista día */

function DayView({
  employees,
  dates,
  selectedDate,
  onSelectDate,
  getEntry,
  rules,
  readOnly,
  onOpen,
}: {
  employees: Employee[]
  dates: string[]
  selectedDate: string
  onSelectDate: (d: string) => void
  getEntry: (employeeId: string, date: string) => TimeEntry | null
  rules: PayrollRules
  readOnly: boolean
  onOpen: (employeeId: string, date: string) => void
}) {
  const today = todayISO()

  return (
    <div className="space-y-3">
      <div
        className="flex gap-1.5 overflow-x-auto pb-1"
        role="tablist"
        aria-label="Días de la quincena"
      >
        {dates.map((d) => {
          const active = d === selectedDate
          return (
            <button
              key={d}
              role="tab"
              aria-selected={active}
              onClick={() => onSelectDate(d)}
              className={`shrink-0 w-12 py-1.5 rounded-xl border text-center ${
                active
                  ? "bg-brand text-brand-fg border-brand"
                  : isWeekend(d)
                    ? "bg-weekend border-line text-muted"
                    : "bg-surface border-line text-muted hover:border-line-strong"
              }`}
            >
              <div
                className={`text-sm font-bold font-mono ${
                  !active && d === today ? "text-brand" : ""
                }`}
              >
                {dayNum(d)}
              </div>
              <div className="text-[10px]">{dayName(d)}</div>
            </button>
          )
        })}
      </div>

      <Card padded={false}>
        <div className="px-4 py-3 border-b border-line">
          <h3 className="text-sm font-bold text-fg">
            {dayNameLong(selectedDate)} {dayNum(selectedDate)}
          </h3>
          <p className="text-xs text-muted">
            {employees.length} colaboradores activos
          </p>
        </div>
        <ul>
          {employees.map((emp) => {
            const entry = getEntry(emp.id, selectedDate)
            const worked = entry ? calcWorkedHours(entry) : null
            const isOver = !!worked && worked.total > rules.overtimeThreshold
            return (
              <li key={emp.id} className="border-b border-line last:border-0">
                <button
                  disabled={readOnly}
                  onClick={() => onOpen(emp.id, selectedDate)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-raised disabled:hover:bg-transparent"
                >
                  <span
                    className={`w-9 h-9 rounded-full shrink-0 grid place-items-center text-white text-xs font-bold ${
                      emp.category === "profesional" ? "bg-violet" : "bg-ok"
                    }`}
                  >
                    {initials(emp.name)}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-fg truncate">
                      {emp.name}
                    </span>
                    <span className="block text-xs text-muted font-mono">
                      {entry && usesSchedule(entry.dayType)
                        ? `${entry.entryTime} → ${entry.exitTime}${
                            entry.lunchBreak
                              ? ` · ${entry.lunchDuration}m almuerzo`
                              : ""
                          }`
                        : entry
                          ? DAY_TYPE_META[entry.dayType].label
                          : "Sin registro"}
                    </span>
                  </span>
                  <span className="text-right shrink-0">
                    {worked && worked.total > 0 ? (
                      <>
                        <span className="block text-sm font-mono font-bold text-fg">
                          {fmtHours(worked.total)}
                        </span>
                        {isOver && (
                          <span className="block text-[10px] font-bold text-amber">
                            +extra
                          </span>
                        )}
                      </>
                    ) : entry ? (
                      <Badge tone={DAY_TYPE_TONE[entry.dayType]}>
                        {DAY_TYPE_META[entry.dayType].short}
                      </Badge>
                    ) : (
                      <span className="text-subtle text-lg leading-none">
                        +
                      </span>
                    )}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </Card>
    </div>
  )
}

/* ------------------------------------------------------------- Editor */

interface EntryEditorProps {
  employee: Employee
  date: string
  existing: TimeEntry | null
  previous: TimeEntry | null
  anchorRect: DOMRect | null
  rules: PayrollRules
  onSave: (entry: TimeEntry) => void
  onDelete: () => void
  onClose: () => void
}

function EntryEditor({
  employee,
  date,
  existing,
  previous,
  anchorRect,
  rules,
  onSave,
  onDelete,
  onClose,
}: EntryEditorProps) {
  const [form, setForm] = useState<TimeEntry>(
    existing ?? blankEntry(employee, date, previous),
  )
  const planned = scheduleForDate(employee, date)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener("keydown", onKey)
    document.addEventListener("mousedown", onDown)
    return () => {
      document.removeEventListener("keydown", onKey)
      document.removeEventListener("mousedown", onDown)
    }
  }, [onClose])

  const set = <K extends keyof TimeEntry>(k: K, v: TimeEntry[K]) =>
    setForm((f) => ({ ...f, [k]: v }))

  const schedule = usesSchedule(form.dayType)
  const worked = calcWorkedHours(form)
  const split = splitHours(worked.total, rules.overtimeThreshold)
  const canSave =
    !schedule || (!!form.entryTime && !!form.exitTime && !worked.invalid)

  const PANEL_W = 300
  const PANEL_H = 430
  const style: React.CSSProperties = anchorRect
    ? {
        position: "fixed",
        top: Math.max(
          8,
          Math.min(anchorRect.bottom + 6, window.innerHeight - PANEL_H - 8),
        ),
        left: Math.max(
          8,
          Math.min(anchorRect.left - 60, window.innerWidth - PANEL_W - 8),
        ),
        width: PANEL_W,
        zIndex: 60,
      }
    : {
        position: "fixed",
        left: "50%",
        bottom: 12,
        transform: "translateX(-50%)",
        width: `min(${PANEL_W}px, calc(100vw - 24px))`,
        zIndex: 60,
      }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/20" onClick={onClose} />
      <div
        ref={ref}
        style={style}
        role="dialog"
        aria-label={`Registro de ${employee.name}`}
        className="bg-surface border border-line rounded-2xl shadow-modal p-4 animate-in"
      >
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="min-w-0">
            <div className="text-sm font-bold text-fg truncate">
              {employee.name}
            </div>
            <div className="text-[11px] text-muted">
              {dayNameLong(date)} {dayNum(date)}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="text-subtle hover:text-fg"
          >
            <Icon name="x" />
          </button>
        </div>

        {/* Tipo de día */}
        <div className="flex flex-wrap gap-1 mb-3">
          {DAY_TYPES.map((t) => (
            <button
              key={t}
              onClick={() => set("dayType", t)}
              aria-pressed={form.dayType === t}
              className={`px-2 py-1 rounded-lg text-[11px] font-bold border ${
                form.dayType === t
                  ? "bg-fg text-app border-fg"
                  : "bg-surface text-muted border-line hover:border-line-strong"
              }`}
            >
              {DAY_TYPE_META[t].label}
            </button>
          ))}
        </div>

        {schedule ? (
          <>
            {/* Horario habitual: referencia visible y atajo para volver a él. */}
            <div className="flex items-center gap-2 mb-3 text-[11px]">
              <Icon name="clock" className="w-3.5 h-3.5 shrink-0 text-subtle" />
              {planned ? (
                <>
                  <span className="text-muted font-mono">
                    Habitual {planned.entryTime}–{planned.exitTime}
                  </span>
                  {(form.entryTime !== planned.entryTime ||
                    form.exitTime !== planned.exitTime) && (
                    <button
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          entryTime: planned.entryTime,
                          exitTime: planned.exitTime,
                          lunchBreak: planned.lunchBreak,
                          lunchDuration: planned.lunchDuration,
                        }))
                      }
                      className="ml-auto font-semibold text-brand hover:underline"
                    >
                      Restaurar
                    </button>
                  )}
                </>
              ) : (
                <span className="text-muted">
                  {dayNameLong(date)} es día libre según su horario
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 mb-3">
              <Field label="Entrada">
                <input
                  type="time"
                  value={form.entryTime}
                  onChange={(e) => set("entryTime", e.target.value)}
                  autoFocus
                  className={`${inputNumClass} py-1.5`}
                />
              </Field>
              <Field label="Salida">
                <input
                  type="time"
                  value={form.exitTime}
                  onChange={(e) => set("exitTime", e.target.value)}
                  className={`${inputNumClass} py-1.5`}
                />
              </Field>
            </div>

            <div className="border border-line rounded-xl p-2.5 mb-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-fg">Almuerzo</span>
                <div className="flex items-center gap-2">
                  {form.lunchBreak && (
                    <>
                      <input
                        type="number"
                        min={0}
                        max={180}
                        value={form.lunchDuration}
                        onChange={(e) =>
                          set("lunchDuration", parseInt(e.target.value) || 0)
                        }
                        className={`${inputClass} w-16 py-1 font-mono`}
                        aria-label="Minutos de almuerzo"
                      />
                      <span className="text-[11px] text-muted">min</span>
                    </>
                  )}
                  <Toggle
                    checked={form.lunchBreak}
                    onChange={(v) => set("lunchBreak", v)}
                    label="Descontar almuerzo"
                  />
                </div>
              </div>
            </div>

            <Field label="Recargo de horas extra" className="mb-3">
              <div className="flex gap-1.5">
                {[1.0, 1.25, 1.5, 2.0].map((r) => (
                  <button
                    key={r}
                    onClick={() => set("overtimeRate", r)}
                    aria-pressed={form.overtimeRate === r}
                    className={`flex-1 py-1.5 rounded-lg text-[11px] font-mono font-bold border ${
                      form.overtimeRate === r
                        ? "bg-fg text-app border-fg"
                        : "bg-surface text-muted border-line hover:border-line-strong"
                    }`}
                  >
                    ×{r}
                  </button>
                ))}
              </div>
            </Field>

            {/* Resultado y avisos */}
            {worked.invalid ? (
              <p className="rounded-xl p-2.5 mb-3 text-[11px] font-semibold bg-danger-soft text-danger">
                El almuerzo consume el turno completo: no quedan horas que
                pagar.
              </p>
            ) : worked.total > 0 ? (
              <div
                className={`rounded-xl p-2.5 mb-3 text-[11px] font-semibold ${
                  split.overtime > 0
                    ? "bg-amber-soft text-amber"
                    : "bg-ok-soft text-ok"
                }`}
              >
                {fmtHours(worked.total)} pagadas
                {split.overtime > 0 && (
                  <span className="font-normal">
                    {" "}
                    ({fmtHours(split.regular)} reg. + {fmtHours(split.overtime)}{" "}
                    extra ×{form.overtimeRate})
                  </span>
                )}
                {worked.crossesMidnight && (
                  <span className="block font-normal mt-1 text-violet">
                    ↷ Turno nocturno: la salida se cuenta al día siguiente.
                  </span>
                )}
              </div>
            ) : null}
          </>
        ) : (
          <p className="rounded-xl p-2.5 mb-3 text-[11px] bg-raised text-muted">
            {form.dayType === "vacaciones" &&
              "Se paga la jornada estándar si la configuración lo permite."}
            {form.dayType === "incapacidad" &&
              "Por omisión no lo paga el patrono; se ajusta en Configuración."}
            {form.dayType === "ausencia" &&
              "Día no laborado y no pagado. Queda registrado para control."}
          </p>
        )}

        <textarea
          value={form.notes}
          onChange={(e) => set("notes", e.target.value)}
          placeholder="Nota (opcional)"
          rows={2}
          className={`${inputClass} mb-3 resize-none text-xs`}
        />

        <div className="flex gap-2">
          {existing && (
            <Button
              variant="ghost"
              onClick={onDelete}
              size="sm"
              className="text-danger hover:bg-danger-soft"
            >
              Borrar
            </Button>
          )}
          {previous && !existing && (
            <Button
              size="sm"
              icon="copy"
              title="Copiar el horario del último día registrado"
              onClick={() =>
                setForm((f) => ({
                  ...f,
                  entryTime: previous.entryTime,
                  exitTime: previous.exitTime,
                  lunchBreak: previous.lunchBreak,
                  lunchDuration: previous.lunchDuration,
                  overtimeRate: previous.overtimeRate,
                }))
              }
            >
              Copiar anterior
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            className="flex-1"
            disabled={!canSave}
            onClick={() => onSave(form)}
          >
            Guardar
          </Button>
        </div>
      </div>
    </>
  )
}
