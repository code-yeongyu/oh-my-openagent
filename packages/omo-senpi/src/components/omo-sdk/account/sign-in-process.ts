import { spawn } from "node:child_process"
import { isAbsolute } from "node:path"
import { createInterface } from "node:readline"

/** One run of `omo account sign-in`, its stdout delivered line by line while it waits for approval. */
export type SignInProcess = (input: {
  readonly args: readonly string[]
  /** One line written to the process's stdin, then closed. */
  readonly stdin: string
  readonly env: Readonly<Record<string, string | undefined>>
  readonly onLine: (line: string) => void
  readonly signal: AbortSignal
}) => Promise<{ readonly code: number | null }>

// Bounds one sign-in run: the device code expires within minutes and the device-service setup hands any install to a
// background process, so a run past this is a stuck child, not a slow approval.
const SIGN_IN_DEADLINE_MS = 30 * 60_000

/**
 * The sign-in runs in the omo launcher (`OMO_BIN`), not in this engine: the account verb owns the credential store
 * write and the device-service setup, and the engine bundle carries neither.
 */
export function launcherSignInProcess(
  omoBin: string | undefined,
  execPath: string = process.execPath,
): SignInProcess | undefined {
  const bin = omoBin?.trim()
  if (bin === undefined || bin === "" || !isAbsolute(bin)) return undefined
  return ({ args, stdin, env, onLine, signal }) => {
    const [command, ...argv] = bin.endsWith(".js") ? [execPath, bin, ...args] : [bin, ...args]
    return new Promise((resolve, reject) => {
      const child = spawn(command ?? bin, argv, {
        stdio: ["pipe", "pipe", "ignore"],
        env: { ...env },
        windowsHide: true,
      })
      child.stdin.end(`${stdin}\n`)
      createInterface({ input: child.stdout }).on("line", onLine)
      const stop = () => child.kill()
      const timer = setTimeout(stop, SIGN_IN_DEADLINE_MS)
      if (signal.aborted) stop()
      else signal.addEventListener("abort", stop, { once: true })
      const settle = () => {
        clearTimeout(timer)
        signal.removeEventListener("abort", stop)
      }
      child.once("error", (error) => {
        settle()
        reject(error)
      })
      child.once("close", (code) => {
        settle()
        resolve({ code })
      })
    })
  }
}
