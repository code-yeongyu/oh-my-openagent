import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { finding } from "./bin/lib/diagnostics-findings.js"
import type { DiagnosticFinding } from "./bin/lib/diagnostics-contract"

/** The marker fields doctor reads: where the generation lives, which one it is, and whether OS roots made it. */
export type EngineTrustDoctorMarker = {
  readonly file: string
  readonly sha256: string
  readonly automatic: "os" | "fallback"
}

type DropFields = { file?: unknown; cause?: unknown; blockIndex?: unknown; narrowing?: unknown }

/**
 * Design revision 11: a default-file drop is visible at the diagnostic level only, so every finding is a notice.
 * The last import-exec or ensure record of the adopted generation is the one that made it.
 */
export function engineTrustFindings(input: {
  readonly platform: NodeJS.Platform
  readonly marker: EngineTrustDoctorMarker | undefined
  readonly records: readonly unknown[]
}): DiagnosticFinding[] {
  const { marker } = input
  if (marker === undefined) return []
  const made = input.records
    .filter((record): record is { codes: unknown[] } => {
      if (typeof record !== "object" || record === null) return false
      const { generation, action, codes } = record as { generation?: unknown; action?: unknown; codes?: unknown }
      return generation === marker.sha256 && (action === "import-exec" || action === "ensure") && Array.isArray(codes)
    })
    .at(-1)
  if (made === undefined) return []
  const malformed = made.codes.filter(
    (code): code is DropFields =>
      typeof code === "object" &&
      code !== null &&
      (code as { code?: unknown }).code === "openssl-default-file-malformed",
  )
  const drop = malformed.find((code) => code.file !== undefined)
  if (drop !== undefined) {
    return [
      finding(
        "engine.trust",
        "notice",
        `engine trust: default file ${String(drop.file)} dropped: ${String(drop.cause)}, block ${String(drop.blockIndex)}, narrowing=${String(drop.narrowing)}`,
        { state: "dropped", file: drop.file, cause: drop.cause, block: drop.blockIndex, narrowing: drop.narrowing },
      ),
    ]
  }
  // Only a macOS generation built from OS roots read the default file; any other generation has no status to state.
  if (input.platform !== "darwin" || marker.automatic !== "os") return []
  const defaultFile = malformed.length > 0 ? "unreadable" : "kept"
  return [
    finding(
      "engine.trust",
      "notice",
      `engine trust: generation ${marker.sha256.slice(0, 12)}, default-file: ${defaultFile}`,
      {
        generation: marker.sha256,
        default_file: defaultFile,
      },
    ),
  ]
}

/** Reads the generation's diagnostics log, oldest first; any read or parse failure yields fewer records, never an error. */
export async function readEngineTrustRecords(marker: EngineTrustDoctorMarker | undefined): Promise<unknown[]> {
  if (marker === undefined) return []
  const directory = dirname(marker.file)
  const records: unknown[] = []
  for (const name of ["diagnostics.1.jsonl", "diagnostics.jsonl"]) {
    const text = await readFile(join(directory, name), "utf8").catch(() => "")
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue
      try {
        records.push(JSON.parse(line))
      } catch {
        /* a torn or foreign line is not a record */
      }
    }
  }
  return records
}
