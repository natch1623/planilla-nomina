import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { AppData } from "../types"
import { DATA_VERSION, decodeStoredData, defaultData, loadProfileData, mergeAppData, normalizeData, saveProfileData, storageFailure } from "../store"
import type { MergePreview, MergeWinner } from "../store"
import * as api from "./client"
import type { CloudCompany, CloudSnapshot, RoleAccess } from "./client"
import { countInlineAttachments, migrateAttachments, setAttachmentCompany } from "./attachments"
import { applySection, sectionPayload } from "./sections"
import type { Section } from "./sections"
import {
  decideRemote,
  findMergeCandidates,
  isFromNewerApp,
  mergeKey,
  onlyLocalFieldsChanged,
  profileForCompany,
  readDismissedMerges,
  readLinks,
  withLocalFields,
  writeDismissedMerges,
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
  onStorageError?: (error: unknown) => void
  /** Un error local detiene toda sincronización; no hay fallback vacío. */
  enabled?: boolean
  /** El documento actual debe estar guardado localmente antes de subirlo. */
  persisted?: boolean
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
  /** Perfiles de este equipo, para encontrar copias locales de la nube. */
  profiles: { id: string; name: string }[]
  /**
   * Deja `data` en el perfil `keepId`, lo activa y borra `dropId` (la copia
   * local que ya quedó fusionada).
   */
  adoptMerged: (keepId: string, data: AppData, dropId: string | null) => void
}

/** Espera tras la última edición antes de subir: agrupa una ráfaga de teclas. */
const PUSH_DELAY = 1500
/** Respaldo por si el aviso en vivo no llega (red corporativa, suspensión…). */
const POLL_EVERY = 60_000

export function useCloud({
  onStorageError,
  enabled = true,
  persisted = true,
  activeId,
  data,
  setData,
  notify,
  openAsNewProfile,
  switchProfile,
  forgetProfiles,
  supportedSections,
  profiles,
  adoptMerged,
}: Options) {
  const available = api.cloudAvailable
  const [email, setEmail] = useState<string | null>(null)
  const [authReady, setAuthReady] = useState(!available)
  const [companies, setCompanies] = useState<CloudCompany[]>([])
  const [links, setLinksState] = useState<CloudLinks>(() => (available ? readLinks() : {}))
  const [phase, setPhase] = useState<"idle" | "saving" | "error" | "outdated">("idle")
  const [lastError, setLastError] = useState("")
  type Context = { profileId: string; companyId: string | null; generation: number }
  const [conflict, setConflict] = useState<(CloudSnapshot & { context: Context }) | null>(null)

  const link: CloudLink | null = links[activeId] ?? null
  const company = link ? (companies.find((c) => c.id === link.companyId) ?? null) : null
  const access: RoleAccess | null = company?.access ?? null
  const identity = `${activeId}:${link?.companyId ?? ""}:${email ?? ""}:${JSON.stringify(access)}`
  const context = useRef({ identity, generation: 0 })
  if (context.current.identity !== identity) context.current = { identity, generation: context.current.generation + 1 }
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const persistedRef = useRef(persisted)
  persistedRef.current = persisted
  const storageErrorRef = useRef(onStorageError)
  storageErrorRef.current = onStorageError

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
  const accountRef = useRef(email)
  accountRef.current = email
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; context.current.generation++ }
  }, [])

  const pushing = useRef(false)
  const pushAgain = useRef(false)
  /** Contador de ediciones: dice si hubo cambios mientras se subía. */
  const edits = useRef(0)
  /** El próximo cambio de `data` viene de la nube, no del usuario. */
  const applyingRemote = useRef<AppData | null>(null)
  const noticeWhilePushing = useRef(false)
  const outdated = useRef(false)
  const storageBlocked = useRef(false)
  const capture = useCallback((): Context => ({ profileId: activeRef.current, companyId: linksRef.current[activeRef.current]?.companyId ?? null, generation: context.current.generation }), [])
  const isCurrent = useCallback((c: Context) => mounted.current && enabledRef.current && !storageBlocked.current && c.generation === context.current.generation && c.profileId === activeRef.current && c.companyId === (linksRef.current[c.profileId]?.companyId ?? null), [])
  const checkSequence = useRef(0)

  const setLinks = useCallback((update: (prev: CloudLinks) => CloudLinks) => {
    const next = update(linksRef.current)
    try { writeLinks(next) }
    catch (err) {
      storageBlocked.current = true
      setLastError(err instanceof Error ? err.message : String(err))
      setPhase("error")
      storageErrorRef.current?.(err)
      throw err
    }
    linksRef.current = next
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
      const account = accountRef.current
      const result = await api.listCompanies()
      if (mounted.current && account && account === accountRef.current) setCompanies(result)
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
      let revision: number | null = null
      let updatedAt = ""
      let updatedByEmail = ""
      for (const sec of usableSections(a)) {
        const part = await api.fetchSection(companyIdToRead, sec)
        data = applySection(data, sec, part.payload)
        if (revision !== null && revision !== part.revision) throw new api.CloudError("La empresa cambió durante la descarga. Vuelve a intentar.")
        revision = part.revision
        updatedAt = part.updatedAt
        updatedByEmail = part.updatedByEmail
      }
      if (revision === null) {
        throw new api.CloudError("Tu rango no incluye nada que esta versión pueda mostrar.")
      }
      return { data, revision, updatedAt, updatedByEmail }
    },
    [usableSections],
  )

  const applySnapshot = useCallback(
    (snap: CloudSnapshot, operation: Context) => {
      if (!isCurrent(operation)) return
      if (isFromNewerApp(snap.data, DATA_VERSION)) {
        outdated.current = true
        setPhase("outdated")
        return
      }
      const next = decodeStoredData(JSON.stringify(withLocalFields(snap.data, dataRef.current)))
      if (!saveProfileData(operation.profileId, next, "cloud")) {
        const err = storageFailure()!
        storageBlocked.current = true
        setLastError(err.message)
        setPhase("error")
        storageErrorRef.current?.(err)
        throw err
      }
      applyingRemote.current = next
      dataRef.current = next
      setData(next)
      patchLink(operation.profileId, { revision: snap.revision, dirty: false })
    },
    [isCurrent, patchLink, setData],
  )

  const checkRemote = useCallback(
    async (knownRevision?: number) => {
      const profileId = activeRef.current
      const current = linksRef.current[profileId]
      const a = accessRef.current
      if (!enabledRef.current || storageBlocked.current || !current || !a || !signedInRef.current || conflictRef.current || outdated.current) return
      const operation = capture()
      const sequence = ++checkSequence.current
      const dataAtStart = dataRef.current
      if (pushing.current) {
        noticeWhilePushing.current = true
        return
      }
      try {
        const remoteRev = knownRevision ?? (await api.fetchRevision(current.companyId))
        if (!isCurrent(operation) || sequence !== checkSequence.current) return
        // Quien no puede escribir nunca tiene cambios propios que proteger.
        const dirty = (linksRef.current[profileId]?.dirty || !onlyLocalFieldsChanged(dataAtStart, dataRef.current)) && api.canWrite(a)
        const decision = decideRemote({ revision: current.revision, dirty }, remoteRev)
        if (decision === "ignore") return
        const snap = await fetchSnapshot(current.companyId, a, dataAtStart)
        if (!isCurrent(operation) || sequence !== checkSequence.current) return
        if (snap.revision < remoteRev) throw new api.CloudError("La descarga no incluye la revisión esperada. Vuelve a intentar.")
        if (isFromNewerApp(snap.data, DATA_VERSION)) { outdated.current = true; setPhase("outdated"); return }
        const changed = api.canWrite(a) && (!onlyLocalFieldsChanged(dataAtStart, dataRef.current) || linksRef.current[profileId]?.dirty)
        if (decision === "apply" && !changed) {
          applySnapshot(snap, operation)
          if (!outdated.current) {
            notify(
              snap.updatedByEmail
                ? `Datos actualizados con los cambios de ${api.displayUser(snap.updatedByEmail)}`
                : "Datos actualizados desde la nube",
            )
            void refreshCompanies()
          }
        } else {
          setConflict({ ...snap, context: operation })
        }
      } catch (err) {
        if (!isCurrent(operation)) return
        setLastError(err instanceof Error ? err.message : String(err))
        setPhase("error")
      }
    },
    [applySnapshot, capture, fetchSnapshot, isCurrent, notify, refreshCompanies],
  )

  /* ------------------------------ Subir ------------------------------- */

  const push = useCallback(async () => {
    const profileId = activeRef.current
    const current = linksRef.current[profileId]
    const a = accessRef.current
    if (!enabledRef.current || storageBlocked.current || !persistedRef.current || !current?.dirty || !signedInRef.current || conflictRef.current || outdated.current) return
    const operation = capture()
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
          if (!isCurrent(operation)) return
          res = await api.saveSection(current.companyId, sec, sectionPayload(sec, snapshot), res.revision)
          if (!res.ok) break
        }
      }
      if (!isCurrent(operation)) return
      if (res.ok) {
        const stillDirty = edits.current !== editsAtStart || !onlyLocalFieldsChanged(snapshot, dataRef.current)
        patchLink(profileId, { revision: res.revision, dirty: stillDirty })
        setPhase("idle")
        if (stillDirty) pushAgain.current = true
      } else {
        const snap = await fetchSnapshot(current.companyId, a, snapshot)
        if (!isCurrent(operation)) return
        if (isFromNewerApp(snap.data, DATA_VERSION)) { outdated.current = true; setPhase("outdated"); return }
        setConflict({ ...snap, context: operation })
        setPhase("idle")
      }
    } catch (err) {
      if (!isCurrent(operation)) return
      setLastError(err instanceof Error ? err.message : String(err))
      setPhase("error")
    } finally {
      pushing.current = false
      if (mounted.current && noticeWhilePushing.current) {
        noticeWhilePushing.current = false
        void checkRemote()
      }
      if (mounted.current && pushAgain.current) {
        pushAgain.current = false
        setTimeout(() => { if (mounted.current) void push() }, PUSH_DELAY)
      }
    }
  }, [capture, checkRemote, fetchSnapshot, isCurrent, patchLink, usableSections])

  // Cada edición real marca la empresa como pendiente y agenda la subida.
  const prev = useRef({ id: activeId, data })
  useEffect(() => {
    const before = prev.current
    prev.current = { id: activeId, data }
    if (before.id !== activeId) { applyingRemote.current = null; return }
    if (applyingRemote.current === data) {
      applyingRemote.current = null
      return
    }
    applyingRemote.current = null
    if (!linksRef.current[activeId]) return
    if (onlyLocalFieldsChanged(before.data, data)) return
    if (accessRef.current && !api.canWrite(accessRef.current)) return
    edits.current++
    if (!linksRef.current[activeId].dirty) {
      try { patchLink(activeId, { dirty: true }) }
      catch (err) { setLastError(err instanceof Error ? err.message : String(err)); setPhase("error") }
    }
  }, [activeId, data, patchLink])

  const dirty = link?.dirty ?? false
  useEffect(() => {
    if (!enabled || !persisted || !dirty || !signedIn || conflict) return
    const t = setTimeout(() => void push(), PUSH_DELAY)
    return () => clearTimeout(t)
  }, [data, dirty, signedIn, conflict, push, enabled, persisted])

  // Al abrir una empresa vinculada: ponerse al día y escuchar a los demás.
  /**
   * Traslada al almacenamiento los adjuntos que todavía viajan dentro del
   * JSON. Se hace una vez por empresa vinculada: a partir de ahí cada
   * guardado deja de arrastrar las fotos.
   */
  const migrating = useRef(false)
  const moveInlineAttachments = useCallback(async () => {
    const profileId = activeRef.current
    const current = linksRef.current[profileId]
    const a = accessRef.current
    if (!enabledRef.current || !current || !a || !api.canWrite(a) || !a.writesAll) return
    if (migrating.current) return
    if (countInlineAttachments(dataRef.current) === 0) return

    migrating.current = true
    const operation = capture()
    const base = dataRef.current
    try {
      const res = await migrateAttachments(base, current.companyId)
      if (!isCurrent(operation) || dataRef.current !== base) return
      if (res.moved > 0) {
        // Cambian los datos, así que el guardado normal sube las rutas.
        setData(res.data)
        notify(
          `${res.moved} ${res.moved === 1 ? "adjunto trasladado" : "adjuntos trasladados"} al almacenamiento de la nube`,
        )
      }
      if (res.failed > 0) {
        notify(`Quedaron ${res.failed} adjuntos sin trasladar; se reintenta luego`, "amber")
      }
    } catch (err) {
      console.error("Falló el traslado de adjuntos", err)
    } finally {
      migrating.current = false
    }
  }, [capture, isCurrent, notify, setData])

  const companyId = link?.companyId ?? null
  // Hasta conocer el rango no se puede consultar: la empresa completa y las
  // secciones van por caminos distintos.
  const accessKnown = access !== null
  // Los adjuntos nuevos van al almacenamiento de la empresa sincronizada.
  useEffect(() => {
    setAttachmentCompany(signedIn ? companyId : null)
    return () => setAttachmentCompany(null)
  }, [companyId, signedIn])

  useEffect(() => {
    setConflict(null)
    conflictRef.current = null
    outdated.current = false
    setPhase("idle")
    if (!enabled || !companyId || !signedIn || !accessKnown) return
    outdated.current = false
    setPhase("idle")
    void checkRemote()
    void moveInlineAttachments()
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
  }, [activeId, companyId, email, enabled, signedIn, accessKnown, checkRemote, push, moveInlineAttachments])

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
    if (!enabledRef.current || !persistedRef.current) throw new api.CloudError("Primero deben guardarse los cambios en este equipo.")
    const operation = capture()
    const profileId = activeRef.current
    const d = dataRef.current
    const created = await api.createCompany(d.companyName, d)
    if (!isCurrent(operation)) { await refreshCompanies(); return }
    setLinks((prev) => ({ ...prev, [profileId]: { companyId: created.id, revision: created.revision, dirty: dataRef.current !== d } }))
    setAttachmentCompany(created.id)
    await refreshCompanies()
    await moveInlineAttachments()
  }, [capture, isCurrent, moveInlineAttachments, refreshCompanies, setLinks])

  /** Abre una empresa de la nube: la baja si este equipo no la tiene. */
  const openCompany = useCallback(
    async (companyIdToOpen: string) => {
      const operation = capture()
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
      if (!isCurrent(operation)) return
      if (isFromNewerApp(snap.data, DATA_VERSION)) {
        throw new api.CloudError("Esta empresa se guardó con una versión más nueva de la app. Recarga la página.")
      }
      const profileId = openAsNewProfile(decodeStoredData(JSON.stringify(snap.data)))
      setLinks((prev) => ({ ...prev, [profileId]: { companyId: companyIdToOpen, revision: snap.revision, dirty: false } }))
    },
    [capture, companies, fetchSnapshot, isCurrent, openAsNewProfile, setLinks, switchProfile, usableSections],
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
    const operation = capture()
    const current = linksRef.current[activeRef.current]
    if (!current) return
    await api.deleteCompany(current.companyId)
    if (isCurrent(operation)) unlinkActive()
    await refreshCompanies()
  }, [capture, isCurrent, refreshCompanies, unlinkActive])

  const resolveConflict = useCallback(
    (choice: "cloud" | "mine") => {
      const snap = conflictRef.current
      const profileId = activeRef.current
      if (!snap || !isCurrent(snap.context)) { setConflict(null); return }
      try {
      if (choice === "cloud") {
        applySnapshot(snap, snap.context)
        notify("Se cargó la versión de la nube")
      } else {
        // Se adopta la revisión remota como base y se sube lo local encima.
        patchLink(profileId, { revision: snap.revision, dirty: true })
        edits.current++
      }
      setConflict(null)
      } catch (err) { setLastError(err instanceof Error ? err.message : String(err)); setPhase("error") }
    },
    [applySnapshot, isCurrent, notify, patchLink],
  )

  /* ---------------------- Fusionar copia local y nube ---------------------- */

  const [dismissedMerges, setDismissedMerges] = useState<string[]>(() =>
    available ? readDismissedMerges() : [],
  )

  /** Copias solo-locales con el mismo nombre que una empresa de la nube. */
  const mergeCandidates = useMemo(
    () => findMergeCandidates(profiles, links, companies, dismissedMerges),
    [profiles, links, companies, dismissedMerges],
  )

  /** "Mantener separadas": no volver a proponer este par. */
  const dismissMerge = useCallback((profileId: string, companyId: string) => {
    setDismissedMerges((prev) => {
      const next = [...prev, mergeKey(profileId, companyId)]
      writeDismissedMerges(next)
      return next
    })
  }, [])

  const profileData = useCallback(
    (profileId: string) => (profileId === activeRef.current ? dataRef.current : loadProfileData(profileId)),
    [],
  )

  const fullAccessCompany = useCallback(
    (companyIdToMerge: string) => {
      const target = companies.find((c) => c.id === companyIdToMerge)
      if (!target || !target.access.readsAll || !target.access.writesAll) {
        throw new api.CloudError("Para fusionar necesitas poder editar la empresa completa en la nube.")
      }
      return target
    },
    [companies],
  )

  /** Qué agregaría la copia local a la de la nube, sin guardar nada. */
  const previewMerge = useCallback(
    async (profileId: string, companyIdToMerge: string): Promise<MergePreview> => {
      fullAccessCompany(companyIdToMerge)
      const snap = await api.fetchCompany(companyIdToMerge)
      return mergeAppData(normalizeData(snap.data), profileData(profileId)).preview
    },
    [fullAccessCompany, profileData],
  )

  /**
   * Junta una copia solo-local con la empresa de la nube y sube el resultado.
   * La configuración (tarifas, nombre…) queda la de la nube; `winner` decide
   * qué versión queda cuando el mismo dato está en ambas.
   */
  const mergeLocal = useCallback(
    async (profileId: string, companyIdToMerge: string, winner: "cloud" | "local") => {
      if (!enabledRef.current || !persistedRef.current) throw new api.CloudError("Primero deben guardarse los cambios en este equipo.")
      const operation = capture()
      const dataAtStart = dataRef.current
      fullAccessCompany(companyIdToMerge)
      if (linksRef.current[profileId]) {
        throw new api.CloudError("Esa empresa de este equipo ya está vinculada a la nube.")
      }
      const linkedId = profileForCompany(linksRef.current, companyIdToMerge)
      if (linkedId && linksRef.current[linkedId].dirty) {
        throw new api.CloudError(
          "La copia sincronizada de esta empresa tiene cambios sin subir. Espera a que termine de subir y vuelve a intentar.",
        )
      }
      const local = profileData(profileId)
      const unchanged = () => {
        if (!isCurrent(operation) || dataRef.current !== dataAtStart || linksRef.current[profileId] || (linkedId && linksRef.current[linkedId]?.dirty)) {
          throw new api.CloudError("Los datos o la empresa activa cambiaron durante la fusión. Tus cambios locales se conservan; vuelve a revisar las versiones.")
        }
      }
      const prefer: MergeWinner = winner === "cloud" ? "current" : "incoming"

      // Si alguien guarda justo en medio, se vuelve a leer y a fusionar.
      for (let attempt = 0; attempt < 3; attempt++) {
        const snap = await api.fetchCompany(companyIdToMerge)
        unchanged()
        if (isFromNewerApp(snap.data, DATA_VERSION)) {
          throw new api.CloudError("La nube tiene datos de una versión más nueva de la app. Recarga la página.")
        }
        const merged = mergeAppData(normalizeData(snap.data), local, prefer).data
        const res = await api.saveCompany(companyIdToMerge, merged.companyName, merged, snap.revision)
        if (!res.ok) continue
        unchanged()

        const keepId = linkedId ?? profileId
        const dropId = linkedId ? profileId : null
        // Lo que se muestra ya es lo que está en la nube: no hay nada que subir.
        const adopted = normalizeData(withLocalFields(merged, local))
        if (keepId === activeRef.current) applyingRemote.current = adopted
        adoptMerged(keepId, adopted, dropId)
        setLinks((prev) => ({ ...prev, [keepId]: { companyId: companyIdToMerge, revision: res.revision, dirty: false } }))
        await refreshCompanies()
        return
      }
      throw new api.CloudError("Alguien está guardando esta empresa ahora mismo. Intenta de nuevo en un momento.")
    },
    [adoptMerged, capture, fullAccessCompany, isCurrent, profileData, refreshCompanies, setLinks],
  )

  const retry = useCallback(() => {
    if (storageBlocked.current) { notify("Descarga tus cambios y recarga para comprobar el almacenamiento.", "amber"); return }
    setPhase("idle")
    setLastError("")
    void checkRemote().then(() => push())
  }, [checkRemote, notify, push])

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
    activeProfileId: activeId,
    activeProfileName: profiles.find((p) => p.id === activeId)?.name ?? "",
    mergeCandidates,
    dismissMerge,
    previewMerge,
    mergeLocal,
  }
}

export type Cloud = ReturnType<typeof useCloud>
