import type { ReactNode } from "react"
import { fmt, pct } from "../../utils/calculations"
import type { AlertLevel, HealthLevel } from "../../utils/finance"
import Icon from "../Icon"
import type { IconName } from "../Icon"
import { Card } from "../ui"
import type { Tone } from "../ui"

/* Tailwind necesita ver las clases completas en el código fuente, así que los
   tonos se resuelven con mapas literales y no interpolando el nombre. */

export const LEVEL_TONE: Record<HealthLevel, Tone> = {
  bueno: "ok",
  atencion: "amber",
  riesgo: "danger",
  sindatos: "muted",
}

export const ALERT_TONE: Record<AlertLevel, Tone> = {
  critico: "danger",
  aviso: "amber",
  info: "brand",
  bueno: "ok",
}

export const ALERT_ICON: Record<AlertLevel, IconName> = {
  critico: "alert",
  aviso: "alert",
  info: "bolt",
  bueno: "checkCircle",
}

export const TONE_FG: Record<Tone, string> = {
  brand: "text-brand",
  ok: "text-ok",
  danger: "text-danger",
  amber: "text-amber",
  violet: "text-violet",
  teal: "text-teal",
  muted: "text-fg",
}

export const TONE_BG: Record<Tone, string> = {
  brand: "bg-brand",
  ok: "bg-ok",
  danger: "bg-danger",
  amber: "bg-amber",
  violet: "bg-violet",
  teal: "bg-teal",
  muted: "bg-subtle",
}

export const TONE_SOFT: Record<Tone, string> = {
  brand: "bg-brand-soft text-brand",
  ok: "bg-ok-soft text-ok",
  danger: "bg-danger-soft text-danger",
  amber: "bg-amber-soft text-amber",
  violet: "bg-violet-soft text-violet",
  teal: "bg-teal-soft text-teal",
  muted: "bg-sunken text-muted",
}

export const TONE_RING: Record<Tone, string> = {
  brand: "ring-2 ring-brand/25",
  ok: "ring-2 ring-ok/25",
  danger: "ring-2 ring-danger/25",
  amber: "ring-2 ring-amber/25",
  violet: "ring-2 ring-violet/25",
  teal: "ring-2 ring-teal/25",
  muted: "",
}

/** Importe con signo y color: la lectura financiera más repetida de la app. */
export function Money({
  value,
  tone,
  signed = false,
  className = "",
}: {
  value: number
  tone?: Tone
  signed?: boolean
  className?: string
}) {
  const resolved: Tone = tone ?? (value < 0 ? "danger" : "ok")
  const sign = value < 0 ? "−" : signed ? "+" : ""
  return (
    <span className={`num font-bold ${TONE_FG[resolved]} ${className}`}>
      {sign}${fmt(Math.abs(value))}
    </span>
  )
}

export function Kpi({
  label,
  value,
  sub,
  tone = "muted",
  emphasis,
  icon,
  delta,
  deltaGoodDirection = "up",
}: {
  label: string
  value: string
  sub?: ReactNode
  tone?: Tone
  emphasis?: boolean
  icon?: IconName
  delta?: number | null
  deltaGoodDirection?: "up" | "down"
}) {
  const deltaGood =
    delta == null ? null : deltaGoodDirection === "up" ? delta >= 0 : delta <= 0

  return (
    <Card className={emphasis ? TONE_RING[tone] : ""}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] text-muted uppercase tracking-wider font-semibold">
          {label}
        </p>
        {icon && (
          <span className={TONE_FG[tone]}>
            <Icon name={icon} className="w-4 h-4" />
          </span>
        )}
      </div>
      <p
        className={`num mt-1.5 font-extrabold ${
          emphasis ? "text-2xl sm:text-3xl" : "text-xl sm:text-2xl"
        } ${TONE_FG[tone]}`}
      >
        {value}
      </p>
      {delta != null ? (
        <p
          className={`flex items-center gap-1 text-[11px] mt-1 font-semibold ${
            deltaGood ? "text-ok" : "text-danger"
          }`}
        >
          <Icon
            name={delta >= 0 ? "trendUp" : "trendDown"}
            className="w-3 h-3"
          />
          {delta >= 0 ? "+" : ""}
          {delta.toFixed(1)}%
          <span className="text-subtle font-normal">vs. anterior</span>
        </p>
      ) : (
        sub && <div className="text-[11px] text-subtle mt-1">{sub}</div>
      )}
    </Card>
  )
}

/** Barra apilada de un solo segmento; devuelve null si no aporta ancho. */
export function BarSegment({
  value,
  total,
  className,
}: {
  value: number
  total: number
  className: string
}) {
  const width = pct(value, total)
  if (width <= 0) return null
  return <div className={className} style={{ width: `${width}%` }} />
}

export function LegendItem({
  dot,
  label,
  value,
  total,
}: {
  dot: string
  label: string
  value: number
  total: number
}) {
  return (
    <span className="flex items-center gap-2">
      <span className={`w-2.5 h-2.5 rounded-sm shrink-0 ${dot}`} />
      <span className="text-muted">{label}</span>
      <span className="num font-bold text-fg">${fmt(value)}</span>
      <span className="text-subtle">{pct(value, total).toFixed(0)}%</span>
    </span>
  )
}

/** Barra de progreso con tope: el excedente se muestra pero no desborda. */
export function ProgressBar({
  value,
  max,
  tone,
}: {
  value: number
  max: number
  tone: Tone
}) {
  const filled = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="h-2 rounded-full bg-sunken overflow-hidden">
      <div
        className={`h-full ${TONE_BG[tone]}`}
        style={{ width: `${filled}%` }}
      />
    </div>
  )
}

export function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-surface border border-line rounded-xl px-3 py-2 shadow-modal text-xs">
      {label && <p className="font-bold text-fg mb-1">{label}</p>}
      {payload.map((p: any) => (
        <p key={p.name ?? p.dataKey} className="num text-muted">
          <span className="text-fg font-semibold">
            {p.name ?? p.payload?.name}
          </span>
          : ${fmt(p.value)}
        </p>
      ))}
    </div>
  )
}

/** Eje monetario compacto: `$12.5k` en vez de `12500`. */
export function compactMoney(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(1)}k`
  return `$${n.toFixed(0)}`
}

export const AXIS_TICK = { fontSize: 11, fill: "var(--muted)" } as const
