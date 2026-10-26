/** Errores de persistencia: nunca se convierten en una empresa vacía. */
export class StorageFailure extends Error {
  constructor(
    public kind: "missing" | "corrupt" | "unavailable" | "changed" | "newer",
    message: string,
    public key?: string,
  ) {
    super(message)
    this.name = "StorageFailure"
  }
}

// Por instancia de Storage: cada pestaña conserva la versión que realmente leyó.
const bases = new WeakMap<Storage, Map<string, string | null>>()
function known() {
  let map = bases.get(localStorage)
  if (!map) bases.set(localStorage, (map = new Map()))
  return map
}

export function readStored(key: string): string | null {
  try {
    const raw = localStorage.getItem(key)
    known().set(key, raw)
    return raw
  } catch {
    throw new StorageFailure("unavailable", "El navegador no permite leer los datos guardados.", key)
  }
}

/** CAS local. Web Locks en StorageGate serializa las pestañas compatibles. */
export function writeStored(key: string, raw: string, keepPrevious = false): void {
  try {
    const before = localStorage.getItem(key)
    const map = known()
    if (map.has(key) ? map.get(key) !== before : before !== null) {
      throw new StorageFailure("changed", "Otra pestaña cambió estos datos. Descarga tus cambios antes de recargar.", key)
    }
    if (before === raw) return
    // Si no cabe la copia anterior, tampoco se reemplaza el documento actual.
    if (keepPrevious && before !== null) {
      localStorage.setItem(`planilla_previous:${key}`, before)
    }
    localStorage.setItem(key, raw)
    map.set(key, raw)
  } catch (err) {
    if (err instanceof StorageFailure) throw err
    throw new StorageFailure("unavailable", "No se pudo guardar en este equipo. Descarga un respaldo y libera espacio o habilita el almacenamiento.", key)
  }
}

export function downloadText(raw: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }))
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Incluye perfiles, índice y vínculos; nunca exporta sesiones o tokens. */
export function downloadLocalRecovery(): void {
  const entries: Record<string, string> = {}
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)!
    if (key === "planilla_profiles" || key === "planilla_cloud_links" ||
        key === "planilla_data" || key.startsWith("planilla_data_") ||
        key.startsWith("planilla_previous:") || key.startsWith("planilla_damaged:")) {
      entries[key] = localStorage.getItem(key)!
    }
  }
  downloadText(JSON.stringify({ format: "planilla-recovery-v1", entries }, null, 2),
    `planilla_recuperacion_${Date.now()}.json`)
}
