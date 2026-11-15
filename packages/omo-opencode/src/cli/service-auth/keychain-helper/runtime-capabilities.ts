import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { z } from "zod"

/**
 * What a built omo runtime declares about itself (RULING-74), in a file beside the runtime binary. The release build
 * writes it next to every runtime it produces, and the desktop bundles it with the runtime and its keychain helper,
 * inside the sealed app. A runtime from before this contract has no such file.
 */
export const RUNTIME_CAPABILITIES_FILE = "omo-runtime-capabilities.json"

/** keychainHandoff 1: honours OMO_KEYCHAIN_HANDOFF (never shows a keychain dialog) and migrates through its helper. */
export const RUNTIME_CAPABILITIES = { keychainHandoff: 1 } as const

const capabilitiesSchema = z.object({ keychainHandoff: z.number().int() }).passthrough()

export function runtimeCapabilitiesText(): string {
  return `${JSON.stringify(RUNTIME_CAPABILITIES)}\n`
}

/** True only when the file beside `runtime` parses and declares keychain hand-off support at level 1 or above. */
export async function runtimeDeclaresKeychainHandoff(runtime: string): Promise<boolean> {
  const text = await readFile(join(dirname(runtime), RUNTIME_CAPABILITIES_FILE), "utf8").catch(() => null)
  if (text === null) return false
  try {
    const parsed = capabilitiesSchema.safeParse(JSON.parse(text))
    return parsed.success && parsed.data.keychainHandoff >= RUNTIME_CAPABILITIES.keychainHandoff
  } catch {
    return false
  }
}
