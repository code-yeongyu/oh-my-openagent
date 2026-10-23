import type { CheckOutcome } from "./evidence"

const FAIL_SIGNATURES: readonly RegExp[] = [
  /(?<![0-9])[1-9]\d*\s+fail(?:ed|ures?)?\b(?![=:])/i,
  /\bfail(?:ed|ures?)?=(?:[1-9]|\[[^\]\s])/i,
  /^\(fail\)/m,
  /\bFAIL\b/,
  /\berror TS\d+/,
  /AssertionError/,
  /^\s*error(?:\[[^\]]*\])?:/im,
  /\b[A-Z_]*EXIT[=:]\s*[1-9]\d*\b/,
  /\bexit(?:ed)?(?: with)?(?: code| status)?\s*[:=]?\s*[1-9]\d*\b/i,
  /\bTests?:?\s+[1-9]\d* failed/,
  /\bTest Files\s+[1-9]\d* failed/,
  /"exitCode":\s*[1-9]/,
  /\bFound [1-9]\d* errors?\b/,
  /Files with errors:\s*[1-9]/,
  /\tfail\t/,
]

const UNSETTLED_SIGNATURES: readonly RegExp[] = [/\t(?:pending|queued|in_progress)\t/]

const PASS_SIGNATURES: readonly RegExp[] = [
  /(?<![0-9])0\s+fail(?:ed|ures?)?\b/i,
  /\bfail(?:ed|ures?)?=(?:0\b|\[\])/i,
  /(?<![0-9])[1-9]\d*\s+pass(?:ed)?\b/i,
  /\bTests?:?\s+\d+ passed/,
  /\bTest Files\s+\d+ passed/,
  /"exitCode":\s*0\b/,
  /\bAll tests passed\b/i,
  /\b[A-Z_]*EXIT[=:]\s*0\b/,
  /\bexit(?:ed)?(?: with)?(?: code| status)?\s*[:=]?\s*0\b/i,
  /\bFound 0 errors\b/,
  /\bNo diagnostics found\b/,
  /Files with errors:\s*0\b/,
  /\bNo fixes applied\b/,
  /\tpass\t/,
]

const HARNESS_REFUSAL = /\bTool \S+ not found\b|\bpermission denied by\b|\b(?:was|were) denied\b|\bblocked by (?:policy|the user|a hook)\b|\brequires approval\b|\b(?:aborted|cancelled) by the user\b/i

/** A structured run that errored is a failed check only if it actually ran: a harness refusal is no evidence. */
export function judgeStructured(errored: boolean, text: string): CheckOutcome {
  if (!errored) return judgeOutput(text)
  return HARNESS_REFUSAL.test(text) ? "unknown" : "failed"
}

export function judgeOutput(text: string): CheckOutcome {
  if (FAIL_SIGNATURES.some((pattern) => pattern.test(text))) return "failed"
  if (UNSETTLED_SIGNATURES.some((pattern) => pattern.test(text))) return "unknown"
  if (PASS_SIGNATURES.some((pattern) => pattern.test(text))) return "passed"
  return "unknown"
}

const NON_CODE_PATH = /(?:^|\/)(?:\.omo|omo-runs|tmp|evidence|notepads?)\/|^\/(?:private\/)?tmp\/|\.(?:md|txt|log|jsonl|csv)$/i

export function isRelevantPath(path: string): boolean {
  return !NON_CODE_PATH.test(path)
}
