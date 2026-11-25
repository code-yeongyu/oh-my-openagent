import type { Row } from "./schema"

// The rows that may declare addressScope "this_device" (design 7.3 ruling): the design does not make them cross-device.
const HOST_LOCAL_ROWS = ["threads.adopt", "threads.release", "threads.unload"] as const

// The rows that may declare pure (design lane ruling on 7.3): a probe and a usage text, each touching nothing.
const PURE_ROWS = ["account.signInCheck", "toolkit.help"] as const

// The two closed exemption lists of design 7.3: a row declares host-local or pure only if it is named here, with a reason.
export function scopeProblems(row: Row): string[] {
  const problems: string[] = []
  const at = `row ${row.id}`
  if (row.pure !== undefined) {
    if (!(PURE_ROWS as readonly string[]).includes(row.id))
      problems.push(`${at}: only ${PURE_ROWS.join(", ")} may declare pure; this row touches a port and states it`)
    if ((row.pureReason ?? "").trim() === "") problems.push(`${at}: pure needs a written pureReason`)
  }
  if (row.addressScope !== undefined) {
    if (!(HOST_LOCAL_ROWS as readonly string[]).includes(row.id))
      problems.push(
        `${at}: only ${HOST_LOCAL_ROWS.join(", ")} may declare addressScope; this row addresses threads on every device`,
      )
    if ((row.addressReason ?? "").trim() === "") problems.push(`${at}: addressScope needs a written addressReason`)
  }
  return problems
}
