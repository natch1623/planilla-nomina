import { useEffect, useRef, useState } from "react"

/**
 * Respeta la preferencia del sistema de reducir movimiento. El CSS global ya
 * recorta las animaciones declarativas, pero una cuenta hecha con
 * `requestAnimationFrame` no se entera: hay que consultarla en JavaScript.
 */
function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false,
  )

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    const apply = () => setReduce(mq.matches)
    mq.addEventListener("change", apply)
    return () => mq.removeEventListener("change", apply)
  }, [])

  return reduce
}

/**
 * Anima un número desde el valor anterior hasta el nuevo.
 *
 * Interesa el recorrido, no solo el destino: al cambiar de quincena el salto de
 * la cifra muestra que algo se recalculó. Si la animación se interrumpe a mitad
 * —otro cambio antes de terminar— la siguiente arranca desde donde iba y no
 * desde el valor viejo, que daría un salto hacia atrás.
 */
function useCountUp(value: number, duration = 600): number {
  const reduce = usePrefersReducedMotion()
  const [display, setDisplay] = useState(value)
  const currentRef = useRef(value)

  useEffect(() => {
    if (reduce || !Number.isFinite(value)) {
      currentRef.current = value
      setDisplay(value)
      return
    }

    const from = currentRef.current
    if (from === value) return

    let frame = 0
    const start = performance.now()

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      // easeOutCubic: arranca rápido y frena, que es como se lee un contador.
      const eased = 1 - Math.pow(1 - t, 3)
      const next = from + (value - from) * eased
      currentRef.current = next
      setDisplay(next)
      if (t < 1) frame = requestAnimationFrame(tick)
      else currentRef.current = value
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value, duration, reduce])

  return display
}

interface AnimatedNumberProps {
  value: number
  /** Cómo se pinta el número; recibe el valor intermedio de la animación. */
  format: (n: number) => string
  className?: string
}

export function AnimatedNumber({
  value,
  format,
  className,
}: AnimatedNumberProps) {
  const display = useCountUp(value)
  return (
    <span className={className} aria-label={format(value)}>
      <span aria-hidden>{format(display)}</span>
    </span>
  )
}

interface SparklineProps {
  values: number[]
  /** Token de color, p. ej. `var(--ok)`. */
  color?: string
  height?: number
  className?: string
  /** Descripción para lectores de pantalla. */
  label?: string
}

/**
 * Minigráfica de tendencia en SVG puro.
 *
 * No usa Recharts a propósito: son media docena de puntos dentro de una tarjeta,
 * y montar un contenedor responsivo por cada uno cuesta más de lo que rinde.
 */
export function Sparkline({
  values,
  color = "var(--brand)",
  height = 32,
  className = "",
  label,
}: SparklineProps) {
  const clean = values.filter((v) => Number.isFinite(v))
  if (clean.length < 2) return null

  const W = 100
  const H = height
  const PAD = 2

  const min = Math.min(...clean)
  const max = Math.max(...clean)
  // Una serie plana dividiría por cero; se dibuja centrada.
  const span = max - min || 1

  const points = clean.map((v, i) => {
    const x = (i / (clean.length - 1)) * W
    const y = H - PAD - ((v - min) / span) * (H - PAD * 2)
    return [x, y] as const
  })

  const line = points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ")
  const area = `${line} ${W},${H} 0,${H}`
  const [lastX, lastY] = points[points.length - 1]
  const gradientId = `spark-${Math.round(min)}-${Math.round(max)}-${clean.length}`

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={`w-full ${className}`}
      style={{ height }}
      role={label ? "img" : "presentation"}
      aria-label={label}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gradientId})`} />
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx={lastX}
        cy={lastY}
        r="2"
        fill={color}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
