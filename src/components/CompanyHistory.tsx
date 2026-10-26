import { useEffect, useRef, useState } from "react"
import * as api from "../cloud/client"
import { downloadText } from "../persistence"
import { Button } from "./ui"

/** El servidor exige administración + lectura completa; la UI solo anticipa eso. */
export default function CompanyHistory({ companyId }: { companyId: string }) {
  const [versions, setVersions] = useState<api.CompanyVersion[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  async function load() {
    setBusy(true)
    setMessage("")
    try {
      const result = await api.listCompanyVersions(companyId)
      if (alive.current) { setVersions(result); if (!result.length) setMessage("Todavía no hay versiones guardadas.") }
    } catch (err) {
      if (alive.current) setMessage(err instanceof Error ? err.message : "No se pudo consultar el historial.")
    } finally { if (alive.current) setBusy(false) }
  }
  async function download(revision: number) {
    setBusy(true)
    try {
      const data = await api.fetchCompanyVersion(companyId, revision)
      if (alive.current) downloadText(JSON.stringify(data,null,2), `planilla_revision_${revision}.json`)
    } catch (err) { if (alive.current) setMessage(err instanceof Error ? err.message : "No se pudo descargar.") }
    finally { if (alive.current) setBusy(false) }
  }
  return <section className="border border-line rounded-2xl p-4 space-y-3">
    <h3 className="text-sm font-bold text-fg">Historial y recuperación</h3>
    <p className="text-xs text-muted">Consulta las últimas 100 versiones. Descarga un respaldo para revisarlo o importarlo en una empresa nueva. Esta consulta conserva los datos actuales.</p>
    <Button size="sm" disabled={busy} onClick={() => void load()}>{busy ? "Consultando…" : "Consultar versiones"}</Button>
    <p role="status" className="text-sm text-muted break-words">{message}</p>
    {versions.length > 0 && <ul className="divide-y divide-line max-h-72 overflow-auto">
      {versions.map(v => <li key={v.revision} className="py-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-fg">Revisión {v.revision} · {new Date(v.recordedAt).toLocaleString("es-PA")}</span>
        <Button size="sm" disabled={busy} onClick={() => void download(v.revision)}>Descargar revisión {v.revision}</Button>
      </li>)}
    </ul>}
  </section>
}
