#!/usr/bin/env node
// allow: SIZE_OK - one bounded QA driver keeps handshake, packed boot, failure, runtime checks, and cleanup evidence together.
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { homedir, tmpdir } from "node:os"
import { delimiter, dirname, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(scriptDir, "..", "..")
const repoRoot = resolve(packageRoot, "..", "..")
const pluginRoot = join(packageRoot, "plugin")
const builtRuntimeEntry = join(repoRoot, "packages", "ast-grep-mcp", "dist", "cli.js")
const stagedRuntimeEntry = join(pluginRoot, "runtime", "ast-grep-mcp", "cli.js")
const stagedRuntimeManifest = join(pluginRoot, "runtime", "ast-grep-mcp", "manifest.json")
const stageScript = join(pluginRoot, "scripts", "stage-ast-grep-mcp-runtime.mjs")
const defaultEvidenceDir = join(repoRoot, ".omo", "evidence", "20260803-senpi-ast-grep-mcp")
const expectedRawTools = ["search", "rewrite", "scan"]
const expectedSenpiTools = expectedRawTools.map((name) => `mcp__ast_grep_${name}`)
const realAgentDir = join(homedir(), ".senpi", "agent")
const timestamp = () => new Date().toISOString()

function parseArgs(argv) {
  const args = { evidenceDir: defaultEvidenceDir }
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--evidence-dir") args.evidenceDir = resolve(argv[++index])
    else throw new Error(`unknown argument: ${arg}`)
  }
  return args
}

function findOnPath(bin) {
  if (bin.includes("/")) return existsSync(bin) ? resolve(bin) : null
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = resolve(dir || ".", bin)
    if (existsSync(candidate)) return candidate
  }
  return null
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

function credentialDigest(agentDir) {
  const hash = createHash("sha256")
  for (const name of ["auth.json", "models.json", "settings.json", "trust.json"]) {
    const path = join(agentDir, name)
    hash.update(name).update("\0")
    hash.update(existsSync(path) ? readFileSync(path) : Buffer.from("absent")).update("\0")
  }
  return hash.digest("hex")
}

function isolatedEnv(workRoot, homeDir, agentDir) {
  const xdgRoot = join(workRoot, "xdg")
  const env = {
    ...process.env,
    HOME: homeDir,
    USERPROFILE: homeDir,
    HOMEDRIVE: "",
    HOMEPATH: homeDir,
    XDG_CONFIG_HOME: join(xdgRoot, "config"),
    XDG_DATA_HOME: join(xdgRoot, "data"),
    XDG_STATE_HOME: join(xdgRoot, "state"),
    XDG_CACHE_HOME: join(xdgRoot, "cache"),
    SENPI_CODING_AGENT_DIR: agentDir,
    SENPI_MCP_STARTUP_TIMEOUT_MS: "5000",
    OMO_SENPI_QA: "1",
    NODE_PATH: "",
  }
  for (const path of [
    homeDir,
    agentDir,
    env.XDG_CONFIG_HOME,
    env.XDG_DATA_HOME,
    env.XDG_STATE_HOME,
    env.XDG_CACHE_HOME,
  ]) mkdirSync(path, { recursive: true })
  return env
}

function formatCommand(command, args) {
  return [command, ...args].map((part) => JSON.stringify(part)).join(" ")
}

function runCommand(command, args, options = {}) {
  const startedAt = timestamp()
  const timeout = options.timeout ?? 60_000
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    input: options.input,
    encoding: "utf8",
    timeout,
    maxBuffer: 64 * 1024 * 1024,
  })
  return {
    command: formatCommand(command, args),
    cwd: options.cwd ?? repoRoot,
    startedAt,
    finishedAt: timestamp(),
    timeoutMs: timeout,
    status: result.status,
    signal: result.signal,
    error: result.error?.message,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  }
}

function renderRun(run) {
  return [
    `$ ${run.command}`,
    `cwd=${run.cwd}`,
    `startedAt=${run.startedAt}`,
    `finishedAt=${run.finishedAt}`,
    `timeoutMs=${run.timeoutMs}`,
    `status=${String(run.status)} signal=${String(run.signal)} error=${run.error ?? "none"}`,
    "--- stdout ---",
    run.stdout.trimEnd(),
    "--- stderr ---",
    run.stderr.trimEnd(),
  ].join("\n")
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function parseJsonLines(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line))
}

function runHandshake(transcript) {
  transcript.push(`\n## HANDSHAKE @ ${timestamp()}`)
  const input = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
  ].map((request) => JSON.stringify(request)).join("\n") + "\n"
  const run = runCommand(process.execPath, [stagedRuntimeEntry], { input, timeout: 10_000 })
  transcript.push(renderRun(run))
  assert(run.status === 0, `handshake server exited ${run.status}: ${run.stderr}`)
  const responses = parseJsonLines(run.stdout)
  assert(responses.length === 2, `handshake expected 2 responses, got ${responses.length}`)
  const initialize = responses.find((response) => response.id === 1)?.result
  const tools = responses.find((response) => response.id === 2)?.result?.tools
  assert(initialize?.serverInfo?.name === "ast_grep", `unexpected server name: ${JSON.stringify(initialize?.serverInfo)}`)
  assert(initialize?.serverInfo?.version === "0.1.0", `unexpected server version: ${JSON.stringify(initialize?.serverInfo)}`)
  assert(Array.isArray(tools), "tools/list did not return a tools array")
  const names = tools.map((tool) => tool.name)
  assert(JSON.stringify(names) === JSON.stringify(expectedRawTools), `unexpected raw tool order: ${JSON.stringify(names)}`)
  transcript.push(`HANDSHAKE PASS serverInfo=ast_grep/0.1.0 rawTools=${JSON.stringify(names)}`)
  return [`# 2026-08-03 ast-grep MCP handshake`, `timestamp=${timestamp()}`, renderRun(run), `PASS serverInfo=ast_grep/0.1.0 rawTools=${JSON.stringify(names)}`, ""].join("\n")
}

function verifyCurrentStagedRuntime(transcript) {
  transcript.push(`\n## STALE-STATE GUARD @ ${timestamp()}`)
  const check = runCommand(process.execPath, [stageScript, "--check"], { timeout: 30_000 })
  transcript.push(renderRun(check))
  assert(check.status === 0, `current staged runtime check failed: ${check.stderr || check.stdout}`)
  const builtSha = sha256(builtRuntimeEntry)
  const stagedSha = sha256(stagedRuntimeEntry)
  const manifest = JSON.parse(readFileSync(stagedRuntimeManifest, "utf8"))
  assert(builtSha === stagedSha, `staged sha ${stagedSha} != built sha ${builtSha}`)
  assert(manifest.sha256 === stagedSha, `manifest sha ${manifest.sha256} != staged sha ${stagedSha}`)
  transcript.push(`STALE-STATE GUARD PASS builtSha256=${builtSha} stagedSha256=${stagedSha} manifestSha256=${manifest.sha256}`)
  return { builtSha, stagedSha }
}

function packAndExtract(workRoot, transcript) {
  const packDir = join(workRoot, "pack")
  const extractDir = join(workRoot, "extract")
  mkdirSync(packDir, { recursive: true })
  mkdirSync(extractDir, { recursive: true })
  const pack = runCommand("npm", ["pack", pluginRoot, "--pack-destination", packDir], { timeout: 60_000 })
  transcript.push(renderRun(pack))
  assert(pack.status === 0, `npm pack failed: ${pack.stderr || pack.stdout}`)
  const filename = pack.stdout.trim().split(/\r?\n/).at(-1)
  assert(typeof filename === "string" && filename.endsWith(".tgz"), `npm pack did not report a tarball: ${pack.stdout}`)
  const tarball = join(packDir, filename)
  const extract = runCommand("tar", ["-xzf", tarball, "-C", extractDir], { timeout: 30_000 })
  transcript.push(renderRun(extract))
  assert(extract.status === 0, `tar extraction failed: ${extract.stderr || extract.stdout}`)
  const extractedPlugin = join(extractDir, "package")
  assert(existsSync(join(extractedPlugin, "package.json")), `extracted plugin is missing package.json: ${extractedPlugin}`)
  return { tarball, extractedPlugin }
}

function writeCaptureProvider(path) {
  writeFileSync(path, `
import { writeFileSync } from "node:fs"
const capturePath = process.env.OMO_AST_GREP_QA_CAPTURE
const model = { id:"mock-1", name:"Mock 1", reasoning:false, input:["text"], cost:{input:0,output:0,cacheRead:0,cacheWrite:0}, contextWindow:200000, maxTokens:4096 }
export default function(pi) {
  pi.registerProvider("omo-ast-grep-qa", {
    name:"omo ast-grep qa", baseUrl:"file://omo-ast-grep-qa", apiKey:"mock", api:"openai-completions", models:[model],
    streamSimple(_model, context) {
      const toolNames = Array.isArray(context?.tools) ? context.tools.map((tool) => tool?.name).filter((name) => typeof name === "string") : []
      writeFileSync(capturePath, JSON.stringify({ timestamp:new Date().toISOString(), contextKeys:Object.keys(context ?? {}).sort(), toolNames }, null, 2) + "\\n")
      const message = { role:"assistant", content:[{type:"text",text:"packed ast-grep boot complete"}], api:"openai-completions", provider:"omo-ast-grep-qa", model:"mock-1", usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:0}, stopReason:"stop", timestamp:Date.now() }
      const events = [
        {type:"start",partial:{...message,content:[]}},
        {type:"text_start",contentIndex:0,partial:{...message,content:[{type:"text",text:""}]}},
        {type:"text_delta",contentIndex:0,delta:"packed ast-grep boot complete",partial:message},
        {type:"text_end",contentIndex:0,content:"packed ast-grep boot complete",partial:message},
        {type:"done",reason:"stop",message},
      ]
      return { async *[Symbol.asyncIterator]() { for (const event of events) yield event }, async result() { return message } }
    },
  })
}
`)
}

function runInstaller(extractedPlugin, projectDir, env) {
  return runCommand(process.execPath, [join(extractedPlugin, "scripts", "install.mjs"), "install"], {
    cwd: projectDir,
    env,
    timeout: 60_000,
  })
}

function runPackedBoot(workRoot, extractedPlugin, senpiBin, transcript) {
  transcript.push(`\n## PACKED BOOT @ ${timestamp()}`)
  const homeDir = join(workRoot, "packed-home")
  const agentDir = join(workRoot, "packed-agent")
  const projectDir = join(workRoot, "packed-project")
  const sessionDir = join(workRoot, "packed-sessions")
  const capturePath = join(workRoot, "provider-capture.json")
  const providerPath = join(workRoot, "capture-provider.mjs")
  mkdirSync(projectDir, { recursive: true })
  mkdirSync(sessionDir, { recursive: true })
  writeCaptureProvider(providerPath)
  const env = { ...isolatedEnv(workRoot, homeDir, agentDir), OMO_AST_GREP_QA_CAPTURE: capturePath }
  const install = runInstaller(extractedPlugin, projectDir, env)
  transcript.push(renderRun(install))
  assert(install.status === 0, `packed install failed: ${install.stderr || install.stdout}`)
  const installResult = JSON.parse(install.stdout.trim())
  assert(installResult.agentDir === agentDir, `packed install escaped isolated agent dir: ${installResult.agentDir}`)
  assert(existsSync(join(agentDir, "settings.json")), `isolated settings were not written under ${agentDir}`)
  const boot = runCommand(senpiBin, [
    "-e", providerPath,
    "-p",
    "--mode", "json",
    "--provider", "omo-ast-grep-qa",
    "--model", "mock-1",
    "--session-dir", sessionDir,
    "--no-skills",
    "--no-context-files",
    "packed ast-grep MCP boot proof",
  ], { cwd: projectDir, env, timeout: 90_000 })
  transcript.push(renderRun(boot))
  assert(boot.status === 0, `packed Senpi boot failed: ${boot.stderr || boot.stdout}`)
  assert(existsSync(capturePath), `mock provider did not capture the Senpi tool surface: ${capturePath}`)
  const capture = JSON.parse(readFileSync(capturePath, "utf8"))
  const toolNames = capture.toolNames ?? []
  const missing = expectedSenpiTools.filter((name) => !toolNames.includes(name))
  const retiredToolMarker = ["code", "graph"].join("")
  const retiredTools = toolNames.filter((name) => name.toLowerCase().includes(retiredToolMarker))
  assert(missing.length === 0, `packed Senpi boot is missing ast_grep tools: ${JSON.stringify(missing)}; visible=${JSON.stringify(toolNames)}`)
  assert(retiredTools.length === 0, `packed Senpi boot exposed retired graph tools: ${JSON.stringify(retiredTools)}`)
  transcript.push(`PROVIDER CAPTURE RAW\n${readFileSync(capturePath, "utf8").trimEnd()}`)
  transcript.push(`PACKED BOOT PASS astGrepTools=${JSON.stringify(expectedSenpiTools)} retiredGraphTools=[]`)
  return { agentDir, homeDir, projectDir, sessionDir, capturePath, toolNames }
}

function runPackedInstallerFailureScenarios(workRoot, extractedPlugin, transcript) {
  const runtimeEntry = join(extractedPlugin, "runtime", "ast-grep-mcp", "cli.js")
  const manifestPath = join(dirname(runtimeEntry), "manifest.json")
  const original = readFileSync(runtimeEntry)
  const originalMode = statSync(runtimeEntry).mode & 0o777
  assert(existsSync(manifestPath), `packed runtime manifest is missing: ${manifestPath}`)

  transcript.push(`\n## PACKED INSTALLER C1 — MISSING RUNTIME @ ${timestamp()}`)
  rmSync(runtimeEntry)
  const missingHomeDir = join(workRoot, "missing-home")
  const missingAgentDir = join(workRoot, "missing-agent")
  const missingProjectDir = join(workRoot, "missing-project")
  mkdirSync(missingProjectDir, { recursive: true })
  const missingEnv = isolatedEnv(join(workRoot, "missing-profile"), missingHomeDir, missingAgentDir)
  const missingInstall = runInstaller(extractedPlugin, missingProjectDir, missingEnv)
  transcript.push(renderRun(missingInstall))
  const missingOutput = `${missingInstall.stdout}\n${missingInstall.stderr}`
  assert(missingInstall.status !== 0, "packed installer silently succeeded with missing ast-grep MCP runtime")
  assert(
    missingOutput.includes("missing required runtime artifacts") && missingOutput.includes(extractedPlugin),
    `packed installer missing-runtime failure was not explicit enough: ${missingOutput}`,
  )
  writeFileSync(runtimeEntry, original)
  chmodSync(runtimeEntry, originalMode)
  const missingRestored = runInstaller(extractedPlugin, missingProjectDir, missingEnv)
  transcript.push("--- C1 restored runtime verification ---")
  transcript.push(renderRun(missingRestored))
  assert(missingRestored.status === 0, `C1 restored runtime did not install: ${missingRestored.stderr || missingRestored.stdout}`)
  transcript.push(`PACKED INSTALLER C1 PASS deleted=${runtimeEntry} loudMissingFailure=true restored=true`)

  transcript.push(`\n## PACKED INSTALLER C2 — CORRUPTED PRESENT RUNTIME @ ${timestamp()}`)
  writeFileSync(runtimeEntry, "#!/usr/bin/env node\nthrow new Error('corrupted packed ast-grep runtime')\n")
  chmodSync(runtimeEntry, originalMode)
  const corruptHomeDir = join(workRoot, "corrupt-home")
  const corruptAgentDir = join(workRoot, "corrupt-agent")
  const corruptProjectDir = join(workRoot, "corrupt-project")
  mkdirSync(corruptProjectDir, { recursive: true })
  const corruptEnv = isolatedEnv(join(workRoot, "corrupt-profile"), corruptHomeDir, corruptAgentDir)
  const corruptInstall = runInstaller(extractedPlugin, corruptProjectDir, corruptEnv)
  transcript.push(renderRun(corruptInstall))
  const corruptOutput = `${corruptInstall.stdout}\n${corruptInstall.stderr}`
  assert(corruptInstall.status !== 0, "packed installer silently succeeded with corrupted present ast-grep MCP runtime")
  assert(
    corruptOutput.includes("ast-grep MCP runtime integrity error") && corruptOutput.includes("sha256 mismatch"),
    `packed installer corruption failure was not an explicit integrity error: ${corruptOutput}`,
  )
  assert(!existsSync(join(corruptAgentDir, "settings.json")), "corrupted packed runtime was registered despite integrity failure")
  writeFileSync(runtimeEntry, original)
  chmodSync(runtimeEntry, originalMode)
  const corruptRestored = runInstaller(extractedPlugin, corruptProjectDir, corruptEnv)
  transcript.push("--- C2 restored runtime verification ---")
  transcript.push(renderRun(corruptRestored))
  assert(corruptRestored.status === 0, `C2 restored runtime did not install: ${corruptRestored.stderr || corruptRestored.stdout}`)
  transcript.push(`PACKED INSTALLER C2 PASS corrupted=${runtimeEntry} manifestPresent=true integrityFailure=true restored=true`)
}

function createRuntimeCheckFixture(workRoot) {
  const fixtureRoot = join(workRoot, "runtime-check-fixture")
  const fixtureScript = join(fixtureRoot, "packages", "omo-senpi", "plugin", "scripts", "stage-ast-grep-mcp-runtime.mjs")
  const sourceEntry = join(fixtureRoot, "packages", "ast-grep-mcp", "dist", "cli.js")
  const targetEntry = join(fixtureRoot, "packages", "omo-senpi", "plugin", "runtime", "ast-grep-mcp", "cli.js")
  mkdirSync(dirname(fixtureScript), { recursive: true })
  mkdirSync(dirname(sourceEntry), { recursive: true })
  copyFileSync(stageScript, fixtureScript)
  writeFileSync(sourceEntry, "#!/usr/bin/env node\nconsole.log('fixture')\n")
  chmodSync(sourceEntry, 0o755)
  return { fixtureRoot, fixtureScript, sourceEntry, targetEntry, manifestPath: join(dirname(targetEntry), "manifest.json") }
}

function runRuntimeCheckRegressions(workRoot, transcript) {
  transcript.push(`\n## STAGE-SCRIPT FIXTURE REGRESSION — SEPARATE FROM PACKED INSTALLER @ ${timestamp()}`)
  const fixture = createRuntimeCheckFixture(workRoot)
  const cases = []
  const invoke = (name) => {
    const run = runCommand(process.execPath, [realpathSync(fixture.fixtureScript), "--check"], { cwd: fixture.fixtureRoot, timeout: 15_000 })
    cases.push({ name, run })
    transcript.push(`\n### ${name}\n${renderRun(run)}`)
    return run
  }

  const staged = runCommand(process.execPath, [realpathSync(fixture.fixtureScript)], { cwd: fixture.fixtureRoot, timeout: 15_000 })
  transcript.push(`\n### stage-fixture\n${renderRun(staged)}`)
  assert(staged.status === 0, `fixture staging failed: ${staged.stderr || staged.stdout}`)
  assert(existsSync(fixture.manifestPath), `fixture staging did not create manifest: ${fixture.manifestPath}`)

  const fresh = invoke("fresh")
  assert(fresh.status === 0 && fresh.stdout.includes("runtime is current"), "fresh runtime --check did not exit 0")

  writeFileSync(fixture.targetEntry, "#!/usr/bin/env node\nconsole.log('corrupted')\n")
  chmodSync(fixture.targetEntry, 0o755)
  const corrupted = invoke("corrupted-sha")
  assert(corrupted.status === 1 && corrupted.stderr.includes("does not match built sha256"), "corrupted sha --check did not fail clearly")

  rmSync(fixture.targetEntry)
  const missing = invoke("missing")
  assert(missing.status === 1 && missing.stderr.includes("staged CLI is missing"), "missing runtime --check did not fail clearly")

  copyFileSync(fixture.sourceEntry, fixture.targetEntry)
  chmodSync(fixture.targetEntry, 0o644)
  const nonExecutable = invoke("non-executable")
  assert(nonExecutable.status === 1 && nonExecutable.stderr.includes("staged CLI is not executable"), "non-executable runtime --check did not fail clearly")

  copyFileSync(fixture.sourceEntry, fixture.targetEntry)
  chmodSync(fixture.targetEntry, 0o755)
  transcript.push("STAGE-SCRIPT FIXTURE REGRESSION PASS manifestCreated=true fresh=0 corrupted=1 missing=1 nonExecutable=1")
  return cases
}

function findWorkRootProcesses(workRoot) {
  const ps = runCommand("ps", ["-axo", "pid=,command="], { timeout: 10_000 })
  if (ps.status !== 0) return []
  return ps.stdout
    .split(/\r?\n/)
    .map((line) => /^(\s*\d+)\s+(.*)$/.exec(line))
    .filter((match) => match !== null && match[2].includes(workRoot))
    .map((match) => ({ pid: Number(match[1]), command: match[2] }))
    .filter((entry) => entry.pid !== process.pid)
}

function writeEvidence(evidenceDir, name, body) {
  mkdirSync(evidenceDir, { recursive: true })
  writeFileSync(join(evidenceDir, name), body)
}

async function main() {
  const args = parseArgs(process.argv)
  const transcript = [`# 2026-08-03 ast-grep MCP end-to-end QA`, `startedAt=${timestamp()}`, `repoRoot=${repoRoot}`]
  const workRoot = mkdtempSync(join(tmpdir(), "omo-senpi-ast-grep-mcp-e2e-"))
  const beforeRealCredentials = credentialDigest(realAgentDir)
  let handshakeEvidence = `# 2026-08-03 ast-grep MCP handshake\ntimestamp=${timestamp()}\nNOT RUN\n`
  let result = "FAIL"
  let failure

  transcript.push(`workRoot=${workRoot}`)
  try {
    const senpiBin = findOnPath(process.env.SENPI_BIN?.trim() || "senpi")
    assert(senpiBin !== null, "senpi binary unavailable; packed boot cannot SKIP")
    transcript.push(`senpiBin=${senpiBin}`)
    verifyCurrentStagedRuntime(transcript)
    handshakeEvidence = runHandshake(transcript)
    transcript.push(`\n## PACK AND EXTRACT @ ${timestamp()}`)
    const packed = packAndExtract(workRoot, transcript)
    transcript.push(`tarball=${packed.tarball}`)
    transcript.push(`extractedPlugin=${packed.extractedPlugin}`)
    runPackedBoot(workRoot, packed.extractedPlugin, senpiBin, transcript)
    runPackedInstallerFailureScenarios(workRoot, packed.extractedPlugin, transcript)
    runRuntimeCheckRegressions(workRoot, transcript)
    result = "PASS"
  } catch (error) {
    failure = error instanceof Error ? error.stack ?? error.message : String(error)
    transcript.push(`\nFAILURE @ ${timestamp()}\n${failure}`)
  } finally {
    const liveBeforeCleanup = findWorkRootProcesses(workRoot)
    transcript.push(`\n## CLEANUP RECEIPTS @ ${timestamp()}`)
    transcript.push(`processesReferencingWorkRootBeforeCleanup=${JSON.stringify(liveBeforeCleanup)}`)
    for (const processEntry of liveBeforeCleanup) {
      try {
        process.kill(processEntry.pid, "SIGTERM")
        transcript.push(`sent SIGTERM pid=${processEntry.pid} command=${processEntry.command}`)
      } catch (error) {
        transcript.push(`SIGTERM pid=${processEntry.pid} result=${error instanceof Error ? error.message : String(error)}`)
      }
    }
    rmSync(workRoot, { recursive: true, force: true })
    transcript.push(`rm -rf ${workRoot} confirmed=${!existsSync(workRoot)}`)
    const liveAfterCleanup = findWorkRootProcesses(workRoot)
    transcript.push(`processesReferencingWorkRootAfterCleanup=${JSON.stringify(liveAfterCleanup)}`)
    transcript.push(`realSenpiCredentialDigestObservedUnchanged=${credentialDigest(realAgentDir) === beforeRealCredentials}`)
    transcript.push("realSenpiCredentialDigestIsInformational=true (concurrent user sessions may write there; isolation is gated by explicit HOME/XDG/SENPI_CODING_AGENT_DIR paths under workRoot)")
    transcript.push(`finishedAt=${timestamp()}`)
    transcript.push(`RESULT=${result}`)
    writeEvidence(args.evidenceDir, "task-15-handshake.txt", handshakeEvidence)
    writeEvidence(args.evidenceDir, "task-15-e2e.txt", `${transcript.join("\n")}\n`)
  }

  process.stdout.write(`${transcript.join("\n")}\n`)
  if (result !== "PASS") {
    process.stderr.write(`ast-grep MCP e2e failed: ${failure ?? "unknown failure"}\n`)
    process.exitCode = 1
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
