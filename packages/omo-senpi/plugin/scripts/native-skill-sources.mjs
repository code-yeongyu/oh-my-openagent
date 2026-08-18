import { join } from "node:path"

/**
 * Senpi-native skills authored directly against the omo-senpi tool surface (not ported from Codex or
 * the shared pool). They ship verbatim aside from blank-line normalization: no edition rewrite, no
 * section stripping, and no Senpi-compatibility banner (they already speak native Senpi tools).
 *
 * Ordered alphabetically by name; the orchestrator preserves this ordering when syncing.
 */

/**
 * @typedef {Object} SkillSource
 * @property {string} name
 * @property {string} source
 */

/**
 * Build the native Senpi skill source registry rooted at `repoRoot`.
 *
 * @param {string} repoRoot - The repository root directory.
 * @returns {{ sources: SkillSource[], names: Set<string> }}
 */
export function createNativeSkillSources(repoRoot) {
  const nativeSkillsRoot = join(repoRoot, "omo-senpi", "skills")

  /** @type {SkillSource[]} */
  const sources = [
    {
      name: "dag-library",
      source: join(nativeSkillsRoot, "dag-library"),
    },
    {
      name: "give-me-tips",
      source: join(nativeSkillsRoot, "give-me-tips"),
    },
    {
      name: "hyperplan",
      source: join(nativeSkillsRoot, "hyperplan"),
    },
    {
      name: "init-deep",
      source: join(nativeSkillsRoot, "init-deep"),
    },
    {
      name: "mass-ulw",
      source: join(nativeSkillsRoot, "mass-ulw"),
    },
    {
      name: "onboarding",
      source: join(nativeSkillsRoot, "onboarding"),
    },
    {
      name: "ultrawork",
      source: join(nativeSkillsRoot, "ultrawork"),
    },
    {
      // Senpi-local override of the shared ulw-plan (omo-opencode consumes the shared file, so the
      // ast-grep/LSP-first rewrite cannot land there). Seeded from the fully senpi-adapted bundle
      // output, so it already carries the review-policy overlays and compatibility banner verbatim.
      name: "ulw-plan",
      source: join(nativeSkillsRoot, "ulw-plan"),
    },
    {
      name: "ulw-research",
      source: join(nativeSkillsRoot, "ulw-research"),
    },
  ]

  const names = new Set(sources.map(({ name }) => name))

  return { sources, names }
}
