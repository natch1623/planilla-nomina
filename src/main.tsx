import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import ErrorBoundary from "./components/ErrorBoundary"
import StorageGate from "./components/StorageGate"
import "./index.css"

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <StorageGate><ErrorBoundary>
      <App />
    </ErrorBoundary></StorageGate>
  </React.StrictMode>,
)
