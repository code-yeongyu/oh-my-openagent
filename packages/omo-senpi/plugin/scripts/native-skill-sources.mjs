import { isAbsolute, join, relative, sep } from "node:path"

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
 * @property {string[]} [sharedAssets] - Paths relative to `shared-skills/skills/<name>` copied byte-for-byte
 *   over the shipped native skill after its own copy; they must not exist in the native source.
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
      // The deliverable runtime and its gate reference are edition-neutral, so they live once in the
      // shared pool and are overlaid at sync time instead of being duplicated into the native source.
      name: "ulw-research",
      source: join(nativeSkillsRoot, "ulw-research"),
      sharedAssets: ["scripts", "references/report-gates.md", "references/deliverable-phase.md"],
    },
  ]

  const names = new Set(sources.map(({ name }) => name))

  return { sources, names }
}

/**
 * Map a path inside a native skill's source dir that falls under one of its `sharedAssets` to the
 * shared source file the sync overlays there. The native source intentionally has no copy of those
 * assets, so repo-wide checks (the markdown link audit) resolve them here instead of reporting them
 * missing. Returns null for any path outside a listed asset.
 *
 * @param {string} repoRoot - The same root `createNativeSkillSources` takes (the packages directory).
 * @param {string} targetPath - Absolute path as written relative to the native skill source.
 * @returns {string | null}
 */
export function sharedAssetSourceFor(repoRoot, targetPath) {
  for (const { name, source, sharedAssets = [] } of createNativeSkillSources(repoRoot).sources) {
    const fromSkill = relative(source, targetPath)
    if (fromSkill === "" || fromSkill.startsWith("..") || isAbsolute(fromSkill)) continue
    const portable = fromSkill.split(sep).join("/")
    if (sharedAssets.some((asset) => portable === asset || portable.startsWith(`${asset}/`))) {
      return join(repoRoot, "shared-skills", "skills", name, fromSkill)
    }
  }
  return null
}
