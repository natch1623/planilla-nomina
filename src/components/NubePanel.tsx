import { useCallback, useEffect, useState } from "react"
import * as api from "../cloud/client"
import type { CompanyMember, CompanyRole, RoleDef } from "../cloud/client"
import type { Cloud } from "../cloud/useCloud"
import Icon from "./Icon"
import { STATUS_INFO } from "./Nube"
import { Button, Card, CardHeader, ConfirmDialog, Field, IconButton, inputClass } from "./ui"
import type { Tone } from "./ui"

/**
 * Los rangos vienen de la tabla `roles` de la nube, así que uno nuevo
 * aparece aquí sin tocar la app. Estos nombres solo cubren el rato en que
 * la lista todavía está cargando.
 */
const FALLBACK_LABEL: Record<string, string> = {
  owner: "Administrador",
  editor: "Editor",
  viewer: "Solo lectura",
  asistencia: "Asistencia",
  costos: "Costos",
}

function roleLabel(roles: RoleDef[], role: CompanyRole): string {
  return roles.find((r) => r.role === role)?.label ?? FALLBACK_LABEL[role] ?? role
}

/**
 * Tarjeta de Configuración para la nube. Solo se monta cuando el build trae
 * credenciales; sin ellas Configuración queda igual que en la versión local.
 */
export default function NubePanel({
  cloud,
  onNotify,
}: {
  cloud: Cloud
  onNotify: (msg: string, tone?: Tone) => void
}) {
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<"unlink" | "delete" | null>(null)
  const info = STATUS_INFO[cloud.status]

  async function run(action: () => Promise<void>, ok: string) {
    setBusy(true)
    try {
      await action()
      onNotify(ok)
    } catch (err) {
      onNotify(err instanceof Error ? err.message : "Algo falló en la nube", "danger")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title="Nube"
        subtitle="Comparte esta empresa para que otras personas vean y editen la misma planilla"
      />

      {!cloud.email ? (
        <p className="p-3.5 bg-raised rounded-2xl text-sm text-muted">
          Inicia sesión con el botón <Icon name="cloud" className="inline w-4 h-4 -mt-0.5" /> de la
          barra superior para subir empresas o abrir las que te compartieron.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 bg-raised rounded-2xl">
            <div className="flex items-start gap-2.5 min-w-0">
              <span className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${info.dot}`} />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-fg">
                  {info.label}
                  {cloud.access && (
                    <span className="ml-2 text-[11px] font-bold text-subtle">
                      · {cloud.access.label}
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted mt-0.5">
                  {info.desc}
                  {cloud.company?.updatedByEmail && cloud.status !== "local" && (
                    <>
                      {" "}
                      Último guardado de {api.displayUser(cloud.company.updatedByEmail)} el{" "}
                      {new Date(cloud.company.updatedAt).toLocaleString("es-PA", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                      .
                    </>
                  )}
                </div>
              </div>
            </div>
            {cloud.status === "local" && (
              <Button
                variant="primary"
                icon="upload"
                disabled={busy}
                className="shrink-0"
                onClick={() => run(cloud.uploadActive, "Empresa subida a la nube")}
              >
                {busy ? "Subiendo…" : "Subir a la nube"}
              </Button>
            )}
          </div>

          {cloud.link && cloud.company && (
            <Members
              companyId={cloud.company.id}
              canManage={cloud.access?.managesMembers === true}
              onNotify={onNotify}
            />
          )}

          {cloud.link && (
            <div className="flex flex-wrap gap-2 pt-1">
              <Button size="sm" disabled={busy} onClick={() => setConfirm("unlink")}>
                Dejar de sincronizar aquí
              </Button>
              {cloud.access?.managesMembers && (
                <Button size="sm" variant="danger" icon="trash" disabled={busy} onClick={() => setConfirm("delete")}>
                  Eliminar de la nube
                </Button>
              )}
            </div>
          )}

          <ChangePassword onNotify={onNotify} />
        </div>
      )}

      {confirm === "unlink" && (
        <ConfirmDialog
          title="Dejar de sincronizar"
          tone="brand"
          message="La empresa sigue en la nube para los demás. En este equipo queda una copia local que ya no recibe ni envía cambios."
          confirmLabel="Dejar de sincronizar"
          onConfirm={() => {
            setConfirm(null)
            cloud.unlinkActive()
            onNotify("La empresa quedó solo en este equipo", "muted")
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === "delete" && (
        <ConfirmDialog
          title="Eliminar de la nube"
          message="Se borra la empresa de la nube para todos los miembros. En este equipo queda una copia local. No se puede deshacer."
          confirmLabel="Eliminar de la nube"
          onConfirm={() => {
            setConfirm(null)
            void run(cloud.deleteActiveFromCloud, "Empresa eliminada de la nube")
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </Card>
  )
}

function Members({
  companyId,
  canManage,
  onNotify,
}: {
  companyId: string
  canManage: boolean
  onNotify: (msg: string, tone?: Tone) => void
}) {
  const [members, setMembers] = useState<CompanyMember[] | null>(null)
  const [roles, setRoles] = useState<RoleDef[]>([])
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<CompanyRole>("editor")
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    api
      .listMembers(companyId)
      .then(setMembers)
      .catch(() => setMembers([]))
  }, [companyId])

  useEffect(load, [load])

  useEffect(() => {
    api
      .listRoles()
      .then(setRoles)
      .catch(() => setRoles([]))
  }, [])

  const selected = roles.find((r) => r.role === role)

  async function changeRole(m: CompanyMember, next: CompanyRole) {
    try {
      // Agregar a alguien que ya está solo le cambia el rango.
      await api.addMember(companyId, m.email, next)
      onNotify(`${api.displayUser(m.email)} ahora es ${roleLabel(roles, next)}`)
      load()
    } catch (err) {
      onNotify(err instanceof Error ? err.message : "No se pudo cambiar el rango", "danger")
    }
  }

  async function add() {
    setBusy(true)
    try {
      await api.addMember(companyId, email, role)
      setEmail("")
      onNotify("Miembro agregado")
      load()
    } catch (err) {
      onNotify(err instanceof Error ? err.message : "No se pudo agregar", "danger")
    } finally {
      setBusy(false)
    }
  }

  async function remove(m: CompanyMember) {
    try {
      await api.removeMember(companyId, m.userId)
      onNotify(`${api.displayUser(m.email)} ya no tiene acceso`, "muted")
      load()
    } catch (err) {
      onNotify(err instanceof Error ? err.message : "No se pudo quitar", "danger")
    }
  }

  return (
    <div>
      <div className="text-xs font-semibold text-muted mb-2">Personas con acceso</div>
      <div className="rounded-2xl border border-line divide-y divide-line overflow-hidden">
        {members === null && <div className="px-3.5 py-2.5 text-xs text-subtle">Cargando…</div>}
        {members?.map((m) => (
          <div key={m.userId} className="flex items-center gap-2 px-3.5 py-2">
            <span className="text-sm text-fg truncate flex-1">{api.displayUser(m.email)}</span>
            {canManage && roles.length > 0 ? (
              <select
                value={m.role}
                onChange={(e) => void changeRole(m, e.target.value)}
                aria-label={`Rango de ${api.displayUser(m.email)}`}
                className="bg-transparent text-[11px] font-bold text-subtle focus:outline-none cursor-pointer"
              >
                {roles.map((r) => (
                  <option key={r.role} value={r.role}>
                    {r.label}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-[11px] font-bold text-subtle">{roleLabel(roles, m.role)}</span>
            )}
            {canManage && (
              <IconButton
                icon="x"
                label={`Quitar a ${api.displayUser(m.email)}`}
                tone="danger"
                onClick={() => remove(m)}
              />
            )}
          </div>
        ))}
      </div>

      {canManage && (
        <form
          className="mt-3 flex flex-col sm:flex-row gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (email.trim()) void add()
          }}
        >
          <input
            type="text"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="usuario, p. ej. willy.coyote"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={`${inputClass} flex-1`}
            aria-label="Usuario de la persona a agregar"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className={`${inputClass} sm:w-40`}
            aria-label="Rango"
          >
            {(roles.length > 0 ? roles : [{ role: "editor", label: "Editor" }]).map((r) => (
              <option key={r.role} value={r.role}>
                {r.label}
              </option>
            ))}
          </select>
          <Button type="submit" variant="primary" icon="plus" disabled={busy || !email.trim()}>
            Agregar
          </Button>
        </form>
      )}
      {canManage && (
        <p className="text-[11px] text-subtle mt-1.5">
          {selected?.description ? `${selected.label}: ${selected.description} ` : ""}
          La persona debe tener cuenta creada en Supabase → Authentication → Users, como{" "}
          <code>usuario@planilla.local</code>.
        </p>
      )}
    </div>
  )
}

function ChangePassword({ onNotify }: { onNotify: (msg: string, tone?: Tone) => void }) {
  const [open, setOpen] = useState(false)
  const [pass, setPass] = useState("")
  const [again, setAgain] = useState("")
  const [busy, setBusy] = useState(false)
  const mismatch = again.length > 0 && pass !== again

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-xs font-semibold text-brand hover:underline">
        Cambiar mi contraseña
      </button>
    )
  }

  return (
    <form
      className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end"
      onSubmit={async (e) => {
        e.preventDefault()
        if (pass.length < 8 || mismatch) return
        setBusy(true)
        try {
          await api.changePassword(pass)
          onNotify("Contraseña actualizada")
          setOpen(false)
          setPass("")
          setAgain("")
        } catch (err) {
          onNotify(err instanceof Error ? err.message : "No se pudo cambiar", "danger")
        } finally {
          setBusy(false)
        }
      }}
    >
      <Field label="Nueva contraseña" hint="Mínimo 8 caracteres">
        <input
          type="password"
          autoComplete="new-password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="Repetir" hint={mismatch ? "No coinciden" : undefined}>
        <input
          type="password"
          autoComplete="new-password"
          value={again}
          onChange={(e) => setAgain(e.target.value)}
          className={inputClass}
        />
      </Field>
      <div className="flex gap-2 sm:mb-5">
        <Button onClick={() => setOpen(false)}>Cancelar</Button>
        <Button type="submit" variant="primary" disabled={busy || pass.length < 8 || mismatch}>
          Guardar
        </Button>
      </div>
    </form>
  )
}
