import { useEffect, useState } from "react"
import type { Attachment } from "../types"
import {
  attachmentUrl,
  cloudStorageReady,
  linkAttachment,
  saveAttachment,
} from "../cloud/attachments"
import type { AttachmentScope } from "../cloud/attachments"
import Icon from "./Icon"
import { Button, IconButton, inputClass } from "./ui"
import type { Tone } from "./ui"

/**
 * Lista y alta de adjuntos, compartida por los comprobantes de Contabilidad y
 * las fotos de incapacidad del Registro Diario.
 *
 * Un archivo guardado en la nube no tiene una dirección fija: se pide un
 * enlace firmado cada vez y caduca, así que la fila resuelve su enlace al
 * montarse en vez de recibirlo hecho.
 */

/** Tope cuando el archivo se guarda en el navegador: ahí el espacio es escaso. */
export const MAX_LOCAL_BYTES = 400 * 1024
/** Tope cuando va al almacenamiento de la nube. */
export const MAX_CLOUD_BYTES = 5 * 1024 * 1024

export function maxAttachmentBytes(): number {
  return cloudStorageReady() ? MAX_CLOUD_BYTES : MAX_LOCAL_BYTES
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"))
    reader.readAsDataURL(file)
  })
}

function AttachmentRow({
  attachment,
  onRemove,
}: {
  attachment: Attachment
  onRemove?: () => void
}) {
  const [href, setHref] = useState("")
  const [error, setError] = useState(false)

  useEffect(() => {
    let alive = true
    setError(false)
    attachmentUrl(attachment)
      .then((url) => alive && setHref(url))
      .catch(() => alive && setError(true))
    return () => {
      alive = false
    }
  }, [attachment])

  const size = attachment.size > 0 ? `${Math.max(1, Math.round(attachment.size / 1024))} KB` : ""

  return (
    <div className="flex items-center gap-2 rounded-xl border border-line px-3 py-2">
      <Icon
        name={attachment.url ? "document" : "paperclip"}
        className="w-4 h-4 shrink-0 text-muted"
      />
      {error ? (
        <span className="text-xs text-danger truncate flex-1">
          {attachment.name} · sin permiso para verlo
        </span>
      ) : href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          download={attachment.url ? undefined : attachment.name}
          className="text-xs text-brand truncate flex-1 hover:underline"
        >
          {attachment.name}
        </a>
      ) : (
        <span className="text-xs text-muted truncate flex-1">{attachment.name}…</span>
      )}
      {size && <span className="text-[11px] text-subtle shrink-0">{size}</span>}
      {onRemove && (
        <IconButton icon="trash" tone="danger" label={`Quitar ${attachment.name}`} onClick={onRemove} />
      )}
    </div>
  )
}

export function AttachmentList({
  items,
  onRemove,
}: {
  items: Attachment[]
  onRemove?: (a: Attachment) => void
}) {
  if (items.length === 0) return null
  return (
    <div className="space-y-1.5 mb-2">
      {items.map((a) => (
        <AttachmentRow
          key={a.id}
          attachment={a}
          onRemove={onRemove ? () => onRemove(a) : undefined}
        />
      ))}
    </div>
  )
}

export function AttachmentPicker({
  scope,
  max,
  current,
  accept = "image/*,application/pdf",
  onAdd,
  onNotify,
}: {
  scope: AttachmentScope
  /** Cuántos adjuntos admite en total el dato que los contiene. */
  max: number
  current: number
  accept?: string
  onAdd: (added: Attachment[]) => void
  onNotify: (text: string, tone?: Tone) => void
}) {
  const [busy, setBusy] = useState(false)
  const [linking, setLinking] = useState(false)
  const [url, setUrl] = useState("")
  const [name, setName] = useState("")
  const limit = maxAttachmentBytes()
  const inCloud = cloudStorageReady()

  async function handleFiles(files: FileList | null, input: HTMLInputElement) {
    if (!files || files.length === 0) return
    const room = max - current
    if (room <= 0) {
      onNotify(`Máximo ${max} archivos`, "amber")
      return
    }

    setBusy(true)
    const accepted: Attachment[] = []
    for (const file of [...files].slice(0, room)) {
      if (file.size > limit) {
        onNotify(
          `«${file.name}» pesa demasiado (máximo ${Math.round(limit / 1024 / (limit >= 1024 * 1024 ? 1024 : 1))} ${limit >= 1024 * 1024 ? "MB" : "KB"})`,
          "amber",
        )
        continue
      }
      accepted.push(await saveAttachment(file, scope, readAsDataUrl))
    }
    setBusy(false)
    input.value = ""
    if (accepted.length === 0) return
    onAdd(accepted)
    if (!inCloud && accepted.some((a) => a.dataUrl)) {
      onNotify("Guardado en este navegador; al subir la empresa pasa a la nube", "amber")
    }
  }

  return (
    <div className="space-y-2">
      <input
        type="file"
        multiple
        accept={accept}
        disabled={busy || current >= max}
        onChange={(e) => void handleFiles(e.target.files, e.target)}
        className="block w-full text-xs text-muted file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-raised file:text-fg file:font-semibold file:cursor-pointer disabled:opacity-50"
      />

      {linking ? (
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://drive.google.com/…"
            className={`${inputClass} flex-1`}
            aria-label="Dirección del documento"
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre"
            className={`${inputClass} sm:w-40`}
            aria-label="Nombre del documento"
          />
          <Button
            variant="primary"
            size="sm"
            disabled={!/^https?:\/\//i.test(url.trim())}
            onClick={() => {
              onAdd([linkAttachment(url, name)])
              setUrl("")
              setName("")
              setLinking(false)
            }}
          >
            Agregar
          </Button>
          <Button size="sm" onClick={() => setLinking(false)}>
            Cancelar
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setLinking(true)}
          disabled={current >= max}
          className="text-xs font-semibold text-brand hover:underline disabled:opacity-50"
        >
          o pegar el enlace de un documento
        </button>
      )}

      <p className="text-[11px] text-subtle">
        {busy
          ? "Subiendo…"
          : inCloud
            ? `Se guardan en la nube y los ve el resto del equipo. Hasta ${Math.round(MAX_CLOUD_BYTES / 1024 / 1024)} MB por archivo.`
            : `Se guardan en este navegador hasta que la empresa se suba a la nube. Hasta ${Math.round(MAX_LOCAL_BYTES / 1024)} KB por archivo.`}
      </p>
    </div>
  )
}
