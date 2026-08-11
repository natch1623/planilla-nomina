import { useMemo, useState } from "react"
import type { AppData } from "../types"
import type { PayrollRules } from "../utils/calculations"
import { buildMonthlySeries, projectFutureMonths } from "../utils/accounting"
import { buildAlerts, calcCashFlow, calcHealth } from "../utils/finance"
import Icon from "./Icon"
import type { IconName } from "./Icon"
import { SectionTitle } from "./ui"
import type { Tone } from "./ui"
import Resumen from "./contabilidad/Resumen"
import FlujoCaja from "./contabilidad/FlujoCaja"
import Movimientos from "./contabilidad/Movimientos"
import Comparar from "./contabilidad/Comparar"
import Proyeccion from "./contabilidad/Proyeccion"
import Presupuestos from "./contabilidad/Presupuestos"
import Calendario from "./contabilidad/Calendario"
import Contactos from "./contabilidad/Contactos"
import Prestamos from "./contabilidad/Prestamos"
import Metas from "./contabilidad/Metas"

export interface ViewProps {
  data: AppData
  rules: PayrollRules
  onChange: (patch: Partial<AppData>) => void
  onNotify: (text: string, tone?: Tone) => void
}

interface Props extends ViewProps {}

type View = "resumen" | "flujo" | "movimientos" | "comparar" | "proyeccion" | "presupuestos" | "calendario" | "contactos" | "prestamos" | "metas"

interface ViewDef {
  id: View
  label: string
  icon: IconName
}

const VIEWS: ViewDef[] = [
  { id: "resumen", label: "Resumen", icon: "dashboard" },
  { id: "flujo", label: "Flujo de caja", icon: "wallet" },
  { id: "movimientos", label: "Movimientos", icon: "receipt" },
  { id: "comparar", label: "Comparar", icon: "scale" },
  { id: "proyeccion", label: "Proyección", icon: "trendUp" },
  { id: "presupuestos", label: "Presupuestos", icon: "grid" },
  { id: "calendario", label: "Calendario", icon: "calendar" },
  { id: "contactos", label: "Clientes y proveedores", icon: "briefcase" },
  { id: "prestamos", label: "Préstamos", icon: "creditCard" },
  { id: "metas", label: "Metas", icon: "flag" },
]

export default function Contabilidad({
  data,
  rules,
  onChange,
  onNotify,
}: Props) {
  const [view, setView] = useState<View>("resumen")

  // Todo el análisis nace de la misma serie mensual: calcularla una vez aquí
  // evita que dos pestañas muestren cifras distintas del mismo período.
  const series = useMemo(
    () => buildMonthlySeries(data, rules, 24),
    [data, rules],
  )
  const projected = useMemo(
    () => projectFutureMonths(series, data, rules, { monthsAhead: 6 }),
    [series, data, rules],
  )
  const cash = useMemo(() => calcCashFlow(data, rules), [data, rules])
  const health = useMemo(
    () => calcHealth(data, series, cash, rules),
    [data, series, cash, rules],
  )
  const alerts = useMemo(
    () => buildAlerts(data, series, projected, cash, health),
    [data, series, projected, cash, health],
  )

  const shared = { data, rules, onChange, onNotify }
  const criticals = alerts.filter((a) => a.level === "critico").length

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Contabilidad"
        subtitle="Flujo de caja, análisis financiero y proyección del negocio"
      />

      <nav
        className="flex items-center gap-1 overflow-x-auto border-b border-line -mb-px"
        aria-label="Secciones de contabilidad"
      >
        {VIEWS.map((v) => (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            aria-current={view === v.id ? "page" : undefined}
            className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-bold whitespace-nowrap border-b-2 transition-colors shrink-0 ${
              view === v.id
                ? "text-brand border-brand"
                : "text-muted border-transparent hover:text-fg"
            }`}
          >
            <Icon name={v.icon} className="w-4 h-4 shrink-0" />
            {v.label}
            {v.id === "resumen" && criticals > 0 && (
              <span className="ml-0.5 px-1.5 rounded-full bg-danger text-white text-[10px]">
                {criticals}
              </span>
            )}
          </button>
        ))}
      </nav>

      {view === "resumen" && (
        <Resumen
          {...shared}
          series={series}
          projected={projected}
          cash={cash}
          health={health}
          alerts={alerts}
          onGoTo={setView}
        />
      )}
      {view === "flujo" && (
        <FlujoCaja {...shared} cash={cash} projected={projected} />
      )}
      {view === "movimientos" && <Movimientos {...shared} />}
      {view === "comparar" && <Comparar {...shared} series={series} />}
      {view === "proyeccion" && (
        <Proyeccion
          {...shared}
          series={series}
          projected={projected}
          cash={cash}
        />
      )}
      {view === "presupuestos" && <Presupuestos {...shared} />}
      {view === "calendario" && <Calendario {...shared} />}
      {view === "contactos" && <Contactos {...shared} />}
      {view === "prestamos" && <Prestamos {...shared} />}
      {view === "metas" && <Metas {...shared} series={series} />}
    </div>
  )
}

export type { View }
