#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { createSandbox, credentialDigest, seedSandbox } from "./drive.mjs"
import { parseJsonEvents } from "./task-e2e-analysis.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const mockProviderEntry = join(scriptDir, "task-e2e-mock-provider.ts")
const realAgentDirs = [join(homedir(), ".senpi", "agent"), join(homedir(), ".omo", "agent")]
const skillName = "qa-skill"
const missingSkillName = "missing-qa-skill"
const skillMarker = "OMO TASK LOAD SKILLS LIVE MARKER"

function findOnPath(bin) {
  if (bin.includes("/")) return existsSync(bin) ? bin : null
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = resolve(dir || ".", bin)
    if (existsSync(candidate)) return candidate
  }
  return null
}

function seedScenario(sandbox) {
  seedSandbox(sandbox)
  const sessionDir = join(sandbox.root, "sessions")
  mkdirSync(sessionDir, { recursive: true })
  const omoDir = join(sandbox.cwd, ".omo")
  mkdirSync(omoDir, { recursive: true })
  writeFileSync(join(omoDir, "omo.json"), `${JSON.stringify({
    categories: { mockcat: { description: "Local mock category.", model: "omo-mock/mock-1" } },
  }, null, 2)}\n`)
  const skillDir = join(sandbox.agentDir, "skills", skillName)
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(
    join(skillDir, "SKILL.md"),
    `---\nname: ${skillName}\ndescription: Isolated live QA skill\n---\n${skillMarker}\n`,
  )
  writeFileSync(join(sandbox.cwd, "mock-script.json"), `${JSON.stringify({
    childSteps: [{ type: "text", text: "skill child complete" }],
    parentSteps: [
      {
        type: "tool_call",
        name: "task",
        arguments: {
          category: "mockcat",
          prompt: "run the skill-marked child",
          load_skills: [skillName, missingSkillName],
          run_in_background: false,
          name: "skill-child",
        },
      },
      { type: "text", text: "skill task returned inline" },
    ],
  }, null, 2)}\n`)
  return sessionDir
}

function collectJsonl(root) {
  if (!existsSync(root)) return []
  const paths = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) paths.push(...collectJsonl(path))
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) paths.push(path)
  }
  return paths
}

function skillResult(events) {
  for (const event of events) {
    if (event?.type !== "tool_execution_end" || event.toolName !== "task") continue
    return event.result?.details?.skills
  }
  return undefined
}

function count(text, needle) {
  return text.split(needle).length - 1
}

function selfTest() {
  const details = skillResult([{
    type: "tool_execution_end",
    toolName: "task",
    result: { details: { skills: { requested: [skillName], resolved: [skillName], missing: [] } } },
  }])
  if (details?.resolved?.[0] !== skillName) throw new Error("skill result parser failed")
  if (count(`x${skillMarker}y${skillMarker}`, skillMarker) !== 2) throw new Error("marker counter failed")
  console.log("SELF-TEST OK")
}

function writeEvidence(outDir, payload, transcript, spawnPrompt, stdout, stderr) {
  if (outDir === undefined) return
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, "verdict.json"), `${JSON.stringify(payload, null, 2)}\n`)
  writeFileSync(join(outDir, "child-session.jsonl.log"), transcript)
  writeFileSync(join(outDir, "spawn-prompt.txt"), spawnPrompt)
  writeFileSync(join(outDir, "stdout.json.log"), stdout)
  writeFileSync(join(outDir, "stderr.log"), stderr)
}

function main() {
  if (process.argv.includes("--self-test")) return selfTest()
  const senpiBin = findOnPath(process.env.SENPI_BIN?.trim() || "senpi")
  if (senpiBin === null) {
    console.log(JSON.stringify({ result: "SKIP", reason: "senpi-binary-unavailable" }))
    return
  }
  const outDir = process.env.TASK_LOAD_SKILLS_E2E_OUT_DIR?.trim()
  const snapshots = realAgentDirs.map((dir) => ({ dir, before: credentialDigest(dir) }))
  const sandbox = createSandbox()
  let exitCode = 1
  try {
    const sessionDir = seedScenario(sandbox)
    const run = spawnSync(
      senpiBin,
      ["-e", mockProviderEntry, "-p", "--mode", "json", "--provider", "omo-mock", "--model", "mock-1", "--session-dir", sessionDir, "run load_skills live QA"],
      {
        cwd: sandbox.cwd,
        env: {
          ...process.env,
          SENPI_CODING_AGENT_DIR: sandbox.agentDir,
          XDG_CONFIG_HOME: sandbox.xdgConfigHome,
          SENPI_CODING_AGENT_SESSION_DIR: sessionDir,
          OMO_SENPI_QA: "1",
        },
        encoding: "utf8",
        timeout: 120_000,
        maxBuffer: 64 * 1024 * 1024,
      },
    )
    const stdout = run.stdout ?? ""
    const stderr = run.stderr ?? ""
    const events = parseJsonEvents(stdout)
    const details = skillResult(events)
    const taskId = events.flatMap((event) => {
      const id = event?.result?.details?.task_id
      return typeof id === "string" && id.startsWith("st_") ? [id] : []
    })[0]
    const taskPath = typeof taskId === "string"
      ? join(sandbox.cwd, ".omo", "senpi-task", "tasks", `${taskId}.json`)
      : ""
    const taskRecord = taskPath && existsSync(taskPath) ? JSON.parse(readFileSync(taskPath, "utf8")) : undefined
    const spawnPrompt = taskRecord?.spawn_spec?.prompt ?? ""
    const childRoot = typeof taskId === "string"
      ? join(sandbox.cwd, ".omo", "senpi-task", "children", taskId, "sessions")
      : ""
    const transcript = childRoot
      ? collectJsonl(childRoot).map((path) => readFileSync(path, "utf8")).join("\n")
      : ""
    const changedRealDirs = snapshots
      .filter(({ dir, before }) => before !== credentialDigest(dir))
      .map(({ dir }) => dir)
    const checks = {
      process_exit: run.status === 0 ? "PASS" : "FAIL",
      skill_summary: JSON.stringify(details) === JSON.stringify({
        requested: [skillName, missingSkillName],
        resolved: [skillName],
        missing: [missingSkillName],
      }) ? "PASS" : "FAIL",
      result_warning: stdout.includes(`Missing skills: ${missingSkillName}`) ? "PASS" : "FAIL",
      spawn_prompt: spawnPrompt.includes(skillMarker) && count(spawnPrompt, skillMarker) === 1 ? "PASS" : "FAIL",
      child_session: transcript.includes(skillMarker) && count(transcript, skillMarker) === 1 ? "PASS" : "FAIL",
      real_agent_dirs_untouched: changedRealDirs.length === 0 ? "PASS" : "FAIL",
    }
    const result = Object.values(checks).every((value) => value === "PASS") ? "PASS" : "FAIL"
    const payload = {
      result,
      checks,
      taskId,
      realAgentDirsUntouched: changedRealDirs.length === 0,
      changedRealDirs,
      sandboxAgentDir: sandbox.agentDir,
    }
    writeEvidence(outDir ? resolve(outDir) : undefined, payload, transcript, spawnPrompt, stdout, stderr)
    console.log(JSON.stringify(payload))
    exitCode = result === "PASS" ? 0 : 1
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
  process.exitCode = exitCode
}

main()
