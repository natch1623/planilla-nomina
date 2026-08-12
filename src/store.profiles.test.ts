import { beforeEach, describe, expect, it } from "vitest"
import {
  createProfile,
  defaultData,
  deleteProfile,
  loadIndex,
  loadProfileData,
  profileLabel,
  saveProfileData,
  syncProfileName,
} from "./store"

/** `localStorage` mínimo: el entorno de las pruebas es Node, no un navegador. */
function installStorage(): Map<string, string> {
  const store = new Map<string, string>()
  const mock: Storage = {
    get length() {
      return store.size
    },
    key: (i: number) => [...store.keys()][i] ?? null,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  }
  globalThis.localStorage = mock
  return store
}

let storage: Map<string, string>

beforeEach(() => {
  storage = installStorage()
})

const LEGACY_KEY = "planilla_data"
const INDEX_KEY = "planilla_profiles"

function dataKeys(): string[] {
  return [...storage.keys()].filter((k) => k.startsWith("planilla_data_"))
}

/* ------------------------------------------------------------------ */
/* Arranque y migración                                                */
/* ------------------------------------------------------------------ */

describe("loadIndex", () => {
  it("crea un perfil vacío en una instalación nueva", () => {
    const index = loadIndex()

    expect(index.profiles).toHaveLength(1)
    expect(index.activeId).toBe(index.profiles[0].id)
    expect(index.profiles[0].name).toBe("")
  })

  it("migra los datos de la versión sin perfiles", () => {
    storage.set(
      LEGACY_KEY,
      JSON.stringify({
        ...defaultData,
        companyName: "RyS Bioservices",
        employees: [
          {
            id: "e1",
            name: "Ana Ruiz",
            hourlyRate: 7,
            category: "empleado",
            paymentType: "hourly",
          },
        ],
      }),
    )

    const index = loadIndex()

    expect(index.profiles).toHaveLength(1)
    expect(index.profiles[0].name).toBe("RyS Bioservices")
    // Los datos viajaron al perfil, no se quedaron en la clave vieja.
    expect(loadProfileData(index.activeId).employees).toHaveLength(1)
    expect(storage.has(LEGACY_KEY)).toBe(false)
  })

  it("no vuelve a migrar en el siguiente arranque", () => {
    storage.set(LEGACY_KEY, JSON.stringify({ ...defaultData, companyName: "A" }))
    const first = loadIndex()
    const second = loadIndex()

    expect(second.activeId).toBe(first.activeId)
    expect(second.profiles).toHaveLength(1)
    expect(dataKeys()).toHaveLength(1)
  })

  it("se recupera de un índice corrupto sin quedar sin perfiles", () => {
    storage.set(INDEX_KEY, "{{ no es json")
    const index = loadIndex()

    expect(index.profiles).toHaveLength(1)
    expect(index.activeId).toBeTruthy()
  })

  it("reapunta el activo si señalaba a un perfil inexistente", () => {
    storage.set(
      INDEX_KEY,
      JSON.stringify({
        activeId: "fantasma",
        profiles: [{ id: "p1", name: "Uno" }],
      }),
    )

    expect(loadIndex().activeId).toBe("p1")
  })
})

/* ------------------------------------------------------------------ */
/* Aislamiento entre perfiles                                          */
/* ------------------------------------------------------------------ */

describe("createProfile", () => {
  it("arranca vacío y queda activo", () => {
    const created = createProfile(loadIndex(), "Laboratorios Delta")

    expect(created.index.profiles).toHaveLength(2)
    expect(created.index.activeId).toBe(created.id)
    expect(created.data.employees).toEqual([])
    expect(created.data.companyName).toBe("Laboratorios Delta")
  })

  it("recorta los espacios del nombre", () => {
    const created = createProfile(loadIndex(), "  Delta  ")
    expect(created.data.companyName).toBe("Delta")
    expect(created.index.profiles[1].name).toBe("Delta")
  })

  it("no mezcla los datos de una empresa con los de la otra", () => {
    const first = loadIndex()
    saveProfileData(first.activeId, {
      ...defaultData,
      companyName: "Empresa A",
      openingBalance: 5000,
    })

    const created = createProfile(first, "Empresa B")

    expect(loadProfileData(created.id).openingBalance).toBe(0)
    expect(loadProfileData(first.activeId).openingBalance).toBe(5000)
  })

  it("guarda cada perfil en su propia clave", () => {
    const index = createProfile(loadIndex(), "Segunda").index
    expect(dataKeys()).toHaveLength(2)
    expect(index.profiles).toHaveLength(2)
  })
})

/* ------------------------------------------------------------------ */
/* Nombre y borrado                                                    */
/* ------------------------------------------------------------------ */

describe("syncProfileName", () => {
  it("actualiza el índice cuando cambia el nombre de la empresa", () => {
    const index = loadIndex()
    const next = syncProfileName(index, index.activeId, "Nuevo nombre")

    expect(next?.profiles[0].name).toBe("Nuevo nombre")
  })

  it("no hace nada si el nombre no cambió", () => {
    const index = createProfile(loadIndex(), "Igual").index
    expect(syncProfileName(index, index.activeId, "Igual")).toBeNull()
  })

  it("ignora un perfil que ya no existe", () => {
    expect(syncProfileName(loadIndex(), "fantasma", "X")).toBeNull()
  })
})

describe("profileLabel", () => {
  it("nombra los perfiles sin nombre", () => {
    expect(profileLabel({ id: "p", name: "" })).toBe("Sin nombre")
    expect(profileLabel({ id: "p", name: "   " })).toBe("Sin nombre")
    expect(profileLabel(undefined)).toBe("Sin nombre")
  })

  it("respeta el nombre cuando lo hay", () => {
    expect(profileLabel({ id: "p", name: "Delta" })).toBe("Delta")
  })
})

describe("deleteProfile", () => {
  it("borra el perfil y sus datos", () => {
    const created = createProfile(loadIndex(), "Delta")
    const next = deleteProfile(created.index, created.id)

    expect(next?.profiles).toHaveLength(1)
    expect(dataKeys()).toHaveLength(1)
  })

  it("nunca borra el último perfil", () => {
    const index = loadIndex()

    expect(deleteProfile(index, index.activeId)).toBeNull()
    // Y sus datos siguen ahí: quedarse sin ningún perfil sería irrecuperable.
    expect(dataKeys()).toHaveLength(1)
    expect(storage.has(INDEX_KEY)).toBe(true)
  })

  it("mueve el activo al que queda si se borra el que estaba en uso", () => {
    const created = createProfile(loadIndex(), "Delta")
    const survivorId = created.index.profiles[0].id
    const next = deleteProfile(created.index, created.id)

    expect(next?.activeId).toBe(survivorId)
  })

  it("no toca el activo si se borra otro perfil", () => {
    const created = createProfile(loadIndex(), "Delta")
    const otherId = created.index.profiles[0].id
    const next = deleteProfile(created.index, otherId)

    expect(next?.activeId).toBe(created.id)
  })

  it("ignora un id que no existe", () => {
    const created = createProfile(loadIndex(), "Delta")
    expect(deleteProfile(created.index, "fantasma")).toBeNull()
  })
})
