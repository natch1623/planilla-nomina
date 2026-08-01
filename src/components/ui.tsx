import { useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"
import Icon from "./Icon"
import type { IconName } from "./Icon"

export type Tone = "brand" | "ok" | "danger" | "amber" | "violet" | "teal" | "muted"

/*
  Las clases se escriben completas y no se componen con plantillas: Tailwind
  analiza el código fuente como texto y una clase construida en tiempo de
  ejecución (`bg-${tone}-soft`) nunca llega a generarse.
*/
const TONE_SOFT: Record<Tone, string> = {
  brand: "bg-brand-soft text-brand",
  ok: "bg-ok-soft text-ok",
  danger: "bg-danger-soft text-danger",
  amber: "bg-amber-soft text-amber",
  violet: "bg-violet-soft text-violet",
  teal: "bg-teal-soft text-teal",
  muted: "bg-sunken text-muted",
}

export const TONE_TEXT: Record<Tone, string> = {
  brand: "text-brand",
  ok: "text-ok",
  danger: "text-danger",
  amber: "text-amber",
  violet: "text-violet",
  teal: "text-teal",
  muted: "text-muted",
}

export const TONE_DOT: Record<Tone, string> = {
  brand: "bg-brand",
  ok: "bg-ok",
  danger: "bg-danger",
  amber: "bg-amber",
  violet: "bg-violet",
  teal: "bg-teal",
  muted: "bg-subtle",
}

/* --------------------------------------------------------------- Card */

export function Card({
  children,
  className = "",
  padded = true,
}: {
  children: ReactNode
  className?: string
  padded?: boolean
}) {
  return (
    <div
      className={`bg-surface border border-line rounded-2xl shadow-card ${
        padded ? "p-4 sm:p-5" : ""
      } ${className}`}
    >
      {children}
    </div>
  )
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-3 mb-4">
      <div className="min-w-0">
        <h3 className="text-sm font-bold text-fg">{title}</h3>
        {subtitle && <p className="text-xs text-muted mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

export function SectionTitle({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex items-end justify-between gap-4 flex-wrap">
      <div>
        <h2 className="text-2xl font-extrabold tracking-tight text-fg">
          {title}
        </h2>
        {subtitle && <p className="text-sm text-muted mt-1">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

/* ------------------------------------------------------------- Button */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger"

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-brand text-brand-fg hover:bg-brand-hover shadow-card",
  secondary: "bg-surface text-fg border border-line hover:bg-raised",
  ghost: "text-muted hover:text-fg hover:bg-raised",
  danger: "bg-danger text-white hover:opacity-90",
}

const BUTTON_SIZE = {
  sm: "px-2.5 py-1.5 text-xs gap-1.5 rounded-lg",
  md: "px-3.5 py-2 text-sm gap-2 rounded-xl",
}

export function Button({
  children,
  onClick,
  variant = "secondary",
  size = "md",
  icon,
  disabled,
  type = "button",
  className = "",
  title,
}: {
  children?: ReactNode
  onClick?: () => void
  variant?: ButtonVariant
  size?: keyof typeof BUTTON_SIZE
  icon?: IconName
  disabled?: boolean
  type?: "button" | "submit"
  className?: string
  title?: string
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center justify-center font-semibold whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed ${BUTTON_VARIANT[variant]} ${BUTTON_SIZE[size]} ${className}`}
    >
      {icon && (
        <Icon
          name={icon}
          className={size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4"}
        />
      )}
      {children}
    </button>
  )
}

export function IconButton({
  icon,
  onClick,
  label,
  tone = "muted",
  disabled,
}: {
  icon: IconName
  onClick: () => void
  label: string
  tone?: Tone
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      disabled={disabled}
      className={`p-2 rounded-lg hover:bg-raised disabled:opacity-30 disabled:cursor-not-allowed ${TONE_TEXT[tone]}`}
    >
      <Icon name={icon} />
    </button>
  )
}

/* -------------------------------------------------------------- Badge */

export function Badge({
  children,
  tone = "muted",
  className = "",
}: {
  children: ReactNode
  tone?: Tone
  className?: string
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${TONE_SOFT[tone]} ${className}`}
    >
      {children}
    </span>
  )
}

/* ------------------------------------------------------------ Campos */

export function Field({
  label,
  hint,
  children,
  className = "",
}: {
  label: string
  hint?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-xs font-semibold text-muted mb-1.5">
        {label}
      </span>
      {children}
      {hint && (
        <span className="block text-[11px] text-subtle mt-1">{hint}</span>
      )}
    </label>
  )
}

export const inputClass =
  "w-full px-3 py-2 bg-surface border border-line rounded-xl text-sm text-fg placeholder:text-subtle focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand-soft"

export const inputNumClass = `${inputClass} font-mono tabular-nums`

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`w-10 h-5.5 shrink-0 rounded-full relative transition-colors ${
        checked ? "bg-brand" : "bg-line-strong"
      }`}
      style={{ height: 22, width: 40 }}
    >
      <span
        className="absolute top-0.5 w-[18px] h-[18px] bg-white rounded-full shadow transition-transform"
        style={{ transform: `translateX(${checked ? 20 : 2}px)` }}
      />
    </button>
  )
}

export interface SegmentedOption<T> {
  value: T
  label: ReactNode
  title?: string
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  size = "md",
}: {
  value: T
  options: SegmentedOption<T>[]
  onChange: (v: T) => void
  size?: "sm" | "md"
}) {
  return (
    <div
      className="inline-flex bg-sunken rounded-xl p-0.5 gap-0.5"
      role="group"
    >
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          title={o.title}
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`rounded-[10px] font-semibold transition-colors ${
            size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm"
          } ${
            value === o.value
              ? "bg-surface text-fg shadow-card"
              : "text-muted hover:text-fg"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* -------------------------------------------------------------- Modal */

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = "max-w-md",
}: {
  title: string
  subtitle?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    // El diálogo recibe el foco al abrirse para que el teclado no siga atrapado detrás.
    ref.current?.focus()
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`bg-surface border border-line rounded-2xl shadow-modal w-full ${width} max-h-[90vh] overflow-y-auto animate-in focus:outline-none`}
      >
        <div className="flex items-start justify-between gap-4 p-5 pb-0">
          <div>
            <h3 className="text-lg font-bold text-fg">{title}</h3>
            {subtitle && (
              <p className="text-xs text-muted mt-0.5">{subtitle}</p>
            )}
          </div>
          <IconButton icon="x" onClick={onClose} label="Cerrar" />
        </div>
        <div className="p-5">{children}</div>
        {footer && <div className="flex gap-3 px-5 pb-5">{footer}</div>}
      </div>
    </div>
  )
}

/** Reemplaza `confirm()`, que no se puede estilizar ni traducir y bloquea la pestaña. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirmar",
  tone = "danger",
  onConfirm,
  onCancel,
}: {
  title: string
  message: ReactNode
  confirmLabel?: string
  tone?: "danger" | "brand"
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      width="max-w-sm"
      footer={
        <>
          <Button onClick={onCancel} className="flex-1">
            Cancelar
          </Button>
          <Button
            onClick={onConfirm}
            variant={tone === "danger" ? "danger" : "primary"}
            className="flex-1"
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-muted leading-relaxed">{message}</div>
    </Modal>
  )
}

/* --------------------------------------------------------- EmptyState */

export function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon: IconName
  title: string
  message?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="border border-dashed border-line rounded-2xl p-10 text-center">
      <div className="w-11 h-11 rounded-2xl bg-sunken text-subtle grid place-items-center mx-auto mb-3">
        <Icon name={icon} className="w-5 h-5" />
      </div>
      <p className="font-semibold text-fg">{title}</p>
      {message && (
        <p className="text-sm text-muted mt-1 max-w-sm mx-auto">{message}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

/* -------------------------------------------------------------- Toast */

export interface ToastMessage {
  id: number
  text: string
  tone: Tone
}

export function useToasts() {
  const [toasts, setToasts] = useState<ToastMessage[]>([])

  function push(text: string, tone: Tone = "ok") {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, text, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200)
  }

  return { toasts, push }
}

export function ToastStack({ toasts }: { toasts: ToastMessage[] }) {
  return (
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[70] flex flex-col items-center gap-2 pointer-events-none"
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className="animate-in bg-nav text-nav-fg text-sm font-semibold px-4 py-2.5 rounded-xl shadow-modal flex items-center gap-2"
        >
          <span className={`w-1.5 h-1.5 rounded-full ${TONE_DOT[t.tone]}`} />
          {t.text}
        </div>
      ))}
    </div>
  )
}
