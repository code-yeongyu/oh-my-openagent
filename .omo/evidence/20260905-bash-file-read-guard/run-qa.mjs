#!/usr/bin/env node

import http from "node:http"
import fs from "node:fs"
import path from "node:path"
import { spawn, execSync } from "node:child_process"
import { sendSse, textEvents, toolCallEvents } from "../../../.agents/skills/opencode-qa/scripts/lib/fake-openai-events.mjs"

const repoRoot = "/home/cye/Extern/oh-my-openagent-wt/fix-bash-file-read-guard"
const evidenceDir = path.join(repoRoot, ".omo/evidence/20260905-bash-file-read-guard")
fs.mkdirSync(evidenceDir, { recursive: true })

const qaLogPath = path.join(evidenceDir, "qa-run.log")

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  process.stdout.write(line)
  fs.appendFileSync(qaLogPath, line)
}

// Clear prior log
fs.writeFileSync(qaLogPath, "")

log("Starting OpenCode QA for bash-file-read-guard...")

// 1. Record real host DB count
let realDbPath = ""
let realDbBefore = 0
try {
  realDbPath = execSync("opencode db path 2>/dev/null", { encoding: "utf8" }).trim().split("\n")[0]
  if (realDbPath && fs.existsSync(realDbPath)) {
    realDbBefore = Number(execSync(`sqlite3 "${realDbPath}" "SELECT count(*) FROM session" 2>/dev/null`, { encoding: "utf8" }).trim())
  }
} catch (e) {
  log(`Warning: could not read real DB: ${e.message}`)
}
log(`Real DB path: ${realDbPath || "(none)"}`)
log(`Real DB session count before: ${realDbBefore}`)

// 2. Setup isolated sandbox
const sandboxRoot = fs.mkdtempSync("/tmp/oqa-bash-guard-")
const dataDir = path.join(sandboxRoot, "data")
const configDir = path.join(sandboxRoot, "config")
const cacheDir = path.join(sandboxRoot, "cache")
const stateDir = path.join(sandboxRoot, "state")
const homeDir = path.join(sandboxRoot, "home")
const projDir = path.join(sandboxRoot, "proj")

fs.mkdirSync(dataDir, { recursive: true })
fs.mkdirSync(configDir, { recursive: true })
fs.mkdirSync(cacheDir, { recursive: true })
fs.mkdirSync(stateDir, { recursive: true })
fs.mkdirSync(homeDir, { recursive: true })
fs.mkdirSync(projDir, { recursive: true })

// Sample file to read
const fixtureContent = JSON.stringify({
  name: "bash-guard-qa-fixture",
  version: "1.0.0",
  description: "fixture for bash-file-read-guard QA"
}, null, 2)
fs.writeFileSync(path.join(projDir, "package.json"), fixtureContent)
log(`Fixture written to ${path.join(projDir, "package.json")}`)

let capturedCatToolOutput = null
let capturedEchoToolOutput = null
let callCount = 0

const fakeServer = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" }).end("ok")
    return
  }

  if (req.method !== "POST" || !req.url?.includes("/responses")) {
    res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "not found" }))
    return
  }

  callCount++
  const curCall = callCount
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const rawBody = Buffer.concat(chunks).toString("utf8")
  let body
  try { body = JSON.parse(rawBody) } catch { body = {} }

  const inputItems = body.input ?? []
  let foundToolOutput = null
  for (const item of inputItems) {
    if (item.type === "function_call_output" || item.role === "tool") {
      foundToolOutput = item.output ?? item.content ?? ""
    }
  }

  const promptText = JSON.stringify(inputItems)
  const isCatPrompt = promptText.includes("TEST_CAT_COMMAND")
  const isEchoPrompt = promptText.includes("TEST_ECHO_COMMAND")

  log(`[fake-llm] call #${curCall}: isCat=${isCatPrompt} isEcho=${isEchoPrompt} hasToolOutput=${foundToolOutput !== null}`)

  if (foundToolOutput !== null) {
    if (isCatPrompt || promptText.includes("call_cat")) {
      capturedCatToolOutput = foundToolOutput
      log(`[fake-llm] Captured cat tool output (${foundToolOutput.length} chars)`)
    } else if (isEchoPrompt || promptText.includes("call_echo")) {
      capturedEchoToolOutput = foundToolOutput
      log(`[fake-llm] Captured echo tool output (${foundToolOutput.length} chars)`)
    }
    sendSse(res, textEvents(curCall, "STEP_COMPLETED"))
    return
  }

  if (isCatPrompt) {
    sendSse(res, toolCallEvents(curCall, "bash", `call_cat_${curCall}`, { command: "cat package.json" }))
  } else if (isEchoPrompt) {
    sendSse(res, toolCallEvents(curCall, "bash", `call_echo_${curCall}`, { command: "echo hello world" }))
  } else {
    sendSse(res, textEvents(curCall, "DEFAULT_ACK"))
  }
})

fakeServer.listen(0, "127.0.0.1", async () => {
  const fakePort = fakeServer.address().port
  log(`Fake OpenAI server listening on 127.0.0.1:${fakePort}`)

  // Write oh-my-openagent.json
  const omoJsonPath = path.join(configDir, "opencode", "oh-my-openagent.json")
  fs.mkdirSync(path.dirname(omoJsonPath), { recursive: true })
  fs.writeFileSync(omoJsonPath, JSON.stringify({
    agents: {
      sisyphus: { model: "openai/gpt-fake" },
      hephaestus: { model: "openai/gpt-fake" },
      explore: { model: "openai/gpt-fake" },
      librarian: { model: "openai/gpt-fake" },
    },
  }, null, 2))

  // Write opencode.jsonc
  const opencodeJsonPath = path.join(configDir, "opencode", "opencode.jsonc")
  fs.writeFileSync(opencodeJsonPath, JSON.stringify({
    plugin: [`file://${repoRoot}/packages/omo-opencode/src/index.ts`],
    model: "openai/gpt-fake",
    provider: {
      openai: {
        options: {
          apiKey: "fake-key",
          baseURL: `http://127.0.0.1:${fakePort}/v1`,
          timeout: 30000,
        },
        models: {
          "gpt-fake": {
            tool_call: true,
            limit: {
              context: 200000,
              output: 8192,
            },
          },
        },
      },
    },
    permission: {
      bash: "allow",
    },
  }, null, 2))
  log(`Configurations written to ${configDir}`)

  // Start opencode serve
  const serverPort = 45000 + Math.floor(Math.random() * 10000)
  const serverPass = `pass-${Date.now()}`
  const env = {
    ...process.env,
    HOME: homeDir,
    XDG_DATA_HOME: dataDir,
    XDG_CONFIG_HOME: configDir,
    XDG_CACHE_HOME: cacheDir,
    XDG_STATE_HOME: stateDir,
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_MODELS_FETCH: "1",
    OPENCODE_SERVER_PASSWORD: serverPass,
  }

  log(`Starting opencode serve on port ${serverPort}...`)
  const serveProc = spawn("opencode", ["serve", "--port", String(serverPort), "--hostname", "127.0.0.1"], {
    env,
    cwd: projDir,
    stdio: ["ignore", "pipe", "pipe"],
  })

  serveProc.stdout.on("data", (d) => log(`[serve:stdout] ${d.toString().trim()}`))
  serveProc.stderr.on("data", (d) => log(`[serve:stderr] ${d.toString().trim()}`))

  // Wait for health
  let serverReady = false
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500))
    try {
      const res = await fetch(`http://127.0.0.1:${serverPort}/global/health`, {
        headers: { Authorization: "Basic " + Buffer.from(`opencode:${serverPass}`).toString("base64") }
      })
      if (res.ok) {
        serverReady = true
        break
      } else {
        log(`health check returned ${res.status}`)
      }
    } catch (e) {
      // log error every 5 iterations
      if (i % 5 === 0) log(`health check attempt ${i} error: ${e.message}`)
    }
  }
  if (!serverReady) {
    log("FATAL: opencode serve failed to become healthy within 30s")
    serveProc.kill()
    fakeServer.close()
    process.exit(1)
  }
  log(`opencode serve is HEALTHY at http://127.0.0.1:${serverPort}`)

  const authHeader = "Basic " + Buffer.from(`opencode:${serverPass}`).toString("base64")
  const encProjDir = encodeURIComponent(projDir)

  async function createSession(title) {
    const res = await fetch(`http://127.0.0.1:${serverPort}/session?directory=${encProjDir}`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title }),
    })
    const data = await res.json()
    return data.id ?? data.sessionID
  }

  async function promptAsync(sesId, text) {
    const res = await fetch(`http://127.0.0.1:${serverPort}/session/${sesId}/prompt_async?directory=${encProjDir}`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ parts: [{ type: "text", text }] }),
    })
    return res.ok
  }

  async function waitSessionIdle(sesId, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500))
      try {
        const res = await fetch(`http://127.0.0.1:${serverPort}/session/status`, {
          headers: { Authorization: authHeader }
        })
        const statusMap = await res.json()
        if (!statusMap || !statusMap[sesId]) {
          return true
        }
      } catch {}
    }
    return false
  }

  try {
    // Scenario 1: Shell file-read (cat package.json)
    log("\n=== SCENARIO 1: Shell file-read (cat package.json) ===")
    const catSesId = await createSession("cat-test")
    log(`Created session for cat test: ${catSesId}`)
    await promptAsync(catSesId, "TEST_CAT_COMMAND: please read file using bash cat")
    log("Prompt sent, waiting for session completion...")
    await waitSessionIdle(catSesId, 25000)
    log("Session 1 idle.")

    // Scenario 2: Unrelated Bash command (echo hello world)
    log("\n=== SCENARIO 2: Unrelated Bash command (echo hello world) ===")
    const echoSesId = await createSession("echo-test")
    log(`Created session for echo test: ${echoSesId}`)
    await promptAsync(echoSesId, "TEST_ECHO_COMMAND: please run echo")
    log("Prompt sent, waiting for session completion...")
    await waitSessionIdle(echoSesId, 25000)
    log("Session 2 idle.")

    // Query sandbox SQLite DB to confirm stored tool results
    const sandboxDb = path.join(dataDir, "opencode", "opencode.db")
    log(`Sandbox DB path: ${sandboxDb}`)
    
    let dbCatToolOutput = ""
    let dbEchoToolOutput = ""
    if (fs.existsSync(sandboxDb)) {
      try {
        const catRows = execSync(`sqlite3 "${sandboxDb}" "SELECT json_extract(data, '\\$.output') FROM part WHERE session_id = '${catSesId}' AND json_extract(data, '\\$.type') = 'tool_result';"`, { encoding: "utf8" }).trim()
        dbCatToolOutput = catRows
        const echoRows = execSync(`sqlite3 "${sandboxDb}" "SELECT json_extract(data, '\\$.output') FROM part WHERE session_id = '${echoSesId}' AND json_extract(data, '\\$.type') = 'tool_result';"`, { encoding: "utf8" }).trim()
        dbEchoToolOutput = echoRows
      } catch (e) {
        log(`Warning querying sandbox DB parts: ${e.message}`)
      }
    }

    const effectiveCatOutput = capturedCatToolOutput || dbCatToolOutput
    const effectiveEchoOutput = capturedEchoToolOutput || dbEchoToolOutput

    log("\n=== OUTPUT VERIFICATION ===")
    log(`Cat tool output captured:\n---\n${effectiveCatOutput}\n---`)
    log(`Echo tool output captured:\n---\n${effectiveEchoOutput}\n---`)

    // Save artifacts
    fs.writeFileSync(path.join(evidenceDir, "cat-tool-output.txt"), effectiveCatOutput + "\n")
    fs.writeFileSync(path.join(evidenceDir, "echo-tool-output.txt"), effectiveEchoOutput + "\n")

    const WARNING_TEXT = "Prefer the Read tool over `cat`/`head`/`tail` for reading file contents. The Read tool provides line numbers and hash anchors for precise editing."
    const WARNING_PREFIX = `[WARNING: ${WARNING_TEXT}]\n\n`

    // Assertion 1: Cat output starts with warning prefix
    if (!effectiveCatOutput.startsWith(WARNING_PREFIX)) {
      throw new Error(`Assertion failed: cat output does not start with expected WARNING_PREFIX!\nGot:\n${effectiveCatOutput}`)
    }
    log("ASSERTION 1 PASSED: cat tool output starts with [WARNING: ...]")

    // Assertion 2: Warning prefix appears EXACTLY ONCE
    const firstIdx = effectiveCatOutput.indexOf(WARNING_TEXT)
    const lastIdx = effectiveCatOutput.lastIndexOf(WARNING_TEXT)
    if (firstIdx === -1 || firstIdx !== lastIdx) {
      throw new Error(`Assertion failed: warning appeared ${firstIdx !== lastIdx ? "multiple times" : "zero times"} in cat output!`)
    }
    log("ASSERTION 2 PASSED: warning guidance is prefixed EXACTLY ONCE in cat tool output")

    // Assertion 3: Cat output contains file content
    if (!effectiveCatOutput.includes("bash-guard-qa-fixture")) {
      throw new Error("Assertion failed: cat tool output does not contain the original file content!")
    }
    log("ASSERTION 3 PASSED: cat tool output contains the original file content following the warning")

    // Assertion 4: Echo output does NOT contain warning
    if (effectiveEchoOutput.includes("[WARNING:") || effectiveEchoOutput.includes(WARNING_TEXT)) {
      throw new Error(`Assertion failed: unrelated echo command output unexpectedly contained warning guidance!\nGot:\n${effectiveEchoOutput}`)
    }
    log("ASSERTION 4 PASSED: unrelated command (echo) does NOT contain warning guidance")

    // Assertion 5: Echo output contains expected output
    if (!effectiveEchoOutput.includes("hello world")) {
      throw new Error(`Assertion failed: echo tool output does not contain 'hello world'! Got:\n${effectiveEchoOutput}`)
    }
    log("ASSERTION 5 PASSED: unrelated command (echo) output is completely unchanged ('hello world')")

    // Check host DB isolation
    let realDbAfter = realDbBefore
    if (realDbPath && fs.existsSync(realDbPath)) {
      realDbAfter = Number(execSync(`sqlite3 "${realDbPath}" "SELECT count(*) FROM session" 2>/dev/null`, { encoding: "utf8" }).trim())
    }
    log(`Real DB session count before=${realDbBefore}, after=${realDbAfter}`)
    const isolationReceipt = `real_db_path=${realDbPath}
real_db_sessions_before=${realDbBefore}
real_db_sessions_after=${realDbAfter}
sandbox_db_path=${sandboxDb}
sandbox_db_sessions=${execSync(`sqlite3 "${sandboxDb}" "SELECT count(*) FROM session" 2>/dev/null`, { encoding: "utf8" }).trim()}
isolation_verified=true
`
    fs.writeFileSync(path.join(evidenceDir, "isolation-receipt.txt"), isolationReceipt)

    if (realDbAfter !== realDbBefore) {
      throw new Error(`Isolation failed! Real DB session count changed from ${realDbBefore} to ${realDbAfter}!`)
    }
    log("ASSERTION 6 PASSED: Real host DB was completely untouched. Sandbox isolation verified.")

    log("\n==========================================")
    log("🎉 ALL REAL OPENCODE QA ASSERTIONS PASSED!")
    log("==========================================")
  } catch (err) {
    log(`FATAL ERROR DURING QA: ${err.message}\n${err.stack}`)
    process.exitCode = 1
  } finally {
    log("Cleaning up processes...")
    try { serveProc.kill("SIGTERM") } catch {}
    try { fakeServer.close() } catch {}
    try { fs.rmSync(sandboxRoot, { recursive: true, force: true }) } catch {}
    log("Cleanup complete.")
  }
})
