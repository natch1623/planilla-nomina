import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { AppData, EmployeeSummary, PayPeriod } from "./types"
import {
  getPeriodDates,
  loadData,
  MONTHS_ES,
  periodKey,
  saveData,
  shiftPeriod,
} from "./store"
import { calcPeriodSummaries, rulesFrom } from "./utils/calculations"
import { exportToExcel } from "./utils/exportExcel"
import { exportToPDF } from "./utils/exportPDF"
import { exportAllPayslips } from "./utils/exportPayslip"
import Dashboard from "./components/Dashboard"
import Empleados from "./components/Empleados"
import RegistroDiario from "./components/RegistroDiario"
import Configuracion from "./components/Configuracion"
import Icon from "./components/Icon"
import type { IconName } from "./components/Icon"
import { Segmented, ToastStack, useToasts } from "./components/ui"

type Tab = "dashboard" | "empleados" | "registro" | "config"

interface TabDef {
  id: Tab
  label: string
  short: string
  icon: IconName
}

const TABS: TabDef[] = [
  { id: "dashboard", label: "Dashboard", short: "Inicio", icon: "dashboard" },
  { id: "empleados", label: "Colaboradores", short: "Equipo", icon: "users" },
  {
    id: "registro",
    label: "Registro Diario",
    short: "Registro",
    icon: "calendar",
  },
  { id: "config", label: "Configuración", short: "Ajustes", icon: "settings" },
]

export default function App() {
  const [data, setData] = useState<AppData>(loadData)
  const [tab, setTab] = useState<Tab>("dashboard")
  const [exportMenu, setExportMenu] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const { toasts, push } = useToasts()

  // Sin esto el indicador "Guardado" parpadea al abrir la aplicación,
  // antes de que el usuario haya cambiado nada.
  const firstRender = useRef(true)

  useEffect(() => {
    saveData(data)
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    setSavedFlash(true)
    const t = setTimeout(() => setSavedFlash(false), 1400)
    return () => clearTimeout(t)
  }, [data])

  // El tema vive en `data-theme` sobre <html>; "sistema" se resuelve aquí.
  useEffect(() => {
    const root = document.documentElement
    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    const apply = () => {
      root.dataset.theme =
        data.theme === "system" ? (mq.matches ? "dark" : "light") : data.theme
    }
    apply()
    mq.addEventListener("change", apply)
    return () => mq.removeEventListener("change", apply)
  }, [data.theme])

  const rules = useMemo(() => rulesFrom(data), [data])
  const key = periodKey(data.currentPeriod)
  const closed = useMemo(
    () => data.closedPeriods.find((c) => c.key === key) ?? null,
    [data.closedPeriods, key],
  )

  const liveSummaries = useMemo(
    () =>
      calcPeriodSummaries(
        data.employees,
        data.timeEntries,
        data.currentPeriod,
        rules,
      ),
    [data.employees, data.timeEntries, data.currentPeriod, rules],
  )

  // Una quincena cerrada muestra su foto congelada: cambiar una tarifa hoy
  // no debe reescribir una planilla que ya se pagó.
  const summaries: EmployeeSummary[] = closed ? closed.summaries : liveSummaries

  const setPeriod = useCallback((p: PayPeriod) => {
    setData((d) => ({ ...d, currentPeriod: p }))
  }, [])

  const { start, end } = getPeriodDates(data.currentPeriod)

  function runExport(kind: "excel" | "pdf" | "payslips") {
    setExportMenu(false)
    if (summaries.length === 0) {
      push("No hay datos que exportar en este período", "amber")
      return
    }
    if (kind === "excel") {
      exportToExcel(summaries, data.currentPeriod)
      push("Excel descargado")
    } else if (kind === "pdf") {
      exportToPDF(summaries, data.currentPeriod, data.companyName)
      push("PDF descargado")
    } else {
      exportAllPayslips(summaries, data.currentPeriod, data.companyName)
      push(`${summaries.length} comprobantes descargados`)
    }
  }

  return (
    <div className="min-h-screen bg-app">
      <a
        href="#contenido"
        className="sr-only-focusable absolute z-[80] m-2 px-3 py-2 bg-brand text-brand-fg rounded-lg text-sm font-semibold"
      >
        Saltar al contenido
      </a>

      <header className="bg-nav sticky top-0 z-40 shadow-pop">
        <div className="max-w-7xl mx-auto px-3 sm:px-4">
          {/* Fila 1: identidad, período y acciones */}
          <div className="flex items-center h-14 gap-2 sm:gap-4">
            <div className="flex items-center gap-2.5 shrink-0">
              <div className="w-8 h-8 rounded-xl bg-brand grid place-items-center text-brand-fg">
                <Icon
                  name="building"
                  className="w-4.5 h-4.5"
                  strokeWidth={2.2}
                />
              </div>
              <div className="hidden sm:block leading-tight">
                <div className="font-bold text-nav-fg text-sm tracking-tight">
                  Planilla
                </div>
                {data.companyName && (
                  <div className="text-[10px] text-nav-muted truncate max-w-[140px]">
                    {data.companyName}
                  </div>
                )}
              </div>
            </div>

            <PeriodNav
              period={data.currentPeriod}
              onChange={setPeriod}
              locked={!!closed}
            />

            <div className="flex-1" />

            <div className="flex items-center gap-1.5 shrink-0">
              <span
                className={`hidden md:flex items-center gap-1 text-xs font-semibold text-ok transition-opacity ${
                  savedFlash ? "opacity-100" : "opacity-0"
                }`}
                aria-hidden={!savedFlash}
              >
                <Icon name="check" className="w-3.5 h-3.5" />
                Guardado
              </span>

              <ThemeToggle
                value={data.theme}
                onChange={(theme) => setData((d) => ({ ...d, theme }))}
              />

              <div className="relative">
                <button
                  onClick={() => setExportMenu((v) => !v)}
                  aria-expanded={exportMenu}
                  aria-haspopup="menu"
                  className="flex items-center gap-1.5 px-3 py-2 bg-brand text-brand-fg rounded-xl text-xs font-bold hover:bg-brand-hover"
                >
                  <Icon name="download" className="w-3.5 h-3.5" />
                  <span className="hidden sm:block">Exportar</span>
                </button>
                {exportMenu && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setExportMenu(false)}
                    />
                    <div
                      role="menu"
                      className="absolute right-0 top-full mt-2 z-50 bg-surface border border-line rounded-2xl shadow-modal w-60 overflow-hidden animate-in"
                    >
                      <ExportItem
                        icon="grid"
                        title="Excel (.xlsx)"
                        desc="Planilla completa en hoja de cálculo"
                        onClick={() => runExport("excel")}
                      />
                      <ExportItem
                        icon="document"
                        title="PDF — Planilla"
                        desc="Reporte consolidado del período"
                        onClick={() => runExport("pdf")}
                      />
                      <ExportItem
                        icon="users"
                        title="PDF — Comprobantes"
                        desc="Un desprendible por colaborador"
                        onClick={() => runExport("payslips")}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Fila 2: navegación principal */}
          <nav
            className="flex items-center gap-1 -mb-px overflow-x-auto"
            aria-label="Secciones"
          >
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
                className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-bold whitespace-nowrap border-b-2 transition-colors ${
                  tab === t.id
                    ? "text-nav-fg border-brand"
                    : "text-nav-muted border-transparent hover:text-nav-fg"
                }`}
              >
                <Icon name={t.icon} className="w-4 h-4 shrink-0" />
                <span className="sm:hidden">{t.short}</span>
                <span className="hidden sm:block">{t.label}</span>
              </button>
            ))}
          </nav>
        </div>
      </header>

      {closed && (
        <div className="bg-amber-soft border-b border-line">
          <div className="max-w-7xl mx-auto px-4 py-2.5 flex items-center gap-2 text-xs font-semibold text-amber">
            <Icon name="lock" className="w-4 h-4 shrink-0" />
            <span>
              Quincena cerrada el{" "}
              {new Date(closed.closedAt).toLocaleDateString("es-PA")}. Los
              montos están congelados y el registro es de solo lectura.
            </span>
            <button
              onClick={() => setTab("config")}
              className="ml-auto underline underline-offset-2 hover:no-underline shrink-0"
            >
              Reabrir
            </button>
          </div>
        </div>
      )}

      <main id="contenido" className="max-w-7xl mx-auto px-3 sm:px-4 py-6">
        {tab === "dashboard" && (
          <Dashboard
            summaries={summaries}
            period={data.currentPeriod}
            companyName={data.companyName}
            closed={!!closed}
            onNotify={push}
          />
        )}
        {tab === "empleados" && (
          <Empleados
            employees={data.employees}
            onChange={(employees) => setData((d) => ({ ...d, employees }))}
            onNotify={push}
          />
        )}
        {tab === "registro" && (
          <RegistroDiario
            employees={data.employees}
            entries={data.timeEntries}
            period={data.currentPeriod}
            rules={rules}
            readOnly={!!closed}
            onChange={(timeEntries) => setData((d) => ({ ...d, timeEntries }))}
            onNotify={push}
          />
        )}
        {tab === "config" && (
          <Configuracion
            data={data}
            liveSummaries={liveSummaries}
            onChange={setData}
            onNotify={push}
          />
        )}
      </main>

      <footer className="max-w-7xl mx-auto px-4 pb-8 text-[11px] text-subtle">
        Período {start} — {end} · {MONTHS_ES[data.currentPeriod.month - 1]}{" "}
        {data.currentPeriod.year} · Los datos se guardan en este navegador.
        Exporta un respaldo JSON con regularidad.
      </footer>

      <ToastStack toasts={toasts} />
    </div>
  )
}

/* --------------------------------------------------------------------- */

function PeriodNav({
  period,
  onChange,
  locked,
}: {
  period: PayPeriod
  onChange: (p: PayPeriod) => void
  locked: boolean
}) {
  const [open, setOpen] = useState(false)
  const years = Array.from(
    { length: 7 },
    (_, i) => new Date().getFullYear() - 3 + i,
  )

  return (
    <div className="relative flex items-center gap-0.5 bg-nav-raised rounded-xl p-0.5">
      <button
        onClick={() => onChange(shiftPeriod(period, -1))}
        aria-label="Quincena anterior"
        className="p-1.5 rounded-lg text-nav-muted hover:text-nav-fg hover:bg-white/10"
      >
        <Icon name="chevronLeft" className="w-4 h-4" />
      </button>

      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="px-2 py-1 rounded-lg text-nav-fg hover:bg-white/10 flex items-center gap-1.5"
      >
        {locked && <Icon name="lock" className="w-3 h-3 text-amber" />}
        <span className="text-xs font-bold whitespace-nowrap">
          <span className="hidden sm:inline">
            {MONTHS_ES[period.month - 1]}
          </span>
          <span className="sm:hidden">
            {MONTHS_ES[period.month - 1].slice(0, 3)}
          </span>{" "}
          {period.year}
        </span>
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-brand text-brand-fg">
          Q{period.half}
        </span>
        <Icon name="chevronDown" className="w-3 h-3 text-nav-muted" />
      </button>

      <button
        onClick={() => onChange(shiftPeriod(period, 1))}
        aria-label="Quincena siguiente"
        className="p-1.5 rounded-lg text-nav-muted hover:text-nav-fg hover:bg-white/10"
      >
        <Icon name="chevronRight" className="w-4 h-4" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-2 z-50 bg-surface border border-line rounded-2xl shadow-modal p-3 w-64 animate-in">
            <div className="grid grid-cols-2 gap-2 mb-3">
              <select
                value={period.year}
                onChange={(e) =>
                  onChange({ ...period, year: parseInt(e.target.value) })
                }
                aria-label="Año"
                className="px-2 py-1.5 bg-surface border border-line rounded-lg text-sm text-fg focus:outline-none focus:border-brand"
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
              <select
                value={period.month}
                onChange={(e) =>
                  onChange({ ...period, month: parseInt(e.target.value) })
                }
                aria-label="Mes"
                className="px-2 py-1.5 bg-surface border border-line rounded-lg text-sm text-fg focus:outline-none focus:border-brand"
              >
                {MONTHS_ES.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <Segmented
              value={period.half}
              onChange={(half) => onChange({ ...period, half: half as 1 | 2 })}
              options={[
                { value: 1, label: "1ª · días 1–15" },
                { value: 2, label: "2ª · 16–fin" },
              ]}
              size="sm"
            />
          </div>
        </>
      )}
    </div>
  )
}

function ThemeToggle({
  value,
  onChange,
}: {
  value: AppData["theme"]
  onChange: (t: AppData["theme"]) => void
}) {
  const order: AppData["theme"][] = ["system", "light", "dark"]
  const icon: Record<AppData["theme"], IconName> = {
    system: "monitor",
    light: "sun",
    dark: "moon",
  }
  const label: Record<AppData["theme"], string> = {
    system: "Tema: según el sistema",
    light: "Tema: claro",
    dark: "Tema: oscuro",
  }

  return (
    <button
      onClick={() => onChange(order[(order.indexOf(value) + 1) % order.length])}
      title={label[value]}
      aria-label={label[value]}
      className="p-2 rounded-xl text-nav-muted hover:text-nav-fg hover:bg-white/10"
    >
      <Icon name={icon[value]} />
    </button>
  )
}

function ExportItem({
  icon,
  title,
  desc,
  onClick,
}: {
  icon: IconName
  title: string
  desc: string
  onClick: () => void
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-raised border-b border-line last:border-0"
    >
      <span className="mt-0.5 text-brand">
        <Icon name={icon} />
      </span>
      <span>
        <span className="block text-sm font-bold text-fg">{title}</span>
        <span className="block text-[11px] text-muted">{desc}</span>
      </span>
    </button>
  )
}
