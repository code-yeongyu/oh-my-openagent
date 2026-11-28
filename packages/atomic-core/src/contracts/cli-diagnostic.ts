export type AtomicCliDiagnostic =
  | { readonly form: "usage"; readonly code: string; readonly fields: Readonly<Record<string, readonly string[]>> }
  | { readonly form: "coded"; readonly code: string; readonly message: string }
  | { readonly form: "message"; readonly message: string }

const USAGE_HEADER = /^error: ([a-z][a-z0-9-]*)$/
const USAGE_FIELD = /^([a-z][a-z-]*): (.*)$/
const CODED_LINE = /^\u2717 atomic:([A-Z_]+): (.*)$/
const MESSAGE_LINE = /^\u2717 (.*)$/

function parseUsageBlock(code: string, lines: readonly string[]): AtomicCliDiagnostic {
  const fields: Record<string, string[]> = {}
  for (const line of lines) {
    const field = USAGE_FIELD.exec(line)
    if (field === null) continue
    const [, key = "", value = ""] = field
    fields[key] = [...(fields[key] ?? []), value]
  }
  return { form: "usage", code, fields }
}

/** Recognizes the three stderr forms Atomic 0.22.1 prints on failure; undefined when none matches. */
export function parseAtomicCliDiagnostic(stderr: string): AtomicCliDiagnostic | undefined {
  const lines = stderr.split(/\r?\n/).map((line) => line.trimEnd())
  const first = lines.findIndex((line) => line.length > 0)
  if (first === -1) return undefined
  const head = lines[first] ?? ""

  const usage = USAGE_HEADER.exec(head)
  if (usage?.[1] !== undefined) return parseUsageBlock(usage[1], lines.slice(first + 1))

  const coded = CODED_LINE.exec(head)
  if (coded?.[1] !== undefined && coded[2] !== undefined) return { form: "coded", code: coded[1], message: coded[2] }

  const message = MESSAGE_LINE.exec(head)
  if (message?.[1] !== undefined) return { form: "message", message: message[1] }
  return undefined
}
