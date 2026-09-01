export type SuggestedMode = "local" | "committed"

export type EligibilityResult =
  | {
      trigger: "coverage-gap"
      coverage: { missingRatio: number; candidateDirs: number; coveredDirs: number }
    }
  | {
      trigger: "commit-and-touch" | "loc-churn" | "snapshot-age"
      drift: {
        commitsSince: number
        touchedRatio: number
        churnLocRatio: number
        daysSince: number
      }
    }
  | { trigger: "snapshot-invalid"; drift: { stale: true } }

export type OmoInitDeepProposedData =
  | {
      repo: string
      trigger: "coverage-gap"
      coverage: { missingRatio: number; candidateDirs: number; coveredDirs: number }
      drift: null
      suggestedMode: SuggestedMode
    }
  | {
      repo: string
      trigger: "commit-and-touch" | "loc-churn" | "snapshot-age"
      coverage: null
      drift: {
        commitsSince: number
        touchedRatio: number
        churnLocRatio: number
        daysSince: number
      }
      suggestedMode: SuggestedMode
    }
  | {
      repo: string
      trigger: "snapshot-invalid"
      coverage: null
      drift: { stale: true }
      suggestedMode: SuggestedMode
    }

export function buildProposedData(
  repo: string,
  eligibility: EligibilityResult,
  suggestedMode: SuggestedMode,
): OmoInitDeepProposedData {
  if (eligibility.trigger === "coverage-gap") {
    return {
      repo,
      trigger: eligibility.trigger,
      coverage: eligibility.coverage,
      drift: null,
      suggestedMode,
    }
  }
  if (eligibility.trigger === "snapshot-invalid") {
    return {
      repo,
      trigger: eligibility.trigger,
      coverage: null,
      drift: eligibility.drift,
      suggestedMode,
    }
  }
  return {
    repo,
    trigger: eligibility.trigger,
    coverage: null,
    drift: eligibility.drift,
    suggestedMode,
  }
}
