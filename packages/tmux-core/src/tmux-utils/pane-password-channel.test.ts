import { expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { buildPaneAuthEnvironmentArgs, buildTmuxAttachCommand } from "./pane-command"
import { createPaneAuthDirectory } from "../pane-auth"

test.skipIf(process.platform === "win32")("pane argv carries only a private one-use file and the pane consumes the password without argv exposure", async () => {
  const savedPassword = process.env.OPENCODE_SERVER_PASSWORD
  const password = ["pane", "'", "$()", "\n", "credential", "\n"].join("")
  const sandbox = mkdtempSync(join(tmpdir(), "pane-auth-"))
  process.env.OPENCODE_SERVER_PASSWORD = password
  const cleanupAuthDirectory = createPaneAuthDirectory()
  let passwordFile: string | undefined
  try {
    const args = buildPaneAuthEnvironmentArgs()
    const command = buildTmuxAttachCommand("http://127.0.0.1:4096", "ses-test", sandbox)
    expect([...args, command].some((arg) => arg.includes(password))).toBe(false)
    passwordFile = args.find((arg) => arg.startsWith("OPENCODE_SERVER_PASSWORD_FILE="))?.split("=").slice(1).join("=")
    expect(passwordFile !== undefined).toBe(true)
    if (!passwordFile) throw new Error("missing one-use password file")
    expect(statSync(passwordFile).mode & 0o777).toBe(0o600)
    expect(statSync(dirname(passwordFile)).mode & 0o777).toBe(0o700)
    writeFileSync(join(sandbox, "opencode"), [
      "#!/bin/sh",
      'test "$OPENCODE_SERVER_PASSWORD" = "$EXPECTED_PASSWORD" || exit 2',
      'test ! -e "$EXPECTED_FILE" || exit 3',
      'for arg in "$@"; do test "$arg" != "$EXPECTED_PASSWORD" || exit 4; done',
      "printf auth-ok",
    ].join("\n"), { mode: 0o700 })
    const child = Bun.spawn(["/bin/sh", "-c", command], {
      env: {
        ...process.env,
        PATH: `${sandbox}:${process.env.PATH ?? ""}`,
        OPENCODE_SERVER_PASSWORD: "",
        OPENCODE_SERVER_PASSWORD_FILE: passwordFile,
        EXPECTED_PASSWORD: password,
        EXPECTED_FILE: passwordFile,
      },
      stdout: "pipe",
      stderr: "pipe",
    })
    expect(await child.exited).toBe(0)
    expect(await new Response(child.stdout).text()).toBe("auth-ok")
    expect(existsSync(passwordFile)).toBe(false)
  } finally {
    cleanupAuthDirectory()
    if (savedPassword === undefined) delete process.env.OPENCODE_SERVER_PASSWORD
    else process.env.OPENCODE_SERVER_PASSWORD = savedPassword
    if (passwordFile) rmSync(passwordFile, { force: true })
    rmSync(sandbox, { recursive: true, force: true })
  }
})
