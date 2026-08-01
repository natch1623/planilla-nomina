import { useMemo, useState } from "react"
import type { DayType, Employee, TimeEntry } from "../types"
import {
  DAY_TYPE_META,
  DAY_TYPES,
  initials,
  usesSchedule,
} from "../utils/calculations"
import { dayNum, isWeekend } from "../utils/dates"
import {
  Badge,
  Button,
  Field,
  Modal,
  Segmented,
  Toggle,
  inputClass,
  inputNumClass,
} from "./ui"

export type DayScope = "todos" | "laborables" | "finde"

export interface FillOptions {
  employeeIds: string[]
  scope: DayScope
  dayType: DayType
  entryTime: string
  exitTime: string
  lunchBreak: boolean
  lunchDuration: number
  overtimeRate: number
  overwrite: boolean
}

export interface FillResult {
  entries: TimeEntry[]
  created: number
  updated: number
  skipped: number
}

function matchesScope(date: string, scope: DayScope): boolean {
  if (scope === "todos") return true
  return scope === "finde" ? isWeekend(date) : !isWeekend(date)
}

/**
 * Genera los registros de un llenado masivo.
 *
 * Devuelve la lista completa de registros ya fusionada, para que quien la llame
 * solo tenga que sustituir el estado.
 */
export function applyFill(
  entries: TimeEntry[],
  dates: string[],
  opts: FillOptions,
): FillResult {
  const targetDates = dates.filter((d) => matchesScope(d, opts.scope))
  const byKey = new Map(entries.map((e) => [`${e.employeeId}|${e.date}`, e]))

  let created = 0
  let updated = 0
  let skipped = 0

  for (const employeeId of opts.employeeIds) {
    for (const date of targetDates) {
      const k = `${employeeId}|${date}`
      const existing = byKey.get(k)
      if (existing && !opts.overwrite) {
        skipped += 1
        continue
      }
      const schedule = usesSchedule(opts.dayType)
      byKey.set(k, {
        id: existing?.id ?? crypto.randomUUID(),
        employeeId,
        date,
        dayType: opts.dayType,
        entryTime: schedule ? opts.entryTime : "",
        exitTime: schedule ? opts.exitTime : "",
        lunchBreak: schedule ? opts.lunchBreak : false,
        lunchDuration: opts.lunchDuration,
        overtimeRate: opts.overtimeRate,
        notes: existing?.notes ?? "",
      })
      if (existing) updated += 1
      else created += 1
    }
  }

  return { entries: [...byKey.values()], created, updated, skipped }
}

interface Props {
  employees: Employee[]
  dates: string[]
  entries: TimeEntry[]
  preselected?: string[]
  onApply: (opts: FillOptions) => void
  onClose: () => void
}

export default function LlenadoRapido({
  employees,
  dates,
  entries,
  preselected,
  onApply,
  onClose,
}: Props) {
  const [selected, setSelected] = useState<string[]>(
    preselected ?? employees.map((e) => e.id),
  )
  const [scope, setScope] = useState<DayScope>("laborables")
  const [dayType, setDayType] = useState<DayType>("trabajo")
  const [entryTime, setEntryTime] = useState("08:00")
  const [exitTime, setExitTime] = useState("17:00")
  const [lunchBreak, setLunchBreak] = useState(true)
  const [lunchDuration, setLunchDuration] = useState(60)
  const [overtimeRate, setOvertimeRate] = useState(1.5)
  const [overwrite, setOverwrite] = useState(false)

  const schedule = usesSchedule(dayType)

  const preview = useMemo(() => {
    const targetDates = dates.filter((d) => matchesScope(d, scope))
    const taken = new Set(entries.map((e) => `${e.employeeId}|${e.date}`))
    let willWrite = 0
    let willSkip = 0
    for (const id of selected) {
      for (const d of targetDates) {
        if (taken.has(`${id}|${d}`) && !overwrite) willSkip += 1
        else willWrite += 1
      }
    }
    return { willWrite, willSkip, days: targetDates.length }
  }, [dates, scope, selected, entries, overwrite])

  const invalidTimes = schedule && (!entryTime || !exitTime)
  const canApply = selected.length > 0 && preview.willWrite > 0 && !invalidTimes

  function toggle(id: string) {
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
    )
  }

  return (
    <Modal
      title="Llenado rápido"
      subtitle="Aplica el mismo día a varios colaboradores de una vez"
      onClose={onClose}
      width="max-w-lg"
      footer={
        <>
          <Button onClick={onClose} className="flex-1">
            Cancelar
          </Button>
          <Button
            variant="primary"
            disabled={!canApply}
            className="flex-1"
            onClick={() =>
              onApply({
                employeeIds: selected,
                scope,
                dayType,
                entryTime,
                exitTime,
                lunchBreak,
                lunchDuration,
                overtimeRate,
                overwrite,
              })
            }
          >
            Aplicar a {preview.willWrite}{" "}
            {preview.willWrite === 1 ? "celda" : "celdas"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {/* Colaboradores */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-muted">
              Colaboradores ({selected.length}/{employees.length})
            </span>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelected(employees.map((e) => e.id))}
              >
                Todos
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
                Ninguno
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
            {employees.map((e) => {
              const on = selected.includes(e.id)
              return (
                <button
                  key={e.id}
                  onClick={() => toggle(e.id)}
                  aria-pressed={on}
                  className={`flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full border text-xs font-semibold ${
                    on
                      ? "bg-brand-soft border-brand text-brand"
                      : "bg-surface border-line text-muted hover:border-line-strong"
                  }`}
                >
                  <span
                    className={`w-5 h-5 rounded-full grid place-items-center text-[9px] font-bold ${
                      e.category === "profesional"
                        ? "bg-violet text-white"
                        : "bg-ok text-white"
                    }`}
                  >
                    {initials(e.name)}
                  </span>
                  {e.name.split(" ")[0]}
                </button>
              )
            })}
          </div>
        </div>

        {/* Días */}
        <Field label="Días de la quincena">
          <Segmented
            value={scope}
            onChange={setScope}
            size="sm"
            options={[
              { value: "laborables", label: "Lun–Vie" },
              { value: "todos", label: "Todos" },
              { value: "finde", label: "Sáb–Dom" },
            ]}
          />
          <p className="text-[11px] text-subtle mt-1.5">
            {preview.days} días seleccionados
            {dates.length > 0 &&
              ` · del ${dayNum(dates[0])} al ${dayNum(dates[dates.length - 1])}`}
          </p>
        </Field>

        {/* Tipo de día */}
        <Field label="Tipo de día">
          <div className="flex flex-wrap gap-1.5">
            {DAY_TYPES.map((t) => (
              <button
                key={t}
                onClick={() => setDayType(t)}
                aria-pressed={dayType === t}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${
                  dayType === t
                    ? "bg-fg text-app border-fg"
                    : "bg-surface text-muted border-line hover:border-line-strong"
                }`}
              >
                {DAY_TYPE_META[t].label}
              </button>
            ))}
          </div>
        </Field>

        {schedule && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Entrada">
              <input
                type="time"
                value={entryTime}
                onChange={(e) => setEntryTime(e.target.value)}
                className={inputNumClass}
              />
            </Field>
            <Field label="Salida">
              <input
                type="time"
                value={exitTime}
                onChange={(e) => setExitTime(e.target.value)}
                className={inputNumClass}
              />
            </Field>
            <div className="col-span-2 flex items-center justify-between border border-line rounded-xl px-3 py-2.5">
              <span className="text-sm font-semibold text-fg">Almuerzo</span>
              <div className="flex items-center gap-2">
                {lunchBreak && (
                  <>
                    <input
                      type="number"
                      min={0}
                      max={180}
                      value={lunchDuration}
                      onChange={(e) =>
                        setLunchDuration(parseInt(e.target.value) || 0)
                      }
                      className={`${inputClass} w-16 py-1 font-mono`}
                    />
                    <span className="text-xs text-muted">min</span>
                  </>
                )}
                <Toggle
                  checked={lunchBreak}
                  onChange={setLunchBreak}
                  label="Descontar almuerzo"
                />
              </div>
            </div>
            <Field label="Recargo de horas extra" className="col-span-2">
              <div className="flex gap-1.5">
                {[1.0, 1.25, 1.5, 2.0].map((r) => (
                  <button
                    key={r}
                    onClick={() => setOvertimeRate(r)}
                    aria-pressed={overtimeRate === r}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-mono font-bold border ${
                      overtimeRate === r
                        ? "bg-fg text-app border-fg"
                        : "bg-surface text-muted border-line hover:border-line-strong"
                    }`}
                  >
                    ×{r}
                  </button>
                ))}
              </div>
            </Field>
          </div>
        )}

        <div className="flex items-center justify-between border border-line rounded-xl px-3 py-2.5">
          <div>
            <div className="text-sm font-semibold text-fg">
              Sobrescribir registros existentes
            </div>
            <div className="text-[11px] text-muted">
              {overwrite
                ? "Se reemplazarán los días que ya tengan datos"
                : `Se respetarán ${preview.willSkip} día(s) ya registrados`}
            </div>
          </div>
          <Toggle
            checked={overwrite}
            onChange={setOverwrite}
            label="Sobrescribir"
          />
        </div>

        {preview.willWrite === 0 && (
          <Badge tone="amber">Nada que aplicar con la combinación actual</Badge>
        )}
      </div>
    </Modal>
  )
}
