// Reviewed spawn sites that telemetry-opt-out-env.scan.mjs cannot prove routed through the opt-out
// helper. Each entry is one call site, keyed by file, enclosing function, and call text (callee plus
// the first argument), with `count` when identical calls share a function. A bypass never covers a
// new spawn: the test fails when an entry no longer matches exactly `count` unrouted sites.

const QA = "packages/omo-senpi/scripts/qa"
const LSP_CORE = "packages/lsp-core/scripts/qa/local-binary-resolution-e2e.mjs"
const RESOLVER = "runs .agents/skills/senpi-qa/scripts/resolve-evidence-dir.mjs, which prints a path and boots nothing"
const LEASE_HOLDER = "an inline `-e` script that only holds a live pid; no omo code loads"
const TMUX_CONTROL = "tmux send-keys/capture-pane/kill-session against a session started with the sandbox env; starts no process"
const LSP_DAEMON = "packages/lsp-daemon/scripts/qa/format-request-e2e.mjs"
const LSP_DAEMON_ONLY = "lsp-daemon QA: the lsp-daemon package carries no telemetry and loads no omo runtime"
const SCRATCH_ENV = "env is scratch.env, built by the thread-tools kit through isolatedChildEnv; the scan cannot follow the kit object"

export const SPAWN_BYPASSES = [
  { file: LSP_DAEMON, function: "createFixtureRepo", call: `spawnSync("bun")`, reason: `bun add of a biome fixture dependency; ${LSP_DAEMON_ONLY}` },
  { file: LSP_DAEMON, function: "createLinterOnlyFixture", call: `spawnSync("bun")`, reason: `bun add of an oxlint fixture dependency; ${LSP_DAEMON_ONLY}` },
  { file: LSP_DAEMON, function: "countProcesses", call: `spawnSync("bash")`, reason: `ps | grep | wc for the residency check; starts no process of ours` },
  { file: LSP_DAEMON, function: "main", call: "spawn(process.execPath)", reason: `starts the lsp-daemon's own dist/cli.js daemon; ${LSP_DAEMON_ONLY}` },
  { file: LSP_CORE, function: "createFixtureRepo", call: `spawnSync("bun")`, reason: "bun add of a biome fixture dependency; no runtime" },
  { file: LSP_CORE, function: "runResolutionProbe", call: `spawnSync("bun")`, reason: "bun -e over lsp-core sources only; no omo runtime or telemetry" },
  { file: LSP_CORE, function: "runBaselineProbe", call: `spawnSync("bun")`, reason: "bun -e over lsp-core sources only; no omo runtime or telemetry" },
  { file: LSP_CORE, function: "runDiagnosticsProbe", call: `spawnSync("bun")`, reason: "bun -e over lsp-core sources only; no omo runtime or telemetry" },
  { file: `${QA}/agent-toolkit-eval-sdk-qa.mjs`, function: "runSession", call: "spawnSync(command)", reason: "python3/python --version probe" },
  { file: `${QA}/ast-grep-mcp-e2e.mjs`, function: "runCommand", call: "spawnSync(command)", reason: "the senpi boot and installer callers pass options.env from the sandbox; the process.env fallback serves npm, tar, ps and the staged MCP entry" },
  { file: `${QA}/dag-lease-handoff-qa.ts`, function: "<module>", call: "spawn(process.execPath)", reason: LEASE_HOLDER },
  { file: `${QA}/dag-owner-scope.mjs`, function: "run", call: "spawnSync(process.execPath)", reason: "`-e \"\"` under a PATH-only env to mint a dead pid" },
  { file: `${QA}/dag-paused-header-qa.ts`, function: "<module>", call: "spawn(process.execPath)", reason: LEASE_HOLDER },
  { file: `${QA}/fixtures/policy-continuation-extension.ts`, function: "policyContinuationExtension", call: "execFileSync(toolkit)", reason: "runs inside the already opted-out senpi child and inherits its env" },
  { file: `${QA}/lsp-e2e.mjs`, function: "runChecked", call: "spawnSync(command)", reason: "callers run npm pack and tar only" },
  { file: `${QA}/lsp-e2e.mjs`, function: "runInjectedPostEditProbe", call: `spawnSync("bun")`, reason: "bun -e builds only the LSP component on a FakeExtensionAPI; no telemetry component is constructed" },
  { file: `${QA}/lsp-e2e.mjs`, function: "runSelfTest", call: `spawnSync("bun")`, reason: "bun -e runs the local installer into a temp agent dir; no session starts" },
  { file: `${QA}/package-dir-hygiene-probe.mjs`, function: "reportLane", call: "spawn(process.execPath)", reason: "re-runs this probe to report its own env on purpose; no runtime boots" },
  { file: `${QA}/policy-continuation-e2e.mjs`, function: "scenario", call: "execFileSync(bun)", reason: "bun build of the fixture extension" },
  { file: `${QA}/policy-continuation-e2e.mjs`, function: "run", call: "execFileSync(process.execPath)", reason: RESOLVER },
  { file: `${QA}/probe-continuation.mjs`, function: "main", call: "spawnSync(tmuxBin)", count: 2, reason: TMUX_CONTROL },
  { file: `${QA}/reflection-recap-e2e.mjs`, function: "optionsFrom", call: "spawnSync(process.execPath)", reason: RESOLVER },
  { file: `${QA}/session-dag-resume-qa.mjs`, function: "<module>", call: `execFileSync("node")`, reason: RESOLVER },
  { file: `${QA}/task-14/version-capability.mjs`, function: "<module>", call: `spawn("node")`, reason: "the unmanaged fake host fixture answers a handshake; no omo code loads" },
  { file: `${QA}/task-host-e2e-ops.mjs`, function: "scenarioG", call: `spawnSync("tmux")`, count: 3, reason: TMUX_CONTROL },
  { file: `${QA}/task-host-e2e-shards-contracts.mjs`, function: "runContractMatrix", call: `spawnSync("bun")`, reason: "bun test of unit suites that inject their own env and never reach a transport" },
  { file: `${QA}/task-id-race-qa.mjs`, function: "regeneratePlugin", call: "spawnSync(process.execPath)", reason: "runs plugin/scripts/build-extension.mjs, a bundler" },
  { file: `${QA}/task-lane-spill-e2e.mjs`, function: "runScenario", call: "spawn(process.execPath)", reason: "an inline `-e` release watcher over the state dir; no omo code loads" },
  { file: `${QA}/thread-tools/lib/gateway.mjs`, function: "start", call: `Bun.spawn([process.env.THREAD_QA_NODE ?? "node", i)`, reason: SCRATCH_ENV },
  { file: `${QA}/thread-tools/lib/gateway.mjs`, function: "capture", call: "Bun.spawnSync([command, ...args])", reason: "pgrep/lsof receipts during cleanup" },
  { file: `${QA}/thread-tools/lib/harness.mjs`, function: "startRealHost", call: "spawn(process.execPath)", reason: SCRATCH_ENV },
  { file: `${QA}/thread-tools/lib/harness.mjs`, function: "runCapture", call: "Bun.spawnSync([command, ...args])", reason: "pgrep/lsof receipts during cleanup" },
  { file: `${QA}/thread-tools/sender-death.mjs`, function: "<module>", call: "spawn(process.execPath)", reason: SCRATCH_ENV },
  { file: `${QA}/thread-tools/session-control-qa.mjs`, function: "startPinnedHost", call: "spawn(process.execPath)", reason: `${SCRATCH_ENV}; the host also runs --no-extensions` },
  { file: `${QA}/ulw-goal-footer-tui.mjs`, function: "assertFakeCreateGoalsWritesScopedPlan", call: "spawnSync(prepared.omoBin)", count: 3, reason: "self-test of the fake omo create-goals shell stub; the real omo never runs" },
  { file: `${QA}/x-search-live-e2e.mjs`, function: "spawnSenpi", call: "spawnSync(path)", reason: "options.env is scrubbedEnv, createScrubbedEnvironment over isolatedChildEnv, which the scan cannot follow through its copy loop" },
  { file: `${QA}/x-search-live-e2e.mjs`, function: "spawnSenpi", call: "spawnSync(command)", reason: "Windows shim branch of the same spawnSenpi options" },
  { file: `${QA}/x-search-live-e2e.mjs`, function: "spawnSenpi", call: `spawnSync(process.env.ComSpec ?? "cmd.exe")`, reason: "cmd.exe branch of the same spawnSenpi options" },
  { file: "script/qa/dependency-audit/runtime.ts", function: "run", call: "Bun.spawn([...command])", reason: "options.env is runtime.env, built by withTelemetryOptOut in createRuntime" },
  { file: "script/qa/desktop/linux/engine.ts", function: "spawn", call: "spawn(binary)", reason: "launches the desktop engine binary, which carries no omo telemetry" },
  { file: "script/qa/desktop/macos/agent.ts", function: "constructor", call: "spawn(bin)", reason: "env is this.#sandbox.env from sandboxEnvironment (withTelemetryOptOut)" },
  { file: "script/qa/desktop/windows/engine.ts", function: "spawn", call: "spawn(binary)", reason: "launches the desktop engine binary, which carries no omo telemetry" },
  { file: "script/qa/omo-native-telemetry-capture.mjs", function: "startCaptureServer", call: "spawn(bunBin)", reason: "starts the loopback capture server only" },
]
