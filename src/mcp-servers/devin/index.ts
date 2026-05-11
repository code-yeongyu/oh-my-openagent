export { createDevinMcpServer, runDevinMcpServer } from "./server"
export {
  startDevinSession,
  getDevinSession,
  listDevinSessions,
  snapshotDevinSession,
  cancelDevinSession,
  shutdownAllSessions,
} from "./session-store"
export type { DevinSession, DevinSessionSnapshot, DevinSessionStatus } from "./types"

if (import.meta.main) {
  const { runDevinMcpServer } = await import("./server")
  await runDevinMcpServer()
}
