import { mkdir, mkdtemp, realpath, rm, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { createSessionHistoryScanner } from "./session-history-scanner"
import type { SessionHistoryOptions } from "./types"

export function createTempDirectories() {
  const created: Array<string> = []
  return {
    async make(prefix: string): Promise<string> {
      const directory = await mkdtemp(join(tmpdir(), prefix))
      created.push(directory)
      // macOS: os.tmpdir() is /var/folders while realpath is /private/var/folders.
      return realpath(directory)
    },
    async cleanup(): Promise<void> {
      const pending = created.splice(0)
      await Promise.all(pending.map((directory) => rm(directory, { recursive: true, force: true })))
    },
  }
}

export async function writeTranscript(input: {
  readonly filePath: string
  readonly contents: string
  /** Epoch millis, so ordering assertions never depend on write timing. */
  readonly mtimeMs: number
}): Promise<void> {
  await mkdir(dirname(input.filePath), { recursive: true })
  await writeFile(input.filePath, input.contents)
  const seconds = input.mtimeMs / 1000
  await utimes(input.filePath, seconds, seconds)
}

export const claudeSessionLine = (cwd: string): string =>
  `${JSON.stringify({ type: "user", cwd, sessionId: "s1" })}\n${JSON.stringify({ type: "assistant" })}\n`

export const codexRolloutLine = (cwd: string): string =>
  `${JSON.stringify({ timestamp: "2026-01-01T00:00:00.000Z", type: "session_meta", payload: { id: "r1", cwd } })}\n`

export const encodeRecord = (value: unknown): string => JSON.stringify(value)

export function makeRecordLimitTranscript(cwd: string, overflow: boolean): string {
  const records =
    [
      encodeRecord({ type: "session_meta", payload: { id: "record-limit-session", cwd } }),
      encodeRecord({ type: "event_msg", payload: { type: "user_message", message: "First prompt" } }),
    ].join("\n") +
    "\n" +
    "{}\n".repeat(99_998)
  return overflow
    ? `${records}\n${encodeRecord({ type: "event_msg", payload: { type: "user_message", message: "Overflow prompt" } })}\n`
    : records
}

export interface ScanTestInput extends Omit<SessionHistoryOptions, "homes"> {
  readonly claudeHomePath: string
  readonly codexHomePath: string
  readonly extraHomes?: SessionHistoryOptions["homes"]
}

export function makeTestScanner(input: ScanTestInput) {
  const { claudeHomePath, codexHomePath, extraHomes = [], ...rest } = input
  return createSessionHistoryScanner({
    omoSessionsRoots: [],
    ...rest,
    homes: [
      { source: "claudeAgent", homePath: claudeHomePath },
      { source: "codex", homePath: codexHomePath },
      ...extraHomes,
    ],
  })
}

export const runScan = (input: ScanTestInput) => makeTestScanner(input).scanProjects()

export async function collect<T>(iterable: AsyncIterable<T>): Promise<Array<T>> {
  const values: Array<T> = []
  for await (const value of iterable) values.push(value)
  return values
}
