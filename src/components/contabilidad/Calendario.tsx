import { useMemo, useState } from "react"
import { fmt } from "../../utils/calculations"
import {
  addMonths,
  currentMonthKey,
  monthEnd,
  monthLabel,
  monthStart,
} from "../../utils/accounting"
import { buildCalendar, type CalendarEvent } from "../../utils/finance"
import { dayName, dayNum, formatDate, todayISO } from "../../utils/dates"
import Icon from "../Icon"
import type { IconName } from "../Icon"
import { Badge, Card, EmptyState } from "../ui"
import type { Tone } from "../ui"
import type { ViewProps } from "../Contabilidad"
import { Kpi, TONE_FG, TONE_SOFT } from "./shared"

const KIND_META: Record<CalendarEvent["kind"], {
  label: string
  tone: Tone
  icon: IconName
  sign: 1 | -1
}> = {
  ingreso: { label: "Cobro", tone: "ok", icon: "trendUp", sign: 1 },
  gasto: { label: "Pago", tone: "danger", icon: "trendDown", sign: -1 },
  nomina: { label: "Nómina", tone: "amber", icon: "users", sign: -1 },
}

export default function Calendario({ data, rules }: ViewProps) {
  const [offset, setOffset] = useState(0)
  const today = todayISO()
  const key = addMonths(currentMonthKey(), offset)

  const events = useMemo(
    () => buildCalendar(data, rules, monthStart(key), monthEnd(key), today),
    [data, rules, key, today],
  )

  const totals = useMemo(() => {
    let entra = 0
    let sale = 0
    for (const e of events) {
      if (KIND_META[e.kind].sign > 0) entra += e.amount
      else sale += e.amount
    }
    return { entra, sale, neto: entra - sale }
  }, [events])

  // Agrupar por día hace que la lista se lea como una agenda, no como una tabla.
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    for (const e of events) {
      const list = map.get(e.date)
      if (list) list.push(e)
      else map.set(e.date, [e])
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [events])

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1 bg-sunken rounded-xl p-0.5">
          <button
            onClick={() => setOffset((o) => o - 1)}
            aria-label="Mes anterior"
            className="p-1.5 rounded-lg text-muted hover:text-fg hover:bg-surface"
          >
            <Icon name="chevronLeft" className="w-4 h-4" />
          </button>
          <span className="px-3 text-sm font-bold text-fg whitespace-nowrap">
            {monthLabel(key)}
          </span>
          <button
            onClick={() => setOffset((o) => o + 1)}
            aria-label="Mes siguiente"
            className="p-1.5 rounded-lg text-muted hover:text-fg hover:bg-surface"
          >
            <Icon name="chevronRight" className="w-4 h-4" />
          </button>
        </div>
        {offset !== 0 && (
          <button
            onClick={() => setOffset(0)}
            className="text-xs font-semibold text-brand hover:underline"
          >
            Volver al mes actual
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Kpi
          label="Entra en el mes"
          value={`$${fmt(totals.entra)}`}
          tone="ok"
          icon="trendUp"
        />
        <Kpi
          label="Sale en el mes"
          value={`$${fmt(totals.sale)}`}
          tone="danger"
          icon="trendDown"
        />
        <Kpi
          label="Diferencia"
          value={`${totals.neto < 0 ? "−" : ""}$${fmt(Math.abs(totals.neto))}`}
          tone={totals.neto >= 0 ? "ok" : "danger"}
          icon="scale"
          emphasis
        />
      </div>

      {byDay.length === 0 ? (
        <EmptyState
          icon="calendar"
          title={`Sin movimientos previstos en ${monthLabel(key)}`}
          message="Aquí aparecen los cobros y pagos pendientes, los movimientos recurrentes y el cierre de cada quincena de nómina."
        />
      ) : (
        <Card padded={false}>
          <div className="px-4 py-3 border-b border-line">
            <h3 className="text-sm font-bold text-fg">Agenda del mes</h3>
            <p className="text-xs text-muted mt-0.5">
              Cobros, pagos y nóminas ordenados por fecha
            </p>
          </div>
          <ul>
            {byDay.map(([date, list]) => {
              const isToday = date === today
              const dayNet = list.reduce(
                (a, e) => a + KIND_META[e.kind].sign * e.amount,
                0,
              )
              return (
                <li
                  key={date}
                  className={`flex gap-3 px-4 py-3 border-b border-line last:border-0 ${
                    isToday ? "bg-brand-soft/40" : ""
                  }`}
                >
                  <div className="w-12 shrink-0 text-center">
                    <div
                      className={`num text-lg font-extrabold leading-none ${
                        isToday ? "text-brand" : "text-fg"
                      }`}
                    >
                      {dayNum(date)}
                    </div>
                    <div className="text-[10px] text-muted uppercase mt-0.5">
                      {dayName(date)}
                    </div>
                  </div>

                  <ul className="flex-1 min-w-0 space-y-1.5">
                    {list.map((e) => {
                      const meta = KIND_META[e.kind]
                      return (
                        <li
                          key={e.id}
                          className="flex items-center gap-2 min-w-0"
                        >
                          <span
                            className={`w-6 h-6 rounded-lg grid place-items-center shrink-0 ${TONE_SOFT[meta.tone]}`}
                          >
                            <Icon name={meta.icon} className="w-3.5 h-3.5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm text-fg truncate">
                              {e.label}
                            </span>
                            <span className="flex items-center gap-1.5 text-[11px] text-subtle">
                              {meta.label}
                              {e.projected && (
                                <span className="text-brand">· previsto</span>
                              )}
                              {e.overdue && (
                                <Badge tone="danger">Vencido</Badge>
                              )}
                            </span>
                          </span>
                          <span
                            className={`num font-bold shrink-0 ${TONE_FG[meta.tone]}`}
                          >
                            {meta.sign > 0 ? "+" : "−"}${fmt(e.amount)}
                          </span>
                        </li>
                      )
                    })}
                  </ul>

                  <div className="w-24 shrink-0 text-right self-center">
                    <span
                      className={`num text-sm font-bold ${
                        dayNet >= 0 ? "text-ok" : "text-danger"
                      }`}
                    >
                      {dayNet >= 0 ? "+" : "−"}${fmt(Math.abs(dayNet))}
                    </span>
                    <span className="block text-[10px] text-subtle">
                      del día
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
          <p className="px-4 py-3 text-[11px] text-subtle border-t border-line">
            Hoy es {formatDate(today)}. Los movimientos marcados como previstos
            provienen de una recurrencia o de una quincena que aún no cierra.
          </p>
        </Card>
      )}
    </div>
  )
}
