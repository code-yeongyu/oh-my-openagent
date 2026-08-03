#!/usr/bin/env node
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const packageRoot = resolve(import.meta.dirname, "../..")
const notifier = join(packageRoot, "src/components/task/cmux-notifier.ts")
const real = process.argv.includes("--real")
const tempRoot = mkdtempSync(join(tmpdir(), "omo-senpi-cmux-probe-"))
const logPath = join(tempRoot, "cmux-args.log")
const fakeCmux = join(tempRoot, "cmux")

if (real && process.platform !== "darwin") {
  console.error("FAIL: --real requires macOS")
  process.exit(1)
}

if (!real) {
  writeFileSync(fakeCmux, `#!/bin/sh\nprintf '%s\\n' "$*" > "$CMUX_PROBE_LOG"\n`, "utf8")
  chmodSync(fakeCmux, 0o755)
}

const executable = real ? (process.env.CMUX_BIN || process.env.OMO_CMUX_BIN) : fakeCmux
if (executable === undefined) {
  console.error("FAIL: --real requires CMUX_BIN or OMO_CMUX_BIN")
  process.exit(1)
}

const source = `import { sendCmuxNotification } from ${JSON.stringify(notifier)}\nconst ok = await sendCmuxNotification("OMO probe", "cmux notification probe", { platform: "darwin" })\nprocess.exit(ok ? 0 : 1)\n`
const result = spawnSync("bun", ["-e", source], {
  cwd: packageRoot,
  encoding: "utf8",
  env: {
    ...process.env,
    OMO_CMUX_BIN: executable,
    OMO_SENPI_CMUX_NOTIFY: "1",
    CMUX_SOCKET_PATH: process.env.CMUX_SOCKET_PATH || "/tmp/cmux-probe.sock",
    CMUX_PROBE_LOG: logPath,
  },
})

if (result.status !== 0) {
  console.error("FAIL: notifier returned a non-zero result")
  process.stderr.write(result.stderr)
  process.exit(result.status ?? 1)
}

if (real) {
  console.log(`PASS: cmux notify command succeeded via ${executable}`)
  process.exit(0)
}

const args = readFileSync(logPath, "utf8").trim()
const expected = "notify --title OMO probe --body cmux notification probe"
if (args !== expected) {
  console.error(`FAIL: expected '${expected}', received '${args}'`)
  process.exit(1)
}
console.log("PASS: fake cmux received the exact notification command")
