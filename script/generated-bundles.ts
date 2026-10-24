/**
 * The generated build outputs feature PRs never commit (#9903). One list, in generated-bundles.json,
 * read here, by the bundle-regen workflow and by external merge tooling.
 */
import list from "./generated-bundles.json" with { type: "json" }

const PATTERNS: readonly RegExp[] = list.patterns.map((source) => new RegExp(source))

export function isGeneratedBundle(path: string): boolean {
  return PATTERNS.some((pattern) => pattern.test(path))
}

export function nonGeneratedPaths(paths: readonly string[]): string[] {
  return paths.filter((path) => !isGeneratedBundle(path))
}

export type BundleGateInput = {
  readonly changedFiles: readonly string[]
  readonly branch: string
  readonly author: string
}

export type BundleGatePolicy = {
  readonly releaseBranchPattern: RegExp
  readonly releaseActors: readonly string[]
}

export function checkGeneratedBundles(
  input: BundleGateInput,
  policy: BundleGatePolicy,
): { readonly pass: boolean; readonly reason: string } {
  const generated = input.changedFiles.filter(isGeneratedBundle)
  if (generated.length === 0) return { pass: true, reason: "no generated bundle in the diff" }
  if (policy.releaseBranchPattern.test(input.branch) && policy.releaseActors.includes(input.author)) {
    return { pass: true, reason: "release-state PR carries the regenerated bundles" }
  }
  const shown = generated.slice(0, 5).join(", ")
  const more = generated.length > 5 ? ` and ${generated.length - 5} more` : ""
  return {
    pass: false,
    reason: `generated bundles are not committed in PRs (#9903): ${shown}${more}. Restore them with \`git checkout origin/dev -- <paths>\`; the bundle-regen workflow rebuilds them on dev after the merge.`,
  }
}
