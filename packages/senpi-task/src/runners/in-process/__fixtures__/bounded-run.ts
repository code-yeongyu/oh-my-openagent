import { spawn } from "node:child_process"

export type BoundedRun = { readonly exit: number | "still running"; readonly stdout: string; readonly stderr: string }

/** Runs one fixture script in a fresh process and kills it when it outlives the bound. */
export async function runFixtureScript(script: string, arg: string, boundMs: number): Promise<BoundedRun> {
  // node:child_process, not Bun's process API: package sources outside test files stay off Bun's own APIs
  // (packages/omo-opencode/src/shared/opencode-coupling-audit.test.ts).
  const child = spawn(process.execPath, [script, arg], { stdio: ["ignore", "pipe", "pipe"] })
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk))
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk))
  const closed = new Promise<number>((resolve) => child.once("close", (code) => resolve(code ?? -1)))
  let watchdog: ReturnType<typeof setTimeout> | undefined
  const bound = new Promise<"still running">((resolve) => {
    watchdog = setTimeout(() => resolve("still running"), boundMs)
  })
  const exit = await Promise.race([closed, bound])
  clearTimeout(watchdog)
  if (exit === "still running") {
    child.kill("SIGKILL")
    await closed
  }
  return { exit, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") }
}
