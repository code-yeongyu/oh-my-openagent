import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import type { CreateAgentSessionOptions, ToolDefinition } from "@code-yeongyu/senpi"
import type { CreateChildSession } from "@oh-my-opencode/senpi-task"
import { PendingNudges } from "@oh-my-opencode/memory-core"
import type { ChildHandle } from "@oh-my-opencode/senpi-task"
import { MemorianGateRunner } from "./memorian-runner"
import { CANDIDATE_PATH, fixture, launchInput, nudgeOnce, registrySnapshot, roots, runnerOptions, scriptedSession, SESSION_ID } from "./memorian-runner.test-support"
import { rmEfaultTolerant } from "./teardown.test-support"

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rmEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))) })

describe("MemorianGateRunner", () => {
  test("#given a gate child that calls nudge on a valid candidate #when the runner launches #then the validated nudge lands in the pending store", async () => {
    // given
    const { identityPaths } = await fixture()
    const stub = scriptedSession(nudgeOnce)
    const runner = new MemorianGateRunner(runnerOptions(identityPaths, { createSession: stub.createSession }))

    // when
    const pending = runner.launch(launchInput())
    stub.resolve()
    const result = await pending

    // then
    expect(result.status).toBe("nudged")
    expect(await new PendingNudges(identityPaths.recallPending).take(SESSION_ID, { currentEpoch: 0 })).toEqual([
      { path: CANDIDATE_PATH, hint: "Drain nodes before a rollout." },
    ])
  })

  test("#given a snapshotted registry on the input #when the ctx behind it is already disposed #then the launch still succeeds", async () => {
    // given: production hands the runner a registry captured synchronously at settle. The runner
    // holds no ctx-reading seam at all, so the snapshot is the whole story of how it resolves.
    const { identityPaths } = await fixture()
    const stub = scriptedSession(nudgeOnce)
    const runner = new MemorianGateRunner(runnerOptions(identityPaths, { createSession: stub.createSession }))

    // when
    const pending = runner.launch(launchInput({ modelRegistry: registrySnapshot() }))
    stub.resolve()
    const result = await pending

    // then
    expect(result.status).toBe("nudged")
    expect(await new PendingNudges(identityPaths.recallPending).take(SESSION_ID, { currentEpoch: 0 })).toEqual([
      { path: CANDIDATE_PATH, hint: "Drain nodes before a rollout." },
    ])
  })

  test("#given no registry snapshot on the input #when the runner launches #then it warns, skips and creates no child session", async () => {
    // given: the settle handler is the ONLY place allowed to read the senpi ctx. When its
    // synchronous snapshot came back unavailable the runner has no legal source left: consulting
    // a resolver here would read a ctx the host disposed the moment the handler returned.
    const { identityPaths } = await fixture()
    const stub = scriptedSession(nudgeOnce)
    const warnings: string[] = []
    const runner = new MemorianGateRunner(runnerOptions(identityPaths, {
      createSession: stub.createSession,
      logger: { info: () => undefined, warn: (message) => warnings.push(message), error: () => undefined },
    }))

    // when: the settle snapshot came back unavailable
    const result = await runner.launch(launchInput({ modelRegistry: undefined }))

    // then
    expect(result.status).toBe("skipped")
    expect(stub.created).toBe(0)
    expect(warnings).toEqual(["memorian gate registry snapshot unavailable"])
    expect(await new PendingNudges(identityPaths.recallPending).take(SESSION_ID, { currentEpoch: 0 })).toEqual([])
  })

  test("#given the quick category cannot resolve #when the runner launches #then it warns, skips and creates no child session", async () => {
    // given
    const { identityPaths } = await fixture()
    const stub = scriptedSession(nudgeOnce)
    const warnings: string[] = []
    const runner = new MemorianGateRunner(runnerOptions(identityPaths, {
      loadConfig: () => ({ config: { categories: {} }, diagnostics: [], layers: [], sources: [] }),
      createSession: stub.createSession,
      logger: { info: () => undefined, warn: (message) => warnings.push(message), error: () => undefined },
    }))

    // when
    const result = await runner.launch(launchInput({ modelRegistry: registrySnapshot([]) }))

    // then
    expect(result.status).toBe("skipped")
    expect(stub.created).toBe(0)
    expect(warnings).toHaveLength(1)
    expect(await new PendingNudges(identityPaths.recallPending).take(SESSION_ID, { currentEpoch: 0 })).toEqual([])
  })

  test("#given no quick category but another usable registry model #when the runner launches #then it warns, skips and never rides the beyond-category ladder", async () => {
    // given: resolveReflectionModel's beyond-category ladder resolves ANY usable registry model when
    // the quick chain is dead. The gate is quick-PINNED: an advisory read must never launch on an
    // arbitrary (possibly frontier-priced) model behind the operator's back.
    const { identityPaths } = await fixture()
    const stub = scriptedSession(nudgeOnce)
    const warnings: string[] = []
    const runner = new MemorianGateRunner(runnerOptions(identityPaths, {
      loadConfig: () => ({ config: { categories: {} }, diagnostics: [], layers: [], sources: [] }),
      createSession: stub.createSession,
      logger: { info: () => undefined, warn: (message) => warnings.push(message), error: () => undefined },
    }))

    // when
    const result = await runner.launch(launchInput({ modelRegistry: registrySnapshot([{ id: "expensive-1" }]) }))

    // then
    expect(result.status).toBe("skipped")
    expect(stub.created).toBe(0)
    expect(warnings).toEqual(["memorian gate quick category unavailable"])
    expect(await new PendingNudges(identityPaths.recallPending).take(SESSION_ID, { currentEpoch: 0 })).toEqual([])
  })

  test("#given a launch already in flight #when a second trigger arrives #then only one child session is created", async () => {
    // given: the first launch holds the latch until the test releases its turn.
    const { identityPaths } = await fixture()
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const stub = scriptedSession(async (options) => {
      await nudgeOnce(options)
      await gate
    })
    const runner = new MemorianGateRunner(runnerOptions(identityPaths, { createSession: stub.createSession }))

    // when: the second trigger arrives while the first turn is still open
    const first = runner.launch(launchInput())
    const second = runner.launch(launchInput())
    stub.resolve()
    release?.()
    const [firstResult, secondResult] = await Promise.all([first, second])

    // then
    expect(stub.created).toBe(1)
    expect([firstResult.status, secondResult.status].sort()).toEqual(["active", "nudged"])
  })

  test("#given a child that nudges the same valid candidate twice #when the runner validates the result #then one pending nudge is written", async () => {
    // given
    const { identityPaths } = await fixture()
    const stub = scriptedSession(async (options) => {
      await nudgeOnce(options)
      await nudgeOnce(options)
    })
    const runner = new MemorianGateRunner(runnerOptions(identityPaths, { createSession: stub.createSession }))

    // when
    const pending = runner.launch(launchInput())
    stub.resolve()
    const result = await pending

    // then
    expect(result.status).toBe("nudged")
    expect(await new PendingNudges(identityPaths.recallPending).take(SESSION_ID, { currentEpoch: 0 })).toEqual([
      { path: CANDIDATE_PATH, hint: "Drain nodes before a rollout." },
    ])
  })

  test("#given a child session that cannot be created #when the runner launches #then the failure names the creation cause", async () => {
    // given
    const { identityPaths } = await fixture()
    const runner = new MemorianGateRunner(runnerOptions(identityPaths, {
      createSession: async () => {
        throw new Error("boot failed")
      },
    }))

    // when
    const result = await runner.launch(launchInput())

    // then
    expect(result).toMatchObject({ status: "failed", cause: "session_create_failed" })
    expect(await new PendingNudges(identityPaths.recallPending).take(SESSION_ID, { currentEpoch: 0 })).toEqual([])
  })

  test("#given a child turn that ends with an error #when the runner launches #then the failure names the child cause", async () => {
    // given: the turn's prompt itself rejects, so the handle records a typed child failure.
    const { identityPaths } = await fixture()
    const failing = scriptedSession(async () => {
      throw new Error("provider exploded")
    })
    const runner = new MemorianGateRunner(runnerOptions(identityPaths, { createSession: failing.createSession }))

    // when
    const result = await runner.launch(launchInput())

    // then
    expect(result).toMatchObject({ status: "failed", cause: "child_failed", reason: "provider exploded" })
    expect(result.runId).toMatch(/^[0-9a-f-]{36}$/)
    expect(await new PendingNudges(identityPaths.recallPending).take(SESSION_ID, { currentEpoch: 0 })).toEqual([])
  })

  test("#given a completed run #when the runner finishes #then the run directory is kept with its auditable artifacts", async () => {
    // given: the run dir is no longer scratch - candidates and the transcript window stay behind as
    // human-auditable artifacts of what the judge actually saw (pruning is deliberately out of scope).
    const { identityPaths } = await fixture()
    const stub = scriptedSession(nudgeOnce)
    const runner = new MemorianGateRunner(runnerOptions(identityPaths, { createSession: stub.createSession }))

    // when
    const pending = runner.launch(launchInput())
    stub.resolve()
    await pending

    // then
    const runsDir = join(identityPaths.recall, "runs")
    const entries = await readdir(runsDir)
    expect(entries).toHaveLength(1)
    const runDir = join(runsDir, entries[0] ?? "")
    expect(JSON.parse(await readFile(join(runDir, "candidates.json"), "utf8"))).toMatchObject({
      version: 1,
      maxItems: 2,
      candidates: [{ path: CANDIDATE_PATH }],
      surfaced: [],
    })
    expect(await readFile(join(runDir, "transcript-window.txt"), "utf8"))
      .toBe("user: how do we handle kubernetes rollouts\n")
  })

  test("#given an inlined launch #when the child session is created #then the judge prompt carries the inputs inline with a bare envelope", async () => {
    // given: the child gets its inputs IN the user message and the persona as the system prompt, so
    // it needs no file access and the ancestry wrapper never wraps the memorian persona.
    const { identityPaths } = await fixture()
    const stub = scriptedSession(nudgeOnce)
    let captured: CreateAgentSessionOptions | undefined
    const createSession: CreateChildSession = async (options) => {
      captured = options
      return await stub.createSession(options)
    }
    const runner = new MemorianGateRunner(runnerOptions(identityPaths, { createSession }))

    // when
    const pending = runner.launch(launchInput())
    stub.resolve()
    await pending

    // then: the prompt is the input block itself, inlined
    expect(stub.promptTexts).toHaveLength(1)
    const prompt = stub.promptTexts[0] ?? ""
    expect(prompt).not.toContain("You are running as an omo senpi-task child")
    expect(prompt).toContain("<memorian-input>")
    expect(prompt).toContain(`"maxItems": 2`)
    expect(prompt).toContain(CANDIDATE_PATH)
    expect(prompt).toContain("user: how do we handle kubernetes rollouts")
    // and the child session runs the memorian persona as its system prompt with only the nudge tool
    expect(captured?.resourceLoader?.getSystemPrompt()).toContain("# Memorian — memory nudge agent")
    expect(captured?.tools).toEqual(["nudge"])
    const toolNames = (captured?.customTools ?? []).map((tool) => tool.name)
    expect(toolNames).toEqual(["nudge"])
  })})
