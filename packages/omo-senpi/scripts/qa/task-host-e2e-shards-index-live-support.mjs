import { join } from "node:path"
import { existsSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs"

import { observeState } from "./task-host-e2e-events.mjs"
import { endpointSockets } from "./task-host-e2e-shard-cost-support.mjs"
import { pass } from "./task-host-e2e-shards-support.mjs"

export function taskScript(name, prompt, childSteps) {
  return {
    parentSteps: [
      { type: "tool_call", name: "task", arguments: { category: "proc", run_in_background: true, name, prompt } },
      { type: "text", text: `${name} parent complete` },
    ],
    childSteps,
  }
}

export function writeScript(project, script) {
  writeFileSync(join(project.cwd, "mock-script.json"), `${JSON.stringify(script, null, 2)}\n`)
}

export function writeHttpModels(sandbox, baseUrl) {
  writeFileSync(join(sandbox.agentDir, "models.json"), `${JSON.stringify({
    providers: {
      "omo-http": {
        name: "todo 14 local HTTP mock",
        api: "openai-completions",
        baseUrl,
        apiKey: "local-qa-only",
        models: [{
          id: "mock-1",
          name: "Todo 14 HTTP mock",
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 200000,
          maxTokens: 4096,
        }],
      },
    },
  }, null, 2)}\n`)
}

export function captureAtomicWriteFailure(rpcDir, indexPath) {
  const temporary = join(rpcDir, `.task-stores-probe-${process.pid}.tmp`)
  const destination = `${indexPath}.probe`
  try {
    writeFileSync(temporary, "probe\n", { flag: "wx" })
    renameSync(temporary, destination)
    rmSync(destination, { force: true })
    return { failed: false, operation: "write-temp+rename", reason: "atomic write unexpectedly succeeded" }
  } catch (error) {
    rmSync(temporary, { force: true })
    rmSync(destination, { force: true })
    return {
      failed: true,
      operation: "write-temp+rename",
      code: error?.code ?? null,
      syscall: error?.syscall ?? null,
      path: error?.path ?? null,
      destination: error?.dest ?? null,
    }
  }
}

export function observeRegistrationBeforeEndpoint(sandbox, indexPath, endpointStateRoot, trigger) {
  return observeState(sandbox.root, () => {
    const sockets = endpointSockets(sandbox)
    const state = existsSync(endpointStateRoot) ? readdirSync(endpointStateRoot, { recursive: true }).map(String) : []
    return existsSync(indexPath) || sockets.length > 0 || state.length > 0
      ? { index_exists: existsSync(indexPath), sockets, endpoint_state: state }
      : undefined
  }, { trigger })
}

export const crossEndpointHazardPassed = (value) =>
  value.shard_open_accepted && value.rpc_open_accepted && value.distinct_endpoints && value.disposable_copy_removed

export const idleGcIndexResumePassed = (value) =>
  value.parent_quit_while_request_held && value.supervisor_exited &&
  ["running", "interrupted"].includes(value.parked_status) &&
  ["resident", "rpc_detached"].includes(value.parked_residency) &&
  value.interrupted_transcript_files.length === 1 &&
  value.continuation_before_r0 === 0 && value.gc_exit === 0 && value.endpoint_removed && value.sidecar_removed &&
  value.store_retained_in_index && value.rollback_exit === 0 && value.migrated_socket?.endsWith("/rpc/rpc.sock") &&
  value.r0_provision_exit === 0 && value.r0_same_home && value.r0_daemon_exit === 0 &&
  value.r0_resume_completed && value.continuation_count === 1

export const storeIndexPreconditionPassed = (value) =>
  value.atomic_index_write_failure?.failed && value.failure_status === "error" &&
  value.failure_reason === "store_index_unavailable" && value.failure_has_no_host_session &&
  value.endpoints_before_retry.length === 0 && value.endpoint_state_before_retry.length === 0 && value.index_absent_after_failure &&
  value.registration_first_observation?.index_exists && value.registration_first_observation.sockets.length === 0 &&
  value.index_mtime_ms <= value.endpoint_birthtime_ms &&
  typeof value.retry_socket === "string" && value.retry_socket_in_agent_dir === true && value.store_registered_before_open

function cleanupPassed(cleanup) {
  return cleanup?.removed === true && cleanup.parentsAlive?.length === 0 &&
    cleanup.endpoints?.every((endpoint) => endpoint.stillAlive.length === 0)
}

export function finishRow(id, artifacts, facts, cleanup, error, predicate) {
  const evidence = join(artifacts, `${id}.json`)
  const cleanupEvidence = join(artifacts, `${id}-cleanup.json`)
  writeFileSync(cleanupEvidence, `${JSON.stringify(cleanup, null, 2)}\n`)
  const ok = error === undefined && cleanupPassed(cleanup) && predicate(facts)
  writeFileSync(evidence, `${JSON.stringify({ ok, error, facts }, null, 2)}\n`)
  return ok ? pass([evidence, cleanupEvidence], { ...facts, cleanup })
    : { status: "fail", evidence: [evidence, cleanupEvidence], reason: error ?? `${id} invariants failed`, facts: { ...facts, cleanup } }
}
