import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { describe, expect, test } from "bun:test"

import {
  createAgentSession,
  createReadToolDefinition,
  DefaultResourceLoader,
  type CreateAgentSessionOptions,
  type ExtensionContext,
  type ToolDefinition,
} from "@code-yeongyu/senpi"

import { InProcessRunner } from "../in-process"
import type { ChildSession } from "../in-process"

const sampleParameters = createReadToolDefinition(process.cwd()).parameters

function makeParentTool(name: string, onExecute: () => void): ToolDefinition {
  return {
    name,
    label: name,
    description: `parent tool ${name}`,
    parameters: sampleParameters,
    execute: async () => {
      onExecute()
      return { content: [{ type: "text", text: "ran" }], details: undefined }
    },
  }
}

describe("in-process child extension suppression", () => {
  test("#given an agent dir with a marker extension #when a child boots through the runner #then the factory never runs and parent tools survive", async () => {
    // given
    const rootDir = mkdtempSync(join(tmpdir(), "senpi-task-runner-marker-"))
    const agentDir = join(rootDir, "agent")
    const cwd = join(rootDir, "project")
    const markerPath = join(agentDir, "extensions", "marker.js")
    const markerInvokedPath = join(rootDir, "marker-invoked")
    mkdirSync(cwd, { recursive: true })
    mkdirSync(dirname(markerPath), { recursive: true })
    writeFileSync(
      markerPath,
      `import { writeFileSync } from "node:fs"\nexport default function () { writeFileSync(${JSON.stringify(markerInvokedPath)}, "invoked", "utf8") }\n`,
      "utf8",
    )
    // positive control: the DefaultResourceLoader DOES execute the marker factory
    const defaultLoader = new DefaultResourceLoader({ cwd, agentDir })
    await defaultLoader.reload()
    expect(existsSync(markerInvokedPath)).toBe(true)
    rmSync(markerInvokedPath, { force: true })

    let parentToolRan = false
    let capturedOptions: CreateAgentSessionOptions | undefined
    let bootedSession: ChildSession | undefined
    const runner = new InProcessRunner({
      sharedParentTools: [makeParentTool("marker_parent_tool", () => {
        parentToolRan = true
      })],
      createSession: async (options) => {
        capturedOptions = options
        const { session } = await createAgentSession(options)
        bootedSession = session
        return session
      },
    })

    // when
    try {
      const handle = await runner.start({
        taskId: "task-marker",
        cwd,
        agentDir,
        depth: 0,
        parentSessionId: "parent-1",
        rootSessionId: "root-1",
        prompt: "inspect only",
      })

      // then
      expect(existsSync(markerInvokedPath)).toBe(false)
      expect(capturedOptions?.resourceLoader?.getExtensions().extensions).toHaveLength(0)
      expect(bootedSession?.getLastAssistantText).toBeDefined()
      const parentTool = (capturedOptions?.customTools ?? []).find((tool) => tool.name === "marker_parent_tool")
      expect(parentTool).toBeDefined()
      // the captured parent tool is the same live closure and still executes inside the child
      const noopCtx = {} as unknown as ExtensionContext
      await parentTool?.execute("call-1", {}, undefined, undefined, noopCtx)
      expect(parentToolRan).toBe(true)
      expect(handle.task_id).toBe("task-marker")
    } finally {
      bootedSession?.dispose()
      rmSync(rootDir, { recursive: true, force: true })
    }
  })
})
