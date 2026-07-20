#!/usr/bin/env node
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { delimiter, dirname, join, resolve } from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(scriptDir, "..", "..")
const repoRoot = resolve(packageRoot, "..", "..")
const pluginRoot = join(packageRoot, "plugin")
const mockProviderEntry = join(scriptDir, "mock-provider", "index.ts")
const realSenpiAgentDir = join(homedir(), ".senpi", "agent")
const commentCheckerHeader = "comment-checker found issues in"

export function digestDirectory(root) {
  if (!existsSync(root)) return "absent"
  const files = []
  collectFiles(root, files)
  const hash = createHash("sha256")
  for (const file of files.sort()) {
    const rel = file.slice(root.length + 1)
    hash.update(rel)
    hash.update("\0")
    hash.update(createHash("sha256").update(readFileSync(file)).digest("hex"))
    hash.update("\0")
  }
  return hash.digest("hex")
}

export function createSandbox() {
  const root = mkdtempSync(join(tmpdir(), "omo-senpi-qa-"))
  const cwd = join(root, "project")
  const agentDir = join(root, "agent")
  const canonicalCwd = realpathSync(root)
  return { root, cwd, agentDir, canonicalCwd: join(canonicalCwd, "project") }
}

export function seedSandbox({ cwd, agentDir, canonicalCwd }) {
  mkdirp(cwd)
  mkdirp(agentDir)
  const settings = {
    defaultProjectTrust: "ask",
    packages: [pluginRoot],
  }
  writeFileSync(join(agentDir, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`)
  writeFileSync(join(agentDir, "trust.json"), `${JSON.stringify({ [canonicalCwd]: true }, null, 2)}\n`)
}

export function resolveCommentCheckerBin() {
  try {
    const require = createRequire(join(repoRoot, "package.json"))
    return require.resolve("@code-yeongyu/comment-checker/cli.js")
  } catch {
    return null
  }
}

function runSelfTest() {
  const sandbox = createSandbox()
  try {
    seedSandbox(sandbox)
    const trust = JSON.parse(readFileSync(join(sandbox.agentDir, "trust.json"), "utf8"))
    if (trust[sandbox.canonicalCwd] !== true) throw new Error("trust.json missing canonical cwd")
    if (sandbox.agentDir === process.env.SENPI_CODING_AGENT_DIR) throw new Error("sandbox reused caller agent dir")
    const before = digestDirectory(join(sandbox.root, "missing"))
    if (before !== "absent") throw new Error("missing directory digest should be absent")
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
}

function runSenpi(senpiBin, sandbox, prompt, script, extraEnv = {}) {
  writeFileSync(join(sandbox.cwd, "mock-script.json"), `${JSON.stringify(script, null, 2)}\n`)
  return spawnSync(senpiBin, ["-e", mockProviderEntry, "-p", "--provider", "omo-mock", "--model", "mock-1", prompt], {
    cwd: sandbox.cwd,
    env: {
      ...process.env,
      ...extraEnv,
      SENPI_CODING_AGENT_DIR: sandbox.agentDir,
      OMO_SENPI_QA: "1",
    },
    encoding: "utf8",
    timeout: 60_000,
  })
}

function main() {
  const providedSenpiCodingAgentDir = process.env.SENPI_CODING_AGENT_DIR ? "IGNORED" : "unset"
  const beforeDigest = digestDirectory(realSenpiAgentDir)
  const sandbox = createSandbox()
  let commentChecker = "NOT-RUN"
  let ultraworkInjected = false
  let result = "FAIL"
  let reason = undefined

  try {
    seedSandbox(sandbox)

    const senpiBin = process.env.SENPI_BIN?.trim() || "senpi"
    if (senpiBin.includes("/") && !existsSync(senpiBin)) {
      result = "SKIP"
      reason = "senpi-binary-unavailable"
      return printResult({ result, reason, ultraworkInjected, commentChecker, beforeDigest, sandbox, providedSenpiCodingAgentDir })
    }

    const resolvedSenpi = senpiBin.includes("/") ? senpiBin : findOnPath(senpiBin)
    if (resolvedSenpi === null) {
      result = "SKIP"
      reason = "senpi-binary-unavailable"
      return printResult({ result, reason, ultraworkInjected, commentChecker, beforeDigest, sandbox, providedSenpiCodingAgentDir })
    }

    const ultrawork = runSenpi(resolvedSenpi, sandbox, "ulw please respond", {
      steps: [{ type: "text", text: "ultrawork scenario complete" }],
    })
    ultraworkInjected = ultrawork.status === 0 && readSandboxText(sandbox.agentDir).includes("<ultrawork-mode>")

    const checkerBin = resolveCommentCheckerBin()
    if (checkerBin === null) {
      commentChecker = "SKIPPED-no-binary"
    } else {
      const checker = runSenpi(
        resolvedSenpi,
        sandbox,
        "write qa slop",
        {
          steps: [
            {
              type: "tool_call",
              name: "write",
              arguments: {
                path: "qa-slop.ts",
                content: "// this function adds two numbers\nexport function add(a: number, b: number) { return a + b }\n",
              },
            },
            { type: "text", text: "done" },
          ],
        },
        { OMO_COMMENT_CHECKER_BIN: checkerBin },
      )
      commentChecker = checker.status === 0 && readSandboxText(sandbox.agentDir).includes(commentCheckerHeader) ? "PASS" : "FAIL"
    }

    result = ultraworkInjected && (commentChecker === "PASS" || commentChecker === "SKIPPED-no-binary") ? "PASS" : "FAIL"
    return printResult({ result, reason, ultraworkInjected, commentChecker, beforeDigest, sandbox, providedSenpiCodingAgentDir })
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
}

function printResult({ result, reason, ultraworkInjected, commentChecker, beforeDigest, sandbox, providedSenpiCodingAgentDir }) {
  const afterDigest = digestDirectory(realSenpiAgentDir)
  const payload = {
    result,
    ...(reason ? { reason } : {}),
    ultraworkInjected,
    commentChecker,
    realSenpiUntouched: beforeDigest === afterDigest,
    providedSenpiCodingAgentDir,
    sandboxAgentDir: sandbox.agentDir,
    sandboxCwd: sandbox.cwd,
  }
  console.log(JSON.stringify(payload))
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

function mkdirp(path) {
  spawnSync("mkdir", ["-p", path])
}

function findOnPath(bin) {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = resolve(dir || ".", bin)
    if (existsSync(candidate)) return candidate
  }
  return null
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) {
    runSelfTest()
    console.log("SELF-TEST OK")
  } else {
    main()
  }
}
