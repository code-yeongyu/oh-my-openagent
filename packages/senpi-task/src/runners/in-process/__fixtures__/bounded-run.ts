export type BoundedRun = { readonly exit: number | "still running"; readonly stdout: string; readonly stderr: string }

/** Runs one fixture script in a fresh process and kills it when it outlives the bound. */
export async function runFixtureScript(script: string, arg: string, boundMs: number): Promise<BoundedRun> {
  const child = Bun.spawn([process.execPath, script, arg], { stdout: "pipe", stderr: "pipe" })
  let watchdog: ReturnType<typeof setTimeout> | undefined
  const bound = new Promise<"still running">((resolve) => {
    watchdog = setTimeout(() => resolve("still running"), boundMs)
  })
  const exit = await Promise.race([child.exited, bound])
  clearTimeout(watchdog)
  if (exit === "still running") child.kill("SIGKILL")
  const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()])
  return { exit, stdout, stderr }
}
