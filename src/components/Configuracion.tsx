import { useMemo, useState } from "react"
import type { AppData, EmployeeSummary } from "../types"
import type { ProfileMeta } from "../store"
import {
  MONTHS_ES,
  exportJSON,
  getPeriodDates,
  importJSON,
  mergeAppData,
  periodKey,
  profileLabel,
} from "../store"
import { calcTotals, fmt } from "../utils/calculations"
import { clearLoanCharges, recordLoanCharges } from "../utils/loans"
import { formatDate } from "../utils/dates"
import Icon from "./Icon"
import {
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  Field,
  IconButton,
  Modal,
  SectionTitle,
  Segmented,
  Toggle,
  inputClass,
  inputNumClass,
} from "./ui"
import type { Tone } from "./ui"

interface Props {
  data: AppData
  /** El cálculo en vivo, no la foto congelada: es lo que se guardaría al cerrar. */
  liveSummaries: EmployeeSummary[]
  profiles: ProfileMeta[]
  activeProfileId: string
  onSwitchProfile: (id: string) => void
  onDeleteProfile: (id: string) => void
  onChange: (data: AppData) => void
  onNotify: (text: string, tone?: Tone) => void
  /** Tarjeta de la nube; ausente cuando el build no trae credenciales. */
  cloudPanel?: React.ReactNode
  cloud?: any /** Cloud object from useCloud for manual merge functionality */
}

type Pending = "clear" | "close" | "reopen" | "import" | null

export default function Configuracion({
  data,
  liveSummaries,
  profiles,
  activeProfileId,
  onSwitchProfile,
  onDeleteProfile,
  onChange,
  onNotify,
  cloudPanel,
  cloud,
}: Props) {
  const [pending, setPending] = useState<Pending>(null)
  const [importedData, setImportedData] = useState<AppData | null>(null)
  const [pendingProfile, setPendingProfile] = useState<ProfileMeta | null>(null)
  const [mergeDialog, setMergeDialog] = useState(false)
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("")
  const [selectedPeriods, setSelectedPeriods] = useState<Set<string>>(new Set())
  const [deleteAfterMerge, setDeleteAfterMerge] = useState(false)

  const { currentPeriod } = data
  const { start, end } = getPeriodDates(currentPeriod)
  const key = periodKey(currentPeriod)
  const closed = data.closedPeriods.find((c) => c.key === key) ?? null

  const periodEntries = useMemo(
    () => data.timeEntries.filter((e) => e.date >= start && e.date <= end),
    [data.timeEntries, start, end],
  )
  const liveTotals = useMemo(() => calcTotals(liveSummaries), [liveSummaries])

  const set = <K extends keyof AppData>(k: K, v: AppData[K]) =>
    onChange({ ...data, [k]: v })

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    importJSON(file)
      .then((d) => {
        setImportedData(d)
        setPending("import")
      })
      .catch((err: Error) => onNotify(err.message, "danger"))
  }

  function clearPeriod() {
    // El botón anterior borraba del día 1 al 31 del mes: al limpiar la segunda
    // quincena se llevaba también la primera, ya pagada.
    onChange({
      ...data,
      timeEntries: data.timeEntries.filter(
        (e) => e.date < start || e.date > end,
      ),
      manualAdjustments: data.manualAdjustments.filter(
        (a) => a.periodKey !== key,
      ),
    })
    onNotify(
      `${periodEntries.length} registros eliminados de la quincena`,
      "danger",
    )
    setPending(null)
  }

  function closePeriod() {
    onChange({
      ...data,
      // El cierre es el momento en que la cuota de préstamo deja de ser
      // hipotética: se guarda lo que la planilla logró descontar de verdad,
      // que puede ser menos si el neto no alcanzaba.
      loans: recordLoanCharges(data.loans, liveSummaries, currentPeriod),
      closedPeriods: [
        ...data.closedPeriods.filter((c) => c.key !== key),
        {
          key,
          period: currentPeriod,
          closedAt: new Date().toISOString(),
          summaries: liveSummaries,
        },
      ],
    })
    onNotify("Quincena cerrada: los montos quedaron congelados")
    setPending(null)
  }

  function reopenPeriod() {
    onChange({
      ...data,
      loans: clearLoanCharges(data.loans, currentPeriod),
      closedPeriods: data.closedPeriods.filter((c) => c.key !== key),
    })
    onNotify("Quincena reabierta", "amber")
    setPending(null)
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <SectionTitle
        title="Configuración"
        subtitle="Perfiles, reglas de cálculo, cierre de quincena y respaldo"
      />

      {/* Perfiles */}
      {profiles.length > 1 && (
        <Card>
          <CardHeader
            title="Empresas"
            subtitle="Cada una con sus colaboradores, planillas y contabilidad por separado"
          />
          <div className="border border-line rounded-2xl divide-y divide-line">
            {profiles.map((p) => {
              const active = p.id === activeProfileId
              return (
                <div
                  key={p.id}
                  className="flex items-center gap-3 px-4 py-3 first:rounded-t-2xl last:rounded-b-2xl"
                >
                  <Icon
                    name="building"
                    className={`w-4 h-4 shrink-0 ${active ? "text-brand" : "text-subtle"}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-fg truncate">
                      {profileLabel(p)}
                    </div>
                    {active && (
                      <div className="text-[11px] text-brand font-semibold">
                        En uso
                      </div>
                    )}
                  </div>
                  {!active && (
                    <Button onClick={() => onSwitchProfile(p.id)}>Abrir</Button>
                  )}
                  <IconButton
                    icon="trash"
                    label={`Eliminar ${profileLabel(p)}`}
                    tone="danger"
                    onClick={() => setPendingProfile(p)}
                  />
                </div>
              )
            })}
          </div>
          <p className="text-[11px] text-subtle mt-3">
            Para crear otra empresa usa el selector de arriba a la izquierda.
          </p>
        </Card>
      )}

      {/* Empresa y apariencia */}
      <Card>
        <CardHeader
          title="Empresa y apariencia"
          subtitle="El nombre aparece en los PDF y da nombre a este perfil"
        />
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Nombre de la empresa">
            <input
              value={data.companyName}
              onChange={(e) => set("companyName", e.target.value)}
              placeholder="Ej. ACME, S.A."
              className={inputClass}
            />
          </Field>
          <Field label="Tema de la interfaz">
            <Segmented
              value={data.theme}
              onChange={(theme) => set("theme", theme)}
              options={[
                { value: "system" as const, label: "Sistema" },
                { value: "light" as const, label: "Claro" },
                { value: "dark" as const, label: "Oscuro" },
              ]}
            />
          </Field>
        </div>
      </Card>

      {cloudPanel}

      {/* Fusión manual */}
      <Card>
        <CardHeader
          title="Fusionar empresas"
          subtitle="Combina dos empresas: local + local, local + nube, o nube + nube"
        />
        <div className="space-y-2.5">
          <DataRow
            title="Fusionar dos empresas"
            desc="Selecciona qué quincenas pasar y elige si conservar o eliminar la empresa de origen"
            action={
              <Button
                icon="cloud"
                onClick={() => {
                  setMergeDialog(true)
                  setSelectedCompanyId("")
                  setSelectedPeriods(new Set())
                  setDeleteAfterMerge(false)
                }}
              >
                Fusionar
              </Button>
            }
          />
        </div>
      </Card>

      {/* Reglas de cálculo */}
      <Card>
        <CardHeader
          title="Reglas de cálculo"
          subtitle="Se aplican a todas las quincenas abiertas; las cerradas conservan sus montos"
        />
        <div className="space-y-4">
          <div className="grid sm:grid-cols-3 gap-4">
            <Field
              label="Umbral de horas extra"
              hint="Horas por día antes de aplicar recargo"
            >
              <input
                type="number"
                min="1"
                max="24"
                step="0.5"
                value={data.overtimeThreshold}
                onChange={(e) =>
                  set("overtimeThreshold", parseFloat(e.target.value) || 8)
                }
                className={inputNumClass}
              />
            </Field>
            <Field
              label="Jornada estándar"
              hint="Horas que se pagan en un día completo no trabajado"
            >
              <input
                type="number"
                min="1"
                max="24"
                step="0.5"
                value={data.standardDayHours}
                onChange={(e) =>
                  set("standardDayHours", parseFloat(e.target.value) || 8)
                }
                className={inputNumClass}
              />
            </Field>
            <Field
              label="Recargo de feriado"
              hint="Multiplicador de las horas trabajadas en feriado"
            >
              <input
                type="number"
                min="1"
                max="4"
                step="0.25"
                value={data.holidayRate}
                onChange={(e) =>
                  set("holidayRate", parseFloat(e.target.value) || 1.5)
                }
                className={inputNumClass}
              />
            </Field>
          </div>

          <div className="border border-line rounded-2xl divide-y divide-line">
            <SettingRow
              title="Pagar días de vacaciones"
              desc={`Suma ${data.standardDayHours} h a la tarifa normal por cada día marcado como vacaciones`}
              checked={data.payVacations}
              onChange={(v) => set("payVacations", v)}
            />
            <SettingRow
              title="Pagar feriados no trabajados"
              desc="Un feriado sin horas registradas paga la jornada estándar"
              checked={data.payHolidays}
              onChange={(v) => set("payHolidays", v)}
            />
            <SettingRow
              title="El patrono paga la incapacidad"
              desc="En Panamá la incapacidad suele cubrirla la CSS, no la empresa"
              checked={data.paySickLeave}
              onChange={(v) => set("paySickLeave", v)}
            />
          </div>

          <div className="border border-line rounded-2xl divide-y divide-line">
            <SettingRow
              title="Módulo de contabilidad"
              desc={
                data.accountingEnabled
                  ? "Apágalo para dejar la aplicación solo en nómina: colaboradores, registro diario y planilla. Tus movimientos no se borran."
                  : `Apagado. Los ${data.transactions.length} movimientos registrados siguen guardados y vuelven a aparecer al encenderlo.`
              }
              checked={data.accountingEnabled}
              onChange={(v) => set("accountingEnabled", v)}
            />
          </div>
        </div>
      </Card>

      {/* Cierre de quincena */}
      <Card>
        <CardHeader
          title="Cierre de quincena"
          subtitle={`${MONTHS_ES[currentPeriod.month - 1]} ${currentPeriod.year} · Q${currentPeriod.half} — ${formatDate(start)} a ${formatDate(end)}`}
        />
        {closed ? (
          <div className="flex items-start gap-3 bg-amber-soft rounded-2xl p-4">
            <span className="text-amber mt-0.5">
              <Icon name="lock" className="w-5 h-5" />
            </span>
            <div className="flex-1">
              <p className="text-sm font-bold text-fg">Quincena cerrada</p>
              <p className="text-xs text-muted mt-0.5">
                Congelada el {new Date(closed.closedAt).toLocaleString("es-PA")}{" "}
                con {closed.summaries.length} colaboradores y un neto de $
                {fmt(calcTotals(closed.summaries).totalPay)}. Editar tarifas o
                registros ya no cambia estos montos.
              </p>
              <Button
                className="mt-3"
                icon="unlock"
                onClick={() => setPending("reopen")}
              >
                Reabrir quincena
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-3 bg-raised rounded-2xl p-4">
            <span className="text-brand mt-0.5">
              <Icon name="checkCircle" className="w-5 h-5" />
            </span>
            <div className="flex-1">
              <p className="text-sm font-bold text-fg">Quincena abierta</p>
              <p className="text-xs text-muted mt-0.5">
                Al cerrarla se guarda una copia del cálculo actual (
                {liveSummaries.length} colaboradores, neto $
                {fmt(liveTotals.totalPay)}) y el registro pasa a solo lectura. Es lo
                que evita que un cambio de tarifa reescriba una planilla ya
                pagada.
              </p>
              <Button
                variant="primary"
                className="mt-3"
                icon="lock"
                disabled={liveSummaries.length === 0}
                onClick={() => setPending("close")}
              >
                Cerrar quincena
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Datos */}
      <Card>
        <CardHeader
          title="Respaldo y datos"
          subtitle="Todo vive en este navegador: si borras sus datos, se pierde la planilla"
        />
        <div className="space-y-2.5">
          <DataRow
            title="Exportar respaldo JSON"
            desc="Descarga colaboradores, registros y configuración"
            action={
              <Button
                icon="download"
                onClick={() => {
                  exportJSON(data)
                  onNotify("Respaldo descargado")
                }}
              >
                Descargar
              </Button>
            }
          />
          <DataRow
            title="Importar respaldo"
            desc="Fusiona el archivo con los datos actuales, o reemplázalos por completo"
            action={
              <label className="inline-flex items-center gap-2 px-3.5 py-2 bg-brand text-brand-fg rounded-xl text-sm font-semibold hover:bg-brand-hover cursor-pointer">
                <Icon name="upload" />
                Cargar
                <input
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={handleImport}
                />
              </label>
            }
          />
          <DataRow
            title="Vaciar la quincena actual"
            desc={`Elimina los ${periodEntries.length} registros entre ${formatDate(start)} y ${formatDate(end)}`}
            danger
            action={
              <Button
                variant="danger"
                icon="trash"
                disabled={periodEntries.length === 0 || !!closed}
                onClick={() => setPending("clear")}
              >
                Vaciar
              </Button>
            }
          />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-5">
          <Stat label="Colaboradores" value={data.employees.length} />
          <Stat
            label="Activos"
            value={data.employees.filter((e) => e.active).length}
          />
          <Stat label="Registros totales" value={data.timeEntries.length} />
          <Stat label="Quincenas cerradas" value={data.closedPeriods.length} />
        </div>

        <p className="mt-4 flex items-center gap-2 text-xs text-ok">
          <Icon name="checkCircle" className="w-3.5 h-3.5" />
          Autoguardado activo en este navegador
        </p>
      </Card>

      {pendingProfile && (
        <ConfirmDialog
          title="Eliminar empresa"
          message={
            <>
              Se borrarán todos los datos de{" "}
              <strong className="text-fg">
                {profileLabel(pendingProfile)}
              </strong>
              : colaboradores, registros, planillas cerradas, préstamos y
              contabilidad. Las demás empresas no se tocan.
              <br />
              <br />
              Esto no se puede deshacer. Si querés conservar una copia, abrila
              primero y exportá su respaldo JSON.
            </>
          }
          confirmLabel="Eliminar empresa"
          onConfirm={() => {
            onDeleteProfile(pendingProfile.id)
            setPendingProfile(null)
          }}
          onCancel={() => setPendingProfile(null)}
        />
      )}

      {pending === "clear" && (
        <ConfirmDialog
          title="Vaciar la quincena actual"
          message={
            <>
              Se eliminarán{" "}
              <strong className="text-fg">
                {periodEntries.length} registros
              </strong>{" "}
              entre {formatDate(start)} y {formatDate(end)}. Las demás quincenas
              no se tocan. Esta acción no se puede deshacer.
            </>
          }
          confirmLabel="Vaciar quincena"
          onConfirm={clearPeriod}
          onCancel={() => setPending(null)}
        />
      )}

      {pending === "close" && (
        <ConfirmDialog
          title="Cerrar la quincena"
          message={
            <>
              Se guardará el cálculo actual de{" "}
              <strong className="text-fg">
                {liveSummaries.length} colaboradores
              </strong>{" "}
              por un neto de{" "}
              <strong className="text-fg">${fmt(liveTotals.totalPay)}</strong>. El
              registro pasará a solo lectura y los montos dejarán de cambiar.
              Puedes reabrirla después.
            </>
          }
          confirmLabel="Cerrar quincena"
          tone="brand"
          onConfirm={closePeriod}
          onCancel={() => setPending(null)}
        />
      )}

      {pending === "reopen" && (
        <ConfirmDialog
          title="Reabrir la quincena"
          message="Los montos volverán a calcularse con los datos y tarifas actuales, que pueden diferir de lo que ya se pagó. Se descarta la copia congelada."
          confirmLabel="Reabrir"
          onConfirm={reopenPeriod}
          onCancel={() => setPending(null)}
        />
      )}

      {pending === "import" && importedData && (
        <Modal
          title="Importar respaldo"
          onClose={() => {
            setImportedData(null)
            setPending(null)
          }}
          width="max-w-sm"
          footer={
            <>
              <Button
                onClick={() => {
                  setImportedData(null)
                  setPending(null)
                }}
                className="flex-1"
              >
                Cancelar
              </Button>
              <Button
                variant="danger"
                className="flex-1"
                onClick={() => {
                  onChange(importedData)
                  onNotify("Datos reemplazados")
                  setImportedData(null)
                  setPending(null)
                }}
              >
                Reemplazar todo
              </Button>
              <Button
                variant="primary"
                className="flex-1"
                onClick={() => {
                  const { data: merged, preview } = mergeAppData(
                    data,
                    importedData,
                  )
                  onChange(merged)
                  onNotify(
                    `Fusionado: ${preview.newEmployees} colaboradores nuevos, ${preview.newEntries} registros nuevos` +
                      (preview.updatedEntries > 0
                        ? `, ${preview.updatedEntries} registros actualizados`
                        : ""),
                  )
                  setImportedData(null)
                  setPending(null)
                }}
              >
                Fusionar
              </Button>
            </>
          }
        >
          <div className="text-sm text-muted leading-relaxed space-y-3">
            <p>
              El archivo contiene{" "}
              <strong className="text-fg">
                {importedData.employees.length} colaboradores
              </strong>{" "}
              y{" "}
              <strong className="text-fg">
                {importedData.timeEntries.length} registros
              </strong>
              . Los datos actuales tienen {data.employees.length}{" "}
              colaboradores y {data.timeEntries.length} registros.
            </p>
            <p>
              <strong className="text-fg">Fusionar</strong> agrega lo nuevo del
              archivo sin borrar lo que no choca con él (por ejemplo, el
              registro de otro colaborador). Solo se sobrescribe lo que
              coincide en colaborador y fecha, o el mismo elemento por id.
            </p>
            <p>
              <strong className="text-fg">Reemplazar todo</strong> descarta
              los datos actuales y deja solo lo que trae el archivo. Exporta
              un respaldo antes si no estás seguro.
            </p>
          </div>
        </Modal>
      )}

      {mergeDialog && cloud && (
        <ManualMergeDialog
          cloud={cloud}
          data={data}
          activeProfileId={activeProfileId}
          profiles={profiles}
          selectedCompanyId={selectedCompanyId}
          selectedPeriods={selectedPeriods}
          deleteAfterMerge={deleteAfterMerge}
          onCompanyChange={setSelectedCompanyId}
          onPeriodsChange={setSelectedPeriods}
          onDeleteChange={setDeleteAfterMerge}
          onClose={() => setMergeDialog(false)}
          onNotify={onNotify}
        />
      )}
    </div>
  )
}

/* --------------------------------------------------------------------- */

function SettingRow({
  title,
  desc,
  checked,
  onChange,
}: {
  title: string
  desc: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 p-3.5">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-fg">{title}</div>
        <div className="text-xs text-muted mt-0.5">{desc}</div>
      </div>
      <Toggle checked={checked} onChange={onChange} label={title} />
    </div>
  )
}

function DataRow({
  title,
  desc,
  action,
  danger,
}: {
  title: string
  desc: string
  action: React.ReactNode
  danger?: boolean
}) {
  return (
    <div
      className={`flex items-center justify-between gap-4 p-3.5 rounded-2xl ${
        danger ? "bg-danger-soft" : "bg-raised"
      }`}
    >
      <div className="min-w-0">
        <div
          className={`text-sm font-semibold ${
            danger ? "text-danger" : "text-fg"
          }`}
        >
          {title}
        </div>
        <div
          className={`text-xs mt-0.5 ${
            danger ? "text-danger opacity-80" : "text-muted"
          }`}
        >
          {desc}
        </div>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  )
}

interface StatProps {
  label: string
  value: number
}

function Stat({ label, value }: StatProps) {
  return (
    <div className="bg-raised rounded-2xl p-3 text-center">
      <div className="num text-2xl font-extrabold text-fg">{value}</div>
      <div className="text-[11px] text-muted mt-0.5">{label}</div>
    </div>
  )
}

/* --------------------------------------------------------- Fusión manual */

interface ManualMergeDialogProps {
  cloud: any
  data: AppData
  activeProfileId: string
  profiles: ProfileMeta[]
  selectedCompanyId: string
  selectedPeriods: Set<string>
  deleteAfterMerge: boolean
  onCompanyChange: (id: string) => void
  onPeriodsChange: (periods: Set<string>) => void
  onDeleteChange: (value: boolean) => void
  onClose: () => void
  onNotify: (text: string, tone?: Tone) => void
}

function ManualMergeDialog({
  cloud,
  data,
  activeProfileId,
  profiles,
  selectedCompanyId,
  selectedPeriods,
  deleteAfterMerge,
  onCompanyChange,
  onPeriodsChange,
  onDeleteChange,
  onClose,
  onNotify,
}: ManualMergeDialogProps) {
  const [busy, setBusy] = useState(false)
  const [sourceProfileId, setSourceProfileId] = useState("")

  async function handleMerge() {
    setBusy(true)
    try {
      // Si origen es local y destino es nube: usar mergeLocal
      if (sourceProfileId && !sourceProfileId.startsWith("cloud-") && selectedCompanyId.startsWith("cloud-")) {
        const cloudCompanyId = selectedCompanyId.replace("cloud-", "")
        await cloud.mergeLocal(sourceProfileId, cloudCompanyId, "cloud")
        onNotify(`Empresas fusionadas exitosamente`)
      } else {
        // Para otros casos de fusión local-local, aquí se podría agregar lógica adicional
        onNotify(`Tipo de fusión aún no implementado en este contexto`, "amber")
      }
      onClose()
    } catch (err) {
      onNotify(err instanceof Error ? err.message : "No se pudo fusionar", "danger")
      setBusy(false)
    }
  }

  // Preparar opciones de empresas (locales + nube)
  const localProfiles = profiles.filter((p) => p.id !== activeProfileId)
  const cloudCompanies = cloud?.companies || []

  const sourceProfile = profiles.find((p) => p.id === sourceProfileId)
  const destCompany = selectedCompanyId.startsWith("cloud-")
    ? cloudCompanies.find((c: any) => c.id === selectedCompanyId.replace("cloud-", ""))
    : profiles.find((p) => p.id === selectedCompanyId)

  return (
    <Modal
      title="Fusionar empresas"
      subtitle="Elige la empresa de origen y la de destino"
      onClose={busy ? () => {} : onClose}
      width="max-w-md"
      footer={
        <>
          <Button onClick={onClose} disabled={busy} className="flex-1">
            Cancelar
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            disabled={busy || !sourceProfileId || !selectedCompanyId || sourceProfileId === selectedCompanyId}
            onClick={handleMerge}
          >
            {busy ? "Fusionando…" : "Fusionar"}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm text-muted leading-relaxed">
        <Field label="Empresa de origen">
          <select
            value={sourceProfileId}
            onChange={(e) => setSourceProfileId(e.target.value)}
            disabled={busy}
            className={inputClass}
          >
            <option value="">Selecciona de dónde traer datos...</option>
            <optgroup label="Empresas locales">
              {localProfiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {profileLabel(p)}
                </option>
              ))}
            </optgroup>
            {cloudCompanies.length > 0 && (
              <optgroup label="Empresas en la nube">
                {cloudCompanies.map((c: any) => (
                  <option key={`cloud-${c.id}`} value={`cloud-${c.id}`}>
                    {c.name || "Sin nombre"}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </Field>

        <Field label="Empresa de destino">
          <select
            value={selectedCompanyId}
            onChange={(e) => onCompanyChange(e.target.value)}
            disabled={busy}
            className={inputClass}
          >
            <option value="">Selecciona a dónde llevar datos...</option>
            <optgroup label="Empresas locales">
              {profiles
                .filter((p) => p.id !== sourceProfileId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {profileLabel(p)}
                  </option>
                ))}
            </optgroup>
            {cloudCompanies.length > 0 && (
              <optgroup label="Empresas en la nube">
                {cloudCompanies.map((c: any) => (
                  <option key={`cloud-${c.id}`} value={`cloud-${c.id}`}>
                    {c.name || "Sin nombre"}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </Field>

        {sourceProfileId && data.closedPeriods.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-semibold text-fg">Quincenas a pasar (opcionales)</div>
            <div className="border border-line rounded-2xl divide-y divide-line max-h-48 overflow-y-auto">
              {data.closedPeriods.map((period) => {
                const isSelected = selectedPeriods.has(period.key)
                return (
                  <label
                    key={period.key}
                    className="flex items-center gap-3 px-3.5 py-2.5 hover:bg-raised cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => {
                        const newPeriods = new Set(selectedPeriods)
                        if (e.target.checked) {
                          newPeriods.add(period.key)
                        } else {
                          newPeriods.delete(period.key)
                        }
                        onPeriodsChange(newPeriods)
                      }}
                      disabled={busy}
                      className="w-4 h-4"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-fg">
                        {MONTHS_ES[period.period.month - 1]} {period.period.year} · Q{period.period.half}
                      </div>
                      <div className="text-xs text-muted">
                        {period.summaries.length} colaboradores
                      </div>
                    </div>
                  </label>
                )
              })}
            </div>
            <p className="text-[11px] text-muted">
              Si no seleccionas ninguna, se pasarán todos los colaboradores y registros abiertos.
            </p>
          </div>
        )}

        <div className="border border-line rounded-2xl p-3.5">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={deleteAfterMerge}
              onChange={(e) => onDeleteChange(e.target.checked)}
              disabled={busy}
              className="mt-1"
            />
            <span className="text-xs">
              <strong className="text-fg">Eliminar empresa de origen</strong> después de fusionar.
              Sin esto, la empresa se conserva con solo los datos que no se movieron.
            </span>
          </label>
        </div>

        <p className="text-xs text-muted">
          Los datos de origen se agregarán a la empresa de destino. La configuración (tarifas, horarios,
          nombre) queda la del destino.
        </p>
      </div>
    </Modal>
  )
}
