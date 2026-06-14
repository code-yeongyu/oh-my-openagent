#!/usr/bin/env node
import http from "node:http"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { appendLog, sendSse, textEvents, toolCallEvents } from "../../../.agents/skills/opencode-qa/scripts/lib/fake-openai-events.mjs"
import { hasToolResult } from "../../../.agents/skills/opencode-qa/scripts/lib/fake-openai-branches.mjs"

const requestedPort = Number(process.env.FAKE_OPENAI_PORT ?? 0)
const logFile = process.env.FAKE_LLM_LOG ?? path.join(os.tmpdir(), "fake-llm-team-create.log")

let callCount = 0
let teamCreateIssued = false
let teamListIssued = false

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

  if (inputStr.includes("Generate a title")) {
    logBranch("title")
    sendSse(res, textEvents(callCount, "team_create empty lead QA"))
    return
  }

  if (inputStr.includes("TEAM_CREATE_EMPTY_LEAD_QA") && !hasToolResult(inputStr) && !teamCreateIssued) {
    teamCreateIssued = true
    logBranch("team_create")
    sendSse(res, toolCallEvents(callCount, "team_create", `call_team_create_${callCount}`, {
      inline_spec: {
        name: "team-create-empty-lead-qa",
        lead: {
          kind: "category",
          category: "",
          subagent_type: "",
          prompt: "",
          loadSkills: [],
        },
        members: [
          {
            name: "worker",
            kind: "category",
            category: "quick",
            prompt: "Reply DONE",
            loadSkills: [],
          },
        ],
      },
    }))
    return
  }

  if (inputStr.includes("TEAM_CREATE_EMPTY_LEAD_QA") && hasToolResult(inputStr) && !teamListIssued) {
    teamListIssued = true
    logBranch("team_list")
    sendSse(res, toolCallEvents(callCount, "team_list", `call_team_list_${callCount}`, {
      scope: "all",
    }))
    return
  }

  if (inputStr.includes("Reply DONE")) {
    logBranch("child")
    sendSse(res, textEvents(callCount, "DONE"))
    return
  }

  logBranch("final")
  sendSse(res, textEvents(callCount, "TEAM_CREATE_QA_DONE"))
})

function logFinalCounts() {
  const line = `[${new Date().toISOString()}] FINAL teamCreateIssued=${teamCreateIssued} teamListIssued=${teamListIssued}\n`
  appendLog(logFile, line)
  process.stdout.write(line)
}

server.listen(requestedPort, "127.0.0.1", () => {
  const addr = server.address()
  const port = typeof addr === "object" && addr !== null ? addr.port : requestedPort
  fs.mkdirSync(path.dirname(logFile), { recursive: true })
  appendLog(logFile, `[${new Date().toISOString()}] START port=${port}\n`)
  process.stdout.write(`fake-openai listening on ${port}\n`)
})

process.on("SIGTERM", () => { logFinalCounts(); server.close(() => process.exit(0)) })
process.on("SIGINT", () => { logFinalCounts(); server.close(() => process.exit(0)) })
