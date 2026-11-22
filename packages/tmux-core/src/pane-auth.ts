import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"

/** The server owns the directory; pane shells consume and unlink individual files. */
export function createPaneAuthDirectory(): () => void {
  const previousDirectory = process.env.OPENCODE_SERVER_PASSWORD_DIR
  const directory = mkdtempSync(join(tmpdir(), "omo-run-auth-"))
  chmodSync(directory, 0o700)
  process.env.OPENCODE_SERVER_PASSWORD_DIR = directory
  const cleanup = (): void => {
    try {
      rmSync(directory, { recursive: true, force: true })
    } finally {
      if (previousDirectory === undefined) delete process.env.OPENCODE_SERVER_PASSWORD_DIR
      else process.env.OPENCODE_SERVER_PASSWORD_DIR = previousDirectory
      process.removeListener("exit", cleanup)
    }
  }
  process.once("exit", cleanup)
  return cleanup
}

export function buildPaneAuthEnvironmentArgs(): string[] {
  const password = process.env.OPENCODE_SERVER_PASSWORD
  if (!password) return []
  // Standalone, user-password-configured OpenCode also needs a private channel.
  if (!process.env.OPENCODE_SERVER_PASSWORD_DIR) createPaneAuthDirectory()
  const directory = process.env.OPENCODE_SERVER_PASSWORD_DIR
  if (!directory) throw new Error("Password directory was not initialized")
  const file = join(directory, `${randomUUID()}.sh`)
  const quotedPassword = `'${password.replaceAll("'", "'\\''")}'`
  writeFileSync(file, `export OPENCODE_SERVER_PASSWORD=${quotedPassword}\n`, { mode: 0o600, flag: "wx" })
  const args = ["-e", `OPENCODE_SERVER_PASSWORD_FILE=${file}`]
  const username = process.env.OPENCODE_SERVER_USERNAME
  if (username !== undefined) args.push("-e", `OPENCODE_SERVER_USERNAME=${username}`)
  return args
}

/** Read once, unlink before launching the child, and fail closed if either fails. */
export function withPaneAuth(command: string): string {
  if (!process.env.OPENCODE_SERVER_PASSWORD) return command
  return `. "$OPENCODE_SERVER_PASSWORD_FILE" && rm -f -- "$OPENCODE_SERVER_PASSWORD_FILE" && ${command}`
}
