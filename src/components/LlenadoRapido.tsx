import { useMemo, useState } from "react"
import type { DayType, Employee, TimeEntry } from "../types"
import {
  DAY_TYPE_META,
  DAY_TYPES,
  fmtHours,
  initials,
  usesSchedule,
} from "../utils/calculations"
import { dayNum, isWeekend } from "../utils/dates"
import {
  describeSchedule,
  scheduleForDate,
  weeklyHours,
} from "../utils/schedule"
import Icon from "./Icon"
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

/** De dónde salen las horas: del horario de cada quien, o de uno fijo para todos. */
export type FillSource = "horario" | "personalizado"

export interface FillOptions {
  employeeIds: string[]
  source: FillSource
  scope: DayScope
  dayType: DayType
  entryTime: string
  exitTime: string
  lunchBreak: boolean
  lunchDuration: number
  overtimeRate: number
  overwrite: boolean
}

export interface FillTarget {
  employeeId: string
  date: string
  entryTime: string
  exitTime: string
  lunchBreak: boolean
  lunchDuration: number
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
 * Qué celdas tocaría el llenado y con qué horas.
 *
 * La vista previa y la escritura usan esta misma función: si el conteo del botón
 * se calculara aparte, acabaría mintiendo en cuanto una regla cambiara.
 */
export function resolveFillTargets(
  employees: Employee[],
  dates: string[],
  opts: FillOptions,
): FillTarget[] {
  // Con un tipo de día sin horario (vacaciones, ausencia…) las horas no aplican,
  // así que el modo "horario de cada quien" pierde sentido y se ignora.
  const useOwnSchedule = opts.source === "horario" && usesSchedule(opts.dayType)
  const selected = employees.filter((e) => opts.employeeIds.includes(e.id))
  const targets: FillTarget[] = []

  for (const employee of selected) {
    for (const date of dates) {
      if (useOwnSchedule) {
        const planned = scheduleForDate(employee, date)
        if (!planned) continue
        targets.push({
          employeeId: employee.id,
          date,
          entryTime: planned.entryTime,
          exitTime: planned.exitTime,
          lunchBreak: planned.lunchBreak,
          lunchDuration: planned.lunchDuration,
        })
      } else {
        if (!matchesScope(date, opts.scope)) continue
        targets.push({
          employeeId: employee.id,
          date,
          entryTime: opts.entryTime,
          exitTime: opts.exitTime,
          lunchBreak: opts.lunchBreak,
          lunchDuration: opts.lunchDuration,
        })
      }
    }
  }

  return targets
}

/**
 * Genera los registros de un llenado masivo.
 *
 * Devuelve la lista completa de registros ya fusionada, para que quien la llame
 * solo tenga que sustituir el estado.
 */
export function applyFill(
  entries: TimeEntry[],
  targets: FillTarget[],
  opts: FillOptions,
): FillResult {
  const byKey = new Map(entries.map((e) => [`${e.employeeId}|${e.date}`, e]))
  const hasHours = usesSchedule(opts.dayType)

  let created = 0
  let updated = 0
  let skipped = 0

  for (const target of targets) {
    const key = `${target.employeeId}|${target.date}`
    const existing = byKey.get(key)
    if (existing && !opts.overwrite) {
      skipped += 1
      continue
    }
    byKey.set(key, {
      id: existing?.id ?? crypto.randomUUID(),
      employeeId: target.employeeId,
      date: target.date,
      dayType: opts.dayType,
      entryTime: hasHours ? target.entryTime : "",
      exitTime: hasHours ? target.exitTime : "",
      lunchBreak: hasHours ? target.lunchBreak : false,
      lunchDuration: target.lunchDuration,
      overtimeRate: opts.overtimeRate,
      notes: existing?.notes ?? "",
    })
    if (existing) updated += 1
    else created += 1
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
  const [source, setSource] = useState<FillSource>("horario")
  const [scope, setScope] = useState<DayScope>("laborables")
  const [dayType, setDayType] = useState<DayType>("trabajo")
  const [entryTime, setEntryTime] = useState("08:00")
  const [exitTime, setExitTime] = useState("17:00")
  const [lunchBreak, setLunchBreak] = useState(true)
  const [lunchDuration, setLunchDuration] = useState(60)
  const [overtimeRate, setOvertimeRate] = useState(1.5)
  const [overwrite, setOverwrite] = useState(false)

  const hasHours = usesSchedule(dayType)
  const useOwnSchedule = source === "horario" && hasHours

  const options: FillOptions = {
    employeeIds: selected,
    source,
    scope,
    dayType,
    entryTime,
    exitTime,
    lunchBreak,
    lunchDuration,
    overtimeRate,
    overwrite,
  }

  const preview = useMemo(() => {
    const targets = resolveFillTargets(employees, dates, options)
    const taken = new Set(entries.map((e) => `${e.employeeId}|${e.date}`))
    let willWrite = 0
    let willSkip = 0
    for (const t of targets) {
      if (taken.has(`${t.employeeId}|${t.date}`) && !overwrite) willSkip += 1
      else willWrite += 1
    }
    return { willWrite, willSkip, total: targets.length }
  }, [employees, dates, entries, JSON.stringify(options)])

  const invalidTimes = hasHours && !useOwnSchedule && (!entryTime || !exitTime)
  const canApply = selected.length > 0 && preview.willWrite > 0 && !invalidTimes

  function toggle(id: string) {
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
    )
  }

  const selectedEmployees = employees.filter((e) => selected.includes(e.id))

  return (
    <Modal
      title="Llenado rápido"
      subtitle="Registra varios días y colaboradores de una sola vez"
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
            onClick={() => onApply(options)}
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
                  title={describeSchedule(e.schedule)}
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

        {/* Origen de las horas */}
        {hasHours && (
          <Field label="Horario a aplicar">
            <Segmented
              value={source}
              onChange={setSource}
              size="sm"
              options={[
                {
                  value: "horario" as FillSource,
                  label: "El de cada colaborador",
                },
                {
                  value: "personalizado" as FillSource,
                  label: "Uno fijo para todos",
                },
              ]}
            />
          </Field>
        )}

        {useOwnSchedule ? (
          <div className="rounded-2xl border border-line divide-y divide-line overflow-hidden">
            <p className="flex items-center gap-2 px-3 py-2 bg-brand-soft text-[11px] text-brand">
              <Icon name="clock" className="w-3.5 h-3.5 shrink-0" />
              Solo se llenan los días laborables de cada quien, con sus propias
              horas.
            </p>
            <div className="max-h-40 overflow-y-auto">
              {selectedEmployees.length === 0 ? (
                <p className="px-3 py-3 text-xs text-subtle text-center">
                  Selecciona al menos un colaborador
                </p>
              ) : (
                selectedEmployees.map((e) => (
                  <div
                    key={e.id}
                    className="flex items-center gap-2 px-3 py-2 text-[11px]"
                  >
                    <span className="font-semibold text-fg truncate">
                      {e.name.split(" ")[0]}
                    </span>
                    <span className="text-muted font-mono truncate">
                      {describeSchedule(e.schedule)}
                    </span>
                    <span className="ml-auto shrink-0 font-mono font-bold text-muted">
                      {fmtHours(weeklyHours(e.schedule))}/sem
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          <>
            <Field label="Días de la quincena">
              <Segmented
                value={scope}
                onChange={setScope}
                size="sm"
                options={[
                  { value: "laborables" as DayScope, label: "Lun–Vie" },
                  { value: "todos" as DayScope, label: "Todos" },
                  { value: "finde" as DayScope, label: "Sáb–Dom" },
                ]}
              />
              <p className="text-[11px] text-subtle mt-1.5">
                {dates.filter((d) => matchesScope(d, scope)).length} días
                {dates.length > 0 &&
                  ` · del ${dayNum(dates[0])} al ${dayNum(dates[dates.length - 1])}`}
              </p>
            </Field>

            {hasHours && (
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
                  <span className="text-sm font-semibold text-fg">
                    Almuerzo
                  </span>
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
                          aria-label="Minutos de almuerzo"
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
              </div>
            )}
          </>
        )}

        {hasHours && (
          <Field label="Recargo de horas extra">
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
          <Badge tone="amber">
            {preview.total === 0
              ? "Ningún día coincide con esta combinación"
              : "Todos los días elegidos ya tienen registro"}
          </Badge>
        )}
      </div>
    </Modal>
  )
}
