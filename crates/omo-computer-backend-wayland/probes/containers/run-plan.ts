// SP-W run plan. Pure: which mode the probe runs in, and how a container's rows are reconciled with the request.

// In-session mode is what --in-session asks for. Without the flag, only the probe image itself (a container with no
// docker client) is treated as in-session, so a probe started there reports the missing session as its precondition;
// a devcontainer or Codespace with docker stays on the host path even though it has /.dockerenv.
export function chooseMode(o: { inSession: boolean; hasDocker: boolean; dockerenv: boolean }): "session" | "host" {
  if (o.inSession) return "session"
  return !o.hasDocker && o.dockerenv ? "session" : "host"
}

type Reported = { id: string; answer: boolean | null }

// Rows come back in request order. A requested row that never arrived becomes UNMEASURED (it never keeps an old
// ledger value); a row that was not requested, or arrived twice, is an error.
export function reconcileRows<R extends Reported>(
  requested: readonly string[],
  rows: readonly R[],
  exitCode: number,
): { rows: (R | { id: string; answer: null; reason: string })[]; missing: string[] } {
  const seen = new Set<string>()
  for (const r of rows) {
    if (!requested.includes(r.id)) throw new Error(`container reported a row that was not requested: ${r.id}`)
    if (seen.has(r.id)) throw new Error(`container reported a row twice: ${r.id}`)
    seen.add(r.id)
  }
  const missing = requested.filter((id) => !seen.has(id))
  return {
    rows: requested.map(
      (id) =>
        rows.find((r) => r.id === id) ?? {
          id,
          answer: null,
          reason: `the container exited (exit ${exitCode}) before reporting this row`,
        },
    ),
    missing,
  }
}

// A container's stdout and exit code -> the requested rows. A row line that does not parse counts as a row that never
// arrived, and a container that reported nothing yields every requested row UNMEASURED with its exit code.
export type Parsed = Reported & Record<string, unknown>

export function containerOutcome(requested: readonly string[], stdout: string, exitCode: number) {
  const rows: Parsed[] = []
  for (const l of stdout.split("\n")) {
    if (!l.startsWith("SPW_ROW ")) continue
    try {
      const r: unknown = JSON.parse(l.slice(8))
      if (r && typeof r === "object" && "id" in r && typeof r.id === "string")
        rows.push({ answer: null, ...r, id: r.id })
    } catch {
      // a truncated line: the row is reconciled as missing below
    }
  }
  return reconcileRows(requested, rows, exitCode)
}
