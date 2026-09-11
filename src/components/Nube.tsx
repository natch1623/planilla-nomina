import { useState } from "react"
import type { Cloud, CloudStatus } from "../cloud/useCloud"
import { exportJSON } from "../store"
import type { AppData } from "../types"
import Icon from "./Icon"
import { Button, Field, Modal, inputClass } from "./ui"
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
              <div className="text-sm font-semibold text-fg truncate">{cloud.email}</div>
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
        <Field label="Correo">
          <input
            type="email"
            autoComplete="username"
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
          <strong className="text-fg">{snap.updatedByEmail || "Alguien"}</strong> guardó esta empresa
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
