#!/usr/bin/env node
// Live Senpi QA driver for the ultrawork duplicate-injection guards.
// Mirrors packages/omo-senpi/scripts/qa/drive.mjs: real senpi binary, isolated
// SENPI_CODING_AGENT_DIR sandbox, local mock provider (zero tokens), and a
// before/after digest proving the real ~/.senpi/agent stayed untouched.
import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { createHash } from "node:crypto"

import { createSandbox, seedSandbox } from "../../../packages/omo-senpi/scripts/qa/drive.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, "..", "..", "..")
const mockProviderEntry = join(repoRoot, "packages", "omo-senpi", "scripts", "qa", "mock-provider", "index.ts")
const realSenpiAgentDir = join(homedir(), ".senpi", "agent")

const DIRECTIVE_SENTINEL = "ULTRAWORK MODE ENABLED!"

// Digest only the real agent dir's config files. The full-directory digest used by
// drive.mjs is unusable here: this QA runs from within a live senpi session that
// continuously appends to ~/.senpi/agent/sessions and telemetry state, so instead
// we pin the files a sandbox leak would actually corrupt.
function digestConfigFiles(root) {
  const hash = createHash("sha256")
  for (const name of ["settings.json", "trust.json"]) {
    const path = join(root, name)
    hash.update(name)
    hash.update("\0")
    hash.update(existsSync(path) ? readFileSync(path) : "absent")
    hash.update("\0")
  }
  return hash.digest("hex")
}

function findOnPath(bin) {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = resolve(dir || ".", bin)
    if (existsSync(candidate)) return candidate
  }
  return null
}

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

function runScenario(senpiBin, name, prompt, assert) {
  const sandbox = createSandbox()
  try {
    seedSandbox(sandbox)
    writeFileSync(
      join(sandbox.cwd, "mock-script.json"),
      `${JSON.stringify({ steps: [{ type: "text", text: "qa scenario complete" }] }, null, 2)}\n`,
    )
    const run = spawnSync(
      senpiBin,
      ["-e", mockProviderEntry, "-p", "--provider", "omo-mock", "--model", "mock-1", prompt],
      {
        cwd: sandbox.cwd,
        env: { ...process.env, SENPI_CODING_AGENT_DIR: sandbox.agentDir, OMO_SENPI_QA: "1" },
        encoding: "utf8",
        timeout: 90_000,
      },
    )
    const sessionText = readSandboxText(sandbox.agentDir)
    const verdict = run.status === 0 ? assert(sessionText) : { pass: false, detail: `senpi exit ${run.status}: ${run.stderr?.slice(0, 300)}` }
    return { name, prompt, pass: verdict.pass, detail: verdict.detail }
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
}

function main() {
  const beforeDigest = digestConfigFiles(realSenpiAgentDir)
  const senpiBin = process.env.SENPI_BIN?.trim() || findOnPath("senpi")
  if (senpiBin === null) {
    console.log(JSON.stringify({ result: "SKIP", reason: "senpi-binary-unavailable" }))
    process.exit(0)
  }

  const scenarios = [
    runScenario(senpiBin, "trigger-still-injects", "ulw please respond", (text) => ({
      pass: text.includes(DIRECTIVE_SENTINEL),
      detail: "expects directive body injected for a bare ulw trigger",
    })),
    runScenario(senpiBin, "ulw-plan-does-not-arm", "ulw-plan please respond", (text) => ({
      pass: !text.includes(DIRECTIVE_SENTINEL) && !text.includes("<ultrawork-mode>"),
      detail: "expects NO directive when the prompt only names the ulw-plan skill",
    })),
    runScenario(
      senpiBin,
      "pasted-block-not-reinjected",
      "review this transcript <ultrawork-mode> pasted copy </ultrawork-mode> and ulw it",
      (text) => ({
        pass: !text.includes(DIRECTIVE_SENTINEL),
        detail: "expects NO directive body when the prompt already carries an <ultrawork-mode> block",
      }),
    ),
    runScenario(senpiBin, "skill-command-appends", "/skill:frontend ulw please tidy this up", (text) => ({
      // Session JSONL escapes quotes, so match the expanded skill block with an
      // escape-tolerant pattern instead of a raw `name="frontend"` literal.
      pass: /<skill name=\\?"frontend/.test(text) && text.includes(DIRECTIVE_SENTINEL),
      detail: "expects native /skill: expansion AND the directive appended after the command",
    })),
    runScenario(senpiBin, "skill-ultrawork-not-duplicated", "/skill:ultrawork fix this login bug", (text) => ({
      // Expansion inlines the SKILL.md body (which IS the directive) exactly once;
      // the hook must NOT append a second copy after the expanded block. Count
      // <ultrawork-mode> OPEN TAGS (one per block; the sentinel line appears
      // twice WITHIN a single directive body, so it cannot be the unit).
      pass: /<skill name=\\?"ultrawork/.test(text) && (text.match(/<ultrawork-mode>/g)?.length ?? 0) === 1,
      detail: "expects /skill:ultrawork to expand natively with exactly one directive block",
    })),
    runScenario(senpiBin, "open-tag-mention-still-arms", "Explain what <ultrawork-mode> means, then ulw this fix", (text) => ({
      pass: text.includes(DIRECTIVE_SENTINEL),
      detail: "expects a lone open-tag mention (no closing tag) to still inject the directive",
    })),
  ]

  const afterDigest = digestConfigFiles(realSenpiAgentDir)
  const payload = {
    result: scenarios.every((s) => s.pass) ? "PASS" : "FAIL",
    scenarios,
    realSenpiUntouched: beforeDigest === afterDigest,
    senpiBin,
  }
  console.log(JSON.stringify(payload, null, 2))
  process.exit(payload.result === "PASS" && payload.realSenpiUntouched ? 0 : 1)
}

main()
