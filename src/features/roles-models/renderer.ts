import type { ChainEntry, RoleView } from "./types"

export type RenderOptions = {
  teamLeader?: string
  autoPick?: boolean
  hideEmptyRoles?: boolean
}

const TITLE = "Roles · Models"

function glyph(view: RoleView): string {
  switch (view.activeReason) {
    case "pick":
      return "◆"
    case "fallback":
      return "↓"
    case "primary":
    default:
      return view.active ? "●" : "·"
  }
}

function formatEntry(entry: ChainEntry | undefined): string {
  if (!entry) return "—"
  return entry.variant ? `${entry.model} ${entry.variant}` : entry.model
}

function chainDepthLabel(view: RoleView): string {
  if (view.activeReason === "pick" && view.activeIndex > 0) return `↓${view.activeIndex}`
  if (view.activeReason === "fallback" && view.activeIndex > 0) return `↓${view.activeIndex}`
  return ""
}

function padRight(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length)
}

export function renderPanel(views: RoleView[], options: RenderOptions = {}): string {
  const visible = options.hideEmptyRoles
    ? views.filter((v) => v.active || v.chain.length > 0)
    : views

  const nameWidth = Math.max(...visible.map((v) => v.name.length), "role".length)
  const modelStrings = visible.map((v) => formatEntry(v.active))
  const modelWidth = Math.max(...modelStrings.map((s) => s.length), 1)

  const rows = visible.map((view, i) => {
    const g = glyph(view)
    const name = padRight(view.name, nameWidth)
    const model = padRight(modelStrings[i] ?? "—", modelWidth)
    const depth = chainDepthLabel(view)
    return `${g} ${name}  ${model}  ${depth}`.trimEnd()
  })

  const lines: string[] = [TITLE, ""]
  lines.push(...rows)
  lines.push("")
  const footerParts: string[] = []
  if (options.teamLeader) footerParts.push(`team · leader: ${options.teamLeader}`)
  if (options.autoPick !== undefined) {
    footerParts.push(`auto-pick: ${options.autoPick ? "ON" : "OFF"}`)
  }
  if (footerParts.length > 0) lines.push(footerParts.join("      "))
  lines.push("[p] /pick  [a] /auto-pick  [t] /show-models")

  return "```\n" + lines.join("\n") + "\n```"
}
