import React from "react"
import ReactDOM from "react-dom/client"
import "./index.css"
import { backendReady } from "./services"
import { bootStep } from "./services/tauriBackend"
import ErrorBoundary from "./components/ErrorBoundary"

// Les stores lisent l'état du lecteur dès leur import : on attend le backend avant de charger l'app.
const root = ReactDOM.createRoot(document.getElementById("root")!)
let started = false
let uiStep = ""

function fail(title: string, detail: string) {
  root.render(
    <div style={{ display: "grid", placeItems: "center", height: "100vh", background: "#07070c", color: "#ccc", fontFamily: "system-ui, sans-serif", padding: 24, textAlign: "center" }}>
      <div>
        <h2>{title}</h2>
        <p style={{ opacity: 0.7 }}>{detail}</p>
        <button onClick={() => location.reload()} style={{ marginTop: 12, padding: "8px 18px", borderRadius: 999, border: 0, background: "#fff", color: "#000", fontWeight: 600, cursor: "pointer" }}>
          Réessayer
        </button>
      </div>
    </div>,
  )
}

// Jamais d'écran vide : au bout de 20 s on affiche l'étape bloquée.
setTimeout(() => {
  if (!started) fail("Démarrage bloqué", `Étape : ${uiStep || bootStep}`)
}, 20000)

backendReady
  .then(() => {
    uiStep = "chargement de l'interface"
    return import("./App")
  })
  .then(({ default: App }) => {
    started = true
    root.render(
      <React.StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </React.StrictMode>,
    )
  })
  .catch((e) => {
    console.error(e)
    started = true
    fail("Moteur audio indisponible", e instanceof Error ? e.message : String(e))
  })
