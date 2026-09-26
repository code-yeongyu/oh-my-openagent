// Report-once bookkeeping for stranded transient identities (issue #8646).

import { existsSync, rm, writeFile } from "@oh-my-opencode/memory-core/fs"
import { join } from "node:path"

import type { TransientWarn } from "./transient-identity"

/**
 * Written into a stranded transient identity once its conflict has been reported (#8646). The
 * conflict is terminal - the sweep never merges into an existing durable identity - so later
 * sweeps still count the identity as stranded but stay silent instead of repeating the warning.
 */
export const STRANDED_REPORTED_MARKER = ".stranded-reported"

export async function reportStrandedOnce(input: { readonly from: string; readonly to: string; readonly warn?: TransientWarn }): Promise<void> {
  const marker = join(input.from, STRANDED_REPORTED_MARKER)
  if (existsSync(marker)) return
  input.warn?.("omo-senpi memory transient run holds memory a durable identity already owns", {
    from: input.from,
    to: input.to,
    promotable: false,
    action: "merge or remove one of the two identity roots by hand; the sweep keeps both and reports this once",
  })
  try {
    await writeFile(marker, `${JSON.stringify({ to: input.to })}\n`)
  } catch (error) {
    input.warn?.("omo-senpi memory stranded-run marker write failed", {
      marker,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/** A promoted identity is no longer stranded; drop the marker it carried over from the transient tree. */
export async function clearStrandedMarker(identityRoot: string, warn?: TransientWarn): Promise<void> {
  const marker = join(identityRoot, STRANDED_REPORTED_MARKER)
  try {
    await rm(marker, { force: true })
  } catch (error) {
    warn?.("omo-senpi memory stranded-run marker cleanup failed", {
      marker,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
