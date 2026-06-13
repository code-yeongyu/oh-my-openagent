import { spawn } from "node:child_process"

type JsonRecord = Record<string, unknown>

type Harness = {
  label: string
  bin: string
  args: string[]
  commandRequest: JsonRecord
  diagnosticCommand: string
  diagnosticTool: string
  toolInventory: "rpc-state" | "source-parity"
}

type HarnessProbe = {
  commands: string[]
  tools: string[]
  frames: JsonRecord[]
  stderr: string
}

const timeoutMs = Number(process.env.OMO_TARGET_FEATURE_TIMEOUT_MS ?? "60000")

const builtinCommandNames = [
  "ralph-loop",
  "ulw-loop",
  "cancel-ralph",
  "refactor",
  "start-work",
  "stop-continuation",
  "remove-ai-slops",
  "handoff",
  "hyperplan",
] as const

const alwaysOnUtilityToolNames = [
  "grep",
  "glob",
  "session_list",
  "session_read",
  "session_search",
  "session_info",
  "background_output",
  "background_cancel",
  "skill",
] as const

const mcpBackedToolNames = [
  "lsp_goto_definition",
  "lsp_find_references",
  "lsp_symbols",
  "lsp_diagnostics",
  "lsp_prepare_rename",
  "lsp_rename",
  "ast_grep_search",
  "ast_grep_replace",
] as const

const targetTaskToolNames = [
  "task",
  "call_omo_agent",
  "task_create",
  "task_get",
  "task_list",
  "task_update",
] as const

const teamToolNames = [
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

const extraToolNames = [
  "mcp_servers",
  "skill_mcp",
  "edit",
  "look_at",
] as const

const harnesses: Harness[] = [
  {
    label: "OMP",
    bin: "omp",
    args: ["--mode", "rpc", "--no-title", "--no-session"],
    commandRequest: { id: "commands", type: "get_available_commands" },
    diagnosticCommand: "omo-diagnostic",
    diagnosticTool: "omo_diagnostic",
    toolInventory: "rpc-state",
  },
  {
    label: "Pi",
    bin: "pi",
    args: ["--mode", "rpc", "--no-session", "--offline"],
    commandRequest: { id: "commands", type: "get_commands" },
    diagnosticCommand: "omo-pi-diagnostic",
    diagnosticTool: "omo_pi_diagnostic",
    toolInventory: "source-parity",
  },
]

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonRecord : undefined
}

function commandNames(frame: JsonRecord): string[] {
  const data = asRecord(frame.data)
  const commands = Array.isArray(data?.commands)
    ? data.commands
    : Array.isArray(frame.commands)
      ? frame.commands
      : []
  return commands
    .map((command) => asRecord(command)?.name)
    .filter((name): name is string => typeof name === "string")
}

function toolNames(frame: JsonRecord): string[] {
  const data = asRecord(frame.data)
  const state = data ?? frame
  const tools = Array.isArray(state.dumpTools) ? state.dumpTools : []
  return tools
    .map((tool) => asRecord(tool)?.name)
    .filter((name): name is string => typeof name === "string")
}

function expectedCommands(harness: Harness): string[] {
  return [
    ...builtinCommandNames,
    harness.diagnosticCommand,
  ].sort()
}

function expectedTools(harness: Harness): string[] {
  return [
    ...alwaysOnUtilityToolNames,
    ...mcpBackedToolNames,
    ...targetTaskToolNames,
    ...extraToolNames,
    ...teamToolNames,
    harness.diagnosticTool,
  ].sort()
}

function missing(expected: readonly string[], actual: readonly string[]): string[] {
  const actualSet = new Set(actual)
  return expected.filter((name) => !actualSet.has(name))
}

async function probeHarness(harness: Harness): Promise<HarnessProbe> {
  return await new Promise((resolve, reject) => {
    const child = spawn(harness.bin, harness.args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        OMO_TEAM_MODE: "1",
        PI_OFFLINE: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    })

    const frames: JsonRecord[] = []
    let stderr = ""
    let commands: string[] = []
    let tools: string[] = []
    let sent = false
    let settled = false

    function settle(result: HarnessProbe | Error): void {
      if (settled) return
      settled = true
      child.kill("SIGTERM")
      clearTimeout(timer)
      if (result instanceof Error) reject(result)
      else resolve(result)
    }

    const timer = setTimeout(() => {
      settle(new Error(`${harness.label} RPC did not return command/tool inventory within ${timeoutMs}ms.\n${stderr}`))
    }, timeoutMs)

    function sendRequests(): void {
      if (sent) return
      sent = true
      child.stdin.write(`${JSON.stringify(harness.commandRequest)}\n`)
      child.stdin.write(`${JSON.stringify({ id: "state", type: "get_state" })}\n`)
    }

    function finishIfReady(): void {
      if (commands.length === 0) return
      if (harness.toolInventory === "rpc-state" && tools.length === 0) return
      settle({ commands: [...new Set(commands)].sort(), tools: [...new Set(tools)].sort(), frames, stderr })
    }

    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (data: string) => {
      stderr += data
    })
    child.stdout.on("data", (data: string) => {
      for (const line of data.split("\n")) {
        if (!line.trim()) continue
        let parsed: unknown
        try {
          parsed = JSON.parse(line)
        } catch {
          continue
        }
        const frame = asRecord(parsed)
        if (!frame) continue
        frames.push(frame)

        if (frame.type === "ready" || frame.type === "available_commands_update") sendRequests()
        if (frame.id === "commands" || frame.type === "available_commands_update") {
          commands = commandNames(frame)
        }
        if (frame.id === "state") {
          tools = toolNames(frame)
        }
        finishIfReady()
      }
    })
    child.on("error", (error) => {
      settle(error)
    })
    child.on("exit", (code, signal) => {
      if (commands.length > 0 && (harness.toolInventory === "source-parity" || tools.length > 0)) {
        settle({ commands: [...new Set(commands)].sort(), tools: [...new Set(tools)].sort(), frames, stderr })
        return
      }
      settle(new Error(`${harness.label} RPC exited before command/tool inventory. code=${code ?? "null"} signal=${signal ?? "null"}\n${stderr}`))
    })
    setTimeout(sendRequests, 2_000)
  })
}

async function main(): Promise<void> {
  let failed = false
  for (const harness of harnesses) {
    const probe = await probeHarness(harness)
    const missingCommands = missing(expectedCommands(harness), probe.commands)
    const missingTools = harness.toolInventory === "rpc-state" ? missing(expectedTools(harness), probe.tools) : []

    if (harness.toolInventory === "rpc-state") {
      console.log(`${harness.label}: ${probe.commands.length} commands, ${probe.tools.length} tools`)
    } else {
      console.log(`${harness.label}: ${probe.commands.length} commands, tool parity covered by src/hosts/target-feature-parity.test.ts`)
    }
    if (missingCommands.length > 0) {
      failed = true
      console.error(`${harness.label} missing commands: ${missingCommands.join(", ")}`)
    }
    if (missingTools.length > 0) {
      failed = true
      console.error(`${harness.label} missing tools: ${missingTools.join(", ")}`)
    }
  }

  if (failed) {
    process.exitCode = 1
    return
  }
  console.log("OMO target feature coverage passed for OMP and Pi.")
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
