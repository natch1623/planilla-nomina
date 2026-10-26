import { useState } from "react"
import { DATA_VERSION, decodeStoredData, defaultData, recoverProfileIndex, restoreProfileRaw } from "../store"
import { downloadLocalRecovery, StorageFailure } from "../persistence"
import * as api from "../cloud/client"
import { readLinks, writeLinks } from "../cloud/sync"
import { applySection } from "../cloud/sections"

export default function StorageRecovery({ error }: { error: StorageFailure }) {
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)
  const [user, setUser] = useState("")
  const [password, setPassword] = useState("")
  const id = error.key?.startsWith("planilla_data_") ? error.key.slice("planilla_data_".length) : null
  async function run(task: () => void | Promise<void>) {
    setBusy(true)
    try { await task(); window.location.reload() }
    catch (err) { setMessage(err instanceof Error ? err.message : "No se pudo recuperar") }
    finally { setBusy(false) }
  }
  async function fromCloud() {
    if (!id) return
    const links = readLinks()
    const link = links[id]
    if (!link) throw new Error("Esta empresa no tiene un vínculo de nube guardado. Recupera un respaldo.")
    if (!(await api.getSession())) {
      if (!user || !password) throw new Error("Escribe tu usuario y contraseña para recuperar desde la nube.")
      await api.signIn(user, password)
    }
    const company = (await api.listCompanies()).find(c => c.id === link.companyId)
    if (!company) throw new Error("Tu cuenta no tiene acceso a esta empresa.")
    let snap: api.CloudSnapshot
    if (company.access.readsAll) snap = await api.fetchCompany(link.companyId)
    else {
      let data = { ...defaultData, companyName: company.name }
      const revision = await api.fetchRevision(link.companyId)
      for (const sec of company.access.sections) data = applySection(data, sec, (await api.fetchSection(link.companyId, sec)).payload)
      if (revision !== await api.fetchRevision(link.companyId)) throw new Error("La empresa cambió durante la recuperación. Vuelve a intentar.")
      snap = { data, revision, updatedAt: "", updatedByEmail: "" }
    }
    if (snap.data.version > DATA_VERSION) throw new Error("Recarga la aplicación para obtener su versión más reciente.")
    const raw = JSON.stringify(snap.data)
    decodeStoredData(raw)
    // La revisión solo se adelanta después de guardar la copia recuperada.
    restoreProfileRaw(id, raw)
    writeLinks({ ...links, [id]: { ...link, revision: snap.revision, dirty: false } })
  }
  return <main className="min-h-screen bg-app grid place-items-center p-6">
    <section className="max-w-xl w-full bg-surface border border-line rounded-2xl p-6 space-y-4">
      <h1 className="text-lg font-bold text-fg">Se necesita recuperar los datos</h1>
      <p className="text-sm text-muted">{error.message} El guardado y la sincronización están detenidos.</p>
      <div className="flex flex-wrap gap-2">
        <button className="px-4 py-3 rounded-xl bg-brand text-brand-fg font-bold" disabled={busy} onClick={() => { try { downloadLocalRecovery(); setMessage("Copia de recuperación descargada. Guárdala en un lugar privado.") } catch { setMessage("El navegador no permite leer el almacenamiento.") } }}>Descargar copia de recuperación</button>
        <button className="px-4 py-3 rounded-xl border border-line text-fg" disabled={busy} onClick={() => window.location.reload()}>Volver a intentar</button>
      </div>
      {error.key === "planilla_profiles" && <button className="px-4 py-3 rounded-xl border border-line text-fg" disabled={busy} onClick={() => void run(recoverProfileIndex)}>Recuperar índice de empresas</button>}
      {id && <>
        <button className="px-4 py-3 rounded-xl border border-line text-fg" disabled={busy} onClick={() => void run(() => {
          const raw = localStorage.getItem(`planilla_previous:planilla_data_${id}`)
          if (!raw) throw new Error("No hay una copia anterior en este equipo.")
          restoreProfileRaw(id, raw)
          // Una copia anterior debe contrastarse con la nube, incluso a igual revisión.
          const links = readLinks()
          if (links[id]) writeLinks({ ...links, [id]: { ...links[id], revision: 0, dirty: true } })
        })}>Recuperar copia local anterior</button>
        <label className="block text-sm text-fg">Recuperar un respaldo JSON de esta empresa
          <input type="file" accept="application/json,.json" disabled={busy} className="block mt-2 w-full" onChange={e => {
            const file = e.target.files?.[0]
            if (file) void run(async () => {
              restoreProfileRaw(id, await file.text())
              const links = readLinks()
              if (links[id]) writeLinks({ ...links, [id]: { ...links[id], revision: 0, dirty: true } })
            })
          }} />
        </label>
        {api.cloudAvailable && <details className="text-fg space-y-3">
          <summary className="cursor-pointer py-2 font-bold">Recuperar versión guardada en la nube</summary>
          <p className="text-sm text-muted">Sustituye la copia de este equipo. Los cambios locales pendientes quedan en la copia de recuperación.</p>
          <label className="block text-sm">Usuario (si tu sesión venció)<input className="block w-full border border-line rounded-xl px-3 py-2 bg-app" autoComplete="username" value={user} onChange={e => setUser(e.target.value)} /></label>
          <label className="block text-sm">Contraseña<input className="block w-full border border-line rounded-xl px-3 py-2 bg-app" autoComplete="current-password" type="password" value={password} onChange={e => setPassword(e.target.value)} /></label>
          <button className="px-4 py-3 rounded-xl bg-brand text-brand-fg font-bold" disabled={busy} onClick={() => void run(fromCloud)}>Recuperar desde la nube</button>
        </details>}
      </>}
      <p role="status" className="text-sm text-fg break-words">{busy ? "Recuperando…" : message}</p>
    </section>
  </main>
}
