/**
 * Reduce a memory child's failure detail to the one line a reader can act on.
 *
 * The detail we store is the tail of the child's stderr, and a crashed Bun child leads with a code
 * frame, a caret, error property rows and a stack before the sentence that explains the failure.
 * Those details are rendered into notices a USER reads, so the raw tail put senpi's own source on
 * screen: `Memory reflection has failed 27 times (child_exit:340 |         const darkPath = ...)`.
 *
 * Distillation is applied where the detail is SHOWN or KEYED, never where it is stored: the full
 * tail stays in `child-stderr.log` and in the durable completion record, so nothing is lost for
 * diagnosis, and records written before this existed are cleaned up as they are read.
 */

/** Bounds one pathological line (a minified frame, a JSON blob); notices excerpt further. */
export const FAILURE_CAUSE_MAX_CHARS = 200

/** Detail chars kept in a failure fingerprint, which is a dedupe key and not user-facing text. */
export const FAILURE_FINGERPRINT_DETAIL_CHARS = 60

const ELLIPSIS = "…"

// CSI escape sequence: a coloured child error would otherwise hide its shape behind \e[31m.
const TERMINAL_CONTROL = /\u001b\[[0-9;?]*[ -/]*[@-~]/g

const MACHINERY = [
  /^\d+\s*\|/, // code frame row: `345 |   dark: JSON.parse(...)`
  /^\^+$/, // caret pointing into the frame above it
  /^at\s+\S/, // stack frame
  /^(?:path|syscall|errno|code|dest|address|port|erroredSysCall)\s*:/i, // Bun error property rows
  /^Bun v\d/, // Bun's runtime footer
  /^\[truncated to last \d+ bytes\]$/, // our own readTail marker
] as const

/** A line that names the failure: `ENOENT: ...`, `TypeError: ...`, `error: ...`. */
const CAUSE_SHAPED = /^(?:[A-Z][A-Za-z]*(?:Error|Exception)|E[A-Z]{2,}|[Ee]rror|[Ww]arning|[Ff]atal)\b/

export function childFailureCause(detail: string | undefined): string | undefined {
  if (detail === undefined) return detail
  const lines = detail
    .split("\n")
    .map((line) => line.replace(TERMINAL_CONTROL, "").replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0 && !MACHINERY.some((pattern) => pattern.test(line)))
  const cause = lines.find((line) => CAUSE_SHAPED.test(line)) ?? lines[0]
  if (cause === undefined) return undefined
  return cause.length <= FAILURE_CAUSE_MAX_CHARS
    ? cause
    : `${cause.slice(0, FAILURE_CAUSE_MAX_CHARS - ELLIPSIS.length)}${ELLIPSIS}`
}

/**
 * Stable dedupe key for a failure streak. Keyed on the distilled cause so a crash whose code frame
 * shifts by a line still counts as the same failure.
 */
export function failureFingerprint(reason: string | undefined, detail: string | undefined): string {
  return `${reason ?? "failed"}:${(childFailureCause(detail) ?? "").slice(0, FAILURE_FINGERPRINT_DETAIL_CHARS)}`
}
