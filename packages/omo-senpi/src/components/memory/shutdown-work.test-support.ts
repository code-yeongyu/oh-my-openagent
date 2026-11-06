import { realpathSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { GitMemoryRepo } from "@oh-my-opencode/memory-core"

import type { MemoryIdentityRuntime } from "./identity-runtime"
import type { SyncRunner } from "./sync-runner"
import type { TransientSweepResult } from "./transient-sweep"
import { rmEfaultTolerant } from "./teardown.test-support"

export const AGENT_ID = "shutdown-work-agent"

export interface Gate {
  readonly entered: Promise<void>
  enter(): void
  readonly opened: Promise<void>
  open(): void
}

export function gate(): Gate {
  let enter: () => void = () => undefined
  let open: () => void = () => undefined
  const entered = new Promise<void>((resolve) => {
    enter = resolve
  })
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })
  return { entered, enter, opened, open }
}

export function gatedStep(held: Gate): { readonly step: () => Promise<void>; readonly finished: Promise<void> } {
  let finish: () => void = () => undefined
  const finished = new Promise<void>((resolve) => {
    finish = resolve
  })
  return {
    step: async () => {
      held.enter()
      await held.opened
      finish()
    },
    finished,
  }
}

export class HeadGatedRepo extends GitMemoryRepo {
  constructor(dir: string, private readonly headGate: Gate) {
    super({ dir, agentId: AGENT_ID })
  }

  override async head(): Promise<string | null> {
    this.headGate.enter()
    await this.headGate.opened
    return super.head()
  }
}

const tempDirs: string[] = []

export async function tempRoot(prefix: string): Promise<string> {
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), prefix)))
  tempDirs.push(dir)
  return dir
}

export async function removeTempRoots(): Promise<void> {
  await Promise.all(tempDirs.splice(0).map((dir) => rmEfaultTolerant(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
}

export async function seededRepoDir(): Promise<string> {
  const dir = await tempRoot("omo-shutdown-work-repo-")
  await new GitMemoryRepo({ dir, agentId: AGENT_ID }).init({
    seedFiles: [{ relativePath: "system/persona.md", content: "---\ndescription: Persona\n---\nsettled\n" }],
  })
  return dir
}

export const EMPTY_SWEEP: TransientSweepResult = { removedRuns: 0, removedIdentities: 0, promoted: 0, stranded: 0, kept: 0 }

export const idleSyncRunner: SyncRunner = {
  acquire: async () => {},
  release: async () => {},
  status: async () => null,
  deviceName: () => undefined,
}

export function launchlessRuntime(): MemoryIdentityRuntime {
  const runtime: Pick<MemoryIdentityRuntime, "launch" | "reconcile" | "settled"> = {
    launch: async () => {},
    reconcile: async () => {},
    settled: async () => {},
  }
  return runtime as unknown as MemoryIdentityRuntime
}

export function sessionEventContext(sessionId: string): unknown {
  return {
    sessionManager: {
      getEntries: () => [],
      getSessionId: () => sessionId,
      getBranch: () => [],
    },
    hasUI: true,
    ui: { notify: () => {} },
  }
}
