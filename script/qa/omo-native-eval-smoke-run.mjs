// One run of the packaged binary in RPC mode against the scripted provider, and readers for what it left in the
// session directory.
import { spawn } from "node:child_process"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { isolatedEnvironment } from "./omo-native-eval-smoke-sandbox.mjs"

export async function drive(sandbox, signal) {
  const child = spawn(sandbox.binary, [
    "--mode", "rpc", "--offline", "--approve", "--no-context-files",
    "--session-dir", sandbox.sessionDir, "-e", sandbox.providerPath,
    "--provider", "openai", "--model", "gpt-5.6-sol",
  ], {
    cwd: sandbox.cwd, env: isolatedEnvironment(sandbox), signal,
    stdio: ["pipe", "pipe", "pipe"],
  })
  let stdout = ""
  let stderr = ""
  let pending = ""
  const result = await new Promise((resolveRun, rejectRun) => {
    const watchdog = setTimeout(() => {
      child.kill("SIGKILL")
      rejectRun(new Error("eval smoke timed out after 120000ms"))
    }, 120_000)
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8")
      stdout += text
      pending += text
      const lines = pending.split("\n")
      pending = lines.pop() ?? ""
      for (const line of lines) {
        if (!line.startsWith("{")) continue
        if (JSON.parse(line).type === "agent_settled") child.stdin.end()
      }
    })
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8") })
    child.stdin.on("error", (error) => {
      if (error.code !== "EPIPE") rejectRun(error)
    })
    child.once("error", (error) => { clearTimeout(watchdog); rejectRun(error) })
    child.once("close", (code, signal) => {
      clearTimeout(watchdog)
      resolveRun({ code, signal })
    })
    child.stdin.write(`${JSON.stringify({ type: "prompt", message: "Run the packaged eval smoke." })}\n`)
  })
  return { ...result, stdout, stderr }
}

export function readEvalResults(sessionDir) {
  return readdirSync(sessionDir).filter((name) => name.endsWith(".jsonl"))
    .flatMap((name) => readFileSync(join(sessionDir, name), "utf8").split("\n"))
    .filter(Boolean).map((line) => JSON.parse(line))
    .filter((record) => record.type === "message").map((record) => record.message)
    .filter((message) => message.role === "toolResult" && message.toolName === "eval")
}

// The large cell's completion notification names the file holding its full output. Records are decoded as JSON
// first, so a Windows path keeps its backslashes, and the path runs to the end of its line (it may contain spaces).
export function largeCellSpill(sessionDir) {
  const texts = readdirSync(sessionDir).filter((name) => name.endsWith(".jsonl"))
    .flatMap((name) => readFileSync(join(sessionDir, name), "utf8").split("\n"))
    .filter(Boolean).flatMap((line) => stringsOf(JSON.parse(line)))
  const notice = texts.find((text) => text.includes("eval-smoke-5") && /[Ff]ull output: /u.test(text))
  const path = notice?.match(/[Ff]ull output: (.+?)\]?[ \t]*$/mu)?.[1]
  if (path === undefined) throw new Error("no completion notification with a full-output path for the large sandbox cell")
  return readFileSync(path, "utf8")
}

function stringsOf(value) {
  if (typeof value === "string") return [value]
  if (value === null || typeof value !== "object") return []
  return Object.values(value).flatMap(stringsOf)
}

export function textOf(message) {
  return message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n")
}
