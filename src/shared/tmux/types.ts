export interface SpawnPaneResult {
  success: boolean
  paneId?: string  // e.g., "%42"
  tmuxSessionId?: string
  windowId?: string
}
