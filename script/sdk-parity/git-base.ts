import { execFileSync } from "node:child_process"

import { type Baseline, ORIGINAL_PATH, PIN_PATH, UNRESOLVED_PATH } from "./baseline"
import { REPO_ROOT } from "./registry"

// The merge base's parity record, read from git: the gate and the recurring registry test both judge the head against
// the base the pull request merges into (review 6061267823 H1), never against an assumed initial state.

export const BASE_REF = process.env.SDK_PARITY_BASE ?? "origin/dev"

const git = (...args: string[]): string =>
  execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 256 << 20,
  })

export const mergeBase = (ref: string = BASE_REF): string => git("merge-base", ref, "HEAD").trim()

export function showAt(ref: string, path: string): string | undefined {
  try {
    return git("show", `${ref}:${path}`)
  } catch {
    return undefined
  }
}

export type BaseRecord = {
  readonly originalText: string | undefined
  readonly pinText: string | undefined
  readonly unresolved: Baseline | undefined
}

export function baseRecord(ref: string): BaseRecord {
  const unresolved = showAt(ref, UNRESOLVED_PATH)
  return {
    originalText: showAt(ref, ORIGINAL_PATH),
    pinText: showAt(ref, PIN_PATH),
    unresolved: unresolved === undefined ? undefined : (JSON.parse(unresolved) as Baseline),
  }
}
