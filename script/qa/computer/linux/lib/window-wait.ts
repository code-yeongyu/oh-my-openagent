// The oracle's window lookup for a fixture the scenario just started: the window maps some
// time after the process starts, so the search re-runs until it names a window. The fixture
// process exiting is the failure signal (with its own output); the 30 s deadline of `until`
// is only a hang guard.
import { type RunResult, until } from "./procs.ts"

export async function waitForWindow(
  title: string,
  search: () => Promise<RunResult>,
  fixtureDied: () => string | undefined,
): Promise<string> {
  let id = ""
  let died: string | undefined
  await until(async () => {
    died = fixtureDied()
    if (died !== undefined) return true
    const ran = await search()
    id = ran.code === 0 ? (ran.stdout.trim().split("\n")[0] ?? "") : ""
    return id !== ""
  }, `a window named ${title} to map`)
  if (died !== undefined) throw new Error(`the fixture window ${title} exited before it mapped: ${died.trim()}`)
  return id
}
