#!/usr/bin/env node
import http from "node:http"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { sendSse, textEvents, toolCallEvents, appendLog } from "./fake-openai-events.mjs"
import { branchCounts, latches, selectBranch } from "./fake-openai-branches.mjs"

const requestedPort = Number(process.env.FAKE_OPENAI_PORT ?? 0)
const logFile = process.env.FAKE_LLM_LOG ?? path.join(os.tmpdir(), "fake-llm.log")

let callCount = 0

function logBranch(branch, extra = {}) {
  const now = new Date().toISOString()
  const line = `[${now}] branch=${branch} call=${callCount}${Object.keys(extra).length ? " " + JSON.stringify(extra) : ""}\n`
  appendLog(logFile, line)
  process.stdout.write(line)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on("data", (chunk) => chunks.push(chunk))
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    req.on("error", reject)
  })
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" }).end("ok")
    return
  }

  if (req.method !== "POST" || !req.url?.includes("/responses")) {
    res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "not found" }))
    return
  }

  callCount++
  const raw = await readBody(req)
  let body
  try { body = JSON.parse(raw) } catch { body = {} }

  const inputStr = JSON.stringify(body.input ?? body.messages ?? body)
  const branch = selectBranch(inputStr)
  branchCounts[branch] = (branchCounts[branch] ?? 0) + 1
  logBranch(branch)

  if (branch === "title") {
    sendSse(res, textEvents(callCount, "wake split probe session"))
    return
  }

  if (branch === "child") {
    sendSse(res, textEvents(callCount, "DONE"))
    return
  }

  if (branch === "wake") {
    await sleep(3000)
    sendSse(res, textEvents(callCount, `WAKE_ACK ${callCount}`))
    return
  }

  if (branch === "parent-tool-call") {
    latches.parentToolCallIssued = true
    sendSse(res, toolCallEvents(callCount, "task", `call_agent_${callCount}`, {
      description: "split probe child",
      prompt: "SPLIT_CHILD_TASK: reply exactly DONE",
      subagent_type: "explore",
      run_in_background: true,
      load_skills: [],
    }))
    return
  }

  if (branch === "parent-hold") {
    latches.parentHoldIssued = true
    sendSse(res, toolCallEvents(callCount, "bash", `call_bash_${callCount}`, {
      command: "i=0; while [ $i -lt 8 ]; do i=$((i+1)); sleep 1; done",
      description: "hold turn",
    }))
    return
  }

  if (inputStr.includes("say exactly: TUI_NOREG_OK")) {
    sendSse(res, textEvents(callCount, "TUI_NOREG_OK"))
    return
  }
  sendSse(res, textEvents(callCount, `fake response ${callCount}`))
})

function logFinalCounts() {
  const summary = Object.entries(branchCounts).map(([k, v]) => `${k}=${v}`).join(" ")
  const line = `[${new Date().toISOString()}] FINAL_COUNTS ${summary}\n`
  appendLog(logFile, line)
  process.stdout.write(line)
}

server.listen(requestedPort, "127.0.0.1", () => {
  const addr = server.address()
  const port = typeof addr === "object" && addr !== null ? addr.port : requestedPort
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true })
    appendLog(logFile, `[${new Date().toISOString()}] START port=${port}\n`)
  } catch {}
  process.stdout.write(`fake-openai listening on ${port}\n`)
})

process.on("SIGTERM", () => { logFinalCounts(); server.close(() => process.exit(0)) })
process.on("SIGINT", () => { logFinalCounts(); server.close(() => process.exit(0)) })
