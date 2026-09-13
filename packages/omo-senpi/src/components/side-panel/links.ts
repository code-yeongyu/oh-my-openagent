/**
 * Clickable rows.
 *
 * The host already captures the mouse: pi-tui's alt-screen renderer turns SGR tracking on
 * unless a caller opts out, and senpi does not. What it does NOT offer is a per-component
 * mouse hook - it dispatches a click to the application exactly once, through OSC 8 hyperlink
 * activation: on a press and release inside one cell with no drag, it resolves a hyperlink
 * from its own rendered screen buffer and hands that URL to its `openUrl` callback.
 *
 * So a row becomes clickable by being painted as a hyperlink whose URL names the action, and
 * the panel recognises its own URLs by this private scheme. Because the hit test runs against
 * the host's buffer rather than the terminal's, a click works even where the terminal itself
 * does not implement OSC 8.
 *
 * Nothing here touches the host: the scheme is a string contract, which keeps it testable.
 */

const SCHEME = "omo-panel:"

/** What a click on a row opens. */
export type PanelAction =
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "agent"; readonly id: string }

/**
 * Percent-encoding is not cosmetic here: a value carrying BEL or ESC would terminate the
 * escape sequence early and paint the rest of the row as garbage.
 */
export function panelActionUrl(action: PanelAction): string {
  const value = action.kind === "file" ? action.path : action.id
  return `${SCHEME}${action.kind}/${encodeURIComponent(value)}`
}

/** The inverse, and the panel's test for "is this URL mine". Anything else belongs to the host. */
export function parsePanelActionUrl(url: string): PanelAction | undefined {
  if (!url.startsWith(SCHEME)) return undefined
  const rest = url.slice(SCHEME.length)
  const slash = rest.indexOf("/")
  if (slash <= 0) return undefined
  const kind = rest.slice(0, slash)
  const encoded = rest.slice(slash + 1)
  if (encoded === "") return undefined
  let value: string
  try {
    value = decodeURIComponent(encoded)
  } catch {
    // A malformed escape is somebody else's URL, not a broken action.
    return undefined
  }
  if (value === "") return undefined
  if (kind === "file") return { kind, path: value }
  if (kind === "agent") return { kind, id: value }
  return undefined
}

/**
 * Wrap painted text in an OSC 8 hyperlink. This must run AFTER the column's width math: the
 * width helpers measure SGR only, and would count these bytes as printable characters.
 */
export function withActionLink(text: string, action: PanelAction): string {
  return `\u001b]8;;${panelActionUrl(action)}\u0007${text}\u001b]8;;\u0007`
}
