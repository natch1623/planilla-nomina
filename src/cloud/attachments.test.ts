import { describe, expect, it, vi } from "vitest"
import { defaultData, normalizeData } from "../store"
import type { AppData, Attachment, TimeEntry, Transaction } from "../types"
import { countInlineAttachments, dataUrlToFile, migrateAttachments } from "./attachments"

/** "hola" en base64. */
const DATA_URL = "data:image/png;base64,aG9sYQ=="

const inline = (id: string): Attachment => ({
  id,
  name: `${id}.png`,
  mime: "image/png",
  size: 4,
  dataUrl: DATA_URL,
  path: "",
  url: "",
})

const inCloud = (id: string): Attachment => ({
  id,
  name: `${id}.png`,
  mime: "image/png",
  size: 4,
  dataUrl: "",
  path: `empresa/movimientos/${id}.png`,
  url: "",
})

function dataWith(txAttachments: Attachment[], entryAttachments: Attachment[]): AppData {
  return {
    ...defaultData,
    transactions: [{ id: "t1", attachments: txAttachments } as unknown as Transaction],
    timeEntries: [{ id: "e1", attachments: entryAttachments } as unknown as TimeEntry],
  }
}

describe("adjuntos: traslado al almacenamiento", () => {
  it("cuenta solo los que siguen dentro de los datos", () => {
    expect(countInlineAttachments(dataWith([inline("a"), inCloud("b")], [inline("c")]))).toBe(2)
    expect(countInlineAttachments(dataWith([inCloud("b")], []))).toBe(0)
  })

  it("sube cada archivo a la carpeta que le toca y deja la ruta en su lugar", async () => {
    const upload = vi.fn().mockResolvedValue(undefined)
    const { data, moved, failed } = await migrateAttachments(
      dataWith([inline("a")], [inline("c")]),
      "emp-1",
      upload,
    )

    expect(moved).toBe(2)
    expect(failed).toBe(0)
    expect(upload.mock.calls.map((c) => c[0])).toEqual([
      "emp-1/movimientos/a.png",
      "emp-1/incapacidades/c.png",
    ])
    // El archivo ya no viaja dentro de los datos.
    expect(data.transactions[0].attachments[0]).toMatchObject({
      dataUrl: "",
      path: "emp-1/movimientos/a.png",
    })
    expect(data.timeEntries[0].attachments[0].path).toBe("emp-1/incapacidades/c.png")
  })

  it("no toca los que ya están en la nube", async () => {
    const upload = vi.fn().mockResolvedValue(undefined)
    const original = dataWith([inCloud("b")], [])
    const { data, moved } = await migrateAttachments(original, "emp-1", upload)
    expect(moved).toBe(0)
    expect(upload).not.toHaveBeenCalled()
    expect(data).toBe(original)
  })

  it("si una subida falla, ese archivo se queda en los datos y no se pierde", async () => {
    const upload = vi
      .fn()
      .mockRejectedValueOnce(new Error("sin conexión"))
      .mockResolvedValue(undefined)
    const { data, moved, failed } = await migrateAttachments(
      dataWith([inline("a"), inline("b")], []),
      "emp-1",
      upload,
    )

    expect(moved).toBe(1)
    expect(failed).toBe(1)
    expect(data.transactions[0].attachments[0].dataUrl).toBe(DATA_URL)
    expect(data.transactions[0].attachments[1].path).toBe("emp-1/movimientos/b.png")
  })

  it("reconstruye el archivo original desde el dato guardado", () => {
    const file = dataUrlToFile(inline("a"))
    expect(file.name).toBe("a.png")
    expect(file.type).toBe("image/png")
    expect(file.size).toBe(4)
  })
})

describe("adjuntos: al leer los datos guardados", () => {
  it("acepta las tres formas y descarta la que no dice dónde está el archivo", () => {
    const raw = {
      ...defaultData,
      transactions: [
        {
          id: "t1",
          date: "2026-09-01",
          amount: 10,
          attachments: [
            { id: "a", name: "a.png", dataUrl: DATA_URL },
            { id: "b", name: "b.png", path: "emp/movimientos/b.png" },
            { id: "c", name: "c", url: "https://drive.google.com/x" },
            { id: "d", name: "huerfano" },
          ],
        },
      ],
    }

    const out = normalizeData(raw)
    expect(out.transactions[0].attachments.map((a) => a.id)).toEqual(["a", "b", "c"])
  })

  it("un registro diario sin adjuntos queda con la lista vacía, no indefinida", () => {
    const out = normalizeData({
      ...defaultData,
      employees: [{ id: "e1", name: "Ana" }],
      timeEntries: [
        { id: "t1", employeeId: "e1", date: "2026-09-02", dayType: "incapacidad" },
      ],
    })
    expect(out.timeEntries[0].attachments).toEqual([])
  })
})
