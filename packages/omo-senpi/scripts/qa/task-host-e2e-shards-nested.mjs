import { writeFileSync } from "node:fs"
import { join } from "node:path"

import { observeState, stopParent } from "./task-host-e2e-events.mjs"
import {
  mainProject,
  newSandbox,
  startParent,
  taskRecords,
  teardownSandbox,
} from "./task-host-e2e-shard-cost-support.mjs"
import {
  crashRows,
  endpointFacts,
  generationNames,
  pass,
  shardConfig,
  writeRoute,
} from "./task-host-e2e-shards-support.mjs"

function hold(path, summary) {
  return {
    type: "tool_call",
    name: "eval",
    arguments: {
      language: "js",
      summary,
      timeout: 660,
      code: `var fs = await import("node:fs"); await new Promise((resolve, reject) => {
        var finish = () => { if (!fs.existsSync(${JSON.stringify(path)})) return;
          clearTimeout(timer); watcher.close(); resolve(); };
        var watcher = fs.watch(${JSON.stringify(join(path, ".."))}, finish);
        var timer = setTimeout(() => { watcher.close(); reject(new Error("nested release missing")); }, 600000);
        finish();
      });`,
    },
  }
}

function nestedScripts(routeChild, routeGrandchild, releasePath, prefix) {
  const grandchildMarker = `[[mock-cwd:${routeGrandchild}]]`
  return {
    parent: {
      parentSteps: [
        {
          type: "tool_call",
          name: "task",
          arguments: {
            category: "proc",
            run_in_background: true,
            name: `${prefix}-child`,
            prompt: `${prefix} child [[mock-cwd:${routeChild}]]`,
          },
        },
        hold(join(routeChild, "parent-release"), `hold ${prefix} parent through nested task`),
        { type: "text", text: `${prefix} parent done` },
      ],
      childSteps: [{ type: "text", text: "unused" }],
    },
    child: {
      parentSteps: [],
      childSteps: [
        hold(releasePath, `hold ${prefix} child before nested task`),
        {
          type: "tool_call",
          name: "task",
          arguments: {
            category: "proc",
            run_in_background: true,
            name: `${prefix}-grandchild`,
            prompt: `${prefix} grandchild ${grandchildMarker}`,
          },
        },
        { type: "text", text: `${prefix} child done` },
      ],
    },
    grandchild: {
      parentSteps: [],
      childSteps: [{ type: "text", text: `${prefix} grandchild done` }],
    },
  }
}

async function normalNested(config, artifacts) {
  const sandbox = newSandbox(config, "nested", {
    omoConfig: shardConfig(),
    script: { parentSteps: [{ type: "text", text: "unused" }], childSteps: [{ type: "text", text: "unused" }] },
  })
  const project = mainProject(sandbox)
  const routeChild = writeRoute(sandbox, "nested-child", {})
  const routeGrandchild = writeRoute(sandbox, "nested-grandchild", {})
  const release = join(routeChild, "release")
  const scripts = nestedScripts(routeChild, routeGrandchild, release, "normal")
  writeFileSync(join(sandbox.cwd, "mock-script.json"), `${JSON.stringify(scripts.parent, null, 2)}\n`)
  writeFileSync(join(routeChild, "mock-script.json"), `${JSON.stringify(scripts.child, null, 2)}\n`)
  writeFileSync(join(routeGrandchild, "mock-script.json"), `${JSON.stringify(scripts.grandchild, null, 2)}\n`)
  const parent = startParent(sandbox, project, "spawn a nested child")
  try {
    const childReady = await observeState(sandbox.root, () => {
      const records = taskRecords(project)
      return records.length === 1 &&
        records[0].status === "running" &&
        typeof records[0].host_session?.socket === "string" &&
        endpointFacts(sandbox).length === 1
        ? records[0]
        : undefined
    }, { timeoutMs: 180_000 })
    if (childReady === undefined) throw new Error("nested child did not reach the hold")
    const before = endpointFacts(sandbox)[0]
    const generations = generationNames(sandbox, before.socket)
    const crashes = crashRows(sandbox, before.socket).length
    writeFileSync(release, "go\n")
    const records = await observeState(sandbox.root, () => {
      const rows = taskRecords(project)
      return rows.length === 2 &&
        rows.every((record) =>
          ["running", "completed"].includes(record.status) &&
          typeof record.host_session?.socket === "string")
        ? rows
        : undefined
    }, { timeoutMs: 180_000 })
    if (records === undefined) throw new Error("grandchild did not open")
    const after = endpointFacts(sandbox)[0]
    const sockets = [...new Set(records.map((record) => record.host_session?.socket))]
    const facts = {
      records: records.map((record) => ({
        task_id: record.task_id,
        parent_task_id: record.parent_task_id ?? null,
        socket: record.host_session?.socket ?? null,
        status: record.status,
      })),
      sockets,
      instanceUnchanged: before.status?.instanceId === after.status?.instanceId,
      supervisorUnchanged: before.supervisor === after.supervisor,
      generationsUnchanged: JSON.stringify(generations) === JSON.stringify(generationNames(sandbox, before.socket)),
      crashesUnchanged: crashes === crashRows(sandbox, before.socket).length,
    }
    writeFileSync(join(artifacts, "nested-normal.json"), `${JSON.stringify(facts, null, 2)}\n`)
    return facts
  } finally {
    writeFileSync(join(routeChild, "parent-release"), "go\n")
    await stopParent(parent)
    const cleanup = await teardownSandbox(sandbox, [parent])
    writeFileSync(join(artifacts, "nested-normal-cleanup.json"), `${JSON.stringify(cleanup, null, 2)}\n`)
  }
}

async function unavailableNested(config, artifacts) {
  const sandbox = newSandbox(config, "nested-stop", {
    omoConfig: shardConfig(),
    script: { parentSteps: [{ type: "text", text: "unused" }], childSteps: [{ type: "text", text: "unused" }] },
  })
  const project = mainProject(sandbox)
  const routeChild = writeRoute(sandbox, "stop-child", {})
  const routeGrandchild = writeRoute(sandbox, "stop-grandchild", {})
  const release = join(routeChild, "release")
  const scripts = nestedScripts(routeChild, routeGrandchild, release, "stopped")
  writeFileSync(join(sandbox.cwd, "mock-script.json"), `${JSON.stringify(scripts.parent, null, 2)}\n`)
  writeFileSync(join(routeChild, "mock-script.json"), `${JSON.stringify(scripts.child, null, 2)}\n`)
  writeFileSync(join(routeGrandchild, "mock-script.json"), `${JSON.stringify(scripts.grandchild, null, 2)}\n`)
  const parent = startParent(sandbox, project, "spawn a child before stopping its supervisor", {
    SENPI_RPC_PROBE_TIMEOUT_MS: "2000",
  })
  let stopped = false
  try {
    const childReady = await observeState(sandbox.root, () => {
      const rows = taskRecords(project)
      return rows.length === 1 &&
        rows[0].status === "running" &&
        typeof rows[0].host_session?.socket === "string" &&
        endpointFacts(sandbox).length === 1
        ? rows[0]
        : undefined
    }, { timeoutMs: 180_000 })
    if (childReady === undefined) throw new Error("own-endpoint child did not reach the hold")
    const before = endpointFacts(sandbox)[0]
    const generations = generationNames(sandbox, before.socket)
    const crashes = crashRows(sandbox, before.socket).length
    process.kill(before.supervisor, "SIGSTOP")
    stopped = true
    writeFileSync(release, "go\n")
    const failure = await observeState(sandbox.root, () => {
      const rows = taskRecords(project)
      return rows.find((record) =>
        record.error_message?.includes("own_host_unreachable") ||
        record.failure_reason === "own_host_unreachable" ||
        record.suspension_reason === "own_host_unreachable")
    }, { timeoutMs: 60_000 })
    process.kill(before.supervisor, "SIGCONT")
    stopped = false
    const facts = {
      failure: failure === undefined ? null : {
        status: failure.status,
        failure_reason: failure.failure_reason ?? null,
        suspension_reason: failure.suspension_reason ?? null,
        error_message: failure.error_message ?? null,
      },
      generationsUnchanged: JSON.stringify(generations) === JSON.stringify(generationNames(sandbox, before.socket)),
      crashesUnchanged: crashes === crashRows(sandbox, before.socket).length,
      supervisorUnchanged: endpointFacts(sandbox)[0]?.supervisor === before.supervisor,
    }
    writeFileSync(join(artifacts, "nested-unreachable.json"), `${JSON.stringify(facts, null, 2)}\n`)
    return facts
  } finally {
    writeFileSync(join(routeChild, "parent-release"), "go\n")
    if (stopped) {
      const supervisor = endpointFacts(sandbox)[0]?.supervisor
      if (supervisor !== undefined) process.kill(supervisor, "SIGCONT")
    }
    await stopParent(parent)
    const cleanup = await teardownSandbox(sandbox, [parent])
    writeFileSync(join(artifacts, "nested-unreachable-cleanup.json"), `${JSON.stringify(cleanup, null, 2)}\n`)
  }
}

export async function runNestedMatrix(config, artifacts) {
  const normal = await normalNested(config, artifacts)
  const unavailable = await unavailableNested(config, artifacts)
  const normalPass = normal.sockets.length === 1 && normal.sockets[0] !== undefined &&
    normal.instanceUnchanged && normal.supervisorUnchanged && normal.generationsUnchanged && normal.crashesUnchanged
  const unavailablePass = unavailable.failure !== null && unavailable.generationsUnchanged &&
    unavailable.crashesUnchanged && unavailable.supervisorUnchanged
  const normalEvidence = [join(artifacts, "nested-normal.json")]
  const unavailableEvidence = [join(artifacts, "nested-unreachable.json")]
  return {
    grandchild_reuses_tree_shard: normalPass
      ? pass(normalEvidence, normal)
      : { status: "fail", evidence: normalEvidence, reason: "grandchild did not reuse the child shard", facts: normal },
    nested_spawn_attach_only: normalPass
      ? pass(normalEvidence, normal)
      : { status: "fail", evidence: normalEvidence, reason: "nested spawn changed the endpoint", facts: normal },
    own_endpoint_unreachable_fails_closed: unavailablePass
      ? pass(unavailableEvidence, unavailable)
      : { status: "fail", evidence: unavailableEvidence, reason: "silent own endpoint did not fail closed", facts: unavailable },
  }
}
