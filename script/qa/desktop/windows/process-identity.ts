// Which tracked processes teardown may kill or count. Windows reuses pids quickly, so a pid alone can
// name an unrelated runner process once the tracked one has exited; a tracked pid counts only while it
// still runs the image it had when it was tracked.
import { spawnSync } from "node:child_process"

/** The image name `tasklist /FO CSV /NH` reports for `pid`, or `undefined` when no such process runs. */
export function imageFromTasklist(csv: string, pid: number): string | undefined {
  for (const line of csv.split(/\r?\n/)) {
    const fields = [...line.matchAll(/"([^"]*)"/g)].map((match) => match[1])
    if (fields.length >= 2 && fields[1] === String(pid)) return fields[0]
  }
  return undefined
}

export function imageOf(pid: number): string | undefined {
  const listed = spawnSync("tasklist", ["/FI", `PID eq ${pid}`, "/NH", "/FO", "CSV"], { encoding: "utf8" })
  return imageFromTasklist(listed.stdout ?? "", pid)
}

/** Whether `pid` is still the process that was tracked under `image`. */
export function stillTracked(pid: number, image: string, current: (pid: number) => string | undefined = imageOf): boolean {
  return current(pid)?.toLowerCase() === image.toLowerCase()
}
