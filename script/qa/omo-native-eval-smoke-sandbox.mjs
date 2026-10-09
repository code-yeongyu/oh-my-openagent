// The packaged eval smoke's isolated sandbox: a private HOME/XDG tree, agent dir, project with a marker fixture,
// sandbox-cell settings and the scripted provider, plus the environment the binary runs under.
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { evalSmokeProviderSource } from "./omo-native-eval-smoke-provider.mjs"

// OMO_SMOKE_JS_ISOLATION=process runs the JavaScript cells in the process-isolated kernel.
export const processIsolation = process.env.OMO_SMOKE_JS_ISOLATION === "process"

export function isolatedEnvironment(sandbox) {
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (/^(SENPI_|OMO_|PI_|NODE_PATH|NODE_OPTIONS)/.test(key)) continue
    if (/CODING_AGENT_(DIR|SESSION_DIR)$|TOKEN|SECRET|PASSWORD|COOKIE|CREDENTIAL|API_KEY/i.test(key)) continue
    env[key] = value
  }
  return {
    ...env, HOME: sandbox.home, USERPROFILE: sandbox.home,
    XDG_CONFIG_HOME: join(sandbox.home, "config"), XDG_DATA_HOME: join(sandbox.home, "data"),
    XDG_STATE_HOME: join(sandbox.home, "state"), XDG_CACHE_HOME: join(sandbox.home, "cache"),
    TMPDIR: sandbox.root, TMP: sandbox.root, TEMP: sandbox.root,
    OMO_CODING_AGENT_DIR: sandbox.agentDir, SENPI_CODING_AGENT_SESSION_DIR: sandbox.sessionDir,
    ...(processIsolation ? { SENPI_CODEMODE_JS_ISOLATION: "process" } : {}),
    PI_OFFLINE: "1", PI_TELEMETRY: "0",
  }
}

export function createSandbox(binary) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "omo-eval-smoke-")))
  const sandbox = {
    root, home: join(root, "home"), cwd: join(root, "project"),
    agentDir: join(root, "agent"), sessionDir: join(root, "sessions"),
    providerPath: join(root, "provider.ts"), receiptPath: join(root, "read.jsonl"),
    binary: join(root, process.platform === "win32" ? "omo.exe" : "omo"),
    marker: crypto.randomUUID(),
  }
  for (const directory of [sandbox.home, sandbox.cwd, sandbox.agentDir, sandbox.sessionDir]) {
    mkdirSync(directory, { recursive: true })
  }
  copyFileSync(binary, sandbox.binary)
  chmodSync(sandbox.binary, 0o755)
  mkdirSync(join(sandbox.agentDir, "omo-senpi", "omo-native"), { recursive: true })
  writeFileSync(join(sandbox.agentDir, "omo-senpi", "omo-native", "onboarding-completed"), '{"version":1}\n')
  writeFileSync(join(sandbox.agentDir, "trust.json"), JSON.stringify({ [sandbox.cwd]: true }))
  writeFileSync(join(sandbox.agentDir, "settings.json"), JSON.stringify({
    defaultProjectTrust: "ask", defaultProvider: "openai", defaultModel: "gpt-5.6-sol",
  }))
  writeFileSync(join(sandbox.agentDir, "models.json"), JSON.stringify({
    providers: { openai: { models: [
      { id: "gpt-5.6-sol", name: "Eval Smoke", contextWindow: 200000, maxTokens: 4096 },
    ] } },
  }))
  writeFileSync(join(sandbox.cwd, "fixture.txt"), `${sandbox.marker}\n`)
  // Sandbox cells on. Every cell gets 10 s before it detaches (room for a cold QuickJS boot on a slow runner). The
  // large sandbox cell blocks until a later cell releases it, so its detach and the peek after it never race its end.
  mkdirSync(join(sandbox.cwd, ".senpi"), { recursive: true })
  writeFileSync(join(sandbox.cwd, ".senpi", "codemode.json"), JSON.stringify({
    sandbox: { enabled: true }, cellTimeoutSeconds: 10, foregroundWindowSeconds: 12,
  }))
  writeFileSync(sandbox.providerPath, evalSmokeProviderSource(sandbox.receiptPath))
  return sandbox
}
