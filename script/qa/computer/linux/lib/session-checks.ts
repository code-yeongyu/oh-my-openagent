/** `xprop -root _NET_SUPPORTING_WM_CHECK` exits 0 whether or not the atom exists, so only its named window proves a window manager. */
export function wmOwnsRoot(xpropStdout: string): boolean {
  return /window id # 0x[0-9a-f]+/i.test(xpropStdout)
}

export function missingTools(tools: readonly string[], present: (tool: string) => boolean): string[] {
  return tools.filter((tool) => !present(tool))
}
