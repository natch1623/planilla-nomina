import type { ReactNode } from "react"
import type { Attachment } from "../../types"
import { MONTHS_ES } from "../../store"
import { addMonths } from "../../utils/accounting"
import { dayNameLong, formatDate } from "../../utils/dates"
import { AttachmentList } from "../Adjuntos"
import { Button, Card, IconButton, Toggle } from "../ui"
import type { Tone } from "../ui"

/** Piezas que comparten las tres secciones de Gastos. */

export function longMonth(month: string): string {
  const [y, m] = month.split("-").map(Number)
  return `${MONTHS_ES[m - 1]} ${y}`
}

/** `2026-10-15` → `15 oct` */
export function shortDate(date: string): string {
  return formatDate(date).replace(/ \d{4}$/, "")
}

/** "Lunes 26 oct", o "Hoy" / "Ayer" cuando aplica. */
export function dayHeading(date: string, today: string): string {
  if (date === today) return `Hoy · ${shortDate(date)}`
  const y = new Date(`${today}T12:00:00`)
  y.setDate(y.getDate() - 1)
  const yesterday = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, "0")}-${String(y.getDate()).padStart(2, "0")}`
  if (date === yesterday) return `Ayer · ${shortDate(date)}`
  return `${dayNameLong(date)} ${shortDate(date)}`
}

/**
 * Selector de mes con flechas, el atajo al mes actual y, a la derecha, las
 * acciones de la sección (imprimir, Excel). Áreas táctiles de 44 px en el
 * celular.
 */
export function MonthNav({
  month,
  thisMonth,
  onChange,
  actions,
}: {
  month: string
  thisMonth: string
  onChange: (m: string) => void
  actions?: ReactNode
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-0.5 bg-surface border border-line rounded-xl p-0.5">
        <IconButton
          icon="chevronLeft"
          label="Mes anterior"
          className="p-3.5 sm:p-2"
          onClick={() => onChange(addMonths(month, -1))}
        />
        <span className="px-2 text-sm font-bold text-fg min-w-[130px] text-center">
          {longMonth(month)}
        </span>
        <IconButton
          icon="chevronRight"
          label="Mes siguiente"
          className="p-3.5 sm:p-2"
          onClick={() => onChange(addMonths(month, 1))}
        />
      </div>
      {month !== thisMonth && (
        <Button
          size="sm"
          variant="ghost"
          className="min-h-11 sm:min-h-0"
          onClick={() => onChange(thisMonth)}
        >
          Ir al mes actual
        </Button>
      )}
      {actions && <div className="flex items-center gap-2 ml-auto">{actions}</div>}
    </div>
  )
}

export function SummaryCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string
  hint: string
  tone: Tone
}) {
  const color: Record<Tone, string> = {
    ok: "text-ok",
    danger: "text-danger",
    brand: "text-fg",
    amber: "text-amber",
    violet: "text-violet",
    teal: "text-teal",
    muted: "text-fg",
  }
  return (
    <Card className="p-3! sm:p-5!">
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p className={`num text-lg sm:text-2xl font-extrabold mt-1 truncate ${color[tone]}`}>{value}</p>
      <p className="hidden sm:block text-[11px] text-muted mt-0.5 truncate">{hint}</p>
    </Card>
  )
}

/**
 * Filtro por tipo o por empresa: cada botón dice cuánto suma. Tocarlo
 * filtra la lista; tocarlo otra vez quita el filtro.
 */
export function BreakdownFilter({
  items,
  selected,
  onSelect,
  money,
  label,
}: {
  items: { key: string; total: number; count: number }[]
  selected: string | null
  onSelect: (key: string | null) => void
  money: (n: number) => string
  label: string
}) {
  if (items.length < 2) return null
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 -mb-1" role="group" aria-label={label}>
      <FilterChip active={selected === null} onClick={() => onSelect(null)}>
        Todos
      </FilterChip>
      {items.map((b) => (
        <FilterChip
          key={b.key}
          active={selected !== null && selected.toLowerCase() === b.key.toLowerCase()}
          onClick={() =>
            onSelect(selected?.toLowerCase() === b.key.toLowerCase() ? null : b.key)
          }
        >
          {b.key} <span className="num font-normal opacity-80">{money(b.total)}</span>
        </FilterChip>
      ))}
    </div>
  )
}

/**
 * Un registro visto por Solo lectura: los datos como texto, sin campos que
 * parezcan editables. Las filas vacías no se muestran.
 */
export function ReadOnlySummary({
  rows,
  attachments,
}: {
  rows: [string, string][]
  attachments: Attachment[]
}) {
  return (
    <div className="space-y-4">
      <dl className="divide-y divide-line rounded-xl border border-line">
        {rows
          .filter(([, v]) => v)
          .map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between gap-4 px-3 py-2.5">
              <dt className="text-xs font-semibold text-muted">{label}</dt>
              <dd className="text-sm text-fg text-right">{value}</dd>
            </div>
          ))}
      </dl>
      {attachments.length > 0 && (
        <div>
          <span className="block text-xs font-semibold text-muted mb-1.5">Recibo o factura</span>
          <AttachmentList items={attachments} />
        </div>
      )}
    </div>
  )
}

/** Interruptor de "anotar también en Contabilidad" para una lista entera. */
export function AccountingSetting({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-fg">Anotar en Contabilidad</p>
          <p className="text-[11px] text-muted">
            Cada gasto nuevo se registra también en Movimientos, para que el flujo
            de caja y el estado de resultados lo incluyan. Los ya anotados no cambian.
          </p>
        </div>
        <Toggle checked={checked} onChange={onChange} label="Anotar en Contabilidad" />
      </div>
    </Card>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`shrink-0 inline-flex items-center gap-1.5 px-3 min-h-11 sm:min-h-8 rounded-xl border text-xs font-semibold whitespace-nowrap transition-colors ${
        active
          ? "bg-brand-soft border-brand text-brand"
          : "bg-surface border-line text-muted hover:text-fg"
      }`}
    >
      {children}
    </button>
  )
}
