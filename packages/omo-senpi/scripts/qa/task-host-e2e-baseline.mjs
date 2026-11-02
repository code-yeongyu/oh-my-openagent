// `--baseline` mode for task-host-e2e.mjs (todo 41): what the CURRENT mainline omob does, recorded so
// the change is measured against a real prior build rather than against memory. The mainline has no
// `daemon` subcommand at all, and its `process` children are one `--mode rpc` process each.
import { createScenarioSandbox } from "./task-host-e2e-sandbox.mjs"
import { cleanupScenario, lastJsonLine, perChildRpcProcesses, readTaskRecords, runBin, spawnParent, waitFor } from "./task-host-e2e-process.mjs"
import { CHILD_BUSY, hostConfig, spawnScript } from "./task-host-e2e-support.mjs"

const LOAD_1000 = "node packages/omo-senpi/scripts/qa/task-14/load-1000.mjs --bin <baseline> --host '<baseline> --mode rpc --multi-session --listen unix://<tmp>/load.sock'"

export async function baselineScenarios(run) {
  const sandbox = createScenarioSandbox(run, "sBL", {
    omoConfig: hostConfig({ task: { default_execution_mode: "process" } }),
    script: spawnScript(2, CHILD_BUSY, "bl"),
  })
  const status = runBin(sandbox, ["daemon", "status", "--json"], { timeoutMs: 120_000 })
  const parsed = lastJsonLine(status.stdout)
  const daemonSubcommandPresent = parsed?.socket !== undefined || parsed?.reachable !== undefined
  const parent = spawnParent(sandbox, run.mockEntry, "spawn two per-child rpc children")
  const perChild = await waitFor(() => {
    const processes = perChildRpcProcesses(sandbox)
    return processes.length >= 2 ? processes : undefined
  }, { timeoutMs: 180_000, intervalMs: 1_000 })
  const observed = perChild ?? perChildRpcProcesses(sandbox)
  const records = readTaskRecords(sandbox)
  try {
    process.kill(-parent.child.pid, "SIGKILL")
  } catch {
    // already gone
  }
  const facts = {
    daemonStatusExit: status.status,
    daemonSubcommandPresent,
    daemonStatusOutput: `${status.stdout}${status.stderr}`.trim().slice(0, 200),
    perChildRpcProcessCount: observed.length,
    perChildRpcArgvExcerpt: observed.slice(0, 2).map((entry) => entry.args.slice(0, 160)),
    childExecutionModes: [...new Set(records.map((record) => record.execution_mode))],
    childStatuses: records.map((record) => record.status),
  }
  const pass = !daemonSubcommandPresent && observed.length >= 2
  const receipt = await cleanupScenario(sandbox)
  return [
    {
      scenario: "BASELINE",
      title: "mainline omob: no `daemon` subcommand, children are `--mode rpc` processes",
      status: pass ? "pass" : "fail",
      ...(pass ? {} : { reason: `daemonSubcommand=${daemonSubcommandPresent} perChildRpc=${observed.length}` }),
      facts,
      receipt,
    },
    {
      scenario: "BASELINE-CAP",
      title: "the 21-session cap of the pre-change multi-session host",
      status: "skipped",
      reason: "needs todo 14's load-1000.mjs, which lives outside this repo (THREAD_QA_SENPI_ROOT)",
      command: LOAD_1000,
    },
  ]
}
