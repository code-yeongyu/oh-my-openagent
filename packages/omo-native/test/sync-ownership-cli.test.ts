import { afterEach, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { Command } from "commander"

import { MEMORY_ROOT_ENV_VAR } from "../../memory-core/src/identity/layout"
import { DECISION_FILE, UNDECIDED_FILE } from "../../memory-core/src/sync/engine/ownership-decision"
import { configureSyncCommands, EXIT_UNSUPPORTED_HERE, type SyncCommandDependencies } from "../sync-cli"
import type { SyncContext } from "../sync-context"
import { RUN_OWNERSHIP_YOURSELF } from "../sync-ownership-cli"
import { createInMemoryDeviceKeyring } from "../../memory-core/src/sync/keyring-port"
import type { AccountHttp, PairingHttp } from "../../memory-core/src/sync/account/index.ts"

const initialExitCode = process.exitCode
const roots: string[] = []
afterEach(async () => {
  process.exitCode = initialExitCode ?? 0
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function waitingMemory(files: number): Promise<{ root: string; gitDir: string }> {
  const root = await mkdtemp(join(tmpdir(), "omo-ownership-"))
  roots.push(root)
  const gitDir = join(root, "agents", "agent-1", "repo", ".git")
  await mkdir(gitDir, { recursive: true })
  await writeFile(join(gitDir, UNDECIDED_FILE), JSON.stringify({ account: "acc_a", files, at: 1 }))
  return { root, gitDir }
}

const unused = (): never => {
  throw new Error("not used by ownership")
}

function signedInAs(account: string): SyncContext {
  const chain: AccountHttp = {
    listKeys: unused,
    listEntries: unused,
    listEntriesAfter: unused,
    listRecoveryWraps: unused,
    appendKeys: unused,
    recoveryJoin: unused,
    state: unused,
  }
  const pairing: PairingHttp = {
    setAccountSync: unused,
    setDeviceSync: unused,
    disableDeviceSync: unused,
    listPending: unused,
    openPending: unused,
    readPending: unused,
    answerPending: unused,
    revealPending: unused,
  }
  const authority = { signal: new AbortController().signal, admit: <T>(dispatch: () => T): T => dispatch() }
  return {
    account,
    serviceDeviceId: "dev_svc",
    keyring: createInMemoryDeviceKeyring("p"),
    pinDir: tmpdir(),
    chain,
    pairing,
    authority,
  }
}

interface Run {
  readonly out: string[]
  readonly err: string[]
  readonly asked: string[]
  readonly contextCalls: number
}

async function omo(args: readonly string[], env: Record<string, string>, answer: boolean): Promise<Run> {
  const run = { out: [] as string[], err: [] as string[], asked: [] as string[], contextCalls: 0 }
  const dependencies: SyncCommandDependencies = {
    context: async () => {
      run.contextCalls += 1
      return signedInAs("acc_a")
    },
    clock: { now: () => 0, sleep: async () => undefined },
    output: (line) => run.out.push(line),
    error: (line) => run.err.push(line),
    confirm: async (question) => {
      run.asked.push(question)
      return answer
    },
    interactive: true,
    env,
    terminalAvailable: () => true,
  }
  const program = new Command("omo")
  configureSyncCommands(program, dependencies)
  await program.parseAsync(["sync", "ownership", ...args], { from: "user" })
  return run
}

test("#given an agent harness runs it #when the person's memory would be uploaded #then use is refused before anything is read or recorded", async () => {
  const { root, gitDir } = await waitingMemory(3)

  const run = await omo(["use"], { [MEMORY_ROOT_ENV_VAR]: root, AI_AGENT: "1" }, true)

  expect(process.exitCode).toBe(EXIT_UNSUPPORTED_HERE)
  expect(run.err).toContain(RUN_OWNERSHIP_YOURSELF)
  expect(run.contextCalls).toBe(0)
  expect(run.asked).toEqual([])
  expect(existsSync(join(gitDir, DECISION_FILE))).toBe(false)
})

test("#given the person is asked to upload the files to the account #when they do not confirm #then nothing is recorded", async () => {
  const { root, gitDir } = await waitingMemory(3)

  const run = await omo(["use"], { [MEMORY_ROOT_ENV_VAR]: root }, false)

  expect(run.asked).toHaveLength(1)
  expect(run.asked[0]).toContain("3 memory files")
  expect(run.asked[0]).toContain("acc_a")
  expect(process.exitCode).toBe(1)
  expect(existsSync(join(gitDir, DECISION_FILE))).toBe(false)
})

test("#given the person confirms the upload #when use runs #then the decision records the account and the confirmed file count", async () => {
  const { root, gitDir } = await waitingMemory(3)

  await omo(["use"], { [MEMORY_ROOT_ENV_VAR]: root }, true)

  expect(process.exitCode).toBe(0)
  expect(JSON.parse(await readFile(join(gitDir, DECISION_FILE), "utf8"))).toEqual({
    account: "acc_a",
    decision: "use",
    files: 3,
  })
})

test("#given the person sets the memory aside #when set-aside runs #then it is recorded without a confirmation, since nothing leaves the device", async () => {
  const { root, gitDir } = await waitingMemory(3)

  const run = await omo(["set-aside"], { [MEMORY_ROOT_ENV_VAR]: root, AI_AGENT: "1" }, false)

  expect(run.asked).toEqual([])
  expect(process.exitCode).toBe(0)
  expect(JSON.parse(await readFile(join(gitDir, DECISION_FILE), "utf8"))).toMatchObject({ decision: "set_aside" })
})
