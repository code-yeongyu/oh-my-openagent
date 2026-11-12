import { spawn } from "node:child_process"
import { mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { describe, expect, it } from "bun:test"

import { withTelemetryOptOut } from "../scripts/qa/telemetry-opt-out-env.mjs"
import { testTempDir } from "../test-support/temp-dir"
import { awaitWithinTestBudget, useTestTimeout } from "../../../test-support/test-deadline"

// omo#13243: a session whose model was chosen explicitly must answer on that model or end the turn with a typed
// error naming it. It must never continue on another model. omo launches the engine that way (`senpi -p --model`
// for memory workers, a model named for every tier and task launch), so this probes the packaged engine omo ships,
// started from its bin, against a provider whose first model fails with a fallback-eligible error and whose
// configured chain offers a healthy second model.
const PROVIDER = "omo-mock"
const PRIMARY = "claude-opus-5"
const FALLBACK = "mock-weak"
const PRIMARY_REF = `${PROVIDER}/${PRIMARY}`
const FALLBACK_ANSWER = "fallback model answered"
const TEST_TIMEOUT_MS = 90_000

const requireFromHere = createRequire(import.meta.url)
const packageDir = dirname(requireFromHere.resolve("@code-yeongyu/senpi/package.json"))
const packaged = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as {
  bin: Record<string, string>
}
const mockProvider = join(import.meta.dir, "..", "scripts", "qa", "fallback-architect-mock-provider.ts")

type Launch = "explicit-model" | "default-model"

type SessionEntry = {
  readonly type?: string
  readonly reason?: string
  readonly provider?: string
  readonly modelId?: string
  readonly customType?: string
  readonly message?: { readonly role?: string; readonly provider?: string; readonly model?: string }
}

type RunResult = {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
  readonly entries: readonly SessionEntry[]
}

async function runPrintTurn(launch: Launch): Promise<RunResult> {
  const root = realpathSync(testTempDir("omo-model-pin-"))
  const cwd = join(root, "project")
  const agentDir = join(root, "agent")
  const sessionDir = join(root, "sessions")
  const home = join(root, "home")
  for (const dir of [cwd, agentDir, sessionDir, home]) mkdirSync(dir, { recursive: true })
  // The mock ends every non-fallback model's turn with "Request timed out.", a transient error the retry engine
  // answers with the configured chain.
  writeFileSync(join(cwd, "mock-script.json"), `${JSON.stringify({ primaryOutcome: "transient" })}\n`)
  writeFileSync(join(agentDir, "trust.json"), `${JSON.stringify({ [cwd]: true })}\n`)
  writeFileSync(
    join(agentDir, "settings.json"),
    `${JSON.stringify(
      {
        ...(launch === "default-model" ? { defaultProvider: PROVIDER, defaultModel: PRIMARY } : {}),
        retry: {
          enabled: true,
          maxRetries: 1,
          baseDelayMs: 1,
          modelFallback: true,
          fallbackChains: { [PRIMARY_REF]: [`${PROVIDER}/${FALLBACK}`] },
        },
      },
      null,
      2,
    )}\n`,
  )
  // The runner's own session, agent dirs and a pinned runner's NO_FALLBACK switch must not reach the probed engine.
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^(PI_|SENPI_|OMO_)/.test(key) && key !== "DBUS_SESSION_BUS_ADDRESS"),
  )
  const env: NodeJS.ProcessEnv = {
    ...withTelemetryOptOut(inherited),
    OMO_CODING_AGENT_DIR: agentDir,
    SENPI_CODING_AGENT_DIR: agentDir,
    PI_CODING_AGENT_DIR: agentDir,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(root, "xdg-config"),
    XDG_DATA_HOME: join(root, "xdg-data"),
    XDG_CACHE_HOME: join(root, "xdg-cache"),
    XDG_RUNTIME_DIR: join(root, "xdg-runtime"),
    SENPI_CODING_AGENT_SESSION_DIR: sessionDir,
  }
  const modelArgs = launch === "explicit-model" ? ["--provider", PROVIDER, "--model", PRIMARY] : []
  const child = spawn(
    process.execPath,
    [
      join(packageDir, packaged.bin.senpi),
      "-e",
      mockProvider,
      "-p",
      ...modelArgs,
      "--session-dir",
      sessionDir,
      "say hello",
    ],
    { cwd, env, stdio: ["ignore", "pipe", "pipe"] },
  )
  let stdout = ""
  let stderr = ""
  child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")))
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")))
  // A spawn that fails emits 'error' and never 'exit'; settle on either so teardown never hangs.
  const exited = new Promise<number | null>((resolve) => {
    child.once("exit", (code) => resolve(code))
    child.once("error", () => resolve(null))
  })
  let code: number | null
  try {
    code = await awaitWithinTestBudget(exited, `the ${launch} print turn to exit`)
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL")
  }
  return { code, stdout, stderr, entries: readSessionEntries(sessionDir) }
}

function readSessionEntries(sessionDir: string): SessionEntry[] {
  const entries: SessionEntry[] = []
  for (const entry of readdirSync(sessionDir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue
    for (const line of readFileSync(join(entry.parentPath, entry.name), "utf8").split("\n")) {
      if (line.trim() !== "") entries.push(JSON.parse(line) as SessionEntry)
    }
  }
  return entries
}

function assistantModels(entries: readonly SessionEntry[]): string[] {
  return entries
    .filter((entry) => entry.type === "message" && entry.message?.role === "assistant")
    .map((entry) => `${entry.message?.provider}/${entry.message?.model}`)
}

function fallbackChanges(entries: readonly SessionEntry[]): SessionEntry[] {
  return entries.filter((entry) => entry.type === "model_change" && entry.reason === "fallback")
}

describe.skipIf(process.platform === "win32")("packaged senpi engine: an explicitly chosen model holds", () => {
  it(
    "#given a launch that names its model and a configured chain #when that model fails with a fallback-eligible error #then the turn ends on it with a typed error and no other model answers",
    async () => {
      useTestTimeout(TEST_TIMEOUT_MS)
      const run = await runPrintTurn("explicit-model")

      expect(fallbackChanges(run.entries)).toEqual([])
      expect(assistantModels(run.entries).length).toBeGreaterThan(0)
      expect(new Set(assistantModels(run.entries))).toEqual(new Set([PRIMARY_REF]))
      expect(run.stdout).not.toContain(FALLBACK_ANSWER)
      expect(run.code).toBe(1)
      expect(run.stderr).toContain(`Pinned model failed: ${PRIMARY_REF}`)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "#given a launch on the default model with the same chain #when that model fails #then the chain answers, every turn records its own model and the model reads a switch note",
    async () => {
      useTestTimeout(TEST_TIMEOUT_MS)
      const run = await runPrintTurn("default-model")

      expect(fallbackChanges(run.entries).map((entry) => `${entry.provider}/${entry.modelId}`)).toEqual([
        `${PROVIDER}/${FALLBACK}`,
      ])
      expect(assistantModels(run.entries)).toContain(PRIMARY_REF)
      expect(assistantModels(run.entries).at(-1)).toBe(`${PROVIDER}/${FALLBACK}`)
      expect(run.stdout).toContain(FALLBACK_ANSWER)
      expect(run.code).toBe(0)
      expect(
        run.entries.filter((entry) => entry.type === "custom_message" && entry.customType === "model_switch"),
      ).toHaveLength(1)
    },
    TEST_TIMEOUT_MS,
  )
})
