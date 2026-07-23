#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
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
    ultraworkDescriptionOk: (ultrawork.match(/^description: (.*)$/m)?.[1] ?? "").includes("injects the full directive inline"),
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
      env: { ...process.env, SENPI_CODING_AGENT_DIR: sandbox.agentDir, OMO_SENPI_QA: "1" },
      encoding: "utf8",
      timeout: 60_000,
    })
    transcript = run.status === 0 ? readSandboxText(sandbox.agentDir) : ""

    const missingMarkers = REQUIRED_DIRECTIVE_MARKERS.filter((marker) => !transcript.includes(marker))
    const forbiddenHits = FORBIDDEN_TRANSCRIPT_MARKERS.filter((marker) => transcript.includes(marker))
    const staged = stagedSkillChecks()
    const ultraworkInjected = run.status === 0 && missingMarkers.length === 0 && forbiddenHits.length === 0
    result = ultraworkInjected && staged.ulwResearchNative && staged.ultraworkDescriptionOk ? "PASS" : "FAIL"
    return printResult({ result, reason, beforeDigest, sandbox, missingMarkers, forbiddenHits, staged, ultraworkInjected })
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
}

function printResult({ result, reason, beforeDigest, sandbox, missingMarkers = [], forbiddenHits = [], staged = {}, ultraworkInjected = false }) {
  const afterDigest = digestDirectory(join(process.env.HOME ?? "", ".senpi", "agent"))
  console.log(
    JSON.stringify({
      result,
      ...(reason ? { reason } : {}),
      ultraworkInjected,
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
