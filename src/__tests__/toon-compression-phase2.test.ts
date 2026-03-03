const { describe, expect, test } = require("bun:test")
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { sendSyncPrompt } from "../tools/delegate-task/sync-prompt-sender"
import { buildSystemContent } from "../tools/delegate-task/prompt-builder"
import { executeBackgroundTask } from "../tools/delegate-task/background-task"
import { executeSyncTask } from "../tools/delegate-task/sync-task"
import { executeSync } from "../tools/call-omo-agent/sync-executor"
import { buildCategorySkillsDelegationGuide, buildUltraworkSection } from "../agents/dynamic-agent-prompt-builder"
import { compressSkillTemplates } from "../features/opencode-skill-loader/skill-content-resolver"
import { compressCliMessage } from "../cli/run/runner"
import { compressDelegateTaskArgs } from "../tools/delegate-task/types"
import { compressParentContext } from "../tools/delegate-task/parent-context-resolver"
import { executeBackgroundContinuation } from "../tools/delegate-task/background-continuation"
import { createTask, preparePromptWithCompression, resumeTask, startTask } from "../features/background-agent/spawner"
import { BackgroundManager } from "../features/background-agent/manager"
import { clearSessionTools, getSessionTools, setSessionTools } from "../shared/session-tools-store"
import { formatTodoList } from "../hooks/todo-continuation-enforcer/continuation-injection"
import { createTaskGetTool } from "../tools/task/task-get"
import { createTaskUpdateTool } from "../tools/task/task-update"
import { createTaskCreateTool } from "../tools/task/task-create"
import { safeCompress, shouldCompress } from "../shared/toon-compression"

const on = { enabled: true, threshold: 100 }
const off = { enabled: false, threshold: 100 }
const toon = /\[\d+\]\{.*\}/
const rows = Array.from({ length: 12 }, (_, i) => ({ id: i, name: `item-${i}`, value: "x".repeat(120) }))
const promptJson = JSON.stringify(rows)

async function waitFor(check: () => boolean): Promise<void> {
  for (let i = 0; i < 40; i++) {
    if (check()) return
    await new Promise((r) => setTimeout(r, 5))
  }
}

describe("toon compression phase 2 integration", () => {
  test("tasks 20-27, 29-31: delegation flow honors enabled/disabled and fallback", async () => {
    let sentText = ""
    const client = { session: {} } as never
    const args = { description: "d", prompt: promptJson, run_in_background: false, load_skills: [], category: "quick" }
    await sendSyncPrompt(client, { sessionID: "s", agentToUse: "hephaestus", args: args as never, systemContent: undefined, categoryModel: undefined, toastManager: null, taskId: undefined, compressionConfig: on }, {
      promptWithModelSuggestionRetry: async (_c, p) => {
        const promptArgs = p as unknown as { body: { parts: Array<{ text: string }> } }
        sentText = String(promptArgs.body.parts[0].text)
      },
      promptSyncWithModelSuggestionRetry: async () => {},
    })
    expect(sentText).toContain("<!-- OMO_INTERNAL_INITIATOR -->")
    expect(sentText).toContain(promptJson)

    const cats = rows.map((r) => ({ name: `cat-${r.id}`, description: r.value, model: "gpt" }))
    const skills = rows.map((r) => ({ name: `skill-${r.id}`, description: r.value, location: "plugin" as const }))
    const compressedGuide = buildSystemContent({ agentName: "plan", availableCategories: cats, availableSkills: skills, compressionConfig: on }) || ""
    const plainGuide = buildSystemContent({ agentName: "plan", availableCategories: cats, availableSkills: skills, compressionConfig: { enabled: false, threshold: 999999 } }) || ""
    expect(compressedGuide).toContain("```toon")
    expect(compressedGuide).toMatch(toon)
    expect(plainGuide).toContain("| Category |")

    const bgOutOn = await executeBackgroundTask(args as never, { sessionID: "s", metadata: async () => {} } as never, { manager: { launch: async () => ({ id: "bg1", description: "d", agent: "a", status: "pending", sessionID: "s2" }), getTask: () => ({ sessionID: "s2" }) } } as never, { sessionID: "s", messageID: "m", agent: "a", model: undefined }, "a", undefined, undefined, undefined, on)
    const bgOutOff = await executeBackgroundTask(args as never, { sessionID: "s", metadata: async () => {} } as never, { manager: { launch: async () => ({ id: "bg2", description: "d", agent: "a", status: "pending", sessionID: "s3" }), getTask: () => ({ sessionID: "s3" }) } } as never, { sessionID: "s", messageID: "m", agent: "a", model: undefined }, "a", undefined, undefined, undefined, off)
    expect(bgOutOn).toContain("Background task launched")
    expect(bgOutOff).toContain("Background task launched")

    let resumedPrompt = ""
    await executeBackgroundContinuation({ description: "d", prompt: promptJson, run_in_background: true, load_skills: [], session_id: "child" } as never, { sessionID: "s", callID: "c" } as never, { manager: { resume: async (p: { prompt: string }) => { resumedPrompt = p.prompt; return { id: "bg3", description: "d", agent: "a", status: "running", sessionID: "child" } } } } as never, { sessionID: "s", messageID: "m", agent: "a", model: undefined }, on)
    expect(resumedPrompt).toBe(promptJson)

    const syncOut = await executeSyncTask(args as never, { sessionID: "s", metadata: async () => {} } as never, { client, directory: "/tmp" } as never, { sessionID: "s", messageID: "m", agent: "a", model: undefined }, "a", undefined, undefined, undefined, undefined, {
      createSyncSession: async () => ({ ok: true, sessionID: "sync1" }),
      sendSyncPrompt: async () => null,
      pollSyncSession: async () => null,
      fetchSyncResult: async () => ({ ok: true, textContent: "done" }),
    } as never, on)
    expect(syncOut).toContain("Task completed")

    const parent = compressParentContext({ sessionID: "s", messageID: "m", agent: "a", model: undefined }, on)
    const packedArgs = compressDelegateTaskArgs(args as never, off)
    expect(parent).toContain("sessionID")
    expect(packedArgs).toContain("description")
  })

  test("tasks 22, 32, 33, 34: spawner/manager/session-state integrations", async () => {
    const promptCalls: Array<{ body: { parts: Array<{ text: string }> } }> = []
    const client = { session: { get: async () => ({ data: { directory: "/tmp" } }), create: async () => ({ data: { id: `ses_${promptCalls.length}` } }), promptAsync: async (p: never) => { promptCalls.push(p as never) }, abort: async () => {}, messages: async () => ({ data: [] }), status: async () => ({ data: { type: "idle" } }), todo: async () => ({ data: [] }) } } as never

    const item = { task: createTask({ description: "d", prompt: promptJson, agent: "explore", parentSessionID: "p", parentMessageID: "m" } as never), input: { description: "d", prompt: promptJson, agent: "explore", parentSessionID: "p", parentMessageID: "m" } }
    await startTask(item as never, { client, directory: "/tmp", concurrencyManager: { release: () => {}, acquire: async () => {} } as never, tmuxEnabled: false, onTaskError: () => {}, toonCompressionConfig: on })
    await waitFor(() => promptCalls.length > 0)
    expect(promptCalls[0].body.parts[0].text).toContain("<!-- OMO_INTERNAL_INITIATOR -->")
    expect(promptCalls[0].body.parts[0].text).toMatch(toon)

    const task = createTask({ description: "d2", prompt: promptJson, agent: "explore", parentSessionID: "p", parentMessageID: "m" } as never)
    task.sessionID = "existing"; task.status = "completed"
    await resumeTask(task as never, { sessionId: "existing", parentSessionID: "p", parentMessageID: "m", prompt: promptJson }, { client, concurrencyManager: { acquire: async () => {} } as never, onTaskError: () => {}, toonCompressionConfig: off })
    await waitFor(() => promptCalls.length > 1)
    expect(promptCalls[1].body.parts[0].text).toContain(promptJson)
    expect(preparePromptWithCompression(promptJson, on)).toMatch(toon)

    const managerOn = new BackgroundManager({ client, directory: "/tmp" } as never, undefined, { enableParentSessionNotifications: false, toonCompressionConfig: on })
    const launched = await managerOn.launch({ description: "m", prompt: promptJson, agent: "explore", parentSessionID: "p", parentMessageID: "m" })
    await waitFor(() => promptCalls.length > 2)
    expect(promptCalls[2].body.parts[0].text).toMatch(toon)
    const running = managerOn.getTask(launched.id)!; running.status = "completed"
    await managerOn.resume({ sessionId: running.sessionID!, parentSessionID: "p", parentMessageID: "m", prompt: promptJson })
    await waitFor(() => promptCalls.length > 3)
    expect(promptCalls[3].body.parts[0].text).toMatch(toon)
    managerOn.shutdown()

    clearSessionTools(); setSessionTools("s", { task: true, question: false }); expect(getSessionTools("s")).toEqual({ task: true, question: false })
    expect(formatTodoList(rows.slice(0, 6).map((r) => ({ status: "pending", content: r.value })) as never, on)).toMatch(toon)
  })

  test("tasks 25-28, 35-37: executor/cli/skill/dynamic/task-tools integration", async () => {
    expect(shouldCompress(rows, 100)).toBe(true)
    expect(safeCompress(rows, on, "test-phase2")).toMatch(toon)
    expect(compressCliMessage(promptJson, off)).toBe(promptJson)

    const out = await executeSync({ description: "d", prompt: promptJson, subagent_type: "explore", run_in_background: false } as never, { sessionID: "s", messageID: "m", agent: "a", abort: new AbortController().signal } as never, { client: { session: { promptAsync: async () => {} } } } as never, {
      createOrGetSession: async () => ({ sessionID: "s2", isNew: true }),
      waitForCompletion: async () => {},
      processMessages: async () => promptJson,
      safeCompress: (data: unknown, cfg: { enabled: boolean }) => (cfg.enabled ? `C:${String(data).slice(0, 1)}` : JSON.stringify(data)),
    }, on)
    expect(out).toContain("session_id: s2")
    expect(out).toContain("C:")

    const dynA = buildCategorySkillsDelegationGuide(rows.slice(0, 6).map((r) => ({ name: `c${r.id}`, description: r.value })), rows.slice(0, 6).map((r) => ({ name: `s${r.id}`, description: r.value, location: "plugin" as const })), on)
    const dynB = buildUltraworkSection(rows.slice(0, 6).map((r) => ({ name: `a${r.id}`, description: r.value, metadata: { keyTrigger: "", category: "utility", cost: "FREE", triggers: [] } } as never)), rows.slice(0, 6).map((r) => ({ name: `c${r.id}`, description: r.value })), rows.slice(0, 6).map((r) => ({ name: `s${r.id}`, description: r.value, location: "plugin" as const })), on)
    expect(dynA).toContain("[Compressed categories/skills data]")
    expect(dynB).toContain("[Compressed ultrawork data]")
    expect(compressSkillTemplates(new Map(rows.slice(0, 6).map((r) => [`k${r.id}`, r.value])), on)).toMatch(toon)

    const root = mkdtempSync(join(tmpdir(), "toon-phase2-"))
    const cfgOn = { sisyphus: { tasks: { storage_path: root } }, toon_compression: on }
    const cfgOff = { sisyphus: { tasks: { storage_path: root } }, toon_compression: off }
    const createOn = createTaskCreateTool(cfgOn as never); const createOff = createTaskCreateTool(cfgOff as never)
    const c1 = JSON.parse(await createOn.execute({ subject: "s1" }, { sessionID: "s" } as never)); const c2 = JSON.parse(await createOff.execute({ subject: "s2" }, { sessionID: "s" } as never))
    const getOn = createTaskGetTool(cfgOn as never); const getOff = createTaskGetTool(cfgOff as never)
    expect(JSON.parse(await getOn.execute({ id: c1.task.id }, {} as never)).task.id).toBe(c1.task.id)
    expect(JSON.parse(await getOff.execute({ id: c2.task.id }, {} as never)).task.id).toBe(c2.task.id)
    const updateOn = createTaskUpdateTool(cfgOn as never); const updateOff = createTaskUpdateTool(cfgOff as never)
    expect(JSON.parse(await updateOn.execute({ id: c1.task.id, status: "completed" }, { sessionID: "s" } as never)).task.status).toBe("completed")
    expect(JSON.parse(await updateOff.execute({ id: c2.task.id, status: "completed" }, { sessionID: "s" } as never)).task.status).toBe("completed")
    rmSync(root, { recursive: true, force: true })
  })
})
