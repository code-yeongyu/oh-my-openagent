/**
 * Default memory seeding — letta parity port (plan todo 33).
 *
 * Seeds a fresh memory repo with system/persona.md + system/human.md
 * rendered with frontmatter, then delegates to GitMemoryRepo.init which
 * writes, stages, and commits them as a single initial commit
 * ("chore: initialize local memory"). If the repo already has a HEAD
 * commit, GitMemoryRepo.init returns the existing HEAD unchanged — the
 * no-overwrite guarantee lives there (P4, letta memory-git.ts:1431-1492),
 * so this module never duplicates that guard.
 *
 * Alignment with P4 (GitMemoryRepo.init):
 * - P4's InitializeGitRepoOptions.seedFiles already accepts GitSeedFile[].
 * - P4 already commits seeds with INITIAL_COMMIT = "chore: initialize local memory".
 * - P4 already falls back to EMPTY_INITIAL_COMMIT when there are no seeds
 *   or no changes.
 * - P4 already no-ops (returns existing HEAD) when the repo has any commit.
 * So initMemoryWithSeeds is a thin adapter: build seed files from content
 * constants, hand them to repo.init. No logic duplication.
 */

import type { GitMemoryRepo, GitSeedFile } from "../git"
import { renderMemoryFile } from "../memfs/frontmatter"
import {
  DEFAULT_HUMAN_BODY,
  DEFAULT_PERSONA_BODY,
} from "./default-memory"
import {
  MEMORY_DISCIPLINE_SKILL_CONTENT,
  MEMORY_DISCIPLINE_SKILL_PATH,
} from "./memory-discipline"

export { DEFAULT_MEMORY_BLOCK_LABELS } from "./default-memory"

const PERSONA_PATH = "system/persona.md"
const HUMAN_PATH = "system/human.md"

const PERSONA_DESCRIPTION = "Persona - who I am"
const HUMAN_DESCRIPTION = "Person - Human"
const HUMAN_ALIASES: readonly string[] = []

export interface DefaultSeedFile extends GitSeedFile {}

export interface InitMemorySeedsOptions {
  authorName?: string
}

/**
 * Build the default seed files: system/persona.md + system/human.md with
 * frontmatter rendered from the content constants, plus the
 * memory-discipline skill (pre-rendered, SKILL.md frontmatter).
 *
 * Pure — no filesystem access. Safe to call repeatedly.
 */
export function buildDefaultSeedFiles(): readonly DefaultSeedFile[] {
  return [
    {
      relativePath: PERSONA_PATH,
      content: renderMemoryFile({ description: PERSONA_DESCRIPTION }, DEFAULT_PERSONA_BODY),
    },
    {
      relativePath: HUMAN_PATH,
      content: renderMemoryFile(
        { description: HUMAN_DESCRIPTION, kind: "person", aliases: HUMAN_ALIASES },
        DEFAULT_HUMAN_BODY,
      ),
    },
    {
      relativePath: MEMORY_DISCIPLINE_SKILL_PATH,
      content: MEMORY_DISCIPLINE_SKILL_CONTENT,
    },
  ]
}

/**
 * Initialize a memory repo with default seed content.
 *
 * Delegates to GitMemoryRepo.init with the default seed files. The
 * no-overwrite guard (existing HEAD -> immediate return) is enforced
 * inside GitMemoryRepo.init, so calling this on an already-initialized
 * repo is a safe no-op.
 *
 * Returns the HEAD sha after initialization.
 */
export async function initMemoryWithSeeds(
  repo: GitMemoryRepo,
  options: InitMemorySeedsOptions = {},
): Promise<string> {
  return repo.init({
    authorName: options.authorName,
    seedFiles: buildDefaultSeedFiles(),
  })
}
