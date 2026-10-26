import { useMemo, useState } from "react"
import type { AppData } from "../types"
import { overdueBills } from "../utils/fixedExpenses"
import { todayISO } from "../utils/dates"
import GastosFijos from "./GastosFijos"
import GastosDiarios from "./gastos/GastosDiarios"
import PagosEmpresas from "./gastos/PagosEmpresas"
import Icon from "./Icon"
import type { IconName } from "./Icon"
import { Badge, SectionTitle } from "./ui"
import type { Tone } from "./ui"

interface Props {
  data: AppData
  /** Rango Solo lectura: ve todo, pero no cambia nada. */
  readOnly?: boolean
  onChange: (patch: Partial<AppData>) => void
  onNotify: (text: string, tone?: Tone) => void
}

type View = "fijos" | "diarios" | "empresas"

// `short` en el celular: con los nombres largos la tercera sección quedaba
// cortada fuera de la pantalla.
const VIEWS: { id: View; label: string; short: string; icon: IconName }[] = [
  { id: "fijos", label: "Fijos", short: "Fijos", icon: "bolt" },
  { id: "diarios", label: "Del día a día", short: "Día a día", icon: "wallet" },
  { id: "empresas", label: "Pagos a empresas", short: "Empresas", icon: "briefcase" },
]

/**
 * Los gastos de administración, aparte de la contabilidad: los fijos que
 * llegan con factura, los sueltos del día a día y los pagos a empresas.
 * Cada lista puede anotarse además en Contabilidad si se quiere.
 */
export default function Gastos({ data, readOnly = false, onChange, onNotify }: Props) {
  const [view, setView] = useState<View>("fijos")
  const overdue = useMemo(
    () => overdueBills(data.fixedExpenses, data.fixedExpensePayments, todayISO()).length,
    [data.fixedExpenses, data.fixedExpensePayments],
  )
  const shared = { data, readOnly, onChange, onNotify }

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Gastos"
        subtitle="Servicios fijos, gastos del día a día y pagos a empresas"
        action={
          readOnly && (
            <Badge>
              <Icon name="eye" className="w-3 h-3" />
              Solo lectura
            </Badge>
          )
        }
      />

      <nav
        className="flex items-center gap-1 overflow-x-auto border-b border-line -mb-px"
        aria-label="Secciones de gastos"
      >
        {VIEWS.map((v) => (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            aria-current={view === v.id ? "page" : undefined}
            className={`flex items-center gap-1.5 px-3 min-h-11 text-xs font-bold whitespace-nowrap border-b-2 transition-colors shrink-0 ${
              view === v.id
                ? "text-brand border-brand"
                : "text-muted border-transparent hover:text-fg"
            }`}
          >
            <Icon name={v.icon} className="w-4 h-4 shrink-0" />
            <span className="sm:hidden">{v.short}</span>
            <span className="hidden sm:inline">{v.label}</span>
            {v.id === "fijos" && overdue > 0 && (
              <span
                className="ml-0.5 px-1.5 rounded-full bg-danger text-white text-[10px]"
                aria-label={`${overdue} ${overdue === 1 ? "pago vencido" : "pagos vencidos"}`}
              >
                {overdue}
              </span>
            )}
          </button>
        ))}
      </nav>

      {view === "fijos" && <GastosFijos {...shared} />}
      {view === "diarios" && <GastosDiarios {...shared} />}
      {view === "empresas" && <PagosEmpresas {...shared} />}
    </div>
  )
}
