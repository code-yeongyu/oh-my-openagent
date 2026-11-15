import type { WindowSelector, WindowSummary } from "./types"

const includes = (value: string, part: string | undefined): boolean =>
  part === undefined || value.toLocaleLowerCase().includes(part.toLocaleLowerCase())

export function matchesSelector(window: WindowSummary, selector: WindowSelector | undefined): boolean {
  if (selector === undefined) return true
  if (typeof selector === "string") return window.id === selector
  return (
    (selector.id === undefined || window.id === selector.id) &&
    includes(window.app, selector.app) &&
    includes(window.title, selector.title)
  )
}
