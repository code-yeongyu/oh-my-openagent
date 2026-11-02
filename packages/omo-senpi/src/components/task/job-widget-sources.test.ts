import { describe, expect, it } from "bun:test"

import type { ManagedChildEvent, TaskRecord, TaskStatus } from "@oh-my-opencode/senpi-task"

import type { JobWidgetBriefText, JobWidgetSourceRegistration, JobWidgetTextChunk } from "./job-widget-host"
import {
  backgroundCommandWatch,
  createTaskJobWidgetFeed,
  TASK_TOOL_CALL_MARK,
  TASK_TOOLS_SOURCE_ID,
  type TaskJobWidgetManager,
} from "./job-widget-sources"

class FakeTap {
  text = ""
  closed = false
  constructor(readonly id: string, readonly label: string) {}
  append(text: string): void { this.text += text }
  close(): void { this.closed = true }
  read(from: number): JobWidgetTextChunk { return { start: from, end: this.text.length, text: this.text.slice(from), open: !this.closed } }
}

type HandleLog = { notify: number; settle: number; dispose: number; updates: JobWidgetBriefText[] }

function fakeRegistry(options: { readonly accepts?: boolean } = {}) {
  const registrations: JobWidgetSourceRegistration[] = []
  const handles: HandleLog[] = []
  const taps: FakeTap[] = []
  return {
    registrations,
    handles,
    taps,
    sources: {
      register: (registration: JobWidgetSourceRegistration) => {
        registrations.push(registration)
        if (options.accepts === false) return undefined
        const log: HandleLog = { notify: 0, settle: 0, dispose: 0, updates: [] }
        handles.push(log)
        return {
          notify: () => { log.notify += 1 },
          update: (brief: JobWidgetBriefText) => { log.updates.push(brief) },
          settle: () => { log.settle += 1 },
          dispose: () => { log.dispose += 1 },
        }
      },
      createTap: (id: string, label: string) => {
        const tap = new FakeTap(id, label)
        taps.push(tap)
        return tap
      },
    },
  }
}

function fakeManager(records: () => readonly TaskRecord[] = () => []) {
  const listeners = new Map<string, Set<(event: ManagedChildEvent) => void>>()
  const manager: TaskJobWidgetManager = {
    subscribeChild: (taskId, listener) => {
      const set = listeners.get(taskId) ?? new Set()
      set.add(listener)
      listeners.set(taskId, set)
      return () => { set.delete(listener) }
    },
    list: (scope) => records().filter((record) => record.parent_session_id === scope.session_id).map((record) => ({ record })),
  }
  return {
    manager,
    emit: (taskId: string, event: ManagedChildEvent) => { for (const listener of listeners.get(taskId) ?? []) listener(event) },
    subscribers: (taskId: string) => listeners.get(taskId)?.size ?? 0,
  }
}

function record(status: TaskStatus, overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    task_id: "st_bg",
    description: "Run the benchmark",
    parent_session_id: "session-a",
    root_session_id: "session-a",
    depth: 1,
    execution_mode: "process",
    model: "omo-mock/mock-1",
    status,
    residency_state: "resident",
    created_at: "2026-10-28T00:00:00.000Z",
    started_at: "2026-10-28T00:00:05.000Z",
    updated_at: "2026-10-28T00:00:06.000Z",
    notify_on_terminal: true,
    notification: { run_epoch: 0, notified_epoch: -1 },
    spawn_spec: { version: 1, cwd: "/project", prompt: "Run bench.sh and report the p95 latency." },
    ...overrides,
  }
}

function feedWith(options: { readonly accepts?: boolean; readonly records?: () => readonly TaskRecord[] } = {}) {
  const registry = fakeRegistry(options)
  const child = fakeManager(options.records)
  let sessionId: string | undefined = "session-a"
  const feed = createTaskJobWidgetFeed({ sources: registry.sources, manager: child.manager, sessionId: () => sessionId })
  return { registry, child, feed, switchSession: (next: string | undefined) => { sessionId = next } }
}

describe("task job widget sources", () => {
  it("#given a background task of this session #when it starts running #then one task job is registered with its id, brief, start time and a tools tap", () => {
    // given
    const { registry, child, feed } = feedWith()

    // when
    feed.observe({ taskId: "st_bg", record: record("pending") })
    feed.observe({ taskId: "st_bg", record: record("running") })

    // then
    expect(registry.registrations).toHaveLength(1)
    const registration = registry.registrations[0]
    expect(registration?.sessionId).toBe("session-a")
    expect(registration?.id).toBe("st_bg")
    expect(registration?.kind).toBe("task")
    expect(registration?.brief).toEqual({ task: "Run bench.sh and report the p95 latency.", intent: "Run the benchmark" })
    expect(registration?.brief.watch).toBeUndefined()
    expect(registration?.startedAtMs).toBe(Date.parse("2026-10-28T00:00:05.000Z"))
    expect(registration?.sources.map((source) => source.id)).toEqual([TASK_TOOLS_SOURCE_ID])
    expect(child.subscribers("st_bg")).toBe(1)
  })

  it("#given a registered task #when its child finishes tool calls #then each lands in the tap as a marker line plus result text and notifies", () => {
    // given
    const { registry, child, feed } = feedWith()
    feed.observe({ taskId: "st_bg", record: record("running") })

    // when
    child.emit("st_bg", { type: "tool_execution_start", toolCallId: "c1", toolName: "bash", args: { command: "./bench.sh --runs 3" } })
    child.emit("st_bg", { type: "tool_execution_update", toolCallId: "c1", toolName: "bash" })
    child.emit("st_bg", { type: "tool_execution_end", toolCallId: "c1", toolName: "bash", result: { content: [{ type: "text", text: "run 1 p95=12ms" }, { type: "image", data: "x" }, { type: "text", text: "run 2 p95=11ms" }] } })
    child.emit("st_bg", { type: "tool_execution_end", toolCallId: "c2", toolName: "read", result: "plain text result" })
    child.emit("st_bg", { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "not a tool call" }] } })

    // then
    expect(registry.taps[0]?.text).toBe(
      `\n${TASK_TOOL_CALL_MARK}bash ./bench.sh --runs 3\nrun 1 p95=12ms\nrun 2 p95=11ms\n` +
      `\n${TASK_TOOL_CALL_MARK}read\nplain text result\n`,
    )
    expect(registry.handles[0]?.notify).toBe(2)
  })

  it("#given a tool result over 64 Ki characters #when it lands in the tap #then only its last 64 Ki characters are kept", () => {
    // given
    const { registry, child, feed } = feedWith()
    feed.observe({ taskId: "st_bg", record: record("running") })
    const head = "h".repeat(10)
    const tail = "t".repeat(64 * 1024)

    // when
    child.emit("st_bg", { type: "tool_execution_end", toolCallId: "c1", toolName: "bash", result: head + tail })

    // then
    expect(registry.taps[0]?.text).toBe(`\n${TASK_TOOL_CALL_MARK}bash\n${tail}\n`)
  })

  it("#given a running task job #when the task reaches a terminal status #then the tap closes, the widget settles once and the child is no longer read", () => {
    // given
    const { registry, child, feed } = feedWith()
    feed.observe({ taskId: "st_bg", record: record("running") })

    // when
    feed.observe({ taskId: "st_bg", record: record("completed") })
    feed.observe({ taskId: "st_bg", record: record("completed") })
    child.emit("st_bg", { type: "tool_execution_end", toolCallId: "late", toolName: "bash", result: "late" })

    // then
    expect(registry.handles[0]?.settle).toBe(1)
    expect(registry.handles[0]?.dispose).toBe(0)
    expect(registry.taps[0]?.closed).toBe(true)
    expect(registry.taps[0]?.text).toBe("")
    expect(child.subscribers("st_bg")).toBe(0)
  })

  it("#given a settled task job #when task_send revives the task #then the old widget is disposed and the new run gets a fresh one", () => {
    // given
    const { registry, feed } = feedWith()
    feed.observe({ taskId: "st_bg", record: record("running") })
    feed.observe({ taskId: "st_bg", record: record("completed") })

    // when
    feed.observe({ taskId: "st_bg", record: record("running") })

    // then
    expect(registry.registrations).toHaveLength(2)
    expect(registry.handles[0]?.dispose).toBe(1)
    expect(registry.handles[1]?.dispose).toBe(0)
  })

  it("#given task jobs #when a record is removed, the session changes, or the feed is disposed #then each widget is disposed and its child subscription released", () => {
    // given
    const { registry, child, feed, switchSession } = feedWith()
    feed.observe({ taskId: "st_bg", record: record("running") })
    feed.observe({ taskId: "st_two", record: record("running", { task_id: "st_two" }) })
    feed.observe({ taskId: "st_three", record: record("running", { task_id: "st_three" }) })

    // when
    feed.observe({ taskId: "st_bg", record: null })
    switchSession("session-b")
    feed.observe({ taskId: "st_other", record: record("running", { task_id: "st_other", parent_session_id: "session-b" }) })
    feed.dispose()

    // then
    expect(registry.handles.map((handle) => handle.dispose)).toEqual([1, 1, 1, 1])
    expect(["st_bg", "st_two", "st_three", "st_other"].map((taskId) => child.subscribers(taskId))).toEqual([0, 0, 0, 0])
  })

  it("#given tasks that are not this session's background tasks #when they run #then no widget source is registered", () => {
    // given
    const { registry, feed } = feedWith()

    // when
    feed.observe({ taskId: "st_fg", record: record("running", { task_id: "st_fg", notify_on_terminal: false }) })
    feed.observe({ taskId: "st_grandchild", record: record("running", { task_id: "st_grandchild", parent_session_id: "child-session" }) })

    // then
    expect(registry.registrations).toEqual([])
  })

  it("#given a session without job widgets #when a background task runs and changes #then registration is tried once and nothing is tapped", () => {
    // given
    const { registry, child, feed } = feedWith({ accepts: false })

    // when
    feed.observe({ taskId: "st_bg", record: record("running") })
    feed.observe({ taskId: "st_bg", record: record("running", { updated_at: "2026-10-28T00:01:00.000Z" }) })

    // then
    expect(registry.registrations).toHaveLength(1)
    expect(child.subscribers("st_bg")).toBe(0)
  })

  it("#given background tasks already running when the feed attaches #when the session starts #then sync registers them from the manager's session list", () => {
    // given
    const running = [record("running"), record("running", { task_id: "st_other_session", parent_session_id: "session-z" })]
    const { registry, feed } = feedWith({ records: () => running })

    // when
    feed.sync()
    feed.sync()

    // then
    expect(registry.registrations.map((entry) => entry.id)).toEqual(["st_bg"])
  })
})

describe("task job widget watch hints from background commands", () => {
  const text = (value: string) => ({ content: [{ type: "text", text: value }] })

  it("#given a child that renders with blender in the background and reads its output #when the calls finish #then the watch names the command once and the tap holds the render lines", () => {
    // given
    const { registry, child, feed } = feedWith()
    feed.observe({ taskId: "st_bg", record: record("running") })

    // when
    child.emit("st_bg", { type: "tool_execution_start", toolCallId: "c1", toolName: "bash", args: { command: "blender -b scene.blend -a", run_in_background: true } })
    child.emit("st_bg", { type: "tool_execution_end", toolCallId: "c1", toolName: "bash", result: text("bash_id: bash_1 (background)") })
    child.emit("st_bg", { type: "tool_execution_start", toolCallId: "c2", toolName: "bash_output", args: { bash_id: "bash_1" } })
    child.emit("st_bg", { type: "tool_execution_end", toolCallId: "c2", toolName: "bash_output", result: text("Fra:1 Mem:120M | Rendering 1 / 250 samples\nFra:2 Mem:121M | Rendering 2 / 250 samples") })
    child.emit("st_bg", { type: "tool_execution_start", toolCallId: "c3", toolName: "bash_output", args: { bash_id: "bash_1" } })
    child.emit("st_bg", { type: "tool_execution_end", toolCallId: "c3", toolName: "bash_output", result: text("Fra:3 Mem:121M | Rendering 3 / 250 samples") })

    // then
    expect(registry.handles[0]?.updates).toEqual([{
      task: "Run bench.sh and report the p95 latency.",
      intent: "Run the benchmark",
      watch: "background command: blender -b scene.blend -a",
    }])
    const tap = registry.taps[0]?.text ?? ""
    expect(tap).toContain(`${TASK_TOOL_CALL_MARK}bash_output bash_1\nFra:1 Mem:120M | Rendering 1 / 250 samples\nFra:2 Mem:121M | Rendering 2 / 250 samples\n`)
    expect(tap).toContain("Fra:3 Mem:121M | Rendering 3 / 250 samples")
    expect(tap).toContain(`${TASK_TOOL_CALL_MARK}bash blender -b scene.blend -a\n`)
  })

  it("#given a child that only reads, edits and runs foreground commands #when the calls finish #then no watch is set", () => {
    // given
    const { registry, child, feed } = feedWith()
    feed.observe({ taskId: "st_bg", record: record("running") })

    // when
    child.emit("st_bg", { type: "tool_execution_start", toolCallId: "r1", toolName: "read", args: { path: "src/a.ts" } })
    child.emit("st_bg", { type: "tool_execution_end", toolCallId: "r1", toolName: "read", result: text("export const a = 1") })
    child.emit("st_bg", { type: "tool_execution_start", toolCallId: "e1", toolName: "edit", args: { path: "src/a.ts", run_in_background: true } })
    child.emit("st_bg", { type: "tool_execution_end", toolCallId: "e1", toolName: "edit", result: text("edited") })
    child.emit("st_bg", { type: "tool_execution_start", toolCallId: "b1", toolName: "bash", args: { command: "bun test", run_in_background: false } })
    child.emit("st_bg", { type: "tool_execution_end", toolCallId: "b1", toolName: "bash", result: text("3 pass") })

    // then
    expect(registry.handles[0]?.updates).toEqual([])
    expect(registry.registrations[0]?.brief.watch).toBeUndefined()
  })

  it("#given two background commands #when the second starts and the first later finishes #then the newest command stays the watch", () => {
    // given
    const { registry, child, feed } = feedWith()
    feed.observe({ taskId: "st_bg", record: record("running") })

    // when
    child.emit("st_bg", { type: "tool_execution_start", toolCallId: "b1", toolName: "bash", args: { command: "./train.sh", run_in_background: true } })
    child.emit("st_bg", { type: "tool_execution_start", toolCallId: "b2", toolName: "bash", args: { command: "./eval.sh", run_in_background: true } })
    child.emit("st_bg", { type: "tool_execution_start", toolCallId: "b3", toolName: "bash", args: { command: "./eval.sh", run_in_background: true } })
    child.emit("st_bg", { type: "tool_execution_end", toolCallId: "b1", toolName: "bash", result: text("exit 0") })

    // then
    expect(registry.handles[0]?.updates.map((brief) => brief.watch)).toEqual([
      "background command: ./train.sh",
      "background command: ./eval.sh",
    ])
  })

  it("#given a background command carrying secrets and a long tail #when it becomes the watch #then secrets are redacted before the 300-character cut", () => {
    // when
    const watch = backgroundCommandWatch(`OPENAI_API_KEY=sk-live-abcdefghijklmnopqrstuv ./run --token hunter2 --password 'p w' ${"x".repeat(400)}`)

    // then
    expect(watch.startsWith("background command: OPENAI_API_KEY=[REDACTED] ./run --token [REDACTED] --password [REDACTED] ")).toBe(true)
    expect(watch).not.toContain("hunter2")
    expect(watch).not.toContain("sk-live")
    expect(watch.length).toBe("background command: ".length + 300)
  })
})
