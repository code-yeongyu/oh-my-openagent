import type { FakeHost } from "./fake-host"

// Evidence-gathering for #10399: the "session still listed after close" failure shows up in about 1 of 29
// Windows CI jobs and has not reproduced on demand. When it happens, print what the host saw so the next
// sighting explains itself. Only command types, routing ids and the path segment after /children/ are
// printed: no payloads, no temp or home directories.
export function sessionListedAfterClose(host: FakeHost, sessionPath: string | undefined): boolean {
  const listed = host.sessions().some((candidate) => candidate.sessionPath === sessionPath)
  if (listed) {
    console.log(`HOST_STATE_ON_FAILURE ${JSON.stringify({
      commands: host.commands.map((command) => command.sessionId === undefined ? command.type : `${command.type}@${command.sessionId}`),
      sessions: host.sessions().map((candidate) => ({ path: childSegment(candidate.sessionPath), routing: candidate.routingId })),
      closedPath: childSegment(sessionPath ?? ""),
    })}`)
  }
  return listed
}

function childSegment(path: string): string {
  const normalized = path.replaceAll("\\", "/")
  const at = normalized.indexOf("/children/")
  if (at === -1) return "(outside children)"
  const rest = normalized.slice(at + 1)
  return rest.split("/").includes("..") ? "(outside children)" : rest
}
