import { Component, type ErrorInfo, type ReactNode } from "react"

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Última defensa ante una excepción de renderizado.
 *
 * Sin esto la pantalla queda en blanco sobre datos que solo viven en este
 * navegador, y el usuario no tiene forma de rescatarlos. Por eso lo primero que
 * ofrece la pantalla de error es descargar el respaldo: se lee directamente de
 * `localStorage`, sin pasar por el estado de React, que es justamente lo que
 * podría estar roto.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Error no controlado", error, info.componentStack)
  }

  private downloadBackup = () => {
    try {
      const raw = localStorage.getItem("planilla_data")
      if (!raw) return
      const blob = new Blob([raw], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `planilla_respaldo_${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error("No se pudo generar el respaldo", err)
    }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="min-h-screen bg-app grid place-items-center p-6">
        <div className="max-w-md w-full bg-surface border border-line rounded-2xl shadow-modal p-6 space-y-4">
          <h1 className="text-lg font-bold text-fg">
            La aplicación encontró un error
          </h1>

          <p className="text-sm text-muted leading-relaxed">
            Tus datos siguen guardados en este navegador. Antes de recargar,
            descarga un respaldo: si el error se repite, es lo que te permite
            recuperar la planilla.
          </p>

          <div className="flex gap-2">
            <button
              onClick={this.downloadBackup}
              className="flex-1 px-3 py-2 bg-brand text-brand-fg rounded-xl text-sm font-bold hover:bg-brand-hover"
            >
              Descargar respaldo
            </button>
            <button
              onClick={() => window.location.reload()}
              className="flex-1 px-3 py-2 bg-raised text-fg border border-line rounded-xl text-sm font-bold hover:bg-surface"
            >
              Recargar
            </button>
          </div>

          <details className="text-xs text-subtle">
            <summary className="cursor-pointer font-semibold">
              Detalle técnico
            </summary>
            <pre className="mt-2 whitespace-pre-wrap break-words">
              {error.message}
            </pre>
          </details>
        </div>
      </div>
    )
  }
}
