import { spawnSync } from "node:child_process"
import { launchRpc, teardown } from "./kibitzer-sidecar-support.mjs"
import { pollUntil } from "./resume-e2e-runtime.mjs"

// Print mode exits on the first settled turn, before a background child can wake its parent.
// Keep the real RPC session open through the native wake, follow-up and child completion.
export async function driveIdleSenpi({ senpiBin, mockProviderEntry, scenario, env, prompt, pids, childCompleted, completionToken }) {
  const session = launchRpc(
    { file: senpiBin, prefix: ["-e", mockProviderEntry, "--name", "omo-task-e2e-parent"] },
    { ...scenario.sandbox, sessionsDir: scenario.sessionDir },
    env,
  )
  if (typeof session.pid === "number") pids.push(session.pid)
  let stdout = ""
  let failure
  session.child.stdout.on("data", (chunk) => { stdout += chunk })
  try {
    session.send({ type: "prompt", message: prompt })
    await session.waitFrom(0, (event) => event.type === "tool_execution_end" && event.toolName === "task_output", 120_000, "task_output after native wake")
    await session.waitFrom(session.mark() - 1, (event) => event.type === "agent_settled", 120_000, "parent settlement")
    if (!await pollUntil(childCompleted, Boolean, 60_000)) throw new Error("follow-up child did not complete")
    await session.waitFrom(0, (event) => event.type === "message_end" && event.message?.customType === "omo-senpi:wake" && JSON.stringify(event.message).includes(completionToken), 60_000, "follow-up completion delivery")
    await session.waitFrom(session.mark() - 1, (event) => event.type === "agent_settled", 60_000, "follow-up parent settlement")
  } catch (error) {
    failure = String(error)
  } finally {
    await teardown(session)
  }
  const exit = await session.exited
  return { status: failure === undefined ? exit.code : 1, signal: exit.signal, stdout, stderr: [session.stderr(), failure].filter(Boolean).join("\n") }
}

export function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (isMissingProcess(error)) return false
    throw error
  }
}

export function killTree(pid) {
  spawnSync("pkill", ["-9", "-P", String(pid)])
  try {
    process.kill(pid, 9)
  } catch (error) {
    if (!isMissingProcess(error)) throw error
  }
}

function isMissingProcess(error) {
  return error instanceof Error && "code" in error && error.code === "ESRCH"
}
