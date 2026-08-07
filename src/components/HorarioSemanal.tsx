import type { DaySchedule, WeeklySchedule } from "../types"
import { fmtHours } from "../utils/calculations"
import {
  SCHEDULE_PRESETS,
  WEEKDAY_LONG,
  WEEKDAY_SHORT,
  WEEK_ORDER,
  dayScheduleHours,
  weeklyHours,
  workingDaysCount,
} from "../utils/schedule"
import Icon from "./Icon"
import { Toggle, inputClass } from "./ui"

interface Props {
  schedule: WeeklySchedule
  onChange: (schedule: WeeklySchedule) => void
}

export default function HorarioSemanal({ schedule, onChange }: Props) {
  const total = weeklyHours(schedule)
  const workdays = workingDaysCount(schedule)

  function updateDay(weekday: number, patch: Partial<DaySchedule>) {
    onChange(
      schedule.map((day, i) => (i === weekday ? { ...day, ...patch } : day)),
    )
  }

  /** Propaga el horario de un día a todos los demás días marcados como laborables. */
  function copyToWorkdays(weekday: number) {
    const source = schedule[weekday]
    onChange(
      schedule.map((day) =>
        day.works
          ? {
              ...day,
              entryTime: source.entryTime,
              exitTime: source.exitTime,
              lunchBreak: source.lunchBreak,
              lunchDuration: source.lunchDuration,
            }
          : day,
      ),
    )
  }

  return (
    <div className="space-y-4">
      {/* Plantillas */}
      <div>
        <p className="text-xs font-semibold text-muted mb-2">
          Plantillas rápidas
        </p>
        <div className="grid sm:grid-cols-2 gap-2">
          {SCHEDULE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => onChange(preset.build())}
              className="text-left px-3 py-2 rounded-xl border border-line bg-surface hover:border-brand hover:bg-brand-soft transition-colors"
            >
              <span className="block text-xs font-bold text-fg">
                {preset.label}
              </span>
              <span className="block text-[11px] text-muted">
                {preset.description}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Días */}
      <div className="border border-line rounded-2xl divide-y divide-line overflow-hidden">
        {WEEK_ORDER.map((weekday) => {
          const day = schedule[weekday]
          const hours = dayScheduleHours(day)
          const crossesMidnight = day.works && day.exitTime <= day.entryTime

          return (
            <div
              key={weekday}
              className={`p-3 ${day.works ? "" : "bg-raised"}`}
            >
              <div className="flex items-center gap-3">
                <Toggle
                  checked={day.works}
                  onChange={(works) => updateDay(weekday, { works })}
                  label={`${WEEKDAY_LONG[weekday]}: ${
                    day.works ? "laborable" : "libre"
                  }`}
                />
                <span
                  className={`text-sm font-bold w-10 ${
                    day.works ? "text-fg" : "text-subtle"
                  }`}
                >
                  {WEEKDAY_SHORT[weekday]}
                </span>

                {day.works ? (
                  <div className="flex-1 flex items-center gap-2 flex-wrap justify-end">
                    <input
                      type="time"
                      value={day.entryTime}
                      onChange={(e) =>
                        updateDay(weekday, { entryTime: e.target.value })
                      }
                      aria-label={`Entrada ${WEEKDAY_LONG[weekday]}`}
                      className={`${inputClass} w-[104px] py-1.5 font-mono`}
                    />
                    <span className="text-subtle text-xs">→</span>
                    <input
                      type="time"
                      value={day.exitTime}
                      onChange={(e) =>
                        updateDay(weekday, { exitTime: e.target.value })
                      }
                      aria-label={`Salida ${WEEKDAY_LONG[weekday]}`}
                      className={`${inputClass} w-[104px] py-1.5 font-mono`}
                    />
                    <button
                      type="button"
                      onClick={() => copyToWorkdays(weekday)}
                      title="Copiar este horario a los demás días laborables"
                      aria-label={`Copiar el horario del ${WEEKDAY_LONG[weekday]} a los demás días laborables`}
                      className="p-1.5 rounded-lg text-muted hover:text-brand hover:bg-brand-soft"
                    >
                      <Icon name="copy" className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <span className="flex-1 text-right text-xs text-subtle">
                    Día libre
                  </span>
                )}
              </div>

              {day.works && (
                <div className="flex items-center gap-3 flex-wrap mt-2 pl-[52px]">
                  <label className="flex items-center gap-2 text-[11px] text-muted">
                    <input
                      type="checkbox"
                      checked={day.lunchBreak}
                      onChange={(e) =>
                        updateDay(weekday, { lunchBreak: e.target.checked })
                      }
                      className="accent-[var(--brand)]"
                    />
                    Almuerzo
                  </label>
                  {day.lunchBreak && (
                    <span className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min={0}
                        max={180}
                        value={day.lunchDuration}
                        onChange={(e) =>
                          updateDay(weekday, {
                            lunchDuration: parseInt(e.target.value) || 0,
                          })
                        }
                        aria-label={`Minutos de almuerzo ${WEEKDAY_LONG[weekday]}`}
                        className={`${inputClass} w-16 py-1 font-mono text-xs`}
                      />
                      <span className="text-[11px] text-muted">min</span>
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-2">
                    {crossesMidnight && (
                      <span
                        className="text-[11px] font-semibold text-violet"
                        title="Turno nocturno"
                      >
                        ↷ nocturno
                      </span>
                    )}
                    <span
                      className={`text-xs font-mono font-bold ${
                        hours > 0 ? "text-fg" : "text-danger"
                      }`}
                    >
                      {hours > 0 ? fmtHours(hours) : "sin horas"}
                    </span>
                  </span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Resumen */}
      <div className="flex items-center justify-between px-4 py-3 rounded-2xl bg-brand-soft">
        <span className="text-xs font-semibold text-brand">
          {workdays} {workdays === 1 ? "día laborable" : "días laborables"} por
          semana
        </span>
        <span className="text-sm font-mono font-bold text-brand">
          {fmtHours(total)} / semana
        </span>
      </div>
    </div>
  )
}
