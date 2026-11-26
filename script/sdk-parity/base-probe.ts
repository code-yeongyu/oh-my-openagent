import { execFileSync } from "node:child_process"

import { offenderGrowth } from "../remote-import-guard-adapter"
import { type Baseline, baselineProblems, ORIGINAL_PATH, PIN_PATH, UNRESOLVED_PATH } from "./baseline"
import { conformanceProblems, type EffectEvidence } from "./conformance"
import { P0_CONTEXT } from "./conformance-run"
import { REPO_ROOT } from "./registry"
import type { Row } from "./schema"

// The checks that compare the head with the merge base's tree (the recurring baseline and built rows, and the adapter
// offender record only shrinking) live in two homes until the SDK Parity job is a required check (design lane ruling
// on review 6064044043): gate-cli.ts in that job, and the ordinary tests, which run them whenever the merge base is
// readable and skip, with the reason, only when it is not (a shallow checkout without the base ref). One probe decides.

/** Runs git with the given arguments in the repository and answers its stdout; throws when git fails. */
export type GitPort = (args: readonly string[]) => string

export type BaseProbe =
  { readonly readable: true; readonly base: string } | { readonly readable: false; readonly reason: string }

const BASE_REF = process.env.SDK_PARITY_BASE ?? "origin/dev"

export const repoGit: GitPort = (args) =>
  execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 256 << 20,
  })

export function probeBase(git: GitPort, ref: string = BASE_REF): BaseProbe {
  let base: string
  try {
    base = git(["merge-base", ref, "HEAD"]).trim()
  } catch {
    return {
      readable: false,
      reason: `no merge base of ${ref} and HEAD in this checkout (a shallow clone without ${ref}); the SDK Parity job runs this check with full history`,
    }
  }
  try {
    git(["cat-file", "-e", `${base}^{tree}`])
  } catch {
    return { readable: false, reason: `the merge base ${base.slice(0, 10)} has no tree in this checkout` }
  }
  return { readable: true, base }
}

const showAt = (git: GitPort, ref: string, path: string): string | undefined => {
  try {
    return git(["show", `${ref}:${path}`])
  } catch {
    return undefined
  }
}

export type BaseCheck = { readonly skipped: string } | { readonly problems: readonly string[] }

export type HeadRecord = {
  readonly rows: readonly Row[]
  readonly originalText: string
  readonly pinText: string
  readonly unresolved: Baseline
  readonly evidence: readonly EffectEvidence[]
}

export function registryBaseProblems(git: GitPort, head: HeadRecord, ref: string = BASE_REF): BaseCheck {
  const probe = probeBase(git, ref)
  if (!probe.readable) return { skipped: probe.reason }
  const unresolved = showAt(git, probe.base, UNRESOLVED_PATH)
  const atBase = {
    originalText: showAt(git, probe.base, ORIGINAL_PATH),
    pinText: showAt(git, probe.base, PIN_PATH),
    unresolved: unresolved === undefined ? undefined : (JSON.parse(unresolved) as Baseline),
  }
  const open = new Set(head.unresolved.entries.map((entry) => entry.id))
  return {
    problems: [
      ...baselineProblems({ ...head, context: P0_CONTEXT, atBase }),
      ...conformanceProblems(head.rows, open, head.evidence, P0_CONTEXT),
    ],
  }
}

type OffenderRecord = Parameters<typeof offenderGrowth>[1]

export function offenderBaseProblems(git: GitPort, head: OffenderRecord, ref: string = BASE_REF): BaseCheck {
  const probe = probeBase(git, ref)
  if (!probe.readable) return { skipped: probe.reason }
  const recorded = showAt(git, probe.base, "script/remote-import-guard-adapter-offenders.json")
  return { problems: offenderGrowth(recorded === undefined ? undefined : JSON.parse(recorded), head) }
}
