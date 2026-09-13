import { createHash } from "node:crypto"
import { chmod, copyFile, mkdir, mkdtemp, readdir, realpath, rm, stat } from "node:fs/promises"
import { hostname } from "node:os"
import { dirname, join, resolve } from "node:path"
import { z } from "zod"
import { AuditError, normalizeReceipt, type CaptureOptions } from "./contracts"

export const REPO = resolve(import.meta.dir, "../../..")
export const FIXTURES = join(REPO, "script/qa/fixtures/dependency-audit")
export type CommandResult = { readonly command: readonly string[]; readonly exitCode: number; readonly stdout: string; readonly stderr: string }
export type Runtime = {
  readonly root: string; readonly home: string; readonly agent: string; readonly cwd: string;
  readonly binary: string; readonly inputBinary: string; readonly payload: string; readonly out: string;
  readonly env: Readonly<Record<string, string>>; readonly sha256: string; readonly size: number;
  readonly machine: string; readonly versions: { readonly bun: string; readonly node: string };
  readonly commands: CommandResult[];
}
export async function run(command: readonly string[], options: { readonly cwd: string; readonly env: Readonly<Record<string, string>>; readonly timeoutMs?: number }): Promise<CommandResult> {
  const process = Bun.spawn([...command], {
    cwd: options.cwd, env: { ...options.env }, stdin: "ignore", stdout: "pipe", stderr: "pipe",
    timeout: options.timeoutMs ?? 60000, killSignal: "SIGKILL",
  })
  try {
    const [exitCode, stdout, stderr] = await Promise.all([process.exited, new Response(process.stdout).text(), new Response(process.stderr).text()])
    return { command, exitCode, stdout, stderr }
  } finally {
    if (process.exitCode === null) { process.kill("SIGKILL"); await process.exited }
  }
}
export function requireSuccess(result: CommandResult): CommandResult {
  if (result.exitCode !== 0) throw new AuditError(result.command.join(" "), `exit ${result.exitCode}\n${result.stdout}\n${result.stderr}`)
  return result
}
export async function execute(runtime: Runtime, command: readonly string[], timeoutMs = 60000): Promise<CommandResult> {
  const result = await run(command, { cwd: runtime.cwd, env: runtime.env, timeoutMs })
  runtime.commands.push(result)
  return result
}
export async function hashFile(path: string): Promise<string> {
  return createHash("sha256").update(await Bun.file(path).bytes()).digest("hex")
}
export async function createRuntime(options: CaptureOptions): Promise<Runtime> {
  const out = resolve(options.out)
  await mkdir(out, { recursive: true })
  const root = await realpath(await mkdtemp(join(dirname(out), ".dependency-audit-")))
  try {
    const home = join(root, "home")
    const agent = join(home, ".omo/agent")
    const cwd = join(root, "workspace")
    for (const path of [home, agent, cwd, join(root, "tmp"), join(root, "fixtures")]) await mkdir(path, { recursive: true })
    for (const file of ["extension.ts", "helper.ts", "wide.png"]) await copyFile(join(FIXTURES, file), join(root, "fixtures", file))
    const binary = join(root, process.platform === "win32" ? "omo.exe" : "omo")
    await copyFile(resolve(options.binary), binary)
    await chmod(binary, 0o755)
    const [sha256, sourceHash, stats] = await Promise.all([hashFile(binary), hashFile(resolve(options.binary)), stat(binary)])
    if (sha256 !== sourceHash) throw new AuditError("copy", "binary hash changed during copy")
    const env = {
      PATH: process.env.PATH ?? "", HOME: home, USERPROFILE: home, TMPDIR: join(root, "tmp"), TMP: join(root, "tmp"), TEMP: join(root, "tmp"),
      XDG_CONFIG_HOME: join(home, "config"), XDG_DATA_HOME: join(home, "data"), XDG_STATE_HOME: join(home, "state"), XDG_CACHE_HOME: join(home, "cache"),
      OMO_CODING_AGENT_DIR: agent, SENPI_CODING_AGENT_DIR: agent, PI_CODING_AGENT_DIR: agent,
      OMO_OFFLINE: "1", SENPI_OFFLINE: "1", PI_OFFLINE: "1", DO_NOT_TRACK: "1",
      OMO_DISABLE_POSTHOG: "1", OMO_SENPI_DISABLE_POSTHOG: "1", OMO_SEND_ANONYMOUS_TELEMETRY: "0", OMO_SENPI_SEND_ANONYMOUS_TELEMETRY: "0",
      OMO_ENABLE_SHARED_HOST: "0", SENPI_ENABLE_SHARED_HOST: "0", OMO_RPC_CLIENT_CAPABILITIES: "extension_events",
      TERM: "xterm-256color", COLORTERM: "truecolor", LANG: "en_US.UTF-8",
      AWS_ACCESS_KEY_ID: "AKIAAUDITFAKE00000000", AWS_SECRET_ACCESS_KEY: "audit-fake-secret", AWS_REGION: "us-east-1",
      AWS_DEFAULT_REGION: "us-east-1", AWS_EC2_METADATA_DISABLED: "true", AWS_BEDROCK_FORCE_HTTP1: "1",
    }
    await Bun.write(join(agent, "settings.json"), JSON.stringify({ defaultProvider: "audit-local", defaultModel: "audit-v1", retry: { enabled: false }, installTelemetry: false, autoCompactEnabled: false }))
    await Bun.write(join(home, ".omo/omo.json"), JSON.stringify({ telemetry: { enabled: false }, memory: { enabled: false } }))
    const provision = requireSuccess(await run([binary, "--version"], { cwd, env }))
    const runtimes = await readdir(join(home, ".omo/binary-runtime"))
    const version = z.array(z.string()).length(1).parse(runtimes)[0]
    if (version === undefined) throw new AuditError("provision", "no runtime payload")
    const payload = join(home, ".omo/binary-runtime", version)
    const provisionedBinary = join(payload, process.platform === "win32" ? "omo.exe" : "omo")
    const node = requireSuccess(await run(["node", "--version"], { cwd, env })).stdout.trim()
    const runtime: Runtime = { root, home, agent, cwd, binary: provisionedBinary, inputBinary: resolve(options.binary), payload, out, env, sha256, size: stats.size,
      machine: `${process.platform}-${process.arch}-${createHash("sha256").update(hostname()).digest("hex").slice(0, 12)}`,
      versions: { bun: Bun.version, node }, commands: [provision] }
    await writeModels(runtime, { "audit-local": { api: "openai-completions", baseUrl: "http://127.0.0.1:9/v1" } })
    return runtime
  } catch (error) {
    await rm(root, { recursive: true, force: true })
    throw error
  }
}
export async function writeModels(runtime: Runtime, providers: Readonly<Record<string, { readonly api: string; readonly baseUrl: string }>>): Promise<void> {
  const models = Object.fromEntries(Object.entries(providers).map(([name, provider]) => [name, {
    ...provider, apiKey: "audit-fake-key", models: [{ id: "audit-v1", name: "Audit local", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 1024 }],
  }]))
  await Bun.write(join(runtime.agent, "models.json"), JSON.stringify({ providers: models }))
}
export function normalized(runtime: Runtime, value: unknown): unknown {
  return JSON.parse(normalizeReceipt(JSON.stringify(value), [[runtime.binary, "$BINARY"], [runtime.inputBinary, "$INPUT_BINARY"], [runtime.payload, "$PAYLOAD"],
    [runtime.root, "$SANDBOX"], [runtime.out, "$OUT"], [REPO, "$REPO"]]))
}
export async function disposeRuntime(runtime: Runtime): Promise<string> {
  await rm(runtime.root, { recursive: true, force: true })
  return "isolated HOME, agent, copied binary, and temporary workspace removed"
}
