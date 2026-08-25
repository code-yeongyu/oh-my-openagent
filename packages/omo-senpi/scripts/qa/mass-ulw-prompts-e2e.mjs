#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createSandbox, digestDirectory, seedSandbox } from "./drive.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(scriptDir, "..", "..")
const mockProviderEntry = join(scriptDir, "mock-provider", "index.ts")

const REQUIRED_POINTER_MARKERS = ["<omo-mass-ulw-pointer>", "mass-ulw/SKILL.md", "read tool", "dag tool"]
const MASS_ULW_CUSTOM_TYPE = "omo-mass-ulw:skill-pointer"

function collectFiles(root, files) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) collectFiles(path, files)
    else if (entry.isFile()) files.push(path)
  }
}

function readSandboxText(root) {
  if (!existsSync(root)) return ""
  const files = []
  collectFiles(root, files)
  return files
    .filter((file) => file.endsWith(".json") || file.endsWith(".jsonl") || file.endsWith(".log") || file.endsWith(".md"))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n")
}

function messageText(content) {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("")
}

// The pointer must ride in as a hidden custom_message entry, never as part of the user's own
// message. Reading the session JSONL is the only way to tell the two apart: the provider sees
// both as role "user".
function inspectSession(agentDir) {
  const sessionsDir = join(agentDir, "sessions")
  if (!existsSync(sessionsDir)) return { userTexts: [], hiddenPointers: [], visiblePointers: [] }

  const files = []
  collectFiles(sessionsDir, files)
  const userTexts = []
  const hiddenPointers = []
  const visiblePointers = []

  for (const file of files.filter((path) => path.endsWith(".jsonl"))) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (line.trim() === "") continue
      let entry
      try {
        entry = JSON.parse(line)
      } catch {
        continue
      }
      if (entry.type === "message" && entry.message?.role === "user") {
        userTexts.push(messageText(entry.message.content))
      }
      if (entry.type === "custom_message" && entry.customType === MASS_ULW_CUSTOM_TYPE) {
        const record = { display: entry.display, content: messageText(entry.content) }
        if (entry.display === false) hiddenPointers.push(record)
        else visiblePointers.push(record)
      }
    }
  }

  return { userTexts, hiddenPointers, visiblePointers }
}

function findOnPath(bin) {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = resolve(dir || ".", bin)
    if (existsSync(candidate)) return candidate
  }
  return null
}

function runSelfTest() {
  const sandbox = createSandbox()
  try {
    seedSandbox(sandbox)
    if (REQUIRED_POINTER_MARKERS.some((marker) => marker.length === 0)) throw new Error("empty required marker")

    const empty = inspectSession(join(sandbox.root, "missing"))
    if (empty.userTexts.length !== 0 || empty.hiddenPointers.length !== 0) {
      throw new Error("inspectSession should report nothing for a missing agent dir")
    }

    const sessionDir = join(sandbox.agentDir, "sessions", "probe")
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(
      join(sessionDir, "probe.jsonl"),
      `${JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text: "mass ulw please respond" }] } })}\n` +
        `${JSON.stringify({ type: "custom_message", customType: MASS_ULW_CUSTOM_TYPE, display: false, content: "<omo-mass-ulw-pointer>mass-ulw/SKILL.md</omo-mass-ulw-pointer>" })}\n`,
    )
    const probed = inspectSession(sandbox.agentDir)
    if (probed.userTexts.length !== 1 || probed.userTexts[0] !== "mass ulw please respond") {
      throw new Error("inspectSession failed to read the user message text")
    }
    if (probed.hiddenPointers.length !== 1 || probed.visiblePointers.length !== 0) {
      throw new Error("inspectSession failed to classify the hidden pointer entry")
    }
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
}

function main() {
  const beforeDigest = digestDirectory(join(process.env.HOME ?? "", ".senpi", "agent"))
  const sandbox = createSandbox()
  let result = "FAIL"
  let reason
  let transcript = ""

  try {
    const senpiBin = process.env.SENPI_BIN?.trim() || "senpi"
    const resolvedSenpi = senpiBin.includes("/") ? (existsSync(senpiBin) ? senpiBin : null) : findOnPath(senpiBin)
    if (resolvedSenpi === null) {
      result = "SKIP"
      reason = "senpi-binary-unavailable"
      return printResult({ result, reason, beforeDigest, sandbox })
    }

    seedSandbox(sandbox)
    writeFileSync(
      join(sandbox.cwd, "mock-script.json"),
      `${JSON.stringify({ steps: [{ type: "text", text: "mass ulw prompts e2e complete" }] }, null, 2)}\n`,
    )
    const run = spawnSync(
      resolvedSenpi,
      ["-e", mockProviderEntry, "-p", "--provider", "omo-mock", "--model", "mock-1", "mass ulw please orchestrate the docs refresh"],
      {
        cwd: sandbox.cwd,
        env: { ...process.env, SENPI_CODING_AGENT_DIR: sandbox.agentDir, XDG_CONFIG_HOME: sandbox.xdgConfigHome, OMO_SENPI_QA: "1" },
        encoding: "utf8",
        timeout: 60_000,
      },
    )
    transcript = run.status === 0 ? readSandboxText(sandbox.agentDir) : ""

    const missingMarkers = REQUIRED_POINTER_MARKERS.filter((marker) => !transcript.includes(marker))
    const session = inspectSession(sandbox.agentDir)
    const pointerInjected = run.status === 0 && missingMarkers.length === 0
    const userTextClean = session.userTexts.length > 0 && session.userTexts.every((text) => !text.includes("<omo-mass-ulw-pointer>"))
    const hiddenInjectionOk =
      session.hiddenPointers.length === 1 &&
      session.visiblePointers.length === 0 &&
      REQUIRED_POINTER_MARKERS.every((marker) => session.hiddenPointers[0].content.includes(marker))
    result = pointerInjected && userTextClean && hiddenInjectionOk ? "PASS" : "FAIL"
    return printResult({
      result,
      reason,
      beforeDigest,
      sandbox,
      missingMarkers,
      pointerInjected,
      userTextClean,
      hiddenInjectionOk,
      userTexts: session.userTexts,
      hiddenPointerCount: session.hiddenPointers.length,
      visiblePointerCount: session.visiblePointers.length,
    })
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
}

function printResult({
  result,
  reason,
  beforeDigest,
  sandbox,
  missingMarkers = [],
  pointerInjected = false,
  userTextClean = false,
  hiddenInjectionOk = false,
  userTexts = [],
  hiddenPointerCount = 0,
  visiblePointerCount = 0,
}) {
  const afterDigest = digestDirectory(join(process.env.HOME ?? "", ".senpi", "agent"))
  console.log(
    JSON.stringify({
      result,
      ...(reason ? { reason } : {}),
      pointerInjected,
      userTextClean,
      hiddenInjectionOk,
      hiddenPointerCount,
      visiblePointerCount,
      userTexts,
      missingMarkers,
      realSenpiUntouched: beforeDigest === afterDigest,
      sandboxAgentDir: sandbox.agentDir,
    }),
  )
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) {
    runSelfTest()
    console.log("SELF-TEST OK")
  } else {
    main()
  }
}
