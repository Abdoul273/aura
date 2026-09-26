import React from "react"
import ReactDOM from "react-dom/client"
import "./index.css"
import { backendReady } from "./services"

// Les stores lisent l'état du lecteur dès leur import : on attend le backend avant de charger l'app.
const root = ReactDOM.createRoot(document.getElementById("root")!)

backendReady
  .then(() => import("./App"))
  .then(({ default: App }) =>
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    ),
  )
  .catch((e) => {
    console.error(e)
    root.render(
      <div style={{ display: "grid", placeItems: "center", height: "100vh", color: "#ccc", fontFamily: "sans-serif", padding: 24, textAlign: "center" }}>
        <div>
          <h2>Moteur audio indisponible</h2>
          <p style={{ opacity: 0.7 }}>{e instanceof Error ? e.message : String(e)}</p>
        </div>
      </div>,
    )
  })
