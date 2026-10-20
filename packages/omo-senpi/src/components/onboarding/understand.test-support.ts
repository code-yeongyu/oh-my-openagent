import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"

import type { ChildHandle, ChildSpec, InProcessRunnerLike } from "@oh-my-opencode/senpi-task"

import { FACTS_RECORD_TOOL_NAME, type FactsRecordTool } from "../memory/facts-record-tool"
import type { SessionDigest } from "./session-history"

export const UNDERSTAND_MODEL = "omo-mock/mock-1"

export type FakeTurn = (turn: {
  readonly spec: ChildSpec
  readonly start: number
  readonly record: (text: string) => Promise<boolean>
}) => Promise<"completed" | "error" | "hang" | "throw">

/**
 * A fake model behind the real facts launch path: `launchFactsInProcess` builds the child spec and the
 * `record_fact` tool, this runner plays the model's turn by calling that tool.
 */
export function fakeModel(turn: FakeTurn, hooks: { readonly onAbort?: (spec: ChildSpec) => Promise<void> } = {}) {
  const starts: ChildSpec[] = []
  let call = 0
  const createRunner = (): InProcessRunnerLike => ({
    start: async (spec: ChildSpec): Promise<ChildHandle> => {
      starts.push(spec)
      const tool = spec.memberScopedTools?.find((candidate) => candidate.name === FACTS_RECORD_TOOL_NAME) as unknown as FactsRecordTool | undefined
      if (tool === undefined) throw new Error("the facts child was started without record_fact")
      const record = async (text: string): Promise<boolean> => {
        call += 1
        const result = await tool.execute(`call-${call}`, { scope: "project", text, date: "2026-10-18" })
        return result.isError !== true
      }
      const outcome = await turn({ spec, start: starts.length, record })
      if (outcome === "throw") throw new Error("model provider unavailable")
      const idle = outcome === "hang"
        ? new Promise<never>(() => undefined)
        : Promise.resolve(outcome === "completed"
          ? { status: "completed" as const, finalResponse: "" }
          : { status: "error" as const, failure: { kind: "child_failed", message: "503 upstream" } as never })
      return {
        task_id: spec.taskId,
        sessionId: `session-${spec.taskId}`,
        effectiveModel: () => undefined,
        steer: async () => undefined,
        followUp: async () => undefined,
        abort: async () => { await hooks.onAbort?.(spec) },
        subscribe: () => () => undefined,
        waitForIdle: () => idle,
        lastAssistantText: () => undefined,
        dispose: async () => undefined,
      }
    },
  })
  return { starts, createRunner }
}

export function digest(cwd: string, index: number, extra: Partial<SessionDigest> = {}): SessionDigest {
  const at = new Date(Date.parse("2026-10-18T00:00:00.000Z") - index * 60_000).toISOString()
  return {
    sessionKey: `codex:${basename(cwd)}-${index}`,
    source: "codex",
    providerSessionId: `${basename(cwd)}-${index}`,
    cwd,
    title: `Session ${index} in ${basename(cwd)}`,
    model: null,
    startedAt: at,
    lastActiveAt: at,
    messageCount: 2,
    firstRequest: `Run the tests with bun in ${basename(cwd)}`,
    toolsUsed: [{ name: "bash", count: 1 }],
    filesChanged: [],
    outcome: "Done.",
    truncated: false,
    ...extra,
  }
}

export async function tempRoot(prefix: string): Promise<{ readonly path: string; cleanup(): Promise<void> }> {
  const path = await mkdtemp(join(tmpdir(), prefix))
  return { path, cleanup: () => rm(path, { recursive: true, force: true }) }
}

export async function snapshotTree(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await walk(path)
      else out[path] = `${(await stat(path)).size}:${await readFile(path, "utf8")}`
    }
  }
  await walk(root)
  return out
}

export async function understandRunDirs(): Promise<string[]> {
  return (await readdir(tmpdir())).filter((name) => name.startsWith("omo-onboarding-understand-"))
}
