// Memory palace generator: collects committed HEAD data plus local runtime state and writes a
// self-contained HTML viewer to <identity runtime>/viewers/palace-<ts>.html (0600 in a 0700 dir).

import { chmod, mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { GitMemoryRepo, renderExternalProjection } from "@oh-my-opencode/memory-core"

import type { MemoryIdentityContext } from "../context"
import {
  collectCore,
  collectExternal,
  collectHistory,
  collectReflection,
  type PalaceCoreEntry,
  type PalaceExternalEntry,
  type PalaceHistory,
  type PalaceReflection,
} from "./collectors"
import { collectPeople, type PalacePeople, type PalacePeopleOptions } from "./people"
import { PALACE_DATA_PLACEHOLDER, PALACE_PEOPLE_PANEL, PALACE_PEOPLE_TAB, PALACE_TEMPLATE } from "./template"

const VIEWER_DIR_MODE = 0o700
const VIEWER_FILE_MODE = 0o600
const DEFAULT_OUTCOME_LIMIT = 10
/** Schema defaults (`memory.people`); callers with resolved settings pass their own. */
const DEFAULT_PEOPLE_OPTIONS: PalacePeopleOptions = {
  enabled: true,
  limits: { maxEntries: 40, maxEntryChars: 200 },
}

export interface PalaceMetadata {
  readonly identity: string
  readonly headSha: string | null
  readonly recompiledAt: string
}

export interface PalaceData {
  readonly metadata: PalaceMetadata
  readonly core: { readonly entries: readonly PalaceCoreEntry[] }
  readonly external: { readonly entries: readonly PalaceExternalEntry[]; readonly tree: string }
  readonly history: PalaceHistory
  readonly reflection: PalaceReflection
  /** Absent when `memory.people.enabled` is false: the panel is then never rendered. */
  readonly people?: PalacePeople
}

export interface GeneratePalaceOptions {
  readonly now?: () => Date
  readonly outcomeLimit?: number
  readonly people?: PalacePeopleOptions
}

export interface GeneratePalaceResult {
  readonly path: string
  readonly data: PalaceData
}

export async function generatePalaceHtml(
  context: MemoryIdentityContext,
  options: GeneratePalaceOptions = {},
): Promise<GeneratePalaceResult> {
  const generatedAt = (options.now ?? (() => new Date()))()
  const data = await collectPalaceData(context, {
    generatedAt,
    outcomeLimit: options.outcomeLimit ?? DEFAULT_OUTCOME_LIMIT,
    ...(options.people === undefined ? {} : { people: options.people }),
  })
  const html = renderPalaceHtml(data)

  const viewersDir = context.identityPaths.viewers
  await mkdir(viewersDir, { recursive: true, mode: VIEWER_DIR_MODE })
  await chmod(viewersDir, VIEWER_DIR_MODE)

  const path = join(viewersDir, `palace-${fileTimestamp(generatedAt)}.html`)
  await writeFile(path, html, { encoding: "utf8", mode: VIEWER_FILE_MODE })
  await chmod(path, VIEWER_FILE_MODE)
  return { path, data }
}

export async function collectPalaceData(
  context: MemoryIdentityContext,
  options: {
    readonly generatedAt: Date
    readonly outcomeLimit: number
    readonly people?: PalacePeopleOptions
  },
): Promise<PalaceData> {
  const repo = new GitMemoryRepo({ dir: context.identityPaths.repo, agentId: context.identity })
  const head = await repo.head().catch(() => null)
  const peopleOptions = options.people ?? DEFAULT_PEOPLE_OPTIONS
  const [core, external, history, reflection, people] = await Promise.all([
    collectCore(repo, head),
    collectExternal(repo, head),
    collectHistory(repo),
    collectReflection(context.identityPaths, { limit: options.outcomeLimit }),
    collectPeople(repo, head, peopleOptions),
  ])
  return {
    metadata: {
      identity: context.identity,
      headSha: head,
      recompiledAt: options.generatedAt.toISOString(),
    },
    core: { entries: core },
    external: { entries: external, tree: renderExternalProjection(external.map((entry) => entry.path)) },
    history,
    reflection,
    ...(people === undefined ? {} : { people }),
  }
}

export function renderPalaceHtml(data: PalaceData): string {
  return PALACE_TEMPLATE.replace(PALACE_DATA_PLACEHOLDER, () => encodePalaceData(data))
    .replace(PALACE_PEOPLE_TAB, () => (data.people === undefined ? "" : PALACE_PEOPLE_TAB))
    .replace(PALACE_PEOPLE_PANEL, () => (data.people === undefined ? "" : PALACE_PEOPLE_PANEL))
}

/**
 * Inline JSON hardening: `<` blocks `</script>` breakout, and U+2028/U+2029 are escaped because
 * they terminate a JavaScript line even inside a string literal.
 */
export function encodePalaceData(data: PalaceData): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")
}

function fileTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-")
}
