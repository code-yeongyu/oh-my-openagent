import { spawn } from "node:child_process"
import type { TargetAgentRoute } from "./agent-routing"

export type TargetAgentRunOptions = {
  cwd: string
  signal?: AbortSignal
  executable?: string
}

export type TargetAgentRunResult = {
  text: string
  exitCode: number
  stderr: string
}

function executableFor(route: TargetAgentRoute): string {
  return route.host === "oh-my-pi" ? "omp" : "pi"
}

export async function runTargetAgent(
  route: TargetAgentRoute,
  options: TargetAgentRunOptions,
): Promise<TargetAgentRunResult> {
  const args = ["--mode", "text", "--print", "--system-prompt", route.agent.systemPrompt]
  if (route.agent.tools?.length) args.push("--tools", route.agent.tools.join(","))
  args.push(route.prompt)

  return await new Promise((resolve, reject) => {
    const child = spawn(options.executable ?? executableFor(route), args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        OMO_TARGET_AGENT: route.agent.name,
        OMO_TARGET_AGENT_POLICY: route.agent.policy,
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    const abort = () => child.kill("SIGTERM")
    options.signal?.addEventListener("abort", abort, { once: true })
    child.once("error", reject)
    child.once("close", (code) => {
      options.signal?.removeEventListener("abort", abort)
      resolve({ text: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? 1 })
    })
  })
}
