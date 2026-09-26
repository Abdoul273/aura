import { useEffect, useState } from "react"
import {
  Home, Search, Library, ListMusic, Disc3, Users, Folder, Radio, Heart, BarChart3,
  Plus, PanelLeftClose, PanelLeft, Music2, Download,
} from "lucide-react"
import { useUI, type Route } from "../../store/uiStore"
import { useSettings } from "../../store/settingsStore"
import { usePlaylists } from "../../store/playlistStore"
import CoverArt from "../../components/CoverArt"
import Tooltip from "../../components/Tooltip"
import OutputStatusChip from "../../components/OutputStatusChip"
import { cn } from "../../utils/cn"

function NavItem({ icon: Icon, label, title, active, collapsed, onClick, indent, onDrop }: any) {
  const [over, setOver] = useState(false)
  const btn = (
    <button
      onClick={onClick}
      onDragOver={onDrop ? (e) => { e.preventDefault(); setOver(true) } : undefined}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop ? (e) => { onDrop(e); setOver(false) } : undefined}
      className={cn(
        "focus-ring relative flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors",
        collapsed && "justify-center px-0",
        active ? "text-hi" : "text-mid hover:text-hi hover:bg-white/6",
        over && "ring-2",
        indent && !collapsed && "pl-3",
      )}
      style={{ ...(active ? { background: "color-mix(in srgb, var(--accent) 18%, transparent)" } : {}), ...(over ? { boxShadow: "0 0 0 2px var(--accent) inset" } : {}) }}
    >
      {active && !collapsed && <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full" style={{ background: "var(--accent)" }} />}
      {Icon ? <Icon size={18} className="shrink-0" style={active ? { color: "var(--accent)" } : undefined} /> : null}
      {!collapsed && <span className="truncate">{label}</span>}
    </button>
  )
  return collapsed ? <Tooltip label={title ?? label} side="bottom">{btn}</Tooltip> : btn
}

export default function Sidebar() {
  const route = useUI((s) => s.route)
  const navigate = useUI((s) => s.navigate)
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  const { playlists, load, create, addTracks } = usePlaylists()
  const collapsed = settings?.sidebarCollapsed ?? false

  useEffect(() => {
    load()
  }, [])

  const is = (r: Route["name"]) => route.name === r
  const go = (r: Route) => navigate(r)

  const primary = [
    { icon: Home, label: "Accueil", r: { name: "home" } as Route },
    { icon: Search, label: "Recherche", r: { name: "search" } as Route },
    { icon: Download, label: "Télécharger", r: { name: "download" } as Route },
  ]
  const library = [
    { icon: ListMusic, label: "Titres", r: { name: "tracks" } as Route },
    { icon: Disc3, label: "Albums", r: { name: "albums" } as Route },
    { icon: Users, label: "Artistes", r: { name: "artists" } as Route },
    { icon: Folder, label: "Dossiers", r: { name: "folders" } as Route },
  ]
  const secondary = [
    { icon: Radio, label: "Radios", r: { name: "radios" } as Route },
    { icon: Heart, label: "Favoris", r: { name: "favorites" } as Route },
    { icon: BarChart3, label: "Statistiques", r: { name: "stats" } as Route },
  ]

  const onDropTracks = (playlistId: string) => (e: React.DragEvent) => {
    e.preventDefault()
    const data = e.dataTransfer.getData("application/x-track-ids")
    if (data) addTracks(playlistId, JSON.parse(data))
  }

  return (
    <aside
      data-panel="sidebar"
      style={{ width: collapsed ? 76 : "var(--sidebar-width)" }}
      className="glass-panel z-20 flex h-full shrink-0 flex-col rounded-3xl p-3"
    >
      <div className={cn("mb-4 flex items-center gap-2 px-2 pt-1", collapsed && "justify-center px-0")}>
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: "var(--accent)" }}>
          <Music2 size={18} className="text-white" />
        </div>
        {!collapsed && <span className="text-lg font-bold tracking-tight text-hi">Aura</span>}
        <div className="flex-1" />
        {!collapsed && (
          <Tooltip label="Réduire">
            <button onClick={() => update({ sidebarCollapsed: true })} className="focus-ring rounded-lg p-1.5 text-mid hover:text-hi" aria-label="Réduire la barre latérale">
              <PanelLeftClose size={18} />
            </button>
          </Tooltip>
        )}
      </div>
      {collapsed && (
        <div className="mb-2 flex justify-center">
          <Tooltip label="Déplier" side="bottom">
            <button onClick={() => update({ sidebarCollapsed: false })} className="focus-ring rounded-lg p-1.5 text-mid hover:text-hi" aria-label="Déplier">
              <PanelLeft size={18} />
            </button>
          </Tooltip>
        </div>
      )}

      <nav className="flex flex-col gap-1">
        {primary.map((n) => <NavItem key={n.label} {...n} icon={n.icon} active={is(n.r.name)} collapsed={collapsed} onClick={() => go(n.r)} />)}
      </nav>

      {!collapsed && <div className="mt-5 mb-1 flex items-center gap-2 px-3 text-xs font-semibold uppercase tracking-wider text-lo"><Library size={13} />Bibliothèque</div>}
      <nav className="flex flex-col gap-1">
        {library.map((n) => <NavItem key={n.label} {...n} icon={n.icon} active={is(n.r.name)} collapsed={collapsed} onClick={() => go(n.r)} />)}
      </nav>
      <nav className="mt-1 flex flex-col gap-1">
        {secondary.map((n) => <NavItem key={n.label} {...n} icon={n.icon} active={is(n.r.name)} collapsed={collapsed} onClick={() => go(n.r)} />)}
      </nav>

      <div className="mt-5 mb-1 flex items-center justify-between px-3">
        {!collapsed && <span className="text-xs font-semibold uppercase tracking-wider text-lo">Playlists</span>}
        <Tooltip label="Nouvelle playlist" side="bottom">
          <button
            onClick={async () => { const p = await create("Nouvelle playlist"); navigate({ name: "playlist", id: p.id }) }}
            className={cn("focus-ring rounded-lg p-1 text-mid hover:text-hi", collapsed && "mx-auto")}
            aria-label="Nouvelle playlist"
          >
            <Plus size={16} />
          </button>
        </Tooltip>
      </div>
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1">
        {playlists.map((p) => (
          <NavItem
            key={p.id}
            icon={null}
            title={p.name}
            label={
              <span className="flex min-w-0 items-center gap-2.5">
                <CoverArt colors={p.colors} size={28} rounded="rounded-md" usePhoto={false} className="h-7 w-7 shrink-0" />
                <span className="truncate">{p.name}</span>
              </span> as any
            }
            active={route.name === "playlist" && (route as any).id === p.id}
            collapsed={collapsed}
            onClick={() => navigate({ name: "playlist", id: p.id })}
            onDrop={onDropTracks(p.id)}
          />
        ))}
      </div>

      <div className="mt-2 shrink-0 pt-2">
        <OutputStatusChip collapsed={collapsed} />
      </div>
    </aside>
  )
}
