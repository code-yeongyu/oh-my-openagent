import { spawn } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..")
const plugin = join(repo, "packages/omo-senpi/plugin")
const provider = join(dirname(fileURLToPath(import.meta.url)), "provider.ts")
const DEADLINE = 120_000

export type Json = Readonly<Record<string, unknown>>
export const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export interface ToolOutcome {
  readonly isError: boolean
  readonly text: string
  readonly images: readonly { readonly mimeType: string; readonly data: string }[]
  readonly details: Json
}

interface Waiter {
  readonly predicate: (event: Json) => boolean
  readonly resolve: (event: Json) => void
  readonly reject: (error: Error) => void
}

export interface Sandbox {
  readonly root: string
  readonly cwd: string
  readonly agentDir: string
  readonly home: string
  readonly env: NodeJS.ProcessEnv
}

/** Never inherit an agent's package, session, or auth directory into the child. */
export function sandboxEnvironment(source: NodeJS.ProcessEnv, home: string, agentDir: string): NodeJS.ProcessEnv {
  const clean = Object.fromEntries(
    Object.entries(source).filter(([key]) => !/^(OMO|SENPI|PI)_/.test(key)),
  )
  return {
    ...clean,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, "config"),
    XDG_DATA_HOME: join(home, "data"),
    XDG_CACHE_HOME: join(home, "cache"),
    OMO_CODING_AGENT_DIR: agentDir,
    SENPI_CODING_AGENT_DIR: agentDir,
    PI_CODING_AGENT_DIR: agentDir,
    PI_OFFLINE: "1",
    OMO_SENPI_QA: "1",
  }
}

export function createSandbox(computer: Json, enginePath?: string): Sandbox {
  const root = mkdtempSync(join(tmpdir(), "omo-qa-macos-"))
  const cwd = join(root, "project")
  const agentDir = join(root, "agent")
  const home = join(root, "home")
  const env = sandboxEnvironment(process.env, home, agentDir)
  for (const dir of [cwd, agentDir, home, env.XDG_CONFIG_HOME, env.XDG_DATA_HOME, env.XDG_CACHE_HOME]) {
    if (dir !== undefined) mkdirSync(dir, { recursive: true })
  }
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({
    defaultProjectTrust: "ask",
    packages: [plugin],
    compaction: { enabled: false },
    retry: { enabled: false },
  }))
  writeFileSync(join(agentDir, "trust.json"), JSON.stringify({ [cwd]: true }))
  mkdirSync(join(cwd, ".omo"), { recursive: true })
  writeFileSync(join(cwd, ".omo", "omo.jsonc"), JSON.stringify({
    computer: { ...computer, ...(enginePath === undefined ? {} : { engine_path: enginePath }) },
  }))
  return { root, cwd, agentDir, home, env }
}

export function agentArgs(): readonly string[] {
  return [
    "--mode", "rpc", "--offline", "--no-context-files", "--no-extensions",
    "--no-skills", "--no-prompt-templates", "--no-themes",
    "-e", join(plugin, "extensions/omo.js"),
    "-e", provider, "--provider", "omo-mock", "--model", "mock-1",
    "--permission", "computer:read=allow", "--permission", "computer:exec=allow",
  ]
}

function readAudit(root: string): readonly Json[] {
  const walk = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name)
      return entry.isDirectory() ? walk(path) : entry.name === ".computer-audit.jsonl" ? [path] : []
    })
  return walk(root).flatMap((path) =>
    readFileSync(path, "utf8").split("\n").filter(Boolean).map((line): unknown => JSON.parse(line)).filter(isRecord),
  )
}

function outcome(event: Json): ToolOutcome {
  const result = isRecord(event.result) ? event.result : {}
  const parts = Array.isArray(result.content) ? result.content.filter(isRecord) : []
  return {
    isError: event.isError === true,
    text: parts.flatMap((part) => typeof part.text === "string" ? [part.text] : []).join("\n"),
    images: parts.flatMap((part) =>
      typeof part.mimeType === "string" && typeof part.data === "string"
        ? [{ mimeType: part.mimeType, data: part.data }] : []),
    details: isRecord(result.details) ? result.details : {},
  }
}

/** The real Senpi RPC process loads the packaged OmO extension and the scripted provider. */
/** The only confirm this QA approves: the foreground-control grant's (#9651 B5). */
const CONTROL_CONFIRM_TITLE = "Allow foreground computer control?"

export class AgentSession {
  readonly #sandbox: Sandbox
  readonly #child
  readonly #exited: Promise<void>
  readonly #waiters = new Set<Waiter>()
  #stderr = ""
  #id = 0
  #step = 0
  #closed = false
  #lastEvents: string[] = []
  /** Foreground-control confirms this session approved. */
  confirms = 0

  constructor(computer: Json, bin: string, enginePath?: string) {
    this.#sandbox = createSandbox(computer, enginePath)
    this.#child = spawn(bin, [...agentArgs()], {
      cwd: this.#sandbox.cwd, env: this.#sandbox.env, stdio: "pipe",
    })
    this.#child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      this.#stderr = (this.#stderr + chunk).slice(-4096)
    })
    this.#exited = new Promise((resolve) => this.#child.once("close", (code, signal) => {
      for (const waiter of this.#waiters)
        waiter.reject(new Error(`senpi exited ${code ?? signal}: ${this.#stderr}; events=${this.#lastEvents.join(" | ")}`))
      this.#waiters.clear()
      resolve()
    }))
    this.#child.on("error", (error) => {
      for (const waiter of this.#waiters) waiter.reject(error)
      this.#waiters.clear()
    })
    createInterface({ input: this.#child.stdout }).on("line", (line) => {
      if (!line.startsWith("{")) return
      const parsed: unknown = JSON.parse(line)
      if (!isRecord(parsed)) return
      if (parsed.type !== "extension_ui_request" || parsed.method === "notify")
        this.#lastEvents = [...this.#lastEvents, JSON.stringify(parsed).slice(0, 700)].slice(-16)
      // The QA stands in for the human: it approves the foreground-control confirm (#9651 B5) that
      // `desktop.control.acquire` raises, the way a person clicking "Allow" would.
      if (parsed.type === "extension_ui_request" && parsed.method === "confirm" && typeof parsed.id === "string" &&
        parsed.title === CONTROL_CONFIRM_TITLE) {
        this.#child.stdin.write(`${JSON.stringify({ type: "extension_ui_response", id: parsed.id, confirmed: true })}\n`)
        this.confirms += 1
      }
      for (const waiter of [...this.#waiters]) {
        if (!waiter.predicate(parsed)) continue
        this.#waiters.delete(waiter)
        waiter.resolve(parsed)
      }
    })
  }

  waitFor(predicate: (event: Json) => boolean): Promise<Json> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiters.delete(waiter)
        reject(new Error(`senpi event deadline: ${this.#stderr}; events=${this.#lastEvents.join(" | ")}`))
      }, DEADLINE)
      const waiter: Waiter = {
        predicate,
        resolve: (event) => { clearTimeout(timer); resolve(event) },
        reject: (error) => { clearTimeout(timer); reject(error) },
      }
      this.#waiters.add(waiter)
    })
  }

  async #send(command: Json): Promise<void> {
    const id = `macos-${++this.#id}`
    const reply = this.waitFor((event) => event.type === "response" && event.id === id)
    this.#child.stdin.write(`${JSON.stringify({ ...command, id })}\n`)
    const response = await reply
    if (response.success !== true) throw new Error(`rpc ${String(command.type)}: ${JSON.stringify(response)}`)
  }

  async command(args: string): Promise<string> {
    const notice = this.waitFor((event) => event.type === "extension_ui_request" &&
      event.method === "notify" && typeof event.message === "string" &&
      (event.message.includes("Computer use") || event.message.startsWith(`/computer ${args}:`) ||
        (args === "resume" && event.message.startsWith("Computer input resumed:"))))
    await this.#send({ type: "prompt", message: `/computer ${args}` })
    return String((await notice).message)
  }

  async call(args: Json): Promise<ToolOutcome> {
    // The provider's response cursor advances twice per turn (tool call, then completion text).
    const steps: Array<
      { type: "text"; text: string } |
      { type: "tool_call"; name: string; arguments: Json }
    > = Array.from({ length: this.#step }, () => ({ type: "text", text: "unused" }))
    steps.push({ type: "tool_call", name: "computer", arguments: args }, { type: "text", text: "done" })
    writeFileSync(join(this.#sandbox.cwd, "mock-script.json"), JSON.stringify({ steps }))
    const end = this.waitFor((event) => event.type === "tool_execution_end" && event.toolName === "computer")
    // `agent_end` can precede retries, compaction and extension follow-ups; the next prompt must wait for idle.
    const settled = this.waitFor((event) => event.type === "agent_settled")
    await this.#send({ type: "prompt", message: `macOS computer QA ${this.#step}` })
    const [result] = await Promise.all([end, settled])
    this.#step += 2
    return outcome(result)
  }

  auditLog(): readonly Json[] { return readAudit(this.#sandbox.root) }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    this.#child.kill("SIGTERM")
    const timer = setTimeout(() => this.#child.kill("SIGKILL"), 30_000)
    try { await this.#exited } finally {
      clearTimeout(timer)
      rmSync(this.#sandbox.root, { recursive: true, force: true })
    }
  }
}

/** No console is touched by this structural self-test. */
export function selfTestSandbox(): Json {
  const sandbox = createSandbox({})
  try {
    const settings: unknown = JSON.parse(readFileSync(join(sandbox.agentDir, "settings.json"), "utf8"))
    if (!isRecord(settings) || !Array.isArray(settings.packages) || settings.packages[0] !== plugin)
      throw new Error("OmO package not installed into sandbox")
    if (!existsSync(provider) || !existsSync(join(plugin, "extensions/omo.js")))
      throw new Error("built OmO extension or mock provider absent")
    if ([sandbox.env.OMO_CODING_AGENT_DIR, sandbox.env.SENPI_CODING_AGENT_DIR, sandbox.env.PI_CODING_AGENT_DIR]
      .some((dir) => dir !== sandbox.agentDir))
      throw new Error("coding-agent directories are not isolated")
    if (sandbox.env.HOME === homedir() || sandbox.env.OMO_PACKAGE_DIR !== undefined)
      throw new Error("real home or package override leaked")
    if (!agentArgs().includes(join(plugin, "extensions/omo.js")))
      throw new Error("OmO extension not explicitly loaded")
    return { isolated: true, plugin, provider, cliArgs: agentArgs() }
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
}

/** Real Senpi + packaged OmO + mock model + protocol fake, with no Aqua or TCC access. */
export async function selfTestBinary(bin: string): Promise<Json> {
  const directory = mkdtempSync(join(tmpdir(), "omo-macos-fake-engine-"))
  const fake = join(repo, "packages/senpi-desktop-service/test/fake-engine.mjs")
  const wrapper = join(directory, "engine.sh")
  writeFileSync(wrapper, `#!/bin/sh\nexec /usr/bin/env bun '${fake}' "$@"\n`)
  chmodSync(wrapper, 0o755)
  let session: AgentSession | undefined
  try {
    session = new AgentSession({}, bin, wrapper)
    const enabled = await session.command("on")
    if (!enabled.includes("Computer use on")) throw new Error(`OmO computer command unavailable: ${enabled}`)
    const result = await session.call({ action: "capabilities" })
    const capabilities = isRecord(result.details.value) ? result.details.value : {}
    if (result.isError || capabilities.backend !== "fake")
      throw new Error(`OmO computer tool did not reach fake engine: ${result.text}`)
    return { realSenpi: bin, engineBackend: capabilities.backend, command: "on",
      tool: "computer", isolated: true }
  } finally {
    try { await session?.close() } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }
}
