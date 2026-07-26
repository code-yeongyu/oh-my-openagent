#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createSandbox, digestDirectory, seedSandbox } from "./drive.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(scriptDir, "..", "..")
const pluginRoot = join(packageRoot, "plugin")
const mockProviderEntry = join(scriptDir, "mock-provider", "index.ts")

const REQUIRED_DIRECTIVE_MARKERS = [
  "<ultrawork-mode>",
  "ULTRAWORK MODE ENABLED!",
  "# Parallel execution",
  "create_goal",
  "# Stop rules",
  "team_create",
]
const FORBIDDEN_TRANSCRIPT_MARKERS = ["update_plan", "multi_agent", "spawn_agent"]
const ULTRAWORK_CUSTOM_TYPE = "omo-ultrawork:directive"

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

/**
 * The directive must ride in as a hidden custom_message entry, never as part of
 * the user's own message. Reading the session JSONL is the only way to tell the
 * two apart: the provider sees both as role "user".
 */
function inspectSession(agentDir) {
  const sessionsDir = join(agentDir, "sessions")
  if (!existsSync(sessionsDir)) return { userTexts: [], hiddenDirectives: [], visibleDirectives: [] }

  const files = []
  collectFiles(sessionsDir, files)
  const userTexts = []
  const hiddenDirectives = []
  const visibleDirectives = []

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
      if (entry.type === "custom_message" && entry.customType === ULTRAWORK_CUSTOM_TYPE) {
        const record = { display: entry.display, content: messageText(entry.content) }
        if (entry.display === false) hiddenDirectives.push(record)
        else visibleDirectives.push(record)
      }
    }
  }

  return { userTexts, hiddenDirectives, visibleDirectives }
}

function findOnPath(bin) {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = resolve(dir || ".", bin)
    if (existsSync(candidate)) return candidate
  }
  return null
}

function stagedSkillChecks() {
  const researchPath = join(pluginRoot, "skills", "ulw-research", "SKILL.md")
  const ultraworkPath = join(pluginRoot, "skills", "ultrawork", "SKILL.md")
  const research = existsSync(researchPath) ? readFileSync(researchPath, "utf8") : ""
  const ultrawork = existsSync(ultraworkPath) ? readFileSync(ultraworkPath, "utf8") : ""
  return {
    ulwResearchExists: research.length > 0,
    ulwResearchNative:
      research.length > 0 &&
      !research.includes("## Senpi Harness Tool Compatibility") &&
      research.includes("team_create") &&
      research.includes("ULW-RESEARCH MODE ENABLED!"),
    ultraworkDescriptionOk: (ultrawork.match(/^description: (.*)$/m)?.[1] ?? "").includes("injects the full directive as a hidden custom message"),
  }
}

function runSelfTest() {
  const sandbox = createSandbox()
  try {
    seedSandbox(sandbox)
    if (REQUIRED_DIRECTIVE_MARKERS.some((marker) => marker.length === 0)) throw new Error("empty required marker")
    if (digestDirectory(join(sandbox.root, "missing")) !== "absent") throw new Error("missing directory digest should be absent")
    const staged = stagedSkillChecks()
    if (!staged.ulwResearchExists) throw new Error("staged ulw-research skill missing; run sync-skills.mjs first")

    const empty = inspectSession(join(sandbox.root, "missing"))
    if (empty.userTexts.length !== 0 || empty.hiddenDirectives.length !== 0) {
      throw new Error("inspectSession should report nothing for a missing agent dir")
    }

    const sessionDir = join(sandbox.agentDir, "sessions", "probe")
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(
      join(sessionDir, "probe.jsonl"),
      `${JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text: "ulw please respond" }] } })}\n` +
        `${JSON.stringify({ type: "custom_message", customType: ULTRAWORK_CUSTOM_TYPE, display: false, content: "<ultrawork-mode>" })}\n`,
    )
    const probed = inspectSession(sandbox.agentDir)
    if (probed.userTexts.length !== 1 || probed.userTexts[0] !== "ulw please respond") {
      throw new Error("inspectSession failed to read the user message text")
    }
    if (probed.hiddenDirectives.length !== 1 || probed.visibleDirectives.length !== 0) {
      throw new Error("inspectSession failed to classify the hidden directive entry")
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
      `${JSON.stringify({ steps: [{ type: "text", text: "ulw prompts e2e complete" }] }, null, 2)}\n`,
    )
    const run = spawnSync(resolvedSenpi, ["-e", mockProviderEntry, "-p", "--provider", "omo-mock", "--model", "mock-1", "ulw please respond"], {
      cwd: sandbox.cwd,
      env: { ...process.env, SENPI_CODING_AGENT_DIR: sandbox.agentDir, XDG_CONFIG_HOME: sandbox.xdgConfigHome, OMO_SENPI_QA: "1" },
      encoding: "utf8",
      timeout: 60_000,
    })
    transcript = run.status === 0 ? readSandboxText(sandbox.agentDir) : ""

    const missingMarkers = REQUIRED_DIRECTIVE_MARKERS.filter((marker) => !transcript.includes(marker))
    const forbiddenHits = FORBIDDEN_TRANSCRIPT_MARKERS.filter((marker) => transcript.includes(marker))
    const staged = stagedSkillChecks()
    const ultraworkInjected = run.status === 0 && missingMarkers.length === 0 && forbiddenHits.length === 0
    const session = inspectSession(sandbox.agentDir)
    const userTextClean = session.userTexts.length > 0 && session.userTexts.every((text) => !text.includes("<ultrawork-mode>"))
    const hiddenInjectionOk =
      session.hiddenDirectives.length === 1 &&
      session.visibleDirectives.length === 0 &&
      REQUIRED_DIRECTIVE_MARKERS.every((marker) => session.hiddenDirectives[0].content.includes(marker))
    result =
      ultraworkInjected && staged.ulwResearchNative && staged.ultraworkDescriptionOk && userTextClean && hiddenInjectionOk
        ? "PASS"
        : "FAIL"
    return printResult({
      result,
      reason,
      beforeDigest,
      sandbox,
      missingMarkers,
      forbiddenHits,
      staged,
      ultraworkInjected,
      userTextClean,
      hiddenInjectionOk,
      userTexts: session.userTexts,
      hiddenDirectiveCount: session.hiddenDirectives.length,
      visibleDirectiveCount: session.visibleDirectives.length,
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
  forbiddenHits = [],
  staged = {},
  ultraworkInjected = false,
  userTextClean = false,
  hiddenInjectionOk = false,
  userTexts = [],
  hiddenDirectiveCount = 0,
  visibleDirectiveCount = 0,
}) {
  const afterDigest = digestDirectory(join(process.env.HOME ?? "", ".senpi", "agent"))
  console.log(
    JSON.stringify({
      result,
      ...(reason ? { reason } : {}),
      ultraworkInjected,
      userTextClean,
      hiddenInjectionOk,
      hiddenDirectiveCount,
      visibleDirectiveCount,
      userTexts,
      missingMarkers,
      forbiddenHits,
      ...staged,
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
