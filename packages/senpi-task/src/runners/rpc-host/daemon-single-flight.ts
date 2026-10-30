import type { EnsuredTaskDaemon } from "./daemon"

const inFlightEnsures = new Map<string, Promise<EnsuredTaskDaemon>>()

export function shareDaemonEnsure(
  socket: string,
  ensure: () => Promise<EnsuredTaskDaemon>,
): Promise<EnsuredTaskDaemon> {
  const existing = inFlightEnsures.get(socket)
  if (existing !== undefined) return existing

  let pending: Promise<EnsuredTaskDaemon>
  pending = ensure().finally(() => {
    if (inFlightEnsures.get(socket) === pending) inFlightEnsures.delete(socket)
  })
  inFlightEnsures.set(socket, pending)
  return pending
}
