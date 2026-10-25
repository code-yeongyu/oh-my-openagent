import { parseNotes } from "./changelog-release-assembly.ts"
import { splitFragment } from "./package-log-blocks.ts"

/** Any changes.md below the repo root; the root one stays the shared gate's (release-only) file. */
const PACKAGE_CHANGES_LOG = /^.+\/changes\.md$/

export type PackageLogInput = {
  readonly addedFiles: readonly string[]
  readonly modifiedFiles: readonly string[]
  readonly deletedFiles: readonly string[]
  readonly isRelease: boolean
  readonly fragment: string | null
  readonly existsAtHead: (path: string) => boolean
}

export function checkPackageLogs(input: PackageLogInput): { readonly pass: boolean; readonly reason: string } {
  if (!input.isRelease) {
    const edited = [...input.addedFiles, ...input.modifiedFiles, ...input.deletedFiles].filter((path) => PACKAGE_CHANGES_LOG.test(path))
    if (edited.length > 0) {
      return {
        pass: false,
        reason: `do not edit ${edited.join(", ")} in a PR: put a \`<!-- changes-log: <path> -->\` block in your changes/unreleased/<pr>.md (docs/reference/changelog-fragments.md)`,
      }
    }
  }
  if (input.fragment === null) return { pass: true, reason: "no package-log blocks" }
  const split = splitFragment(input.fragment)
  if (split.reasons.length > 0) return { pass: false, reason: split.reasons.join("; ") }
  const missing = split.blocks.filter((block) => !input.existsAtHead(block.log)).map((block) => block.log)
  if (missing.length > 0) return { pass: false, reason: `a block names a log that does not exist: ${missing.join(", ")}` }
  // A merged fragment is immutable, so refuse here whatever the release stamp would refuse (#10477 review HIGH 1).
  if (split.preamble === "") return { pass: false, reason: "the fragment needs CHANGELOG text before its log blocks (a paragraph or ### bullets)" }
  try {
    parseNotes(split.preamble)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { pass: false, reason: `the release cannot place this fragment text (docs/reference/changelog-fragments.md): ${detail}` }
  }
  return { pass: true, reason: `${split.blocks.length} package-log block(s) valid` }
}
