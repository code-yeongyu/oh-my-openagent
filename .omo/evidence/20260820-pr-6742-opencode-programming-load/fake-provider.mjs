import http from "node:http"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  sendSse,
  textEvents,
  toolCallEvents,
} from "../../../.agents/skills/opencode-qa/scripts/lib/fake-openai-events.mjs"

const logFile = process.env.FAKE_LLM_LOG ?? path.join(os.tmpdir(), "pr-6742-fake-provider.log")
const expectedPrefix = "Use for writing/editing .py .pyi .rs .ts .tsx .mts .cts .go files or requested reviews of them; not for read-only citation, grep, or non-review analysis."
const legacyTrigger = "MUST USE for ANY work on"
let requestCount = 0

function append(line) {
  fs.appendFileSync(logFile, `${line}\n`)
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    request.on("data", (chunk) => chunks.push(chunk))
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    request.on("error", reject)
  })
}

const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "text/plain" }).end("ok")
    return
  }
  if (request.method !== "POST" || !request.url?.includes("/responses")) {
    response.writeHead(404, { "content-type": "application/json" }).end('{"error":"not found"}')
    return
  }

  requestCount += 1
  const raw = await readBody(request)
  const body = JSON.parse(raw)

  const tools = Array.isArray(body.tools) ? body.tools : []
  const skillTool = tools.find((candidate) => candidate?.name === "skill")
  const serializedInput = JSON.stringify(body.input ?? body)

  if (serializedInput.includes("## Skill: programming")) {
    append("tool_output_returned=true")
    sendSse(response, textEvents(requestCount, "PROGRAMMING_SKILL_LOADED"))
    return
  }

  if (skillTool !== undefined) {
    append(`tool_names=${tools.map((candidate) => candidate?.name ?? candidate?.function?.name ?? "unknown").join(",")}`)
    const description = typeof skillTool?.description === "string" ? skillTool.description : ""
    const lines = description.split("\n")
    const nameIndex = lines.findIndex((line) => line.trim() === "<name>/programming</name>")
    const descriptionLine = nameIndex >= 0 ? lines[nameIndex + 1]?.trim() ?? "" : ""
    const routedDescription = descriptionLine.startsWith("<description>") && descriptionLine.endsWith("</description>")
      ? descriptionLine.slice("<description>".length, -"</description>".length)
      : ""
    const metadataDescription = routedDescription.replace(/^\([^)]*\) /, "")

    append(`skill_tool_present=${skillTool !== undefined}`)
    append(`served_description=${metadataDescription}`)
    append(`description_prefix_match=${metadataDescription.startsWith(expectedPrefix)}`)
    append(`legacy_trigger_present=${description.includes(legacyTrigger)}`)
    append(`description_length=${Buffer.byteLength(metadataDescription, "utf8")}`)
    sendSse(response, toolCallEvents(requestCount, "skill", "call_programming", { name: "programming" }))
    return
  }

  append("auxiliary_request_without_skill_tool=true")
  sendSse(response, textEvents(requestCount, "programming skill probe"))
})

server.listen(0, "127.0.0.1", () => {
  const address = server.address()
  const port = typeof address === "object" && address !== null ? address.port : 0
  fs.writeFileSync(logFile, "")
  process.stdout.write(`fake-provider listening on ${port}\n`)
})
