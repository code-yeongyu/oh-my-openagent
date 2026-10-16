import { extractChannel } from "../../../hooks/auto-update-checker"
import { fetchNpmDistTags, type NpmDistTags } from "../../config-manager/npm-dist-tags"
import { EDITION_PACKAGE_NAMES } from "../framework/constants"
import type { CodexDoctorSummary, DoctorTarget, SystemInfo } from "../framework/types"

export type FetchDistTags = (packageName: string) => Promise<NpmDistTags | null>

export interface LatestVersionInput {
  target: DoctorTarget
  systemInfo: SystemInfo
  codex: CodexDoctorSummary | undefined
  distTags: NpmDistTags | null
}

export function gatherEditionDistTags(
  target: DoctorTarget,
  fetchDistTags: FetchDistTags = fetchNpmDistTags
): Promise<NpmDistTags | null> {
  return fetchDistTags(EDITION_PACKAGE_NAMES[target])
}

function resolveInstalledVersion(input: LatestVersionInput): string | null {
  if (input.target === "codex" && input.codex) {
    return input.codex.packageVersion ?? input.codex.installerVersion
  }
  return input.systemInfo.pluginVersion
}

export function resolveLatestVersion(input: LatestVersionInput): string | null {
  if (!input.distTags) return null
  const channel = extractChannel(resolveInstalledVersion(input))
  return input.distTags[channel] ?? input.distTags.latest ?? null
}
