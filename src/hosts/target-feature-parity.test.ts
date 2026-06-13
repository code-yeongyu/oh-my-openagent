import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadBuiltinCommands } from "../features/builtin-commands"
import { targetHookMappings } from "../host-hooks"
import { MCP_BACKED_TOOL_NAMES, TARGET_TASK_TOOL_NAMES } from "../host-tools"
import { ALWAYS_ON_UTILITY_TOOL_NAMES } from "../host-tools/always-on-tools"
import ohMyOpenAgentOhMyPiExtension from "./oh-my-pi"
import { OH_MY_PI_DIAGNOSTIC_COMMAND, OH_MY_PI_DIAGNOSTIC_TOOL, OH_MY_PI_EXTENSION_LABEL } from "./oh-my-pi/manifest"
import ohMyOpenAgentPiExtension from "./pi"
import { PI_DIAGNOSTIC_COMMAND, PI_DIAGNOSTIC_TOOL } from "./pi/manifest"

type HostName = "oh-my-pi" | "pi"

type RegisteredCommand = {
  description?: string
  handler(argument: string, context: unknown): Promise<void> | void
}

type RegisteredTool = {
  name: string
  description: string
  parameters: unknown
  execute: (...args: never[]) => unknown
}

type CapturedExtension = {
  commands: Map<string, RegisteredCommand>
  tools: Map<string, RegisteredTool>
  events: Map<string, Array<(payload: unknown, context: unknown) => unknown>>
  labels: string[]
  messages: string[]
}

const TEAM_TOOL_NAMES = [
  "team_create",
  "team_delete",
  "team_shutdown_request",
  "team_approve_shutdown",
  "team_reject_shutdown",
  "team_send_message",
  "team_task_create",
  "team_task_list",
  "team_task_update",
  "team_task_get",
  "team_status",
  "team_list",
] as const

const EXTRA_TARGET_TOOL_NAMES = [
  "mcp_servers",
  "skill_mcp",
  "edit",
  "look_at",
] as const

let cwd = ""
let previousCwd = ""
let previousTeamMode: string | undefined
let previousPiAgentDir: string | undefined

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "omo-target-feature-parity-"))
  previousCwd = process.cwd()
  previousTeamMode = process.env.OMO_TEAM_MODE
  previousPiAgentDir = process.env.PI_CODING_AGENT_DIR
  process.chdir(cwd)
  process.env.PI_CODING_AGENT_DIR = join(cwd, ".pi", "agent")
})

afterEach(() => {
  process.chdir(previousCwd)
  if (previousTeamMode === undefined) delete process.env.OMO_TEAM_MODE
  else process.env.OMO_TEAM_MODE = previousTeamMode
  if (previousPiAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR
  else process.env.PI_CODING_AGENT_DIR = previousPiAgentDir
  rmSync(cwd, { recursive: true, force: true })
})

function createCapture(): CapturedExtension {
  return {
    commands: new Map(),
    tools: new Map(),
    events: new Map(),
    labels: [],
    messages: [],
  }
}

function fakeApi(captured: CapturedExtension, host: HostName): unknown {
  return {
    zod: {
      object: (shape: Record<string, unknown>) => ({ type: "zod-object", shape }),
    },
    setLabel: (label: string) => {
      captured.labels.push(label)
    },
    on: (event: string, handler: (payload: unknown, context: unknown) => unknown) => {
      const handlers = captured.events.get(event) ?? []
      handlers.push(handler)
      captured.events.set(event, handlers)
    },
    registerCommand: (name: string, command: RegisteredCommand) => {
      captured.commands.set(name, command)
    },
    registerTool: (tool: RegisteredTool) => {
      captured.tools.set(tool.name, tool)
    },
    sendUserMessage: (content: string) => {
      captured.messages.push(`${host}:${content}`)
    },
  }
}

function runExtension(host: HostName, teamModeEnabled: boolean): CapturedExtension {
  const captured = createCapture()
  if (teamModeEnabled) process.env.OMO_TEAM_MODE = "1"
  else delete process.env.OMO_TEAM_MODE

  if (host === "oh-my-pi") {
    ohMyOpenAgentOhMyPiExtension(fakeApi(captured, host) as Parameters<typeof ohMyOpenAgentOhMyPiExtension>[0])
  } else {
    ohMyOpenAgentPiExtension(fakeApi(captured, host) as Parameters<typeof ohMyOpenAgentPiExtension>[0])
  }

  return captured
}

function expectedCommands(host: HostName, teamModeEnabled: boolean): string[] {
  return [
    ...Object.keys(loadBuiltinCommands(undefined, { teamModeEnabled })),
    host === "oh-my-pi" ? OH_MY_PI_DIAGNOSTIC_COMMAND : PI_DIAGNOSTIC_COMMAND,
  ].sort()
}

function requiredToolNames(teamModeEnabled: boolean): string[] {
  return [
    ...ALWAYS_ON_UTILITY_TOOL_NAMES,
    ...MCP_BACKED_TOOL_NAMES,
    ...EXTRA_TARGET_TOOL_NAMES,
    ...TARGET_TASK_TOOL_NAMES,
    ...(teamModeEnabled ? TEAM_TOOL_NAMES : []),
  ].sort()
}

function expectedEvents(host: HostName): string[] {
  return [
    ...new Set([
      "session_shutdown",
      ...targetHookMappings(host).map((mapping) => mapping.targetEvent),
    ]),
  ].sort()
}

function withoutDiagnosticCommands(names: Iterable<string>): string[] {
  return [...names]
    .filter((name) => name !== OH_MY_PI_DIAGNOSTIC_COMMAND && name !== PI_DIAGNOSTIC_COMMAND)
    .sort()
}

function expectFeatureSet(host: HostName, captured: CapturedExtension, teamModeEnabled: boolean): void {
  const commandNames = [...captured.commands.keys()].sort()
  const toolNames = [...captured.tools.keys()].sort()
  const eventNames = [...captured.events.keys()].sort()

  expect(commandNames).toEqual(expectedCommands(host, teamModeEnabled))
  expect(commandNames).toContain("hyperplan")

  for (const toolName of requiredToolNames(teamModeEnabled)) {
    expect(toolNames).toContain(toolName)
  }
  expect(toolNames.filter((name) => name === "interactive_bash")).toHaveLength(toolNames.includes("interactive_bash") ? 1 : 0)

  for (const eventName of expectedEvents(host)) {
    expect(eventNames).toContain(eventName)
  }
  expect(captured.commands.get("hyperplan")?.description).toContain("Adversarial")
  expect(captured.commands.get(host === "oh-my-pi" ? OH_MY_PI_DIAGNOSTIC_COMMAND : PI_DIAGNOSTIC_COMMAND)).toBeDefined()
  expect(captured.tools.get(host === "oh-my-pi" ? OH_MY_PI_DIAGNOSTIC_TOOL : PI_DIAGNOSTIC_TOOL)).toBeDefined()
}

describe("target feature parity", () => {
  test("#given normal target mode #when OMO loads in both harnesses #then slash commands tools hooks MCP resources and diagnostics are registered", () => {
    const ohMyPi = runExtension("oh-my-pi", false)
    const pi = runExtension("pi", false)

    expectFeatureSet("oh-my-pi", ohMyPi, false)
    expectFeatureSet("pi", pi, false)
    expect(withoutDiagnosticCommands(ohMyPi.commands.keys())).toEqual(withoutDiagnosticCommands(pi.commands.keys()))
    expect([...ohMyPi.tools.keys()].filter((name) => name !== OH_MY_PI_DIAGNOSTIC_TOOL).sort()).toEqual(
      [...pi.tools.keys()].filter((name) => name !== PI_DIAGNOSTIC_TOOL).sort(),
    )
    expect(ohMyPi.labels).toEqual([OH_MY_PI_EXTENSION_LABEL])
  })

  test("#given Team Mode target mode #when OMO loads in both harnesses #then Hyperplan has the required team surface", async () => {
    const ohMyPi = runExtension("oh-my-pi", true)
    const pi = runExtension("pi", true)

    expectFeatureSet("oh-my-pi", ohMyPi, true)
    expectFeatureSet("pi", pi, true)
    for (const captured of [ohMyPi, pi]) {
      for (const toolName of TEAM_TOOL_NAMES) {
        expect([...captured.tools.keys()]).toContain(toolName)
      }
      await captured.commands.get("hyperplan")?.handler("stress test target parity", {
        cwd,
        ui: { notify: () => {} },
      })
      expect(captured.messages.at(-1)).toContain("stress test target parity")
      expect(captured.messages.at(-1)).toContain("team_create")
    }
  })
})
