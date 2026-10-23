import { describe, expect, test } from "bun:test"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"

import {
  AGREEMENTS_PATH,
  GitMemoryRepo,
  agreementId,
  agreementItemsOf,
  buildDefaultSeedFiles,
  consumeAgreementsNoticeDelta,
  readAgreementsAt,
} from "@oh-my-opencode/memory-core"
import { OmoConfigSchema } from "@oh-my-opencode/omo-config-core"
import type { ChildHandle, ChildSpec, InProcessRunnerLike } from "@oh-my-opencode/senpi-task"

import { FACTS_AGREEMENT_TOOL_NAME } from "./facts-agreement-tool"
import { FactsExtractorRunner } from "./facts-runner"
import type { FactsExtractorRunnerOptions } from "./facts-runner-types"
import { enqueue, fixture, runnerOptions } from "./facts-runner.test-support"

const MONITOR = "Never filter the message monitor output"
const MONITOR_ID = agreementId(MONITOR)
const LEDGER = `---\ndescription: Agreements\n---\n\n- [global] ${MONITOR} <!-- id: ${MONITOR_ID}; by: agent; n: 2; since: 2026-08-01; last: 2026-08-09; status: active -->\n`

function withMaxItems(load: FactsExtractorRunnerOptions["loadConfig"], maxItems: number): FactsExtractorRunnerOptions["loadConfig"] {
  return () => {
    const loaded = load()
    return { ...loaded, config: OmoConfigSchema.parse({ ...loaded.config, memory: { agreements: { max_items: maxItems } } }) }
  }
}

type AgreementToolLike = { readonly name: string; readonly execute: (id: string, params: Record<string, unknown>) => Promise<{ readonly isError?: boolean }> }

function handle(spec: ChildSpec): ChildHandle {
  return {
    task_id: spec.taskId,
    sessionId: `session-${spec.taskId}`,
    effectiveModel: () => undefined,
    steer: async () => undefined,
    followUp: async () => undefined,
    abort: async () => undefined,
    subscribe: () => () => undefined,
    waitForIdle: async () => ({ status: "completed", finalResponse: "" }),
    lastAssistantText: () => undefined,
    dispose: async () => undefined,
  }
}

describe("facts lane: a repeat correction counts against its agreement", () => {
  test("#given an agreement corrected twice and a third correction in the transcript #when the extractor reaffirms it through the real tool #then the committed ledger reads n 3 needs-human, an unknown id is refused, and the flag is announced once", async () => {
    // given
    const { root, identity, queue } = await fixture()
    await enqueue(queue, identity, "session-1", "m2", "또 모니터 필터링했네, 하지 말라고 했잖아")
    const repo = new GitMemoryRepo({ dir: identity.paths.repo, agentId: identity.id })
    await repo.init({ seedFiles: [...buildDefaultSeedFiles(), { relativePath: AGREEMENTS_PATH, content: LEDGER }] })
    const seen: { allowlist?: readonly string[]; payloadIds?: readonly string[]; unknown?: boolean } = {}
    const createRunner = (): InProcessRunnerLike => ({
      start: async (spec: ChildSpec): Promise<ChildHandle> => {
        seen.allowlist = spec.toolAllowlist
        const payload = JSON.parse(spec.prompt.slice(spec.prompt.indexOf("\n\n") + 2)) as { readonly agreements?: readonly { readonly id: string }[] }
        seen.payloadIds = payload.agreements?.map((item) => item.id)
        const tool = (spec.memberScopedTools as readonly AgreementToolLike[] | undefined)?.find((candidate) => candidate.name === FACTS_AGREEMENT_TOOL_NAME)
        if (tool === undefined) throw new Error("record_agreement was not offered to the facts child")
        seen.unknown = (await tool.execute("a-0", { action: "reaffirm", id: "0000000000", date: "2026-08-10" })).isError === true
        await tool.execute("a-1", { action: "reaffirm", id: MONITOR_ID, date: "2026-08-10" })
        return handle(spec)
      },
    })
    const runner = new FactsExtractorRunner(runnerOptions(root, identity, queue, "empty", { createRunner }))

    // when
    const result = await runner.launchPending()

    // then
    expect(result.status).toBe("committed")
    expect(seen.allowlist).toContain(FACTS_AGREEMENT_TOOL_NAME)
    expect(seen.payloadIds).toEqual([MONITOR_ID])
    expect(seen.unknown).toBe(true)
    const head = await repo.head()
    if (head === null) throw new Error("no HEAD after the facts commit")
    expect(agreementItemsOf(await readAgreementsAt(repo, head))).toEqual([{
      id: MONITOR_ID, scope: "global", by: "agent", text: MONITOR, n: 3,
      since: "2026-08-01", last: "2026-08-10", status: "needs-human",
    }])
    expect((await repo.log())[0]?.trailers["Generated-By"]).toBe("facts-extractor")
    const notices = { noticesDir: identity.paths.notices, locksDir: identity.paths.locks }
    expect((await consumeAgreementsNoticeDelta(repo, notices)).map((item) => item.id)).toEqual([MONITOR_ID])
    expect(await consumeAgreementsNoticeDelta(repo, notices)).toEqual([])
  }, 30_000)

  test("#given the person drops an agreement while the extractor is reaffirming it #when the run finalizes #then nothing is committed, the run ends no_facts instead of failing, and the stale reaffirm is logged", async () => {
    // given
    const { root, identity, queue } = await fixture()
    await enqueue(queue, identity, "session-1", "m2", "또 모니터 필터링했네")
    const repo = new GitMemoryRepo({ dir: identity.paths.repo, agentId: identity.id })
    await repo.init({ seedFiles: [...buildDefaultSeedFiles(), { relativePath: AGREEMENTS_PATH, content: LEDGER }] })
    const warnings: Array<{ message: string; details?: unknown }> = []
    const logger = { info: () => undefined, error: () => undefined, warn: (message: string, details?: unknown) => { warnings.push({ message, details }) } }
    let droppedHead: string | null = null
    const createRunner = (): InProcessRunnerLike => ({
      start: async (spec: ChildSpec): Promise<ChildHandle> => {
        const tool = (spec.memberScopedTools as readonly AgreementToolLike[] | undefined)?.find((candidate) => candidate.name === FACTS_AGREEMENT_TOOL_NAME)
        if (tool === undefined) throw new Error("record_agreement was not offered to the facts child")
        await tool.execute("a-1", { action: "reaffirm", id: MONITOR_ID, date: "2026-08-10" })
        await writeFile(join(repo.dir, AGREEMENTS_PATH), "---\ndescription: Agreements\n---\n")
        await repo.commitWrite([AGREEMENTS_PATH], "/agreements drop", { agentId: identity.id, authorName: "Person" })
        droppedHead = await repo.head()
        return handle(spec)
      },
    })
    const runner = new FactsExtractorRunner(runnerOptions(root, identity, queue, "empty", { createRunner, logger }))

    // when
    const result = await runner.launchPending()

    // then
    expect(result.status).toBe("no_facts")
    expect(await repo.head()).toBe(droppedHead)
    expect(warnings.some((entry) => entry.message.startsWith("agreement reaffirm ignored")
      && JSON.stringify(entry.details).includes(MONITOR_ID))).toBe(true)
  }, 30_000)

  test("#given a full ledger #when the extractor records a new agreement #then the oldest unreaffirmed one is evicted and named in the facts commit", async () => {
    // given
    const { root, identity, queue } = await fixture()
    await enqueue(queue, identity, "session-1", "m2", "run roots never go in tmp")
    const repo = new GitMemoryRepo({ dir: identity.paths.repo, agentId: identity.id })
    const old = "Use bun, never npm"
    const reaffirmed = ["Answer in Korean", "Never push to main", "Never push to dev", "Quote remote commands", "Read before editing", "Keep commits atomic"]
      .map((text) => `- [global] ${text} <!-- id: ${agreementId(text)}; by: agent; n: 2; since: 2026-06-01; last: 2026-06-01; status: active -->\n`)
    const full = `${LEDGER}- [global] ${old} <!-- id: ${agreementId(old)}; by: agent; n: 1; since: 2026-07-01; last: 2026-07-01; status: active -->\n${reaffirmed.join("")}`
    await repo.init({ seedFiles: [...buildDefaultSeedFiles(), { relativePath: AGREEMENTS_PATH, content: full }] })
    const createRunner = (): InProcessRunnerLike => ({
      start: async (spec: ChildSpec): Promise<ChildHandle> => {
        const tool = (spec.memberScopedTools as readonly AgreementToolLike[] | undefined)?.find((candidate) => candidate.name === FACTS_AGREEMENT_TOOL_NAME)
        if (tool === undefined) throw new Error("record_agreement was not offered to the facts child")
        await tool.execute("a-1", { action: "new", applies: "project", text: "Keep run roots out of tmp", date: "2026-08-10" })
        return handle(spec)
      },
    })
    const options = runnerOptions(root, identity, queue, "empty", { createRunner })
    const runner = new FactsExtractorRunner({ ...options, loadConfig: withMaxItems(options.loadConfig, 8) })

    // when
    const result = await runner.launchPending()

    // then
    expect(result.status).toBe("committed")
    const head = await repo.head()
    if (head === null) throw new Error("no HEAD after the facts commit")
    const texts = agreementItemsOf(await readAgreementsAt(repo, head)).map((item) => item.text)
    expect(texts).toHaveLength(8)
    expect(texts).toContain("Keep run roots out of tmp")
    expect(texts).not.toContain(old)
    expect((await repo.log())[0]?.trailers["Omo-Agreement-Evicted"]).toBe(agreementId(old))
  }, 30_000)
})
