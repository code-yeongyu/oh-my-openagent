#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createSandbox, credentialDigest, seedSandbox } from "../../../packages/omo-senpi/scripts/qa/drive.mjs"

const evidenceDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(evidenceDir, "../../..")
const provider = join(evidenceDir, "memory-prompt-provider.ts")
const realAgentDir = join(homedir(), ".senpi", "agent")
const beforeCredentials = credentialDigest(realAgentDir)
const sandbox = createSandbox()
const runRecords = []

try {
  seedSandbox(sandbox)
  const sessions = join(sandbox.root, "sessions")
  const memoryHome = join(sandbox.root, "memory")
  mkdirSync(sessions, { recursive: true })
  mkdirSync(join(sandbox.cwd, ".omo"), { recursive: true })
  writeFileSync(join(sandbox.agentDir, "auth.json"), `${JSON.stringify({
    "omo-cache-qa": { type: "api_key", key: "mock" },
  }, null, 2)}\n`)
  writeFileSync(join(sandbox.cwd, ".omo", "omo.json"), `${JSON.stringify({
    memory: {
      enabled: true,
      reflection: { enabled: false },
      nudge: { enabled: true, every_user_turns: 1 },
      facts: { enabled: false },
      dream: { enabled: false },
    },
  }, null, 2)}\n`)

  const bootstrap = runSenpi("bootstrap", "initialize stable memory projection")
  assert(bootstrap.status === 0, `bootstrap failed: ${bootstrap.stderr.slice(-600)}`)
  const repo = findMemoryRepo(memoryHome)
  assert(repo !== undefined, "memory repository was not created")
  const baseline = runSenpi("baseline", "establish the soul notice watermark")
  assert(baseline.status === 0, `baseline failed: ${baseline.stderr.slice(-600)}`)

  const persona = join(repo, "system", "persona.md")
  writeFileSync(persona, `${readFileSync(persona, "utf8").trimEnd()}\nExternal reflection QA marker.\n`)
  const commit = spawnSync("git", [
    "-c", "user.name=Memory Prompt QA",
    "-c", "user.email=memory-prompt-qa@omo.local",
    "add", "system/persona.md",
  ], { cwd: repo, encoding: "utf8" })
  assert(commit.status === 0, `git add failed: ${commit.stderr}`)
  const committed = spawnSync("git", [
    "-c", "user.name=Memory Prompt QA",
    "-c", "user.email=memory-prompt-qa@omo.local",
    "commit", "-m", "chore(reflection): external soul QA update", "-m", "Omo-Writer: reflection",
  ], { cwd: repo, encoding: "utf8" })
  assert(committed.status === 0, `git commit failed: ${committed.stderr}`)

  const noticed = runSenpi("noticed", "observe nudge and soul notices")
  assert(noticed.status === 0, `noticed run failed: ${noticed.stderr.slice(-600)}`)
  const quiet = runSenpi("quiet", "observe stable prompt after soul notice consumption")
  assert(quiet.status === 0, `quiet run failed: ${quiet.stderr.slice(-600)}`)

  const noticedDump = readSingleDump("noticed")
  const quietDump = readSingleDump("quiet")
  const noticedMessage = findMemoryNotice(noticedDump.messages)
  const quietMessage = findMemoryNotice(quietDump.messages)
  assert(noticedMessage !== undefined, "noticed provider request lacked omo-memory:notice")
  assert(quietMessage !== undefined, "quiet provider request lacked omo-memory:notice")
  assert(noticedMessage.content.includes("user turns since your last memory save"), "nudge was not provider-visible")
  assert(noticedMessage.content.includes("Soul updated by reflection"), "soul notice was not provider-visible")
  assert(quietMessage.content.includes("user turns since your last memory save"), "next-turn nudge was not provider-visible")
  assert(!quietMessage.content.includes("Soul updated by reflection"), "soul notice was not consumed once")

  const noticedBlock = memoryBlock(noticedDump.systemPrompt)
  const quietBlock = memoryBlock(quietDump.systemPrompt)
  assert(noticedBlock === quietBlock, "same identity and HEAD produced different system memory blocks")
  for (const dump of [noticedDump, quietDump]) {
    assert(!dump.systemPrompt.includes("CONVERSATION_ID"), "system prompt leaked conversation id")
    assert(!dump.systemPrompt.includes("System prompt last recompiled"), "system prompt leaked compile timestamp")
    assert(!dump.systemPrompt.includes("previous messages"), "system prompt leaked recall count")
    assert(!dump.systemPrompt.includes("user turns since your last memory save"), "system prompt leaked nudge")
    assert(!dump.systemPrompt.includes("Soul updated by"), "system prompt leaked soul notice")
  }

  const summary = {
    result: "PASS",
    realSenpiCredentialsUntouched: beforeCredentials === credentialDigest(realAgentDir),
    freshSessionsCompared: ["noticed", "quiet"],
    byteIdenticalMemoryBlock: noticedBlock === quietBlock,
    memoryBlockBytes: Buffer.byteLength(noticedBlock),
    memoryBlockSha256: createHash("sha256").update(noticedBlock).digest("hex"),
    noticedProviderMessage: noticedMessage,
    quietProviderMessage: quietMessage,
    systemVolatileFieldsAbsent: true,
    runs: runRecords,
    cleanup: `removed isolated sandbox ${sandbox.root}`,
  }
  assert(summary.realSenpiCredentialsUntouched, "real Senpi credentials changed")
  writeFileSync(join(evidenceDir, "real-senpi-memory-prompt-summary.json"), `${JSON.stringify(summary, null, 2)}\n`)
  writeFileSync(join(evidenceDir, "noticed-system-memory-block.txt"), noticedBlock)
  writeFileSync(join(evidenceDir, "quiet-system-memory-block.txt"), quietBlock)
  console.log(JSON.stringify(summary, null, 2))
} finally {
  rmSync(sandbox.root, { recursive: true, force: true })
}

function runSenpi(name, prompt) {
  const dump = join(sandbox.root, `${name}-provider.jsonl`)
  const run = spawnSync("senpi", [
    "-e", provider,
    "-p",
    "--mode", "json",
    "--provider", "omo-cache-qa",
    "--model", "mock-1",
    "--session-dir", join(sandbox.root, "sessions"),
    prompt,
  ], {
    cwd: sandbox.cwd,
    env: {
      ...process.env,
      HOME: sandbox.homeDir,
      USERPROFILE: sandbox.homeDir,
      SENPI_CODING_AGENT_DIR: sandbox.agentDir,
      XDG_CONFIG_HOME: sandbox.xdgConfigHome,
      OMO_MEMORY_HOME: join(sandbox.root, "memory"),
      QA_PROVIDER_DUMP: dump,
      QA_PROVIDER_MODE: name,
    },
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
  })
  runRecords.push({ name, status: run.status, providerDump: `${name}-provider.jsonl` })
  return run
}

function readSingleDump(name) {
  const path = join(sandbox.root, `${name}-provider.jsonl`)
  const rows = readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
  assert(rows.length === 1, `${name} expected one provider request, got ${rows.length}`)
  writeFileSync(join(evidenceDir, `${name}-provider-request.json`), `${JSON.stringify(rows[0], null, 2)}\n`)
  return rows[0]
}

function findMemoryRepo(memoryHome) {
  const agents = join(memoryHome, "agents")
  if (!existsSync(agents)) return undefined
  return readdirSync(agents).map((name) => join(agents, name, "repo")).find(existsSync)
}

function findMemoryNotice(messages) {
  for (const message of messages ?? []) {
    const content = Array.isArray(message?.content)
      ? message.content.map((part) => typeof part?.text === "string" ? part.text : "").join("\n")
      : typeof message?.content === "string" ? message.content : ""
    if (message?.role === "user" && content.includes("<memory_notice>")) {
      return { providerRole: message.role, sourceCustomType: "omo-memory:notice", content }
    }
  }
  return undefined
}

function memoryBlock(systemPrompt) {
  assert(typeof systemPrompt === "string", "provider request lacked a string system prompt")
  const start = systemPrompt.indexOf("<!-- senpi-memory:")
  assert(start >= 0, "system prompt lacked memory sentinel")
  const endMarker = "<!-- senpi-memory:"
  const endStart = systemPrompt.indexOf(endMarker, start + endMarker.length)
  assert(endStart >= 0, "system prompt lacked closing memory sentinel")
  const end = systemPrompt.indexOf("-->", endStart)
  assert(end >= 0, "closing memory sentinel was malformed")
  return systemPrompt.slice(start, end + 3)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
