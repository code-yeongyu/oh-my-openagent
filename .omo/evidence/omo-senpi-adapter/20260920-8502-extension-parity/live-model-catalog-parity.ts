import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"

import { digestCredentialFiles } from "../../../../packages/omo-senpi/scripts/qa/task-rpc-e2e-helpers.mjs"
import { parseModelCatalog, probeModelCatalog } from "../../../../packages/senpi-task/src/runners/rpc/model-catalog-probe"
import { buildRpcModelCatalogSpawn } from "../../../../packages/senpi-task/src/runners/rpc/spawn"

const repoRoot = resolve(import.meta.dir, "../../../..")
const senpiBin = process.env.SENPI_BIN?.trim()
if (senpiBin === undefined || senpiBin.length === 0) throw new Error("SENPI_BIN is required")

const realAgentDir = join(homedir(), ".senpi", "agent")
const beforeCredentials = digestCredentialFiles(realAgentDir)
const root = mkdtempSync(join(tmpdir(), "omo-8502-live-"))
const projectDir = join(root, "project")
const agentDir = join(root, "agent")
const stateRoot = join(projectDir, ".omo", "senpi-task")
const taskId = "st_8502_live_catalog"
const childStateDir = join(stateRoot, "children", taskId)
const forbiddenLauncher = join(root, "forbidden-launcher.ts")
const providerExtension = join(repoRoot, "packages", "omo-senpi", "scripts", "qa", "task-rpc-e2e-mock-provider.ts")

try {
  mkdirSync(join(stateRoot, "tasks"), { recursive: true })
  mkdirSync(agentDir, { recursive: true })
  writeFileSync(join(stateRoot, "tasks", `${taskId}.json`), JSON.stringify({ owner: { kind: "dag" } }))
  writeFileSync(join(agentDir, "settings.json"), `${JSON.stringify({ defaultProjectTrust: "ask", packages: [] }, null, 2)}\n`)
  writeFileSync(join(agentDir, "trust.json"), `${JSON.stringify({ [projectDir]: true }, null, 2)}\n`)
  writeFileSync(forbiddenLauncher, 'throw new Error("forbidden DAG launcher loaded")\nexport default function forbidden() {}\n')

  const descriptor = buildRpcModelCatalogSpawn({
    task_id: taskId,
    cwd: projectDir,
    state_dir: childStateDir,
    prompt: "catalog parity probe",
    model: "omo-mock/mock-1",
    extensions: [forbiddenLauncher, providerExtension],
  }, {
    isBunBinary: false,
    isCompiledEngine: false,
    execPath: process.execPath,
    platform: process.platform,
    parentEnv: {
      ...process.env,
      SENPI_CODING_AGENT_DIR: agentDir,
      XDG_CONFIG_HOME: join(root, "xdg-config"),
      XDG_DATA_HOME: join(root, "xdg-data"),
      XDG_CACHE_HOME: join(root, "xdg-cache"),
    },
    resolveRpcEntry: () => join(repoRoot, "node_modules", "@code-yeongyu", "senpi", "dist", "rpc-entry.js"),
    resolveSenpiExecutable: () => senpiBin,
  })

  const result = await probeModelCatalog(descriptor, { timeoutMs: 60_000 })
  const extensionArgs = descriptor.args.flatMap((arg, index) => arg === "--extension" ? [descriptor.args[index + 1] ?? ""] : [])
  const models = parseModelCatalog(result.stdout)
  const launcherExcluded = extensionArgs.every((entry) => basename(entry) !== basename(forbiddenLauncher))
  const providerIncluded = extensionArgs.some((entry) => basename(entry) === basename(providerExtension))
  const providerModelVisible = models.has("omo-mock/mock-1")
  const forbiddenLauncherSilent = result.stderr.includes("forbidden DAG launcher loaded") === false
  const realCredentialsUntouched = beforeCredentials === digestCredentialFiles(realAgentDir)
  const pass = result.code === 0 && !result.timedOut && launcherExcluded && providerIncluded
    && providerModelVisible && forbiddenLauncherSilent && realCredentialsUntouched

  console.log(JSON.stringify({
    result: pass ? "PASS" : "FAIL",
    code: result.code,
    timedOut: result.timedOut,
    effectiveExtensions: extensionArgs.map((entry) => basename(entry)),
    launcherExcluded,
    providerIncluded,
    providerModelVisible,
    forbiddenLauncherSilent,
    realCredentialsUntouched,
    sandboxAgentDirDistinct: resolve(agentDir) !== resolve(realAgentDir),
    stderrExcerpt: pass ? "" : result.stderr.slice(-500),
  }))
  if (!pass) process.exitCode = 1
} finally {
  rmSync(root, { recursive: true, force: true })
}
