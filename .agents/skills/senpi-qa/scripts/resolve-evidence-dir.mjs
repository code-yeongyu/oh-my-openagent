#!/usr/bin/env node
// resolve-evidence-dir.mjs - pick the canonical evidence directory for a live Senpi QA run.
//
// Live Senpi QA artifacts belong under .omo/evidence/omo-senpi-adapter/<slug>/ and nowhere else.
// That path is the repository-standard location every reviewer and AGENTS.md rule points at, so a
// hand-typed alternative (local-ignore/qa-evidence/..., a temp dir, a traversal) silently strands
// the evidence where the PR cannot cite it. Resolving through this script makes the path a checked
// contract instead of a convention.
//
// The resolver COMPUTES and VALIDATES only; creating the directory stays the caller's decision, so
// a rejected slug never leaves a stray directory behind.
//
//   node resolve-evidence-dir.mjs --repo-root "$(git rev-parse --show-toplevel)" --slug 20260820-my-run
//
// Prints the absolute path to stdout. Exit 0 iff the root is a git worktree and the slug is safe.
import { existsSync, realpathSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const EVIDENCE_RELATIVE_ROOT = join(".omo", "evidence", "omo-senpi-adapter")

// One relative segment: lowercase alphanumerics joined by single hyphens. This is what makes the
// path predictable - it also rejects every separator, traversal, and absolute form outright, since
// none of them can match.
const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * @param {{ repoRoot: string, slug: string }} input
 * @returns {string} absolute evidence directory; NOT created
 */
export function resolveEvidenceDir({ repoRoot, slug }) {
  if (typeof repoRoot !== "string" || repoRoot.length === 0) {
    throw new Error("repoRoot must be a non-empty path to a git worktree")
  }
  if (!existsSync(join(repoRoot, ".git"))) {
    throw new Error(`repoRoot is not a git worktree: ${repoRoot}`)
  }
  if (typeof slug !== "string" || !SAFE_SLUG.test(slug)) {
    throw new Error(
      `slug must be one lowercase alphanumeric-and-hyphen segment (got ${JSON.stringify(slug)}); ` +
        `evidence lives under ${EVIDENCE_RELATIVE_ROOT}/<slug>`,
    )
  }
  return resolve(repoRoot, EVIDENCE_RELATIVE_ROOT, slug)
}

const isDirectRun =
  process.argv[1] !== undefined &&
  existsSync(process.argv[1]) &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))

if (isDirectRun) {
  const args = process.argv.slice(2)
  const read = (flag) => {
    const at = args.indexOf(flag)
    return at === -1 ? undefined : args[at + 1]
  }
  try {
    const dir = resolveEvidenceDir({ repoRoot: read("--repo-root") ?? process.cwd(), slug: read("--slug") })
    process.stdout.write(`${dir}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}
