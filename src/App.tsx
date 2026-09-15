import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type { AppData, EmployeeSummary, PayPeriod } from "./types"
import type { ProfileIndex } from "./store"
import {
  createProfile,
  createProfileWithData,
  deleteProfile,
  getPeriodDates,
  loadIndex,
  loadProfileData,
  MONTHS_ES,
  periodKey,
  profileLabel,
  saveIndex,
  saveProfileData,
  shiftPeriod,
  syncProfileName,
} from "./store"
import { calcPeriodSummaries, rulesFrom } from "./utils/calculations"
import { useCloud } from "./cloud/useCloud"
import { SECTIONS } from "./cloud/sections"
import type { Section } from "./cloud/sections"
import { CloudBanner, CloudButton, ConflictDialog } from "./components/Nube"
import NubePanel from "./components/NubePanel"
import Dashboard from "./components/Dashboard"
import Icon from "./components/Icon"
import type { IconName } from "./components/Icon"
import {
  Button,
  Field,
  Modal,
  Segmented,
  ToastStack,
  inputClass,
  useToasts,
} from "./components/ui"

/**
 * El dashboard es la pantalla de entrada y se carga de una. El resto viaja en
 * su propio chunk: la contabilidad arrastra cuatro vistas con gráficas, y no
 * tiene por qué descargarla quien solo viene a revisar la planilla.
 *
 * Los exportadores —SheetJS y jsPDF suman más de medio megabyte— se importan
 * dentro de `runExport`, así que solo bajan cuando alguien exporta de verdad.
 */
const Empleados = lazy(() => import("./components/Empleados"))
const RegistroDiario = lazy(() => import("./components/RegistroDiario"))
const Contabilidad = lazy(() => import("./components/Contabilidad"))
const Costos = lazy(() => import("./components/Costos"))
const Configuracion = lazy(() => import("./components/Configuracion"))

type Tab =
  | "dashboard"
  | "empleados"
  | "registro"
  | "contabilidad"
  | "costos"
  | "config"

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
  {
    id: "contabilidad",
    label: "Contabilidad",
    short: "Cuentas",
    icon: "receipt",
  },
  { id: "costos", label: "Costos", short: "Costos", icon: "building" },
  { id: "config", label: "Configuración", short: "Ajustes", icon: "settings" },
]

/**
 * Secciones de la nube que esta versión sabe mostrar: las que tienen su
 * pestaña. Cuando exista la de Costos, esa sección se habilita sola.
 */
const SUPPORTED_SECTIONS = (Object.keys(SECTIONS) as Section[]).filter((s) =>
  TABS.some((t) => t.id === SECTIONS[s].tab),
)

export default function App() {
  // Índice y datos se leen juntos una sola vez: el perfil activo decide qué
  // AppData cargar, y llamarlos por separado leería el índice dos veces.
  const [boot] = useState(() => {
    const index = loadIndex()
    return { index, data: loadProfileData(index.activeId) }
  })
  const [index, setIndex] = useState<ProfileIndex>(boot.index)
  const [data, setData] = useState<AppData>(boot.data)
  const [tab, setTab] = useState<Tab>("dashboard")
  const accounting = data.accountingEnabled
  const tabs = useMemo(
    () => (accounting ? TABS : TABS.filter((t) => t.id !== "contabilidad")),
    [accounting],
  )
  // Apagar el módulo estando parado en él dejaría la pestaña sin destino.
  const baseTab: Tab = !accounting && tab === "contabilidad" ? "dashboard" : tab
  const [exportMenu, setExportMenu] = useState(false)
  const [profileMenu, setProfileMenu] = useState(false)
  const [creatingProfile, setCreatingProfile] = useState(false)
  const [newProfile, setNewProfile] = useState("")
  const [savedFlash, setSavedFlash] = useState(false)
  const { toasts, push } = useToasts()
  const hideFlash = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Sin esto el indicador "Guardado" parpadea al abrir la aplicación,
  // antes de que el usuario haya cambiado nada.
  const firstRender = useRef(true)

  const activeId = index.activeId

  useEffect(() => {
    // El primer guardado va sin demora: normaliza en disco lo que se acaba de
    // cargar, y todavía no hay nada que el usuario pueda perder esperando.
    // También cubre el cambio de perfil, que reemplaza `data` de golpe.
    if (firstRender.current) {
      firstRender.current = false
      saveProfileData(activeId, data)
      return
    }

    /**
     * Serializar todo el estado —incluidos los adjuntos en base64— en cada
     * tecla bloqueaba el hilo principal mientras se escribía. Se agrupa en una
     * sola escritura al frenar; el `beforeunload` cubre el caso de cerrar la
     * pestaña dentro de esa ventana.
     */
    const flush = () => {
      const ok = saveProfileData(activeId, data)
      // El nombre del perfil es el de la empresa: si cambió, el selector tiene
      // que reflejarlo sin obligar a recargar.
      const renamed = syncProfileName(index, activeId, data.companyName)
      if (renamed) setIndex(renamed)
      if (!ok) {
        // Casi siempre es la cuota llena por comprobantes adjuntos. Callarlo
        // dejaría al usuario trabajando sobre cambios que no se guardaron.
        push(
          "No se pudo guardar: almacenamiento lleno. Elimina adjuntos o exporta un respaldo.",
          "danger",
        )
        return
      }
      setSavedFlash(true)
      hideFlash.current = setTimeout(() => setSavedFlash(false), 1400)
    }

    const timer = setTimeout(flush, 400)
    window.addEventListener("beforeunload", flush)
    return () => {
      clearTimeout(timer)
      clearTimeout(hideFlash.current)
      window.removeEventListener("beforeunload", flush)
    }
  }, [data, activeId, index, push])

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

  // Depende de los seis parámetros de cálculo, no de `data` entero: antes
  // cualquier cambio —un movimiento contable, el tema— devolvía un objeto nuevo
  // e invalidaba el recálculo de toda la planilla.
  const rules = useMemo(
    () => rulesFrom(data),
    [
      data.overtimeThreshold,
      data.standardDayHours,
      data.holidayRate,
      data.payVacations,
      data.payHolidays,
      data.paySickLeave,
    ],
  )

  /** Cuántos registros dependen de cada colaborador; ver `Empleados`. */
  const employeeHistory = useMemo(() => {
    const counts = new Map<string, number>()
    const bump = (id: string) => counts.set(id, (counts.get(id) ?? 0) + 1)
    for (const entry of data.timeEntries) bump(entry.employeeId)
    for (const loan of data.loans) bump(loan.employeeId)
    for (const period of data.closedPeriods) {
      for (const summary of period.summaries) bump(summary.employee.id)
    }
    return counts
  }, [data.timeEntries, data.loans, data.closedPeriods])

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
        data.loans,
        data.manualAdjustments,
      ),
    [
      data.employees,
      data.timeEntries,
      data.currentPeriod,
      rules,
      data.loans,
      data.manualAdjustments,
    ],
  )

  // Una quincena cerrada muestra su foto congelada: cambiar una tarifa hoy
  // no debe reescribir una planilla que ya se pagó.
  const summaries: EmployeeSummary[] = closed ? closed.summaries : liveSummaries

  const setPeriod = useCallback((p: PayPeriod) => {
    setData((d) => ({ ...d, currentPeriod: p }))
  }, [])

  /**
   * Cambiar de empresa. Se descarga la actual antes de soltarla: el guardado
   * normal está diferido, y sin este volcado los últimos segundos de trabajo se
   * perderían al reemplazar el estado.
   */
  const switchProfile = useCallback(
    (id: string) => {
      if (id === activeId) return
      saveProfileData(activeId, data)
      const next = { ...index, activeId: id }
      saveIndex(next)
      setIndex(next)
      setData(loadProfileData(id))
      setTab("dashboard")
      firstRender.current = true
      setProfileMenu(false)
    },
    [activeId, data, index],
  )

  const addProfile = useCallback(
    (name: string) => {
      saveProfileData(activeId, data)
      const created = createProfile(index, name)
      setIndex(created.index)
      setData(created.data)
      setTab("config")
      firstRender.current = true
      setProfileMenu(false)
      push(`Perfil «${name}» creado`)
    },
    [activeId, data, index, push],
  )

  /** Abre como perfil nuevo una empresa bajada de la nube. */
  const openAsNewProfile = useCallback(
    (incoming: AppData) => {
      saveProfileData(activeId, data)
      const created = createProfileWithData(index, incoming)
      setIndex(created.index)
      setData(created.data)
      setTab("dashboard")
      firstRender.current = true
      setProfileMenu(false)
      return created.id
    },
    [activeId, data, index],
  )

  /**
   * Borra las copias locales de empresas de la nube (al cerrar sesión en un
   * equipo compartido). Si eran todas, deja un perfil vacío: la app necesita
   * al menos uno.
   */
  const forgetProfiles = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return
      const gone = new Set(ids)
      if (!gone.has(activeId)) saveProfileData(activeId, data)
      let next = index
      if (next.profiles.every((p) => gone.has(p.id))) {
        next = createProfile(next, "").index
      }
      for (const id of ids) next = deleteProfile(next, id) ?? next
      if (gone.has(next.activeId)) next = { ...next, activeId: next.profiles[0].id }
      saveIndex(next)
      setIndex(next)
      setData(loadProfileData(next.activeId))
      setTab("dashboard")
      firstRender.current = true
    },
    [activeId, data, index],
  )

  const cloud = useCloud({
    activeId,
    data,
    setData,
    notify: push,
    openAsNewProfile,
    switchProfile,
    forgetProfiles,
    supportedSections: SUPPORTED_SECTIONS,
  })

  /**
   * Un rango por secciones (Asistencia, Costos…) ve solo sus pestañas y la
   * de su cuenta. Es comodidad, no seguridad: sus datos locales ya llegan
   * recortados desde la nube, sin salarios.
   */
  const restricted = cloud.restricted
  const shownTabs = useMemo(() => {
    if (!restricted || !cloud.access) return tabs
    const allowed = new Set<string>(cloud.access.sections.map((s) => SECTIONS[s].tab))
    return TABS.filter((t) => allowed.has(t.id) || t.id === "config").map((t) =>
      t.id === "config" ? { ...t, label: "Mi cuenta", short: "Cuenta" } : t,
    )
  }, [restricted, cloud.access, tabs])
  const activeTab: Tab = shownTabs.some((t) => t.id === baseTab)
    ? baseTab
    : shownTabs[0].id

  const removeProfile = useCallback(
    (id: string) => {
      const next = deleteProfile(index, id)
      if (!next) {
        push("No se puede eliminar el único perfil", "amber")
        return
      }
      // Se borra la copia de este equipo; la empresa sigue en la nube.
      cloud.forgetLink(id)
      setIndex(next)
      if (id === activeId) {
        setData(loadProfileData(next.activeId))
        setTab("dashboard")
      }
      firstRender.current = true
      push("Perfil eliminado", "danger")
    },
    [activeId, index, push, cloud.forgetLink],
  )

  const { start, end } = getPeriodDates(data.currentPeriod)

  type ExportKind = "excel" | "pdf" | "payslips" | "finanzas-pdf" | "finanzas-excel"

  async function runExport(kind: ExportKind) {
    setExportMenu(false)

    try {
      // Los reportes financieros no dependen de la planilla del período: viven
      // de los movimientos, así que no se bloquean cuando la quincena va vacía.
      if (kind === "finanzas-pdf" || kind === "finanzas-excel") {
        const finanzas = await import("./utils/exportFinanzas")
        if (kind === "finanzas-pdf") {
          finanzas.exportFinancialReportPDF(data, rules)
          push("Estado financiero descargado")
        } else {
          finanzas.exportFinancialWorkbook(data, rules)
          push("Libro financiero descargado")
        }
        return
      }

      if (summaries.length === 0) {
        push("No hay datos que exportar en este período", "amber")
        return
      }

      if (kind === "excel") {
        const { exportToExcel } = await import("./utils/exportExcel")
        exportToExcel(summaries, data.currentPeriod, data.timeEntries, rules)
        push("Excel descargado")
      } else if (kind === "pdf") {
        const { exportToPDF } = await import("./utils/exportPDF")
        exportToPDF(summaries, data.currentPeriod, data.companyName)
        push("PDF descargado")
      } else {
        const { exportAllPayslips } = await import("./utils/exportPayslip")
        exportAllPayslips(
          summaries,
          data.currentPeriod,
          data.companyName,
          data.timeEntries,
          data.manualAdjustments,
          rules,
        )
        push(`${summaries.length} comprobantes descargados`)
      }
    } catch (err) {
      // Una descarga que falla en silencio es peor que un aviso: el usuario se
      // queda esperando un archivo que nunca llega.
      console.error("Falló la exportación", err)
      push("No se pudo generar el archivo. Intenta de nuevo.", "danger")
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
            <div className="relative shrink-0">
              <button
                onClick={() => setProfileMenu((v) => !v)}
                aria-expanded={profileMenu}
                aria-haspopup="menu"
                title="Cambiar de empresa"
                className="flex items-center gap-2.5 rounded-xl px-1 py-1 hover:bg-white/10"
              >
                <span className="w-8 h-8 rounded-xl bg-brand grid place-items-center text-brand-fg">
                  <Icon
                    name="building"
                    className="w-4.5 h-4.5"
                    strokeWidth={2.2}
                  />
                </span>
                <span className="hidden sm:block leading-tight text-left">
                  <span className="block font-bold text-nav-fg text-sm tracking-tight truncate max-w-[140px]">
                    {profileLabel(
                      index.profiles.find((p) => p.id === activeId),
                    )}
                  </span>
                  <span className="block text-[10px] text-nav-muted">
                    {index.profiles.length > 1
                      ? `${index.profiles.length} empresas`
                      : "Planilla"}
                  </span>
                </span>
                <Icon
                  name="chevronDown"
                  className="w-3 h-3 text-nav-muted shrink-0"
                />
              </button>

              {profileMenu && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setProfileMenu(false)}
                  />
                  <div
                    role="menu"
                    className="absolute left-0 top-full mt-2 z-50 bg-surface border border-line rounded-2xl shadow-modal w-64 overflow-hidden animate-in"
                  >
                    <div className="px-4 py-1.5 bg-raised">
                      <span className="text-[10px] font-bold text-subtle uppercase tracking-widest">
                        Empresas
                      </span>
                    </div>
                    {index.profiles.map((p) => (
                      <button
                        key={p.id}
                        role="menuitem"
                        onClick={() => switchProfile(p.id)}
                        className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-raised border-b border-line"
                      >
                        <Icon
                          name="check"
                          className={`w-3.5 h-3.5 shrink-0 text-brand ${
                            p.id === activeId ? "" : "opacity-0"
                          }`}
                        />
                        <span className="text-sm font-semibold text-fg truncate flex-1">
                          {profileLabel(p)}
                        </span>
                        {cloud.links[p.id] && (
                          <Icon
                            name="cloud"
                            className="w-3.5 h-3.5 shrink-0 text-subtle"
                          />
                        )}
                      </button>
                    ))}
                    {cloud.remoteOnly.length > 0 && (
                      <>
                        <div className="px-4 py-1.5 bg-raised">
                          <span className="text-[10px] font-bold text-subtle uppercase tracking-widest">
                            En la nube
                          </span>
                        </div>
                        {cloud.remoteOnly.map((c) => (
                          <button
                            key={c.id}
                            role="menuitem"
                            onClick={() => {
                              setProfileMenu(false)
                              cloud
                                .openCompany(c.id)
                                .catch((err) =>
                                  push(
                                    err instanceof Error
                                      ? err.message
                                      : "No se pudo abrir la empresa",
                                    "danger",
                                  ),
                                )
                            }}
                            className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-raised border-b border-line"
                          >
                            <Icon
                              name="download"
                              className="w-3.5 h-3.5 shrink-0 text-brand"
                            />
                            <span className="text-sm font-semibold text-fg truncate">
                              {c.name || "Sin nombre"}
                            </span>
                          </button>
                        ))}
                      </>
                    )}
                    <button
                      role="menuitem"
                      onClick={() => {
                        setProfileMenu(false)
                        setNewProfile("")
                        setCreatingProfile(true)
                      }}
                      className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-raised text-brand"
                    >
                      <Icon name="plus" className="w-3.5 h-3.5 shrink-0" />
                      <span className="text-sm font-bold">Nueva empresa</span>
                    </button>
                  </div>
                </>
              )}
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

              {cloud.available && <CloudButton cloud={cloud} onNotify={push} />}

              <ThemeToggle
                value={data.theme}
                onChange={(theme) => setData((d) => ({ ...d, theme }))}
              />

              <div className={`relative ${restricted ? "hidden" : ""}`}>
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
                      {accounting && (
                        <>
                          <div className="px-4 py-1.5 bg-raised">
                            <span className="text-[10px] font-bold text-subtle uppercase tracking-widest">
                              Finanzas
                            </span>
                          </div>
                          <ExportItem
                            icon="wallet"
                            title="PDF — Estado financiero"
                            desc="Caja, resultado, salud y proyección"
                            onClick={() => runExport("finanzas-pdf")}
                          />
                          <ExportItem
                            icon="grid"
                            title="Excel — Libro financiero"
                            desc="Movimientos, historial, presupuestos y más"
                            onClick={() => runExport("finanzas-excel")}
                          />
                        </>
                      )}
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
            {shownTabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-current={activeTab === t.id ? "page" : undefined}
                className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-bold whitespace-nowrap border-b-2 transition-colors ${
                  activeTab === t.id
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

      <CloudBanner cloud={cloud} />

      {closed && (
        <div className="bg-amber-soft border-b border-line">
          <div className="max-w-7xl mx-auto px-4 py-2.5 flex items-center gap-2 text-xs font-semibold text-amber">
            <Icon name="lock" className="w-4 h-4 shrink-0" />
            <span>
              Quincena cerrada el{" "}
              {new Date(closed.closedAt).toLocaleDateString("es-PA")}. Los
              montos están congelados y el registro es de solo lectura.
            </span>
            {!restricted && (
              <button
                onClick={() => setTab("config")}
                className="ml-auto underline underline-offset-2 hover:no-underline shrink-0"
              >
                Reabrir
              </button>
            )}
          </div>
        </div>
      )}

      <main id="contenido" className="max-w-7xl mx-auto px-3 sm:px-4 py-6">
        {activeTab === "dashboard" && (
          <Dashboard
            summaries={summaries}
            period={data.currentPeriod}
            companyName={data.companyName}
            closed={!!closed}
            data={data}
            rules={rules}
            onNotify={push}
            onChange={setData}
          />
        )}
        <Suspense fallback={<TabSkeleton />}>
          {activeTab === "empleados" && (
            <Empleados
              employees={data.employees}
              history={employeeHistory}
              onChange={(employees) => setData((d) => ({ ...d, employees }))}
              onNotify={push}
            />
          )}
          {activeTab === "registro" && (
            <RegistroDiario
              employees={data.employees}
              entries={data.timeEntries}
              period={data.currentPeriod}
              rules={rules}
              loans={data.loans}
              readOnly={!!closed}
              hidePay={restricted}
              onChange={(timeEntries) => setData((d) => ({ ...d, timeEntries }))}
              onNotify={push}
            />
          )}
          {activeTab === "contabilidad" && (
            <Contabilidad
              data={data}
              rules={rules}
              onChange={(patch) => setData((d) => ({ ...d, ...patch }))}
              onNotify={push}
            />
          )}
          {activeTab === "costos" && (
            <Costos
              data={data}
              onChange={(patch) => setData((d) => ({ ...d, ...patch }))}
              onNotify={push}
            />
          )}
          {activeTab === "config" && restricted && (
            <div className="space-y-5 max-w-3xl">
              <NubePanel cloud={cloud} onNotify={push} />
            </div>
          )}
          {activeTab === "config" && !restricted && (
            <Configuracion
              data={data}
              liveSummaries={liveSummaries}
              profiles={index.profiles}
              activeProfileId={activeId}
              onSwitchProfile={switchProfile}
              onDeleteProfile={removeProfile}
              onChange={setData}
              onNotify={push}
              cloudPanel={
                cloud.available ? (
                  <NubePanel cloud={cloud} onNotify={push} />
                ) : undefined
              }
            />
          )}
        </Suspense>
      </main>

      <footer className="max-w-7xl mx-auto px-4 pb-8 text-[11px] text-subtle">
        Período {start} — {end} · {MONTHS_ES[data.currentPeriod.month - 1]}{" "}
        {data.currentPeriod.year} ·{" "}
        {cloud.link
          ? "Los datos se guardan en este navegador y en la nube."
          : "Los datos se guardan en este navegador. Exporta un respaldo JSON con regularidad."}
      </footer>

      {creatingProfile && (
        <Modal
          title="Nueva empresa"
          onClose={() => setCreatingProfile(false)}
          width="max-w-sm"
          footer={
            <>
              <Button
                onClick={() => setCreatingProfile(false)}
                className="flex-1"
              >
                Cancelar
              </Button>
              <Button
                variant="primary"
                className="flex-1"
                disabled={!newProfile.trim()}
                onClick={() => {
                  addProfile(newProfile.trim())
                  setCreatingProfile(false)
                }}
              >
                Crear
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <p className="text-sm text-muted leading-relaxed">
              Arranca vacía y con sus propias reglas de cálculo. Sus
              colaboradores, planillas y contabilidad no se mezclan con los de
              las demás.
            </p>
            <Field label="Nombre de la empresa">
              <input
                autoFocus
                value={newProfile}
                onChange={(e) => setNewProfile(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newProfile.trim()) {
                    addProfile(newProfile.trim())
                    setCreatingProfile(false)
                  }
                }}
                placeholder="Ej. ACME, S.A."
                className={inputClass}
              />
            </Field>
          </div>
        </Modal>
      )}

      <ConflictDialog cloud={cloud} localData={data} />

      <ToastStack toasts={toasts} />
    </div>
  )
}

/* --------------------------------------------------------------------- */

/** Relleno mientras baja el chunk de una pestaña. */
function TabSkeleton() {
  return (
    <div className="animate-pulse space-y-4" aria-hidden>
      <div className="h-8 w-48 bg-raised rounded-lg" />
      <div className="h-32 bg-raised rounded-2xl" />
      <div className="h-32 bg-raised rounded-2xl" />
    </div>
  )
}

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
