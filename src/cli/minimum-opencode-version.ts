import { MIN_OPENCODE_VERSION } from "./doctor/constants"
import { compareVersions } from "../shared/opencode-version"

export function getUnsupportedOpenCodeVersionMessage(openCodeVersion: string | null): string | null {
  if (!openCodeVersion) {
    return null
  }

  if (compareVersions(openCodeVersion, MIN_OPENCODE_VERSION) >= 0) {
    return null
  }

  return `Detected OpenCode ${openCodeVersion}, but ${MIN_OPENCODE_VERSION}+ is required. Update OpenCode, then rerun the installer.`
}
