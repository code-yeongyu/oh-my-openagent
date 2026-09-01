#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createSandbox, digestDirectory, seedSandbox } from "./drive.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const mockProviderEntry = join(scriptDir, "mock-provider", "index.ts")

const MASS_ULW_MARKER = "<omo-mass-ulw-pointer>"
const ULW_PLAN_MARKER = "<omo-ulw-plan-pointer>"
const ULW_LOOP_MARKER = "<omo-ulw-loop-pointer>"
const ULW_RESEARCH_MARKER = "<omo-ulw-research-pointer>"

const SCENARIOS = [
  {
    name: "overlap-mass-ulw-loop",
    prompt: "mass ulw-loop ship the refactor",
    expectHidden: [
      { customType: "omo-mass-ulw:skill-pointer", markers: [MASS_ULW_MARKER, "mass-ulw/SKILL.md", "workflow tool"] },
      { customType: "omo-ulw-loop:skill-pointer", markers: [ULW_LOOP_MARKER, "ulw-loop/SKILL.md", "read tool"] },
    ],
    forbidMarkers: [ULW_PLAN_MARKER, ULW_RESEARCH_MARKER],
    expectTranscriptMarkers: ["<ultrawork-mode>"],
  },
  {
    name: "ulw-plan",
    prompt: "go ulw plan the migration",
    expectHidden: [{ customType: "omo-ulw-plan:skill-pointer", markers: [ULW_PLAN_MARKER, "ulw-plan/SKILL.md", "read tool"] }],
    forbidMarkers: [MASS_ULW_MARKER, ULW_LOOP_MARKER, ULW_RESEARCH_MARKER],
    expectTranscriptMarkers: ["<ultrawork-mode>"],
  },
  {
    name: "mass-ulw-research",
    prompt: "mass ulw research the gateway options",
    expectHidden: [
      { customType: "omo-mass-ulw:skill-pointer", markers: [MASS_ULW_MARKER, "mass-ulw/SKILL.md"] },
      { customType: "omo-ulw-research:skill-pointer", markers: [ULW_RESEARCH_MARKER, "ulw-research/SKILL.md"] },
    ],
    forbidMarkers: [ULW_PLAN_MARKER, ULW_LOOP_MARKER],
    expectTranscriptMarkers: ["<ultrawork-mode>"],
  },
  {
    name: "plain-mass-ulw",
    prompt: "mass ulw please orchestrate the docs refresh",
    expectHidden: [{ customType: "omo-mass-ulw:skill-pointer", markers: [MASS_ULW_MARKER, "mass-ulw/SKILL.md"] }],
    forbidMarkers: [ULW_PLAN_MARKER, ULW_LOOP_MARKER, ULW_RESEARCH_MARKER],
    expectTranscriptMarkers: ["<ultrawork-mode>"],
  },
]

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

// The pointer must ride in as a hidden custom_message entry, never inside the user's own
// message. Only the session JSONL distinguishes the two: the provider sees both as role "user".
function inspectSession(agentDir) {
  const sessionsDir = join(agentDir, "sessions")
  if (!existsSync(sessionsDir)) return { userTexts: [], hiddenCustomMessages: [], visiblePointerMarkers: 0 }

  const files = []
  collectFiles(sessionsDir, files)
  const userTexts = []
  const hiddenCustomMessages = []
  let visiblePointerMarkers = 0

  for (const file of files.filter((path) => path.endsWith(".jsonl"))) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (line.trim() === "") continue
      let entry
      try {
        entry = JSON.parse(line)
      } catch {
        continue
      }
      if (entry?.type === "custom_message" && typeof entry.content === "string") {
        if (entry.display === false) hiddenCustomMessages.push({ customType: entry.customType, content: entry.content })
        else if (entry.content.includes("-pointer>")) visiblePointerMarkers += 1
      }
      if (entry?.type === "message" && entry.message?.role === "user") {
        userTexts.push(messageText(entry.message.content))
      }
    }
  }

  return { userTexts, hiddenCustomMessages, visiblePointerMarkers }
}

function findOnPath(bin) {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = resolve(dir || ".", bin)
    if (existsSync(candidate)) return candidate
  }
  return null
}

function runScenario(resolvedSenpi, scenario) {
  const sandbox = createSandbox()
  try {
    seedSandbox(sandbox)
    writeFileSync(
      join(sandbox.cwd, "mock-script.json"),
      `${JSON.stringify({ steps: [{ type: "text", text: `${scenario.name} e2e complete` }] }, null, 2)}\n`,
    )
    const run = spawnSync(
      resolvedSenpi,
      ["-e", mockProviderEntry, "-p", "--provider", "omo-mock", "--model", "mock-1", scenario.prompt],
      {
        cwd: sandbox.cwd,
        env: { ...process.env, SENPI_CODING_AGENT_DIR: sandbox.agentDir, XDG_CONFIG_HOME: sandbox.xdgConfigHome, OMO_SENPI_QA: "1" },
        encoding: "utf8",
        timeout: 60_000,
      },
    )
    const transcript = run.status === 0 ? readSandboxText(sandbox.agentDir) : ""
    const session = inspectSession(sandbox.agentDir)

    const failures = []
    if (run.status !== 0) failures.push(`senpi-exit-${run.status}`)
    for (const expected of scenario.expectHidden) {
      const match = session.hiddenCustomMessages.find((entry) => entry.customType === expected.customType)
      if (match === undefined) {
        failures.push(`missing-hidden:${expected.customType}`)
        continue
      }
      for (const marker of expected.markers) {
        if (!match.content.includes(marker)) failures.push(`missing-marker:${expected.customType}:${marker}`)
      }
    }
    for (const marker of scenario.forbidMarkers) {
      if (transcript.includes(marker)) failures.push(`forbidden-marker-present:${marker}`)
    }
    for (const marker of scenario.expectTranscriptMarkers) {
      if (!transcript.includes(marker)) failures.push(`missing-transcript-marker:${marker}`)
    }
    if (session.visiblePointerMarkers > 0) failures.push("pointer-rendered-visible")
    if (session.userTexts.some((text) => text.includes("-pointer>"))) failures.push("pointer-leaked-into-user-text")

    return { name: scenario.name, prompt: scenario.prompt, result: failures.length === 0 ? "PASS" : "FAIL", failures }
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
}

function main() {
  const realAgentDir = join(process.env.HOME ?? "", ".senpi", "agent")
  const beforeDigest = digestDirectory(realAgentDir)
  const senpiBin = process.env.SENPI_BIN?.trim() || "senpi"
  const resolvedSenpi = senpiBin.includes("/") ? (existsSync(senpiBin) ? senpiBin : null) : findOnPath(senpiBin)
  if (resolvedSenpi === null) {
    console.log(JSON.stringify({ result: "SKIP", reason: "senpi-binary-unavailable" }))
    return
  }

  const scenarios = SCENARIOS.map((scenario) => runScenario(resolvedSenpi, scenario))
  const afterDigest = digestDirectory(realAgentDir)
  console.log(
    JSON.stringify({
      result: scenarios.every((scenario) => scenario.result === "PASS") ? "PASS" : "FAIL",
      scenarios,
      realSenpiUntouched: beforeDigest === afterDigest,
    }),
  )
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
