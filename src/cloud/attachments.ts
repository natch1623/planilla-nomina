import type { AppData, Attachment } from "../types"
import * as api from "./client"

/**
 * Adjuntos: comprobantes de movimientos y fotos de incapacidad.
 *
 * Con la empresa sincronizada, el archivo se sube al almacenamiento de la
 * nube y en los datos solo queda su ruta. Sin nube —o sin conexión— se sigue
 * guardando dentro del navegador como antes, y al subir la empresa se
 * traslada (ver `migrateAttachments`).
 *
 * La empresa activa se registra aquí en vez de pasarla por props: los
 * adjuntos se usan en pantallas muy adentro (Movimientos, el editor de un
 * día) y encadenar la prop por todas ellas solo para esto ensuciaría medio
 * árbol de componentes.
 */

export type AttachmentScope = "movimientos" | "incapacidades"

let activeCompanyId: string | null = null

export function setAttachmentCompany(companyId: string | null): void {
  activeCompanyId = companyId
}

/** ¿Los archivos nuevos pueden ir a la nube ahora mismo? */
export function cloudStorageReady(): boolean {
  return api.cloudAvailable && activeCompanyId !== null
}

function extensionFor(file: { name: string; type: string }): string {
  const fromName = file.name.includes(".") ? file.name.split(".").pop()! : ""
  if (fromName && fromName.length <= 5) return fromName.toLowerCase()
  const fromType = file.type.split("/")[1] ?? ""
  return fromType.slice(0, 5).toLowerCase() || "bin"
}

/**
 * Guarda un archivo y devuelve el adjunto que va a los datos. Si la nube no
 * está disponible cae al navegador, para no perder el archivo por estar sin
 * conexión.
 */
export async function saveAttachment(
  file: File,
  scope: AttachmentScope,
  readAsDataUrl: (file: File) => Promise<string>,
): Promise<Attachment> {
  const id = crypto.randomUUID()
  const base: Attachment = {
    id,
    name: file.name,
    mime: file.type,
    size: file.size,
    dataUrl: "",
    path: "",
    url: "",
  }

  if (cloudStorageReady()) {
    try {
      const path = `${activeCompanyId}/${scope}/${id}.${extensionFor(file)}`
      await api.uploadFile(path, file)
      return { ...base, path }
    } catch (err) {
      console.error("No se pudo subir el adjunto a la nube", err)
    }
  }

  return { ...base, dataUrl: await readAsDataUrl(file) }
}

/** Un enlace externo (Drive, correo) en vez de un archivo subido. */
export function linkAttachment(url: string, name: string): Attachment {
  return {
    id: crypto.randomUUID(),
    name: name.trim() || "enlace",
    mime: "",
    size: 0,
    dataUrl: "",
    path: "",
    url: url.trim(),
  }
}

/**
 * Dirección para ver o descargar el adjunto. La de la nube es firmada y
 * caduca, así que se pide en el momento y se recuerda un rato.
 */
const urlCache = new Map<string, { url: string; expires: number }>()
const SIGNED_SECONDS = 3600

export async function attachmentUrl(a: Attachment): Promise<string> {
  if (a.dataUrl) return a.dataUrl
  if (a.url) return a.url
  if (!a.path) return ""

  const cached = urlCache.get(a.path)
  if (cached && cached.expires > Date.now()) return cached.url

  const url = await api.signedUrl(a.path, SIGNED_SECONDS)
  // Se descarta antes de tiempo para no entregar un enlace recién vencido.
  urlCache.set(a.path, { url, expires: Date.now() + (SIGNED_SECONDS - 60) * 1000 })
  return url
}

/** Borra el archivo de la nube; los locales se van con el dato que los contiene. */
export async function removeAttachment(a: Attachment): Promise<void> {
  if (!a.path || !api.cloudAvailable) return
  urlCache.delete(a.path)
  try {
    await api.removeFile(a.path)
  } catch (err) {
    // Un archivo huérfano molesta menos que impedir borrar el movimiento.
    console.error("No se pudo borrar el adjunto de la nube", err)
  }
}

export function isCloudAttachment(a: Attachment): boolean {
  return Boolean(a.path)
}

/* ------------------- Traslado de los adjuntos viejos ------------------ */

/** Adjuntos que todavía viven dentro de los datos de la empresa. */
export function countInlineAttachments(data: AppData): number {
  let n = 0
  for (const t of data.transactions) n += t.attachments.filter((a) => a.dataUrl).length
  for (const e of data.timeEntries) n += e.attachments.filter((a) => a.dataUrl).length
  return n
}

/**
 * Sube al almacenamiento los adjuntos que venían dentro del JSON y deja en
 * su lugar la ruta. Es lo que hace que subir una empresa vieja a la nube no
 * arrastre las fotos en cada guardado.
 *
 * El que falla se queda como estaba: se reintenta la próxima vez, y nunca se
 * pierde el archivo.
 */
export async function migrateAttachments(
  data: AppData,
  companyId: string,
  upload: (path: string, file: File) => Promise<void> = api.uploadFile,
): Promise<{ data: AppData; moved: number; failed: number }> {
  let moved = 0
  let failed = 0

  async function move(a: Attachment, scope: AttachmentScope): Promise<Attachment> {
    if (!a.dataUrl) return a
    try {
      const file = dataUrlToFile(a)
      const path = `${companyId}/${scope}/${a.id}.${extensionFor(file)}`
      await upload(path, file)
      moved++
      return { ...a, dataUrl: "", path }
    } catch (err) {
      console.error("No se pudo trasladar un adjunto a la nube", err)
      failed++
      return a
    }
  }

  const transactions = []
  for (const t of data.transactions) {
    if (!t.attachments.some((a) => a.dataUrl)) {
      transactions.push(t)
      continue
    }
    const attachments = []
    for (const a of t.attachments) attachments.push(await move(a, "movimientos"))
    transactions.push({ ...t, attachments })
  }

  const timeEntries = []
  for (const e of data.timeEntries) {
    if (!e.attachments.some((a) => a.dataUrl)) {
      timeEntries.push(e)
      continue
    }
    const attachments = []
    for (const a of e.attachments) attachments.push(await move(a, "incapacidades"))
    timeEntries.push({ ...e, attachments })
  }

  if (moved === 0) return { data, moved, failed }
  return { data: { ...data, transactions, timeEntries }, moved, failed }
}

/** Convierte un data URL en el archivo original para poder subirlo. */
export function dataUrlToFile(a: Attachment): File {
  const [head, body] = a.dataUrl.split(",")
  const mime = /:(.*?);/.exec(head)?.[1] ?? a.mime ?? "application/octet-stream"
  const binary = atob(body ?? "")
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new File([bytes], a.name || "adjunto", { type: mime })
}
