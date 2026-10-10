import { spawn } from "node:child_process"
import { chmodSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { watchUntil } from "./kibitzer-sidecar-support.mjs"

const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`

export function createReplayGate(sandbox) {
  const readyPath = join(sandbox.root, "reflection-ready")
  const releasePath = join(sandbox.root, "reflection-release")
  const script = join(sandbox.root, "reflection-gate.mjs")
  writeFileSync(script, `import { existsSync, watch, writeFileSync } from 'node:fs';
const released = ${JSON.stringify(releasePath)};
const watcher = watch(${JSON.stringify(sandbox.root)}, inspect);
const deadline = setTimeout(() => { watcher.close(); process.exitCode = 1 }, 60000);
function inspect() { if (existsSync(released)) { watcher.close(); clearTimeout(deadline) } }
writeFileSync(${JSON.stringify(readyPath)}, 'ready'); inspect();\n`)
  const ready = watchUntil(sandbox.root, () => {
    try { return readFileSync(readyPath, "utf8") === "ready" } catch (error) { if (error.code === "ENOENT") return false; throw error }
  }, { timeoutMs: 60_000, description: "child generation gate" })
  return { ready, release: () => writeFileSync(releasePath, "release"), command: `node ${quote(script)}` }
}

/** --keep transfers explicit ownership of this synthetic provider to the lead. */
export async function retainRuntime({ sandbox, command, env, session, report }) {
  const providerScript = join(dirname(fileURLToPath(import.meta.url)), "reflection-recap-retained-provider.mjs")
  const child = spawn(process.execPath, [providerScript, report], { cwd: sandbox.cwd, env, detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"] })
  let provider
  try {
    provider = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Retained provider readiness timed out")), 10_000)
      child.once("error", (error) => { clearTimeout(timer); reject(error) })
      child.once("message", (message) => { clearTimeout(timer); resolve(message) })
    })
  } catch (error) { child.kill("SIGTERM"); throw error }
  child.disconnect()
  child.unref()
  const modelsPath = join(sandbox.agentDir, "models.json")
  const models = JSON.parse(readFileSync(modelsPath, "utf8"))
  models.providers["omo-mock"].baseUrl = provider.baseUrl
  writeFileSync(modelsPath, JSON.stringify(models))
  const wrapper = join(sandbox.root, "omo-reflection-qa")
  const variables = ["HOME", "USERPROFILE", "SENPI_CODING_AGENT_DIR", "OMO_MEMORY_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "PI_OFFLINE"]
  writeFileSync(wrapper, `#!/bin/sh\nunset OMO_CODING_AGENT_DIR PI_CODING_AGENT_DIR OMO_PACKAGE_DIR SENPI_PACKAGE_DIR PI_PACKAGE_DIR SENPI_BIN\nexport SENPI_RPC_CLIENT_CAPABILITIES='extension_events'\n${variables.map((name) => `export ${name}=${quote(env[name])}`).join("\n")}\nexec ${[command.file, ...command.prefix].map(quote).join(" ")} "$@"\n`)
  chmodSync(wrapper, 0o700)
  return {
    wrapper, providerPid: child.pid, providerUrl: provider.baseUrl, agentDir: sandbox.agentDir,
    memoryHome: sandbox.memoryHome, sessionsDir: sandbox.sessionsDir, sessionFile: session.sessionFile,
    tuiCommand: `${quote(wrapper)} --session ${quote(session.sessionFile)}`,
    rpcCommand: `${quote(wrapper)} --session ${quote(session.sessionFile)} --mode rpc`,
    desktopRuntimePath: wrapper,
    cleanupCommand: `kill ${child.pid}; rm -rf ${quote(sandbox.root)}`,
  }
}
