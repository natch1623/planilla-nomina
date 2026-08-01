import { useMemo, useState } from "react"
import type { AppData, EmployeeSummary } from "../types"
import {
  MONTHS_ES,
  exportJSON,
  getPeriodDates,
  importJSON,
  periodKey,
} from "../store"
import { calcTotals, fmt } from "../utils/calculations"
import { formatDate } from "../utils/dates"
import Icon from "./Icon"
import {
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  Field,
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
  onChange: (data: AppData) => void
  onNotify: (text: string, tone?: Tone) => void
}

type Pending = "clear" | "close" | "reopen" | "import" | null

export default function Configuracion({
  data,
  liveSummaries,
  onChange,
  onNotify,
}: Props) {
  const [pending, setPending] = useState<Pending>(null)
  const [importedData, setImportedData] = useState<AppData | null>(null)

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
      closedPeriods: data.closedPeriods.filter((c) => c.key !== key),
    })
    onNotify("Quincena reabierta", "amber")
    setPending(null)
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <SectionTitle
        title="Configuración"
        subtitle="Reglas de cálculo, cierre de quincena y respaldo"
      />

      {/* Empresa y apariencia */}
      <Card>
        <CardHeader
          title="Empresa y apariencia"
          subtitle="El nombre aparece en los PDF que exportes"
        />
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Nombre de la empresa">
            <input
              value={data.companyName}
              onChange={(e) => set("companyName", e.target.value)}
              placeholder="Ej. Servicios RyS, S.A."
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
                {fmt(calcTotals(closed.summaries).net)}. Editar tarifas o
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
                {fmt(liveTotals.net)}) y el registro pasa a solo lectura. Es lo
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
            desc="Reemplaza todos los datos actuales por los del archivo"
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
              <strong className="text-fg">${fmt(liveTotals.net)}</strong>. El
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
        <ConfirmDialog
          title="Importar respaldo"
          message={
            <>
              El archivo contiene{" "}
              <strong className="text-fg">
                {importedData.employees.length} colaboradores
              </strong>{" "}
              y{" "}
              <strong className="text-fg">
                {importedData.timeEntries.length} registros
              </strong>
              . Reemplazará por completo los datos actuales (
              {data.employees.length} colaboradores, {data.timeEntries.length}{" "}
              registros). Exporta un respaldo antes si no estás seguro.
            </>
          }
          confirmLabel="Reemplazar datos"
          onConfirm={() => {
            onChange(importedData)
            onNotify("Datos importados")
            setImportedData(null)
            setPending(null)
          }}
          onCancel={() => {
            setImportedData(null)
            setPending(null)
          }}
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
