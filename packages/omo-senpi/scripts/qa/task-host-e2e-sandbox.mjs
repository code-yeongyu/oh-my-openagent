// Sandbox construction for task-host-e2e.mjs (todo 41): the live QA of task children running as
// sessions of the machine-wide `omo daemon`.
//
// Isolation model, copied from task-rpc-e2e.mjs and hardened for a COMPILED omo binary:
//   - the binary resolves its agent dir from OMO_ first, then SENPI_, then PI_, so all THREE names are
//     pointed at the sandbox. Setting only SENPI_ silently hands the daemon the caller's real agent dir.
//   - HOME and XDG_CONFIG_HOME are the sandbox's too; the binary provisions its runtime under
//     $HOME/.omo/binary-runtime/<ver>/ on FIRST invocation, so HOME must be set before any call.
//   - SENPI_PACKAGE_DIR / OMO_PACKAGE_DIR / PI_PACKAGE_DIR / OMO_BIN / SENPI_BIN / PI_SESSION_FILE /
//     OMO_RPC_SOCKET_PATH / SENPI_RPC_HOST_WATCH_FD are DELETED from every child env: an inherited one
//     re-points the child at the caller's install or at the machine's real daemon socket.
//   - the run root is mkdtemp'd under /tmp with a 4-char tag so <agentDir>/rpc/rpc.sock, and the
//     `<socket>.next-<generation>` handoff bind path beside it, stay under the 104-byte sun_path limit.
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

export const DELETED_CHILD_ENV = [
  "SENPI_PACKAGE_DIR",
  "OMO_PACKAGE_DIR",
  "PI_PACKAGE_DIR",
  "OMO_BIN",
  "SENPI_BIN",
  "PI_SESSION_FILE",
  "OMO_RPC_SOCKET_PATH",
  "SENPI_RPC_HOST_WATCH_FD",
  "SENPI_CODING_AGENT_HOST_DIR",
  "SENPI_CODING_AGENT_RUNTIME_DIR",
  "OMO_CODING_AGENT_HOST_DIR",
  "OMO_CODING_AGENT_RUNTIME_DIR",
  "PI_CODING_AGENT_HOST_DIR",
  "PI_CODING_AGENT_RUNTIME_DIR",
]

export const AGENT_DIR_ENV_NAMES = ["OMO_CODING_AGENT_DIR", "SENPI_CODING_AGENT_DIR", "PI_CODING_AGENT_DIR"]

/**
 * What `realSenpiUntouched` GATES on: the two files a sandbox escape would have to read or rewrite to
 * be guilty of using the developer's real install. They are byte-stable on a live machine.
 */
export const CREDENTIAL_FILES = ["auth.json", "models.json"]
/**
 * Reported per file but NOT gated: on a machine where the operator's own omo session is running, that
 * session rewrites its `settings.json` and trust state while this driver runs. Gating on them would
 * turn ambient churn into a false accusation, so they are recorded per-file for attribution instead.
 */
export const WATCHED_FILES = [...CREDENTIAL_FILES, "settings.json", "trust.json", "omo.json"]
export const REAL_AGENT_DIRS = [join(homedir(), ".omo", "agent"), join(homedir(), ".senpi", "agent")]

export function credentialDigest(root, files = CREDENTIAL_FILES) {
  const hash = createHash("sha256")
  for (const name of files) {
    const path = join(root, name)
    hash.update(`${name}\0`)
    hash.update(existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : "absent")
  }
  return hash.digest("hex")
}

export function realAgentDigests() {
  return Object.fromEntries(REAL_AGENT_DIRS.map((dir) => [dir, {
    credentials: credentialDigest(dir),
    files: Object.fromEntries(WATCHED_FILES.map((name) => [name, credentialDigest(dir, [name])])),
  }]))
}

/** Which watched files moved across a run, named so a reviewer can attribute each one. */
export function changedRealAgentFiles(before, after) {
  return REAL_AGENT_DIRS.flatMap((dir) =>
    WATCHED_FILES.filter((name) => before[dir]?.files[name] !== after[dir]?.files[name]).map((name) => join(dir, name)))
}

export function createRunRoot() {
  // Deliberately /tmp and not os.tmpdir(): on darwin TMPDIR is a ~50-byte /var/folders path, which
  // pushes <agentDir>/rpc/rpc.sock past the unix-socket limit before a scenario name is added.
  return realpathSync(mkdtempSync("/tmp/dh41."))
}

/**
 * The identity of the thing under test. A live dev machine may REPLACE the binary at this path while a
 * suite is running (a concurrent rebuild), and every scenario after that swap would be measuring a
 * different build under one summary, so the driver digests it before and after and refuses to report a
 * run that straddled two binaries.
 */
export function binaryDigest(bin) {
  return createHash("sha256").update(readFileSync(bin)).digest("hex")
}

/** First invocation of the binary: provisions $HOME/.omo/binary-runtime/<ver>/ and reports its plugin root. */
export function provisionRuntime(bin, runRoot) {
  const home = join(runRoot, "home")
  const bootstrap = join(runRoot, "bootstrap")
  for (const dir of [home, bootstrap]) mkdirSync(dir, { recursive: true })
  const runtimeRoot = join(home, ".omo", "binary-runtime")
  const before = new Set(existsSync(runtimeRoot) ? readdirSync(runtimeRoot) : [])
  const env = baseEnv({ home, agentDir: bootstrap, xdgConfigHome: bootstrap })
  const result = spawnSync(bin, ["--version"], { env, encoding: "utf8", cwd: runRoot, timeout: 300_000 })
  const versions = existsSync(runtimeRoot) ? readdirSync(runtimeRoot) : []
  if (versions.length === 0) throw new Error(`binary did not provision a runtime: ${result.stderr ?? ""}`)
  // The runtime THIS binary just provisioned, never merely the first one on disk: a second version
  // directory means a different build wrote it, and its plugin root is not the one to seed.
  const added = versions.filter((version) => !before.has(version))
  const runtime = join(runtimeRoot, added[0] ?? versions[0])
  return {
    home,
    runtime,
    pluginRoot: join(runtime, "plugin"),
    version: (result.stdout ?? "").trim(),
    runtimeVersions: versions,
  }
}

/**
 * The daemon loads its extensions from the launch spec ONLY, and the spec refuses absolute and
 * `..`-escaping entries, so the keyless mock provider is copied INTO the provisioned plugin root and
 * referenced relatively. Without it the daemon has no `omo-mock` provider and every child session
 * would fail on model resolution rather than on the behavior under test. The sandbox's own
 * provisioned copy is patched - never the repo, never a real install.
 */
export function injectDaemonMockProvider(pluginRoot, mockEntry, name = "omo-qa-mock-provider.ts") {
  const specPath = join(pluginRoot, "daemon-launch-spec.json")
  // A pre-change payload ships no launch spec at all - that build has no daemon to seed, and its
  // per-child processes inherit the parent's `-e` mock provider instead.
  if (!existsSync(specPath)) return { specPath, extensions: [], launchSpecPresent: false }
  copyFileSync(mockEntry, join(pluginRoot, name))
  copyFileSync(join(dirname(mockEntry), "task-e2e-mock-provider.ts"), join(pluginRoot, "task-e2e-mock-provider.ts"))
  copyFileSync(join(dirname(mockEntry), "task-host-e2e-audit.mjs"), join(pluginRoot, "task-host-e2e-audit.mjs"))
  const spec = JSON.parse(readFileSync(specPath, "utf8"))
  const entry = `./${name}`
  if (!spec.core.extensions.includes(entry)) spec.core.extensions.push(entry)
  writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`)
  chmodSync(specPath, 0o600)
  return { specPath, extensions: spec.core.extensions, launchSpecPresent: true }
}

function baseEnv({ home, agentDir, xdgConfigHome, extra = {} }) {
  const env = { ...process.env }
  for (const name of DELETED_CHILD_ENV) delete env[name]
  env.HOME = home
  env.XDG_CONFIG_HOME = xdgConfigHome
  env.XDG_DATA_HOME = join(home, "data")
  env.XDG_CACHE_HOME = join(home, "cache")
  env.XDG_STATE_HOME = join(home, "state")
  for (const name of AGENT_DIR_ENV_NAMES) env[name] = agentDir
  env.OMO_SENPI_QA = "1"
  env.CI = "1"
  return { ...env, ...extra }
}

/** One scenario's private world: its own agent dir (so its own daemon + socket), project and sessions. */
export function createScenarioSandbox(run, name, { omoConfig, script }) {
  const root = join(run.runRoot, name)
  const agentDir = join(root, "agent")
  const cwd = join(root, "proj")
  const xdgConfigHome = join(root, "xdg")
  const sessionDir = join(root, "sessions")
  const stateDir = join(cwd, ".omo", "senpi-task")
  for (const dir of [agentDir, cwd, xdgConfigHome, sessionDir, join(cwd, ".omo"), join(agentDir, "omo-senpi", "omo-native")]) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(join(agentDir, "settings.json"), `${JSON.stringify({ defaultProjectTrust: "ask" }, null, 2)}\n`)
  writeFileSync(join(agentDir, "trust.json"), `${JSON.stringify({ [cwd]: true }, null, 2)}\n`)
  // A fresh agent dir re-claims onboarding on every run, and its triggerTurn would race print mode's
  // prompt ("Agent is already processing"), so the marker is pre-claimed exactly as task-rpc-e2e does.
  writeFileSync(
    join(agentDir, "omo-senpi", "omo-native", "onboarding-completed"),
    `${JSON.stringify({ completedAt: new Date().toISOString(), version: 1 })}\n`,
  )
  const sandbox = { name, root, agentDir, cwd, xdgConfigHome, sessionDir, stateDir, home: run.home, bin: run.bin }
  writeOmoConfig(sandbox, omoConfig)
  if (script !== undefined) writeMockScript(sandbox, script)
  return sandbox
}

/** omo.json lands in BOTH scopes: the project scope the task engine reads, and the agent scope `omo daemon` reads. */
export function writeOmoConfig(sandbox, config) {
  const json = `${JSON.stringify(config, null, 2)}\n`
  writeFileSync(join(sandbox.cwd, ".omo", "omo.json"), json)
  writeFileSync(join(sandbox.agentDir, "omo.json"), json)
}

export function writeMockScript(sandbox, script) {
  writeFileSync(join(sandbox.cwd, "mock-script.json"), `${JSON.stringify(script, null, 2)}\n`)
}

export function sandboxEnv(sandbox, extra = {}) {
  return baseEnv({ home: sandbox.home, agentDir: sandbox.agentDir, xdgConfigHome: sandbox.xdgConfigHome, extra })
}
