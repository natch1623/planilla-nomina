import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { AppData } from "../types"
import { DATA_VERSION, defaultData, normalizeData } from "../store"
import * as api from "./client"
import type { CloudCompany, CloudSnapshot, RoleAccess } from "./client"
import { applySection, sectionPayload } from "./sections"
import type { Section } from "./sections"
import {
  decideRemote,
  isFromNewerApp,
  onlyLocalFieldsChanged,
  profileForCompany,
  readLinks,
  withLocalFields,
  writeLinks,
} from "./sync"
import type { CloudLink, CloudLinks } from "./sync"

export type CloudStatus =
  /** El build no trae credenciales: la nube no existe para esta app. */
  | "unavailable"
  | "signedOut"
  /** Con sesión, pero esta empresa vive solo en este equipo. */
  | "local"
  | "synced"
  /** Hay cambios esperando subir (en cola o sin conexión). */
  | "pending"
  | "saving"
  | "conflict"
  /** La nube tiene datos de una versión más nueva de la app. */
  | "outdated"
  | "readonly"
  | "error"

type Tone = "teal" | "amber" | "danger"

interface Options {
  activeId: string
  data: AppData
  setData: (data: AppData) => void
  notify: (msg: string, tone?: Tone) => void
  /** Crea un perfil local con esos datos, lo activa y devuelve su id. */
  openAsNewProfile: (data: AppData) => string
  switchProfile: (id: string) => void
  /** Borra perfiles locales (al cerrar sesión en un equipo compartido). */
  forgetProfiles: (ids: string[]) => void
  /** Secciones que esta versión de la app sabe mostrar. */
  supportedSections: Section[]
}

/** Espera tras la última edición antes de subir: agrupa una ráfaga de teclas. */
const PUSH_DELAY = 1500
/** Respaldo por si el aviso en vivo no llega (red corporativa, suspensión…). */
const POLL_EVERY = 60_000

export function useCloud({
  activeId,
  data,
  setData,
  notify,
  openAsNewProfile,
  switchProfile,
  forgetProfiles,
  supportedSections,
}: Options) {
  const available = api.cloudAvailable
  const [email, setEmail] = useState<string | null>(null)
  const [authReady, setAuthReady] = useState(!available)
  const [companies, setCompanies] = useState<CloudCompany[]>([])
  const [links, setLinksState] = useState<CloudLinks>(() => (available ? readLinks() : {}))
  const [phase, setPhase] = useState<"idle" | "saving" | "error" | "outdated">("idle")
  const [lastError, setLastError] = useState("")
  const [conflict, setConflict] = useState<CloudSnapshot | null>(null)

  const link: CloudLink | null = links[activeId] ?? null
  const company = link ? (companies.find((c) => c.id === link.companyId) ?? null) : null
  const access: RoleAccess | null = company?.access ?? null

  // Los callbacks asíncronos necesitan el valor vigente, no el de su render.
  const dataRef = useRef(data)
  dataRef.current = data
  const linksRef = useRef(links)
  linksRef.current = links
  const activeRef = useRef(activeId)
  activeRef.current = activeId
  const accessRef = useRef(access)
  accessRef.current = access
  const supportedRef = useRef(supportedSections)
  supportedRef.current = supportedSections
  const conflictRef = useRef(conflict)
  conflictRef.current = conflict
  const signedIn = email !== null
  const signedInRef = useRef(signedIn)
  signedInRef.current = signedIn

  const pushing = useRef(false)
  const pushAgain = useRef(false)
  /** Contador de ediciones: dice si hubo cambios mientras se subía. */
  const edits = useRef(0)
  /** El próximo cambio de `data` viene de la nube, no del usuario. */
  const applyingRemote = useRef(false)
  const noticeWhilePushing = useRef(false)
  const outdated = useRef(false)

  const setLinks = useCallback((update: (prev: CloudLinks) => CloudLinks) => {
    const next = update(linksRef.current)
    linksRef.current = next
    writeLinks(next)
    setLinksState(next)
  }, [])

  const patchLink = useCallback(
    (profileId: string, patch: Partial<CloudLink>) => {
      setLinks((prev) => (prev[profileId] ? { ...prev, [profileId]: { ...prev[profileId], ...patch } } : prev))
    },
    [setLinks],
  )

  const refreshCompanies = useCallback(async () => {
    if (!signedInRef.current) return
    try {
      setCompanies(await api.listCompanies())
    } catch (err) {
      console.error("No se pudo listar las empresas de la nube", err)
    }
  }, [])

  /* ------------------------------ Sesión ------------------------------ */

  useEffect(() => {
    if (!available) return
    let alive = true
    api
      .getSession()
      .then((s) => alive && setEmail(s?.user.email ?? null))
      .catch(() => {})
      .finally(() => alive && setAuthReady(true))
    const off = api.onSessionChange((s) => setEmail(s?.user.email ?? null))
    return () => {
      alive = false
      off()
    }
  }, [available])

  useEffect(() => {
    if (signedIn) void refreshCompanies()
    else setCompanies([])
  }, [signedIn, refreshCompanies])

  /* ------------------------ Aplicar la versión remota ------------------------ */

  /** Secciones de un rango que esta app sabe mostrar y guardar. */
  const usableSections = useCallback(
    (a: RoleAccess) => a.sections.filter((sec) => supportedRef.current.includes(sec)),
    [],
  )

  /**
   * Lo que este usuario puede ver de la empresa: completa si su rango lo
   * permite; si no, `base` con sus secciones encima. La revisión es la menor
   * de las leídas: si alguien guardó entre una sección y otra, la próxima
   * consulta vuelve a bajar todo en vez de quedarse con una mezcla.
   */
  const fetchSnapshot = useCallback(
    async (companyIdToRead: string, a: RoleAccess, base: AppData): Promise<CloudSnapshot> => {
      if (a.readsAll) return api.fetchCompany(companyIdToRead)
      let data: AppData = base
      let revision = Infinity
      let updatedAt = ""
      let updatedByEmail = ""
      for (const sec of usableSections(a)) {
        const part = await api.fetchSection(companyIdToRead, sec)
        data = applySection(data, sec, part.payload)
        revision = Math.min(revision, part.revision)
        updatedAt = part.updatedAt
        updatedByEmail = part.updatedByEmail
      }
      if (!Number.isFinite(revision)) {
        throw new api.CloudError("Tu rango no incluye nada que esta versión pueda mostrar.")
      }
      return { data, revision, updatedAt, updatedByEmail }
    },
    [usableSections],
  )

  const applySnapshot = useCallback(
    (snap: CloudSnapshot, profileId: string) => {
      if (isFromNewerApp(snap.data, DATA_VERSION)) {
        outdated.current = true
        setPhase("outdated")
        return
      }
      if (activeRef.current === profileId) {
        applyingRemote.current = true
        setData(normalizeData(withLocalFields(snap.data, dataRef.current)))
      }
      patchLink(profileId, { revision: snap.revision, dirty: false })
    },
    [patchLink, setData],
  )

  const checkRemote = useCallback(
    async (knownRevision?: number) => {
      const profileId = activeRef.current
      const current = linksRef.current[profileId]
      const a = accessRef.current
      if (!current || !a || !signedInRef.current || conflictRef.current || outdated.current) return
      if (pushing.current) {
        noticeWhilePushing.current = true
        return
      }
      try {
        const remoteRev = knownRevision ?? (await api.fetchRevision(current.companyId))
        // Quien no puede escribir nunca tiene cambios propios que proteger.
        const dirty = current.dirty && api.canWrite(a)
        const decision = decideRemote({ revision: current.revision, dirty }, remoteRev)
        if (decision === "ignore") return
        const snap = await fetchSnapshot(current.companyId, a, dataRef.current)
        if (activeRef.current !== profileId) return
        if (decision === "apply") {
          applySnapshot(snap, profileId)
          if (!outdated.current) {
            notify(
              snap.updatedByEmail
                ? `Datos actualizados con los cambios de ${api.displayUser(snap.updatedByEmail)}`
                : "Datos actualizados desde la nube",
            )
            void refreshCompanies()
          }
        } else {
          setConflict(snap)
        }
      } catch (err) {
        setLastError(err instanceof Error ? err.message : String(err))
        setPhase("error")
      }
    },
    [applySnapshot, fetchSnapshot, notify, refreshCompanies],
  )

  /* ------------------------------ Subir ------------------------------- */

  const push = useCallback(async () => {
    const profileId = activeRef.current
    const current = linksRef.current[profileId]
    const a = accessRef.current
    if (!current?.dirty || !signedInRef.current || conflictRef.current || outdated.current) return
    // Sin saber el rango todavía no se sube nada: podría ir por el camino
    // equivocado (empresa completa vs. secciones).
    if (!a || !api.canWrite(a)) return
    if (pushing.current) {
      pushAgain.current = true
      return
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) return

    pushing.current = true
    const editsAtStart = edits.current
    const snapshot = dataRef.current
    setPhase("saving")
    try {
      let res: api.SaveResult
      if (a.writesAll) {
        res = await api.saveCompany(current.companyId, snapshot.companyName, snapshot, current.revision)
      } else {
        // Una sección tras otra, cada una sobre la revisión que dejó la anterior.
        res = { ok: true, revision: current.revision }
        for (const sec of usableSections(a)) {
          res = await api.saveSection(current.companyId, sec, sectionPayload(sec, snapshot), res.revision)
          if (!res.ok) break
        }
      }
      if (res.ok) {
        const stillDirty = edits.current !== editsAtStart && activeRef.current === profileId
        patchLink(profileId, { revision: res.revision, dirty: stillDirty })
        setPhase("idle")
        if (stillDirty) pushAgain.current = true
      } else {
        const snap = await fetchSnapshot(current.companyId, a, dataRef.current)
        setConflict(snap)
        setPhase("idle")
      }
    } catch (err) {
      setLastError(err instanceof Error ? err.message : String(err))
      setPhase("error")
    } finally {
      pushing.current = false
    }

    if (noticeWhilePushing.current) {
      noticeWhilePushing.current = false
      void checkRemote()
    }
    if (pushAgain.current) {
      pushAgain.current = false
      setTimeout(() => void push(), PUSH_DELAY)
    }
  }, [checkRemote, fetchSnapshot, patchLink, usableSections])

  // Cada edición real marca la empresa como pendiente y agenda la subida.
  const prev = useRef({ id: activeId, data })
  useEffect(() => {
    const before = prev.current
    prev.current = { id: activeId, data }
    if (before.id !== activeId) return
    if (applyingRemote.current) {
      applyingRemote.current = false
      return
    }
    if (!linksRef.current[activeId]) return
    if (onlyLocalFieldsChanged(before.data, data)) return
    if (accessRef.current && !api.canWrite(accessRef.current)) return
    edits.current++
    if (!linksRef.current[activeId].dirty) patchLink(activeId, { dirty: true })
  }, [activeId, data, patchLink])

  const dirty = link?.dirty ?? false
  useEffect(() => {
    if (!dirty || !signedIn || conflict) return
    const t = setTimeout(() => void push(), PUSH_DELAY)
    return () => clearTimeout(t)
  }, [data, dirty, signedIn, conflict, push])

  // Al abrir una empresa vinculada: ponerse al día y escuchar a los demás.
  const companyId = link?.companyId ?? null
  // Hasta conocer el rango no se puede consultar: la empresa completa y las
  // secciones van por caminos distintos.
  const accessKnown = access !== null
  useEffect(() => {
    if (!companyId || !signedIn || !accessKnown) return
    outdated.current = false
    setPhase("idle")
    void checkRemote()
    const off = api.subscribeCompany(companyId, (rev) => void checkRemote(rev))
    const onFocus = () => {
      if (document.visibilityState === "visible") void checkRemote()
    }
    const onOnline = () => void push()
    const timer = setInterval(onFocus, POLL_EVERY)
    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onFocus)
    window.addEventListener("online", onOnline)
    return () => {
      off()
      clearInterval(timer)
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onFocus)
      window.removeEventListener("online", onOnline)
    }
  }, [companyId, signedIn, accessKnown, checkRemote, push])

  /* ------------------------------ Acciones ----------------------------- */

  const signIn = useCallback(async (mail: string, password: string) => {
    await api.signIn(mail, password)
  }, [])

  const signOut = useCallback(
    async (forgetLocal: boolean) => {
      const pendingCount = Object.values(linksRef.current).filter((l) => l.dirty).length
      await api.signOut()
      if (forgetLocal) {
        const ids = Object.keys(linksRef.current)
        setLinks(() => ({}))
        forgetProfiles(ids)
      }
      setConflict(null)
      if (pendingCount > 0 && !forgetLocal) {
        notify("Quedan cambios sin subir; se subirán al volver a iniciar sesión", "amber")
      }
    },
    [forgetProfiles, notify, setLinks],
  )

  /** Sube la empresa activa a la nube y la vincula. */
  const uploadActive = useCallback(async () => {
    const profileId = activeRef.current
    const d = dataRef.current
    const created = await api.createCompany(d.companyName, d)
    setLinks((prev) => ({ ...prev, [profileId]: { companyId: created.id, revision: created.revision, dirty: false } }))
    await refreshCompanies()
  }, [refreshCompanies, setLinks])

  /** Abre una empresa de la nube: la baja si este equipo no la tiene. */
  const openCompany = useCallback(
    async (companyIdToOpen: string) => {
      const existing = profileForCompany(linksRef.current, companyIdToOpen)
      if (existing) {
        switchProfile(existing)
        return
      }
      const target = companies.find((c) => c.id === companyIdToOpen)
      if (!target) throw new api.CloudError("No tienes acceso a esa empresa.")
      const a = target.access
      if (!a.readsAll && usableSections(a).length === 0) {
        throw new api.CloudError(
          `Tu rango (${a.label}) todavía no está disponible en esta versión de la app.`,
        )
      }
      const base: AppData = { ...defaultData, companyName: target.name }
      const snap = await fetchSnapshot(companyIdToOpen, a, base)
      if (isFromNewerApp(snap.data, DATA_VERSION)) {
        throw new api.CloudError("Esta empresa se guardó con una versión más nueva de la app. Recarga la página.")
      }
      const profileId = openAsNewProfile(normalizeData(snap.data))
      setLinks((prev) => ({ ...prev, [profileId]: { companyId: companyIdToOpen, revision: snap.revision, dirty: false } }))
    },
    [companies, fetchSnapshot, openAsNewProfile, setLinks, switchProfile, usableSections],
  )

  /** Deja de sincronizar la empresa activa; la copia local se conserva. */
  const unlinkActive = useCallback(() => {
    const profileId = activeRef.current
    setLinks((prev) => {
      const next = { ...prev }
      delete next[profileId]
      return next
    })
    setConflict(null)
    outdated.current = false
    setPhase("idle")
  }, [setLinks])

  /** Olvida el vínculo de un perfil que se borró localmente. */
  const forgetLink = useCallback(
    (profileId: string) => {
      if (!linksRef.current[profileId]) return
      setLinks((prev) => {
        const next = { ...prev }
        delete next[profileId]
        return next
      })
    },
    [setLinks],
  )

  const deleteActiveFromCloud = useCallback(async () => {
    const current = linksRef.current[activeRef.current]
    if (!current) return
    await api.deleteCompany(current.companyId)
    unlinkActive()
    await refreshCompanies()
  }, [refreshCompanies, unlinkActive])

  const resolveConflict = useCallback(
    (choice: "cloud" | "mine") => {
      const snap = conflictRef.current
      const profileId = activeRef.current
      if (!snap) return
      setConflict(null)
      if (choice === "cloud") {
        applySnapshot(snap, profileId)
        notify("Se cargó la versión de la nube")
      } else {
        // Se adopta la revisión remota como base y se sube lo local encima.
        patchLink(profileId, { revision: snap.revision, dirty: true })
        edits.current++
      }
    },
    [applySnapshot, notify, patchLink],
  )

  const retry = useCallback(() => {
    setPhase("idle")
    setLastError("")
    void checkRemote().then(() => push())
  }, [checkRemote, push])

  /* ------------------------------ Estado ------------------------------- */

  const status: CloudStatus = useMemo(() => {
    if (!available) return "unavailable"
    if (!signedIn) return "signedOut"
    if (!link) return "local"
    if (phase === "outdated") return "outdated"
    if (conflict) return "conflict"
    if (access && !api.canWrite(access)) return "readonly"
    if (phase === "error") return "error"
    if (phase === "saving") return "saving"
    if (link.dirty) return "pending"
    return "synced"
  }, [available, signedIn, link, phase, conflict, access])

  /** Empresas de la nube que este equipo todavía no tiene. */
  const remoteOnly = useMemo(
    () => companies.filter((c) => !profileForCompany(links, c.id)),
    [companies, links],
  )

  return {
    available,
    authReady,
    email,
    status,
    lastError,
    link,
    company,
    access,
    /** El rango ve solo algunas secciones, no la empresa completa. */
    restricted: link !== null && access !== null && !access.readsAll,
    companies,
    remoteOnly,
    links,
    conflict,
    signIn,
    signOut,
    uploadActive,
    openCompany,
    unlinkActive,
    forgetLink,
    deleteActiveFromCloud,
    resolveConflict,
    retry,
    refreshCompanies,
  }
}

export type Cloud = ReturnType<typeof useCloud>
