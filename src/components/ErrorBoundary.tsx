import { Component, type ErrorInfo, type ReactNode } from "react"

// Sans elle, une erreur de rendu démonte toute l'app et laisse une fenêtre vide.
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null; stack: string }> {
  state = { error: null as Error | null, stack: "" }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
    this.setState({ stack: info.componentStack ?? "" })
  }

  render() {
    const { error, stack } = this.state
    if (!error) return this.props.children
    return (
      <div style={{ height: "100vh", overflow: "auto", background: "#07070c", color: "#ddd", fontFamily: "system-ui, sans-serif", padding: 32 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700 }}>Aura a rencontré une erreur</h2>
        <p style={{ marginTop: 8, color: "#f88", fontFamily: "monospace", userSelect: "text" }}>{error.message}</p>
        <pre style={{ marginTop: 12, fontSize: 12, opacity: 0.6, whiteSpace: "pre-wrap", userSelect: "text" }}>{stack.trim().split("\n").slice(0, 8).join("\n")}</pre>
        <button
          onClick={() => this.setState({ error: null, stack: "" })}
          style={{ marginTop: 16, padding: "8px 18px", borderRadius: 999, border: 0, background: "#fff", color: "#000", fontWeight: 600, cursor: "pointer" }}
        >
          Réessayer
        </button>
      </div>
    )
  }
}
