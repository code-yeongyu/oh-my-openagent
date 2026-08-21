import { detectOmoHosts, type OmoHostDeps } from "../../../shared"
import { doctorSummary } from "../../../plugin/v2"
import type { CheckResult } from "../framework/types"

const CHECK_NAME = "OpenCode v2 beta"

/**
 * Reports opencode2 presence and the omo feature degradation ledger.
 * Never fails doctor: v2 is opt-in and every inactive surface is already
 * tracked as a ledger entry rather than an error condition.
 */
export function createOpencodeV2Check(deps: Partial<OmoHostDeps> = {}): () => Promise<CheckResult> {
  return async () => {
    const detection = detectOmoHosts(deps)

    if (!detection.hasV2) {
      return {
        name: CHECK_NAME,
        status: "skip",
        message: "opencode2 not detected; running a v1-only environment",
        details: [],
        issues: [],
      }
    }

    const v2 = detection.hosts.find((host) => host.kind === "opencode-v2")
    const version = v2?.version ?? "unknown"
    const v1Suffix = detection.hasV1 && detection.primary ? ` alongside v1 ${detection.primary.version}` : ""

    return {
      name: CHECK_NAME,
      status: "warn",
      message: `opencode2 ${version} detected${v1Suffix}; some omo features are inactive on v2`,
      details: doctorSummary(),
      issues: [],
    }
  }
}

export const checkOpencodeV2 = createOpencodeV2Check()
