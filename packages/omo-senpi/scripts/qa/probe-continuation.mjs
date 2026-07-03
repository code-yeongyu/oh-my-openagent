#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { existsSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { createSandbox, digestDirectory, seedSandbox } from "./drive.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const realSenpiAgentDir = join(homedir(), ".senpi", "agent")
const mockProviderEntry = join(scriptDir, "mock-provider", "index.ts")
const activeIncompleteStatusJson =
  '{"ok":true,"plan":{"goals":[{"status":"in_progress","title":"qa","successCriteria":[{"status":"pending","text":"qa"}]}]},"summary":"qa active incomplete"}'

function selfTest() {
  const sandbox = createSandbox()
  try {
    seedSandbox(sandbox)
    const binDir = join(sandbox.root, "bin")
    spawnSync("mkdir", ["-p", binDir])
    const omo = join(binDir, "omo")
    writeFileSync(omo, `#!/bin/sh\nprintf '${activeIncompleteStatusJson}'\n`)
    spawnSync("chmod", ["+x", omo])
    if (!existsSync(omo)) throw new Error("fake omo stub missing")
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
}

function main() {
  const beforeDigest = digestDirectory(realSenpiAgentDir)
  const sandbox = createSandbox()
  const sessionDir = join(sandbox.root, "sessions")
  let result = "FAIL"
  let continuationQaPath = "none"
  let reason
  let tmuxBin = null
  let tmuxSession = null

  try {
    seedSandbox(sandbox)
    const binDir = join(sandbox.root, "bin")
    spawnSync("mkdir", ["-p", binDir, sessionDir])
    const omo = join(binDir, "omo")
    writeFileSync(
      omo,
      `#!/bin/sh\nif [ "$1 $2 $3" = "ulw-loop status --json" ]; then printf '${activeIncompleteStatusJson}'; exit 0; fi\nexit 1\n`,
    )
    spawnSync("chmod", ["+x", omo])

    const senpiBin = process.env.SENPI_BIN?.trim() || "senpi"
    const resolvedSenpi = senpiBin.includes("/") ? (existsSync(senpiBin) ? senpiBin : null) : findOnPath(senpiBin)
    if (resolvedSenpi === null) {
      result = "SKIP"
      reason = "senpi-binary-unavailable"
      return print({ result, reason, continuationQaPath, beforeDigest })
    }

    writeFileSync(join(sandbox.cwd, "mock-script.json"), JSON.stringify({ steps: [{ type: "text", text: "first turn" }] }))
    const printRun = spawnSync(resolvedSenpi, [
      "-e",
      mockProviderEntry,
      "-p",
      "--session-dir",
      sessionDir,
      "--provider",
      "omo-mock",
      "--model",
      "mock-1",
      "continue ulw-loop",
    ], {
      cwd: sandbox.cwd,
      env: senpiEnv(sandbox, binDir, sessionDir),
      encoding: "utf8",
      timeout: 60_000,
    })
    const transcript = `${printRun.stdout}\n${printRun.stderr}`
    if (transcript.includes("Continue the active omo ulw-loop run")) {
      result = "PASS"
      continuationQaPath = "print"
      return print({ result, continuationQaPath, beforeDigest })
    }

    tmuxBin = findOnPath("tmux")
    if (tmuxBin === null) {
      result = "SKIP"
      reason = "print-mode-no-followup-and-tmux-unavailable"
      continuationQaPath = "print-observed-no-followup"
      return print({ result, reason, continuationQaPath, beforeDigest })
    }

    tmuxSession = `omo-senpi-qa-${process.pid}`
    const tmuxPath = `${binDir}:${process.env.PATH ?? ""}`
    const tmuxRun = spawnSync(tmuxBin, [
      "new-session",
      "-e",
      `PATH=${tmuxPath}`,
      "-e",
      `SENPI_CODING_AGENT_DIR=${sandbox.agentDir}`,
      "-e",
      `SENPI_CODING_AGENT_SESSION_DIR=${sessionDir}`,
      "-d",
      "-s",
      tmuxSession,
      resolvedSenpi,
      "-e",
      mockProviderEntry,
      "--session-dir",
      sessionDir,
      "--provider",
      "omo-mock",
      "--model",
      "mock-1",
      "continue ulw-loop",
    ], {
      cwd: sandbox.cwd,
      env: senpiEnv(sandbox, binDir, sessionDir),
      timeout: 10_000,
    })
    if (tmuxRun.status !== 0) {
      reason = "tmux-start-failed"
      continuationQaPath = "tmux"
      return print({ result, reason, continuationQaPath, beforeDigest })
    }

    let captureText = ""
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const capture = spawnSync(tmuxBin, ["capture-pane", "-pt", tmuxSession, "-S", "-200"], { encoding: "utf8", timeout: 10_000 })
      captureText = capture.stdout
      if (captureText.includes("Continue the active omo ulw-loop run")) break
      wait(250)
    }
    continuationQaPath = "tmux"
    result = captureText.includes("Continue the active omo ulw-loop run") ? "PASS" : "FAIL"
    return print({ result, continuationQaPath, beforeDigest })
  } finally {
    if (tmuxBin !== null && tmuxSession !== null) {
      spawnSync(tmuxBin, ["kill-session", "-t", tmuxSession], { timeout: 10_000 })
    }
    rmSync(sandbox.root, { recursive: true, force: true })
  }
}

function print({ result, reason, continuationQaPath, beforeDigest }) {
  const afterDigest = digestDirectory(realSenpiAgentDir)
  console.log(JSON.stringify({ result, ...(reason ? { reason } : {}), continuationQaPath, realSenpiUntouched: beforeDigest === afterDigest }))
}

function senpiEnv(sandbox, binDir, sessionDir) {
  return {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH ?? ""}`,
    SENPI_CODING_AGENT_DIR: sandbox.agentDir,
    SENPI_CODING_AGENT_SESSION_DIR: sessionDir,
    OMO_SENPI_QA: "1",
  }
}

function findOnPath(bin) {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = resolve(dir || ".", bin)
    if (existsSync(candidate)) return candidate
  }
  return null
}

function wait(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) {
    selfTest()
    console.log("SELF-TEST OK")
  } else {
    main()
  }
}
