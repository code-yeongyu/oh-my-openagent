import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  ASTRA_DAG_RUN_VERIFICATION_DIRECTIVE,
  ASTRA_DAG_VERIFICATION_DIRECTIVE,
  DAG_VERIFICATION_DIRECTIVE,
  buildCompletionMessage,
  createCompletionNotifier,
  createTaskRecord,
  createTaskRecordStore,
  type CompletionDetails,
  type TaskRecord,
} from "@oh-my-opencode/senpi-task"
import type { DagNodeId, DagRunId } from "@oh-my-opencode/senpi-task/dag"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { IdleInjectionCoordinator, type IdleInjectionMessage } from "../../extension/idle-injection-coordinator"
import { createDagWake } from "./dag-wake"
import { wireDagVerificationContext } from "./dag-verification-context"
import { createParentNotifier } from "./parent-notifier"
import { TaskRuntimeContext } from "./runtime-context"
import { createSessionArming, createUltraworkComponent } from "../ultrawork"
import { SENPI_ASTRA_ULTRAWORK_DIRECTIVE, SENPI_ULTRAWORK_DIRECTIVE } from "../ultrawork/generated-directive"

const ASTRA = "chatgpt-subscription/gpt-6-astra"
const SOL = "openai/gpt-6.1-sol"
const counts = { total: 1, pending: 0, blocked: 0, scheduled: 0, running: 0, completed: 1, failed: 0, cancelled: 0, skipped: 0 }
const fixtureRoots: string[] = []

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function details(childModel = SOL): CompletionDetails {
  return {
    task_id: "st_12345678", name: "verify", status: "completed", model: childModel,
    duration_ms: 10, final_response: "done", continuation_hint: "",
    dag: { run_id: "dag_1", node_id: "verify" },
  }
}

function harness(receiverModel: unknown, includeUlw = false) {
  const pi = new FakeExtensionAPI()
  if (includeUlw) createUltraworkComponent(createSessionArming()).register(pi, {
    config: { getFlag: () => undefined }, logger: { info() {}, warn() {}, error() {} },
  })
  const runtime = new TaskRuntimeContext("/project")
  runtime.captureFrom({ model: receiverModel, isIdle: () => false })
  let scheduled: (() => void) | undefined
  const delivered: IdleInjectionMessage[] = []
  const coordinator = new IdleInjectionCoordinator((message) => { delivered.push(message) }, {
    scheduleFlush: (flush) => { scheduled = flush },
  })
  const notifier = createParentNotifier(pi, coordinator, () => true, undefined, () => runtime.parentModel())
  const wake = createDagWake({ coordinator, parentState: () => runtime.parentState(), getReceiverModel: () => runtime.parentModel() })
  wireDagVerificationContext(pi, runtime)
  return { pi, runtime, notifier, wake, delivered, flush: () => { scheduled?.(); scheduled = undefined } }
}

function completeRun(target: ReturnType<typeof harness>, type = "dag.run.completed"): void {
  target.wake.onRunEvent({ runId: "dag_1", name: "release", parentSessionId: "parent" }, { runId: "dag_1", seq: 1, type, counts })
}

describe("DAG receiving-model routing", () => {
  for (const [receiver, child, astra] of [
    [ASTRA, SOL, true],
    ["gateway/openai/gpt-6-astra-fast", SOL, true],
    ["openai/gpt-6-sol", ASTRA, false],
    [SOL, ASTRA, false],
    ["openai/gpt-6-luna", ASTRA, false],
    ["anthropic/claude-opus-5-5", ASTRA, false],
    ["unknown", ASTRA, false],
    [undefined, ASTRA, false],
  ] as const) {
    test(`#given receiver ${receiver} and child ${child} #when a node completion delivers #then only the receiver selects its policy`, () => {
      // given: the child model is deliberately independent of the parent.
      const target = harness({ id: receiver })
      // when
      target.notifier.enqueue(buildCompletionMessage([details(child)]))
      target.flush()
      // then: compare the selected production artifact, not its prose wording.
      expect(target.delivered).toHaveLength(1)
      expect(target.delivered[0]?.content).toEndWith(astra ? ASTRA_DAG_VERIFICATION_DIRECTIVE : DAG_VERIFICATION_DIRECTIVE)
    })
  }

  for (const [before, after, astra] of [[ASTRA, SOL, false], [SOL, ASTRA, true], [ASTRA, undefined, false]] as const) {
    test(`#given queued node and run completions on ${before} #when receiver becomes ${after} before flush #then both use the current receiver`, () => {
      // given
      const target = harness({ id: before })
      target.notifier.enqueue(buildCompletionMessage([details()]))
      completeRun(target)
      // when
      target.runtime.captureFrom({ model: after === undefined ? undefined : { id: after } })
      target.flush()
      // then: the node and the whole-run policies remain distinct in one batched wake.
      const content = target.delivered[0]?.content ?? ""
      expect(target.delivered).toHaveLength(1)
      expect(content).toContain(astra ? ASTRA_DAG_VERIFICATION_DIRECTIVE : DAG_VERIFICATION_DIRECTIVE)
      expect(content).toEndWith(astra ? ASTRA_DAG_RUN_VERIFICATION_DIRECTIVE : DAG_VERIFICATION_DIRECTIVE)
    })
  }

  test("#given a live host model getter #when fallback replaces its model after enqueue #then the wake uses the fallback model", () => {
    // given
    let model = { id: ASTRA }
    const target = harness(undefined)
    target.runtime.captureFrom({ get model() { return model } })
    target.notifier.enqueue(buildCompletionMessage([details()]))
    // when
    model = { id: SOL }
    target.flush()
    // then
    expect(target.delivered[0]?.content).toEndWith(DAG_VERIFICATION_DIRECTIVE)
  })

  test("#given a DAG terminal buffered during compaction #when the receiver changes before session start #then release selects the new model", async () => {
    // given
    const target = harness({ id: SOL })
    target.runtime.setTransition("compacting")
    completeRun(target)
    // when
    target.runtime.captureFrom({ model: { id: ASTRA } })
    target.runtime.setTransition(undefined)
    target.wake.onSessionStart("parent")
    await Promise.resolve()
    // then
    expect(target.delivered).toHaveLength(1)
    expect(target.delivered[0]?.content).toEndWith(ASTRA_DAG_RUN_VERIFICATION_DIRECTIVE)
  })

  test("#given a node completion buffered during a session transition #when the receiver changes before release #then the real notifier delivers the current node policy once", () => {
    // given: a real temporary record store and the normal completion engine own the buffer.
    const root = mkdtempSync(join(tmpdir(), "omo-dag-receiver-"))
    fixtureRoots.push(root)
    const target = harness({ id: SOL })
    const store = createTaskRecordStore({ project_dir: root, task: { state_dir: join(root, "state") } })
    const record: TaskRecord = {
      ...createTaskRecord({ parent_session_id: "parent", root_session_id: "parent", depth: 1, execution_mode: "in-process", model: SOL, notify_on_terminal: true }),
      status: "completed", final_response: "done",
      owner: { kind: "dag", runId: "dag_1" as DagRunId, nodeId: "verify" as DagNodeId, fingerprint: "fixture" },
    }
    store.save(record)
    const completion = createCompletionNotifier({ notifier: target.notifier, store })
    completion.notifyTerminal({ record, parentState: { kind: "session_switching" }, runInBackground: true })
    // when
    target.runtime.captureFrom({ model: { id: ASTRA } })
    const released = completion.flushBuffered({ sessionId: "parent", replaced: false })
    target.flush()
    // then
    expect(released).toEqual({ kind: "flushed", count: 1 })
    expect(target.delivered).toHaveLength(1)
    expect(target.delivered[0]?.content).toEndWith(ASTRA_DAG_VERIFICATION_DIRECTIVE)
    expect(store.load(record.task_id)?.notification.notified_epoch).toBe(0)
  })

  test("#given direct delivery without a coordinator #when an Astra parent receives a Sol node #then the node policy selects Astra", () => {
    // given
    const pi = new FakeExtensionAPI()
    const notifier = createParentNotifier(pi, undefined, undefined, undefined, () => ASTRA)
    // when
    notifier.enqueue(buildCompletionMessage([details()]))
    // then
    expect(pi.messages[0]?.message["content"]).toEndWith(ASTRA_DAG_VERIFICATION_DIRECTIVE)
  })

  for (const [before, after, astra] of [[ASTRA, SOL, false], [SOL, ASTRA, true], [ASTRA, undefined, false]] as const) {
    test(`#given a mixed wake already delivered on ${before} #when the model-call context uses ${after} #then canonical node/run policies change without changing the transcript`, async () => {
      // given
      const target = harness({ id: before })
      target.notifier.enqueue(buildCompletionMessage([details()]))
      completeRun(target)
      target.flush()
      const original = target.delivered[0]
      const message = { ...original, role: "custom" }
      // when
      const results = await target.pi.dispatch("context", { messages: [message] }, { model: after === undefined ? undefined : { id: after } })
      // then
      const expected = buildCompletionMessage([details()], astra ? ASTRA_DAG_VERIFICATION_DIRECTIVE : DAG_VERIFICATION_DIRECTIVE).content
        + `\n\nDAG "release" completed: 1 completed, 0 failed, 0 cancelled, 0 skipped (1 total)\n\n${astra ? ASTRA_DAG_RUN_VERIFICATION_DIRECTIVE : DAG_VERIFICATION_DIRECTIVE}`
      const nodeEnd = buildCompletionMessage([details()], astra ? ASTRA_DAG_VERIFICATION_DIRECTIVE : DAG_VERIFICATION_DIRECTIVE).content.length
      expect(results).toEqual([{ messages: [{ ...message, content: expected, details: [
        { ...message.details?.[0], contentRange: [0, nodeEnd] },
        { ...message.details?.[1], contentRange: [nodeEnd + 2, expected.length] },
      ] }] }])
      expect(original?.content).toEndWith(before === ASTRA ? ASTRA_DAG_RUN_VERIFICATION_DIRECTIVE : DAG_VERIFICATION_DIRECTIVE)
    })
  }

  test("#given plain, paused and user-authored canonical text #when the context selects Astra #then unrelated messages are untouched", async () => {
    // given
    const target = harness({ id: SOL })
    const messages = [
      { role: "user", content: DAG_VERIFICATION_DIRECTIVE },
      { role: "custom", customType: "senpi-task.completion", content: DAG_VERIFICATION_DIRECTIVE, details: [{ model: ASTRA }] },
      { role: "custom", customType: "omo-senpi.dag-run", content: DAG_VERIFICATION_DIRECTIVE, details: { status: "paused" } },
    ]
    // when
    const results = await target.pi.dispatch("context", { messages }, { model: { id: ASTRA } })
    // then
    expect(results).toEqual([undefined])
  })

  test("#given a DAG completion followed by a plain child's canonical quotation #when context switches to Astra #then only the actual DAG policy changes", async () => {
    // given: both entries pass through the production coordinator in one wake.
    const target = harness({ id: SOL })
    const plain: CompletionDetails = {
      task_id: "st_87654321", name: "quote", status: "completed", model: ASTRA,
      duration_ms: 10, final_response: `Here is the requested literal:\n${DAG_VERIFICATION_DIRECTIVE}`, continuation_hint: "",
    }
    target.notifier.enqueue(buildCompletionMessage([details()]))
    target.notifier.enqueue(buildCompletionMessage([plain]))
    target.flush()
    const message = { ...target.delivered[0], role: "custom" }
    // when
    const results = await target.pi.dispatch("context", { messages: [message] }, { model: { id: ASTRA } })
    // then: the emitted plain result is byte-preserved and the DAG's policy artifact is selected.
    const expected = buildCompletionMessage([details()], ASTRA_DAG_VERIFICATION_DIRECTIVE).content + "\n\n" + buildCompletionMessage([plain]).content
    expect(results).toEqual([{ messages: [{ ...message, content: expected, details: [
      { ...message.details?.[0], contentRange: [0, buildCompletionMessage([details()], ASTRA_DAG_VERIFICATION_DIRECTIVE).content.length] },
      message.details?.[1],
    ] }] }])
  })

  test("#given a historic untagged wake #when context switches model #then unknown segment provenance preserves its original text", async () => {
    // given
    const target = harness({ id: SOL })
    target.notifier.enqueue(buildCompletionMessage([details()]))
    target.flush()
    const delivered = target.delivered[0]
    const message = { ...delivered, role: "custom", details: delivered?.details.map(({ customType, details }) => ({ customType, details })) }
    // when
    const results = await target.pi.dispatch("context", { messages: [message] }, { model: { id: ASTRA } })
    // then: pre-change histories carry no trustworthy segment boundaries.
    expect(results).toEqual([undefined])
  })

  test("#given canonical ULW content before a scoped DAG policy #when earlier ULW context selection shifts its length #then DAG selection follows the updated boundary", async () => {
    // given: production registration order runs the ULW context hook first.
    const target = harness({ id: SOL }, true)
    const node = { ...details(), final_response: SENPI_ULTRAWORK_DIRECTIVE }
    target.notifier.enqueue(buildCompletionMessage([node]))
    completeRun(target)
    target.flush()
    const message = { ...target.delivered[0], role: "custom" }
    // when: FakeExtensionAPI exposes each handler's result, so feed the preceding result as the host does.
    const handlers = target.pi.handlers.filter((entry) => entry.event === "context")
    let payload: unknown = { messages: [message] }
    for (const entry of handlers) {
      const result = await entry.handler(payload, { model: { id: ASTRA } })
      if (result !== undefined) payload = result
    }
    // then
    const expectedNode = buildCompletionMessage([{ ...node, final_response: SENPI_ASTRA_ULTRAWORK_DIRECTIVE }], ASTRA_DAG_VERIFICATION_DIRECTIVE).content
    const expected = expectedNode + `\n\nDAG "release" completed: 1 completed, 0 failed, 0 cancelled, 0 skipped (1 total)\n\n${ASTRA_DAG_RUN_VERIFICATION_DIRECTIVE}`
    expect(payload).toEqual({ messages: [{ ...message, content: expected, details: [
      { ...message.details?.[0], contentRange: [0, expectedNode.length] },
      { ...message.details?.[1], contentRange: [expectedNode.length + 2, expected.length] },
    ] }] })
  })
})
