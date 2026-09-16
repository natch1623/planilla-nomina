import { useEffect, useState } from "react"
import type { Cloud, CloudStatus } from "../cloud/useCloud"
import { displayUser } from "../cloud/client"
import { exportJSON, loadProfileData } from "../store"
import type { MergePreview } from "../store"
import type { AppData } from "../types"
import Icon from "./Icon"
import { Button, Field, Modal, Segmented, inputClass } from "./ui"
import type { Tone } from "./ui"

/** Texto y color de cada estado, compartidos por el botón y el panel. */
export const STATUS_INFO: Record<CloudStatus, { label: string; desc: string; dot: string }> = {
  unavailable: { label: "", desc: "", dot: "" },
  signedOut: {
    label: "Sin sesión",
    desc: "Inicia sesión para ver y compartir empresas en la nube.",
    dot: "bg-subtle",
  },
  local: {
    label: "Solo en este equipo",
    desc: "Esta empresa no está en la nube. Súbela desde Configuración para compartirla.",
    dot: "bg-subtle",
  },
  synced: { label: "Sincronizado", desc: "Todos ven la misma versión.", dot: "bg-ok" },
  pending: {
    label: "Cambios por subir",
    desc: "Guardado en este equipo; se sube a la nube en cuanto haya conexión.",
    dot: "bg-amber",
  },
  saving: { label: "Subiendo…", desc: "Guardando en la nube.", dot: "bg-brand animate-pulse" },
  conflict: {
    label: "Conflicto",
    desc: "Otra persona guardó cambios mientras tú también editabas.",
    dot: "bg-danger",
  },
  outdated: {
    label: "Versión desactualizada",
    desc: "La nube tiene datos de una versión más nueva de la app. Recarga la página.",
    dot: "bg-danger",
  },
  readonly: {
    label: "Solo lectura",
    desc: "Puedes ver esta empresa, pero tus cambios no se suben a la nube.",
    dot: "bg-violet",
  },
  error: { label: "Error de nube", desc: "No se pudo sincronizar.", dot: "bg-danger" },
}

/* ------------------------------------------------------------ Botón */

export function CloudButton({
  cloud,
  onNotify,
}: {
  cloud: Cloud
  onNotify: (msg: string, tone?: Tone) => void
}) {
  const [open, setOpen] = useState(false)
  const [login, setLogin] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const info = STATUS_INFO[cloud.status]

  async function openCompany(id: string) {
    setBusy(id)
    try {
      await cloud.openCompany(id)
      setOpen(false)
    } catch (err) {
      onNotify(err instanceof Error ? err.message : "No se pudo abrir la empresa", "danger")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => (cloud.email ? setOpen((v) => !v) : setLogin(true))}
        aria-expanded={open}
        aria-haspopup="menu"
        title={`Nube: ${info.label}`}
        className="flex items-center gap-1.5 p-2 rounded-xl text-nav-muted hover:text-nav-fg hover:bg-white/10"
      >
        <span className="relative">
          <Icon name="cloud" />
          <span className={`absolute -top-0.5 -right-1 w-2 h-2 rounded-full ring-2 ring-nav ${info.dot}`} />
        </span>
        <span className="hidden lg:block text-xs font-semibold">
          {cloud.email ? info.label : "Iniciar sesión"}
        </span>
      </button>

      {open && cloud.email && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="absolute right-0 top-full mt-2 z-50 bg-surface border border-line rounded-2xl shadow-modal w-72 overflow-hidden animate-in"
          >
            <div className="px-4 py-3 border-b border-line">
              <div className="text-[11px] text-subtle">Sesión iniciada como</div>
              <div className="text-sm font-semibold text-fg truncate">{displayUser(cloud.email)}</div>
              <div className="mt-2 flex items-start gap-2 text-xs text-muted">
                <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${info.dot}`} />
                <span>
                  <strong className="text-fg">{info.label}.</strong> {info.desc}
                  {cloud.status === "error" && cloud.lastError ? ` (${cloud.lastError})` : ""}
                </span>
              </div>
              {cloud.status === "error" && (
                <Button size="sm" className="mt-2" icon="undo" onClick={cloud.retry}>
                  Reintentar
                </Button>
              )}
            </div>

            {cloud.remoteOnly.length > 0 && (
              <>
                <div className="px-4 py-1.5 bg-raised">
                  <span className="text-[10px] font-bold text-subtle uppercase tracking-widest">
                    En la nube, no en este equipo
                  </span>
                </div>
                {cloud.remoteOnly.map((c) => (
                  <button
                    key={c.id}
                    role="menuitem"
                    disabled={busy !== null}
                    onClick={() => openCompany(c.id)}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-raised border-b border-line disabled:opacity-50"
                  >
                    <Icon name="download" className="w-3.5 h-3.5 shrink-0 text-brand" />
                    <span className="text-sm font-semibold text-fg truncate flex-1">
                      {c.name || "Sin nombre"}
                    </span>
                    <span className="text-[11px] text-subtle">
                      {busy === c.id ? "Abriendo…" : "Abrir"}
                    </span>
                  </button>
                ))}
              </>
            )}

            <button
              role="menuitem"
              onClick={() => {
                setOpen(false)
                setLeaving(true)
              }}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-raised text-muted"
            >
              <Icon name="x" className="w-3.5 h-3.5 shrink-0" />
              <span className="text-sm font-semibold">Cerrar sesión</span>
            </button>
          </div>
        </>
      )}

      {login && (
        <LoginModal
          onClose={() => setLogin(false)}
          onSignIn={async (mail, pass) => {
            await cloud.signIn(mail, pass)
            setLogin(false)
            onNotify("Sesión iniciada")
          }}
        />
      )}

      {leaving && (
        <SignOutDialog
          pending={Object.values(cloud.links).filter((l) => l.dirty).length}
          linked={Object.keys(cloud.links).length}
          onCancel={() => setLeaving(false)}
          onConfirm={async (forget) => {
            setLeaving(false)
            try {
              await cloud.signOut(forget)
              onNotify("Sesión cerrada", "muted")
            } catch (err) {
              onNotify(err instanceof Error ? err.message : "No se pudo cerrar la sesión", "danger")
            }
          }}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------ Login */

function LoginModal({
  onClose,
  onSignIn,
}: {
  onClose: () => void
  onSignIn: (email: string, password: string) => Promise<void>
}) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!email.trim() || !password) return
    setBusy(true)
    setError("")
    try {
      await onSignIn(email, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar sesión")
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Iniciar sesión en la nube"
      subtitle="Con tu cuenta ves las empresas que te compartieron y trabajas sobre la misma versión que los demás."
      onClose={onClose}
      width="max-w-sm"
      footer={
        <>
          <Button onClick={onClose} className="flex-1">
            Cancelar
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            disabled={busy || !email.trim() || !password}
            onClick={submit}
          >
            {busy ? "Entrando…" : "Entrar"}
          </Button>
        </>
      }
    >
      {/* El botón de enviar vive en el pie del modal, fuera del formulario:
          Enter se atiende a mano. */}
      <div
        className="space-y-3"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            void submit()
          }
        }}
      >
        <Field label="Usuario">
          <input
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="p. ej. willy.coyote"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Contraseña">
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </Field>
        {error && (
          <p className="flex items-center gap-2 text-xs font-semibold text-danger">
            <Icon name="alert" className="w-4 h-4 shrink-0" />
            {error}
          </p>
        )}
        <p className="text-[11px] text-subtle">
          Las cuentas las crea quien administra la nube. Si no tienes una, pídesela.
        </p>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------- Cerrar sesión */

function SignOutDialog({
  pending,
  linked,
  onCancel,
  onConfirm,
}: {
  pending: number
  linked: number
  onCancel: () => void
  onConfirm: (forgetLocal: boolean) => void
}) {
  const [forget, setForget] = useState(false)
  return (
    <Modal
      title="Cerrar sesión"
      onClose={onCancel}
      width="max-w-sm"
      footer={
        <>
          <Button onClick={onCancel} className="flex-1">
            Cancelar
          </Button>
          <Button variant={forget ? "danger" : "primary"} className="flex-1" onClick={() => onConfirm(forget)}>
            Cerrar sesión
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-muted leading-relaxed">
        {pending > 0 && (
          <p className="flex gap-2 p-3 rounded-xl bg-amber-soft text-amber text-xs font-semibold">
            <Icon name="alert" className="w-4 h-4 shrink-0" />
            Hay {pending} {pending === 1 ? "empresa" : "empresas"} con cambios que todavía no subieron a
            la nube.
          </p>
        )}
        {linked > 0 && (
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={forget}
              onChange={(e) => setForget(e.target.checked)}
              className="mt-1"
            />
            <span>
              Borrar de este equipo las copias de las empresas de la nube. Úsalo en una computadora
              compartida.
              {forget && pending > 0 && (
                <strong className="block text-danger">Los cambios sin subir se perderán.</strong>
              )}
            </span>
          </label>
        )}
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------ Conflicto */

export function ConflictDialog({
  cloud,
  localData,
}: {
  cloud: Cloud
  localData: AppData
}) {
  const snap = cloud.conflict
  if (!snap) return null
  const when = new Date(snap.updatedAt).toLocaleString("es-PA", {
    dateStyle: "medium",
    timeStyle: "short",
  })
  return (
    <Modal
      title="Otra persona guardó cambios"
      onClose={() => {}}
      width="max-w-md"
      footer={
        <>
          <Button variant="danger" className="flex-1" onClick={() => cloud.resolveConflict("mine")}>
            Conservar la mía
          </Button>
          <Button variant="primary" className="flex-1" onClick={() => cloud.resolveConflict("cloud")}>
            Usar la de la nube
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-muted leading-relaxed">
        <p>
          <strong className="text-fg">{displayUser(snap.updatedByEmail) || "Alguien"}</strong> guardó esta empresa
          el {when}, mientras tú tenías cambios sin subir. Hay que elegir una versión:
        </p>
        <ul className="space-y-1.5 text-xs">
          <li>
            <strong className="text-fg">Usar la de la nube</strong>: tomas lo que guardó la otra
            persona y descartas tus cambios pendientes.
          </li>
          <li>
            <strong className="text-fg">Conservar la mía</strong>: tu versión reemplaza la de la nube y
            se pierde lo que guardó la otra persona.
          </li>
        </ul>
        <p className="text-xs">
          Si no estás seguro, descarga primero tu versión como respaldo; luego puedes importarla con
          «Fusionar» desde Configuración.
        </p>
        <Button size="sm" icon="download" onClick={() => exportJSON(localData)}>
          Descargar mi versión
        </Button>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------ Fusionar */

/**
 * Al iniciar: si este equipo tiene una copia solo-local de una empresa que
 * también está en la nube, ofrece juntarlas. "Ahora no" vuelve a preguntar
 * en la próxima apertura; "Mantener separadas" no pregunta más.
 */
export function MergePrompt({
  cloud,
  onNotify,
}: {
  cloud: Cloud
  onNotify: (msg: string, tone?: Tone) => void
}) {
  const [skipped, setSkipped] = useState<string[]>([])
  // No se apila sobre un conflicto: ese se resuelve primero.
  if (cloud.conflict) return null
  const next = cloud.mergeCandidates.find((c) => !skipped.includes(`${c.profileId}:${c.companyId}`))
  if (!next) return null
  return (
    <MergeDialog
      key={`${next.profileId}:${next.companyId}`}
      cloud={cloud}
      profileId={next.profileId}
      profileName={next.profileName}
      companies={[{ id: next.companyId, name: next.companyName }]}
      onNotify={onNotify}
      onClose={() => setSkipped((s) => [...s, `${next.profileId}:${next.companyId}`])}
      onKeepApart={() => cloud.dismissMerge(next.profileId, next.companyId)}
    />
  )
}

export function MergeDialog({
  cloud,
  profileId,
  profileName,
  companies,
  onNotify,
  onClose,
  onKeepApart,
}: {
  cloud: Cloud
  profileId: string
  profileName: string
  /** Empresas de la nube con las que se puede fusionar; si hay varias, se elige. */
  companies: { id: string; name: string }[]
  onNotify: (msg: string, tone?: Tone) => void
  onClose: () => void
  onKeepApart?: () => void
}) {
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "")
  const [winner, setWinner] = useState<"cloud" | "local">("cloud")
  const [preview, setPreview] = useState<MergePreview | null>(null)
  const [previewError, setPreviewError] = useState("")
  const [busy, setBusy] = useState(false)
  const company = companies.find((c) => c.id === companyId)

  useEffect(() => {
    if (!companyId) return
    let alive = true
    setPreview(null)
    setPreviewError("")
    cloud
      .previewMerge(profileId, companyId)
      .then((p) => alive && setPreview(p))
      .catch((err) => alive && setPreviewError(err instanceof Error ? err.message : String(err)))
    return () => {
      alive = false
    }
    // Solo se recalcula al cambiar de empresa, no con cada render de `cloud`.
  }, [profileId, companyId])

  async function merge() {
    setBusy(true)
    try {
      await cloud.mergeLocal(profileId, companyId, winner)
      onNotify(`«${company?.name || profileName}» quedó en una sola versión, sincronizada con la nube`)
      onClose()
    } catch (err) {
      onNotify(err instanceof Error ? err.message : "No se pudo fusionar", "danger")
      setBusy(false)
    }
  }

  const adds = preview
    ? [
        [preview.newEmployees, "colaborador", "colaboradores"],
        [preview.newEntries, "registro diario", "registros diarios"],
        [preview.newClosedPeriods, "quincena cerrada", "quincenas cerradas"],
        [preview.newTransactions, "movimiento", "movimientos"],
        [preview.newLoans, "préstamo", "préstamos"],
        [preview.newCosts, "pago de costos", "pagos de costos"],
      ].filter(([n]) => (n as number) > 0)
    : []
  const shared = preview ? preview.updatedEmployees + preview.updatedEntries : 0

  return (
    <Modal
      title="Fusionar con la nube"
      subtitle={
        <>
          Este equipo tiene una copia local de <strong className="text-fg">«{profileName || "Sin nombre"}»</strong>{" "}
          que no está sincronizada, y la misma empresa está en la nube.
        </>
      }
      onClose={busy ? () => {} : onClose}
      width="max-w-md"
      footer={
        <>
          <Button onClick={onClose} disabled={busy} className="flex-1">
            Ahora no
          </Button>
          <Button variant="primary" className="flex-1" disabled={busy || !companyId} onClick={merge}>
            {busy ? "Fusionando…" : "Fusionar"}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-muted leading-relaxed">
        {companies.length > 1 && (
          <Field label="Empresa de la nube">
            <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className={inputClass}>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name || "Sin nombre"}
                </option>
              ))}
            </select>
          </Field>
        )}

        <p>
          Al fusionar, lo que solo está en este equipo se agrega a la nube y queda{" "}
          <strong className="text-fg">una sola empresa</strong> que todos ven. La configuración
          (tarifas, horarios, nombre) se toma de la nube.
        </p>

        <div className="p-3 rounded-xl bg-raised text-xs">
          {previewError ? (
            <span className="text-danger font-semibold">{previewError}</span>
          ) : !preview ? (
            "Comparando las dos versiones…"
          ) : adds.length === 0 ? (
            "Esta copia no tiene nada que la nube no tenga ya."
          ) : (
            <>
              <strong className="text-fg">Se agregan desde este equipo:</strong>{" "}
              {adds.map(([n, one, many]) => `${n} ${n === 1 ? one : many}`).join(", ")}.
            </>
          )}
        </div>

        {shared > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs">
              {shared} {shared === 1 ? "dato está" : "datos están"} en las dos versiones. Si difieren, se
              conserva:
            </p>
            <Segmented
              size="sm"
              value={winner}
              onChange={setWinner}
              options={[
                { value: "cloud", label: "Lo de la nube" },
                { value: "local", label: "Lo de este equipo" },
              ]}
            />
          </div>
        )}

        <p className="text-xs">
          La copia local se reemplaza por la versión fusionada. Si quieres, descarga antes un respaldo.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            icon="download"
            disabled={busy}
            onClick={() => exportJSON(loadProfileData(profileId))}
          >
            Descargar respaldo local
          </Button>
          {onKeepApart && (
            <Button size="sm" disabled={busy} onClick={onKeepApart}>
              Mantener separadas
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------ Aviso */

/** Franja bajo el encabezado para los estados que bloquean o sorprenden. */
export function CloudBanner({ cloud }: { cloud: Cloud }) {
  if (cloud.status === "outdated") {
    return (
      <Banner tone="danger">
        La nube tiene datos guardados con una versión más nueva de la app. No se subirá nada desde
        aquí hasta que recargues.
        <button
          onClick={() => window.location.reload()}
          className="ml-auto underline underline-offset-2 hover:no-underline shrink-0"
        >
          Recargar
        </button>
      </Banner>
    )
  }
  if (cloud.status === "readonly") {
    return (
      <Banner tone="violet">
        Tienes acceso de solo lectura a esta empresa: lo que cambies aquí no se guarda en la nube y
        se reemplaza con la próxima actualización.
      </Banner>
    )
  }
  return null
}

function Banner({ tone, children }: { tone: "danger" | "violet"; children: React.ReactNode }) {
  const cls = tone === "danger" ? "bg-danger-soft text-danger" : "bg-violet-soft text-violet"
  return (
    <div className={`${cls} border-b border-line`}>
      <div className="max-w-7xl mx-auto px-4 py-2.5 flex items-center gap-2 text-xs font-semibold">
        <Icon name="cloud" className="w-4 h-4 shrink-0" />
        {children}
      </div>
    </div>
  )
}
