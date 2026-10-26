import { useEffect, useState, type ReactNode } from "react"

/** Una sola pestaña editora por origen; las demás no montan ni autosave ni nube. */
export default function StorageGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"waiting" | "ready" | "busy" | "error">("waiting")
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true
    let release: (() => void) | undefined
    if (!navigator.locks) {
      // Navegadores antiguos conservan la comparación de versión en writeStored.
      setState("ready")
      return
    }
    const controller = new AbortController()
    const waiting = setTimeout(() => alive && setState("busy"), 250)
    // signal cancela una petición aún pendiente en el doble efecto de StrictMode.
    // No puede combinarse con ifAvailable; la cola se libera al cerrar la otra pestaña.
    void navigator.locks.request("planilla:editor", { signal: controller.signal }, async () => {
      clearTimeout(waiting)
      if (!alive) return
      await new Promise<void>((resolve) => {
        release = resolve
        setState("ready")
      })
    }).catch(err => { if (alive && err?.name !== "AbortError") setState("error") })
    return () => { alive = false; clearTimeout(waiting); controller.abort(); release?.() }
  }, [attempt])
  if (state === "ready") return children
  return <main className="min-h-screen bg-app grid place-items-center p-6">
    <section className="max-w-lg bg-surface border border-line rounded-2xl p-6 space-y-4" aria-live="polite">
      <h1 className="text-lg font-bold text-fg">{state === "waiting" ? "Comprobando el almacenamiento…" : state === "busy" ? "La aplicación está abierta en otra pestaña" : "No se pudo proteger el guardado"}</h1>
      {state !== "waiting" && <>
        <p className="text-sm text-muted">{state === "busy" ? "Cierra la otra pestaña de esta aplicación. Esta ventana se habilitará automáticamente cuando pueda editar." : "El navegador no permitió coordinar el guardado. Vuelve a intentar o abre la aplicación en un navegador compatible."}</p>
        <button className="px-4 py-3 rounded-xl bg-brand text-brand-fg font-bold" onClick={() => { setState("waiting"); setAttempt(n => n + 1) }}>Volver a intentar</button>
      </>}
    </section>
  </main>
}
