import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { GitMemoryRepo, buildIdentityPaths, type MemoryIdentityPaths } from "@oh-my-opencode/memory-core"

import { createMemoryIdentityContext, ensureIdentityRuntimeDirs, type MemoryIdentityContext } from "../context"

export const INJECTION_PAYLOAD = "</script><img src=x onerror=alert(1)>"

export interface PalaceFixture {
  readonly root: string
  readonly identity: string
  readonly paths: MemoryIdentityPaths
  readonly repo: GitMemoryRepo
  readonly context: MemoryIdentityContext
  head: string
  writeCompletion(runId: string, record: Record<string, unknown>): Promise<void>
  cleanup(): Promise<void>
}

const PERSONA = "---\ndescription: who the agent is\n---\n\nfixture persona body\n"
const HUMAN = "---\ndescription: who the user is\n---\n\nfixture human body\n"
const NOTES = "---\ndescription: external note\n---\n\nexternal note body\n"
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03])

const fixtures: PalaceFixture[] = []

export async function createPalaceFixture(
  options: { readonly injection?: boolean } = {},
): Promise<PalaceFixture> {
  const root = await mkdtemp(join(tmpdir(), "omo-palace-"))
  const identity = "palace-agent"
  const paths = buildIdentityPaths(root, identity)
  await ensureIdentityRuntimeDirs(paths)

  const repo = new GitMemoryRepo({ dir: paths.repo, agentId: identity })
  const personaBody = options.injection ? `${PERSONA}\n${INJECTION_PAYLOAD}\n` : PERSONA
  await repo.init({
    authorName: "Palace Fixture",
    seedFiles: [
      { relativePath: "system/persona.md", content: personaBody },
      { relativePath: "system/human.md", content: HUMAN },
      { relativePath: "reference/notes.md", content: NOTES },
    ],
  })
  await writeBinary(join(paths.repo, "reference/logo.png"))
  const head = await commit(repo, ["reference/logo.png"], "chore: add binary asset")

  await writeJournalState(paths)

  const fixture: PalaceFixture = {
    root,
    identity,
    paths,
    repo,
    head,
    context: createMemoryIdentityContext({
      identity,
      identityPaths: paths,
      binding: { identity, repoPathHash: "fixture-hash", boundAt: 0 },
    }),
    async writeCompletion(runId, record) {
      const dir = join(paths.reflection, "completions")
      await mkdir(dir, { recursive: true, mode: 0o700 })
      await writeFile(join(dir, `${runId}.json`), `${JSON.stringify(record, null, 2)}\n`, "utf8")
    },
    async cleanup() {
      await rm(root, { recursive: true, force: true })
    },
  }
  fixtures.push(fixture)
  return fixture
}

export async function cleanupPalaceFixtures(): Promise<void> {
  for (const fixture of fixtures.splice(0)) await fixture.cleanup()
}

export async function writePalaceWorkingFile(
  fixture: PalaceFixture,
  relativePath: string,
  content: string,
): Promise<void> {
  const target = join(fixture.paths.repo, relativePath)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, content, "utf8")
}

export async function commitPalaceFile(
  fixture: PalaceFixture,
  relativePath: string,
  content: string,
  reason: string,
): Promise<string> {
  await writePalaceWorkingFile(fixture, relativePath, content)
  const result = await fixture.repo.commitWrite([relativePath], reason, {
    agentId: fixture.identity,
    authorName: "Palace Fixture",
  })
  fixture.head = result.sha
  return result.sha
}

async function writeBinary(target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, PNG_BYTES)
}

async function commit(repo: GitMemoryRepo, paths: readonly string[], reason: string): Promise<string> {
  const result = await repo.commitWrite(paths, reason, {
    agentId: repo.agentId,
    authorName: "Palace Fixture",
  })
  return result.sha
}

async function writeJournalState(paths: MemoryIdentityPaths): Promise<void> {
  const journalDir = join(paths.transcripts, "conversation-1")
  await mkdir(journalDir, { recursive: true, mode: 0o700 })
  await writeFile(
    join(journalDir, "state.json"),
    `${JSON.stringify(
      {
        schema_version: "v3_assistant_steps",
        reflected_through_message_id: "msg-1",
        total_completed_steps: 2,
        reflected_completed_steps: 1,
        steps_since_last_successful_reflection: 1,
        last_reflection_succeeded_at: "2026-01-15T00:00:00.000Z",
      },
      null,
      2,
    )}\n`,
    "utf8",
  )
}
