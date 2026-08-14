import { execFile } from "node:child_process"

export type ExecuteHerdrCommand = (
  file: string,
  args: readonly string[],
) => Promise<string>

export function executeHerdrCommand(
  file: string,
  args: readonly string[],
  timeoutMs = 15_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, [...args], {
      encoding: "utf8",
      windowsHide: true,
      timeout: timeoutMs,
      killSignal: "SIGKILL",
    }, (error, stdout) => {
      if (error !== null) {
        reject(error)
        return
      }
      resolve(stdout)
    })
  })
}
