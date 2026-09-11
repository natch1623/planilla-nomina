import { useCallback, useEffect, useState } from "react"
import * as api from "../cloud/client"
import type { CompanyMember, CompanyRole } from "../cloud/client"
import type { Cloud } from "../cloud/useCloud"
import Icon from "./Icon"
import { STATUS_INFO } from "./Nube"
import { Button, Card, CardHeader, ConfirmDialog, Field, IconButton, inputClass } from "./ui"
import type { Tone } from "./ui"

const ROLE_LABEL: Record<CompanyRole, string> = {
  owner: "Dueño",
  editor: "Editor",
  viewer: "Solo lectura",
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
                  {cloud.role && (
                    <span className="ml-2 text-[11px] font-bold text-subtle">
                      · {ROLE_LABEL[cloud.role]}
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted mt-0.5">
                  {info.desc}
                  {cloud.company?.updatedByEmail && cloud.status !== "local" && (
                    <>
                      {" "}
                      Último guardado de {cloud.company.updatedByEmail} el{" "}
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
            <Members companyId={cloud.company.id} isOwner={cloud.role === "owner"} onNotify={onNotify} />
          )}

          {cloud.link && (
            <div className="flex flex-wrap gap-2 pt-1">
              <Button size="sm" disabled={busy} onClick={() => setConfirm("unlink")}>
                Dejar de sincronizar aquí
              </Button>
              {cloud.role === "owner" && (
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
  isOwner,
  onNotify,
}: {
  companyId: string
  isOwner: boolean
  onNotify: (msg: string, tone?: Tone) => void
}) {
  const [members, setMembers] = useState<CompanyMember[] | null>(null)
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
      onNotify(`${m.email} ya no tiene acceso`, "muted")
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
            <span className="text-sm text-fg truncate flex-1">{m.email}</span>
            <span className="text-[11px] font-bold text-subtle">{ROLE_LABEL[m.role]}</span>
            {isOwner && m.role !== "owner" && (
              <IconButton icon="x" label={`Quitar a ${m.email}`} tone="danger" onClick={() => remove(m)} />
            )}
          </div>
        ))}
      </div>

      {isOwner && (
        <form
          className="mt-3 flex flex-col sm:flex-row gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (email.trim()) void add()
          }}
        >
          <input
            type="email"
            placeholder="correo@empresa.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={`${inputClass} flex-1`}
            aria-label="Correo de la persona a invitar"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as CompanyRole)}
            className={`${inputClass} sm:w-36`}
            aria-label="Permiso"
          >
            <option value="editor">Editor</option>
            <option value="viewer">Solo lectura</option>
            <option value="owner">Dueño</option>
          </select>
          <Button type="submit" variant="primary" icon="plus" disabled={busy || !email.trim()}>
            Agregar
          </Button>
        </form>
      )}
      {isOwner && (
        <p className="text-[11px] text-subtle mt-1.5">
          La persona debe tener cuenta creada en la nube (Supabase → Authentication → Users).
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
