#!/usr/bin/env bun
// Live macOS measurement for computer-use v2 row 9 (P8). Nothing here turns a gate on: it records facts for the
// follow-up PR that decides whether a missing replayd approval refuses captures.
//
//   consent  Reads ~/Library/Group Containers/group.com.apple.replayd/ScreenCaptureApprovals.plist from a child
//            process and records present|absent|unreadable, how long the read took, and a screenshot taken while a
//            read still blocks (a TCC prompt holds the read open). When present, it lists the plist's keys (bundle
//            ids, never values) next to this terminal's own bundle id. With --engine it also runs the engine's own
//            probe (SENPI_DESKTOP_CAPTURE_CONSENT_PROBE=1) and records the line the engine logged.
//   bench    With --engine and --window <id>: 30 warm window captures through `--stdio` with SkyLight resolving,
//            then 30 with SENPI_DESKTOP_DISABLE_SKYLIGHT=1 (the ScreenCaptureKit route); p50/p95 per route and the
//            route lines the engine logged. The last SkyLight frame is written as live.png and checked opaque.
//
// Start it from the GUI Terminal that holds Screen Recording (the engine refuses a disclaimed launch).
// Usage: bun capture-consent-probe-macos.mjs --evidence-dir <dir> [--engine <path>] [--window <id>] [--runs 30]
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { inflateSync } from "node:zlib"

import { withTelemetryOptOut } from "./telemetry-opt-out-env.mjs"

const APPROVALS = join(homedir(), "Library/Group Containers/group.com.apple.replayd/ScreenCaptureApprovals.plist")
const BLOCKED_AFTER_MS = 1500

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

const evidenceDir = argValue("--evidence-dir")
const enginePath = argValue("--engine")
const windowId = argValue("--window")
const runs = Number(argValue("--runs") ?? 30)

if (process.platform !== "darwin") {
  console.log(JSON.stringify({ verdict: "SKIP", reason: "macOS only; this is not a pass" }))
  process.exit(1)
}
if (evidenceDir === undefined) {
  console.log(JSON.stringify({ verdict: "FAIL", reason: "--evidence-dir is required" }))
  process.exit(1)
}
mkdirSync(evidenceDir, { recursive: true })

const text = (command, args) =>
  spawnSync(command, args, { encoding: "utf8", env: withTelemetryOptOut(process.env) }).stdout?.trim() ?? ""

// The read runs in a child so a prompt that blocks it can be photographed instead of hanging this script.
async function measureRead() {
  const started = Date.now()
  const child = spawn(
    process.execPath,
    [
      "-e",
      `const fs=require("node:fs");try{fs.readFileSync(${JSON.stringify(APPROVALS)});console.log("present")}catch(e){console.log(e.code==="ENOENT"?"absent":"unreadable:"+e.code)}`,
    ],
    { env: withTelemetryOptOut(process.env) },
  )
  let out = ""
  child.stdout.on("data", (chunk) => {
    out += chunk
  })
  let blockedShot
  const timer = setTimeout(() => {
    blockedShot = join(evidenceDir, "consent-read-blocked.png")
    spawnSync("screencapture", ["-x", blockedShot])
  }, BLOCKED_AFTER_MS)
  await new Promise((resolveExit) => child.on("exit", resolveExit))
  clearTimeout(timer)
  return { outcome: out.trim(), elapsedMs: Date.now() - started, blockedShot: blockedShot ?? null }
}

function plistKeys() {
  const parsed = spawnSync("plutil", ["-convert", "json", "-o", "-", APPROVALS], { encoding: "utf8" })
  if (parsed.status !== 0) return { error: parsed.stderr.trim() }
  const walk = (value, depth) =>
    value !== null && typeof value === "object" && depth < 3
      ? Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, walk(inner, depth + 1)]))
      : typeof value
  return { keys: walk(JSON.parse(parsed.stdout), 0) }
}

// One `--stdio` engine; `call` resolves with the reply to the request it sent.
function startEngine(env) {
  const child = spawn(enginePath, ["--stdio"], { env: withTelemetryOptOut({ ...process.env, ...env }) })
  let buffered = ""
  let stderr = ""
  const pending = new Map()
  child.stderr.on("data", (chunk) => {
    stderr += chunk
  })
  child.stdout.on("data", (chunk) => {
    buffered += chunk
    const lines = buffered.split("\n")
    buffered = lines.pop() ?? ""
    for (const line of lines) {
      if (line.trim() === "") continue
      const message = JSON.parse(line)
      pending.get(message.id)?.(message)
      pending.delete(message.id)
    }
  })
  let next = 1
  const call = (method, params = {}) =>
    new Promise((resolveCall) => {
      const id = next++
      pending.set(id, resolveCall)
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`)
    })
  return { call, stderr: () => stderr, close: () => child.kill("SIGTERM") }
}

const routes = (stderr) =>
  [...stderr.matchAll(/capture: (route=\w+|replayd consent=\w+[^\n]*|SkyLight[^\n]*)/g)].map((m) => m[1])

function percentile(samples, fraction) {
  const sorted = [...samples].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)]
}

// Minimal PNG reader: true when any pixel has non-zero alpha (or the image has no alpha channel);
// null when the bytes are not a PNG (the engine fell back to inline-jpeg), so the check cannot pass by accident.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
function pngHasOpaquePixel(png) {
  if (png.length < 8 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) return null
  let offset = 8
  let width = 0
  let colorType = 0
  const idat = []
  while (offset < png.length) {
    const length = png.readUInt32BE(offset)
    const type = png.toString("ascii", offset + 4, offset + 8)
    const data = png.subarray(offset + 8, offset + 8 + length)
    if (type === "IHDR") {
      width = data.readUInt32BE(0)
      colorType = data[9]
      if (data[8] !== 8 || data[12] !== 0) throw new Error("only 8-bit non-interlaced PNG is supported")
    }
    if (type === "IDAT") idat.push(data)
    offset += 12 + length
  }
  if (colorType !== 6) return true
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * 4
  let previous = Buffer.alloc(stride)
  for (let row = 0; row * (stride + 1) < raw.length; row += 1) {
    const filter = raw[row * (stride + 1)]
    const line = Buffer.from(raw.subarray(row * (stride + 1) + 1, (row + 1) * (stride + 1)))
    for (let i = 0; i < stride; i += 1) {
      const left = i >= 4 ? line[i - 4] : 0
      const up = previous[i]
      const upLeft = i >= 4 ? previous[i - 4] : 0
      const p = left + up - upLeft
      const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)]
      const paeth = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft
      const add = [0, left, up, (left + up) >> 1, paeth][filter]
      line[i] = (line[i] + add) & 0xff
      if (i % 4 === 3 && line[i] !== 0) return true
    }
    previous = line
  }
  return false
}

async function bench(env, label) {
  const engine = startEngine(env)
  await engine.call("session.open")
  const samples = []
  let last
  let error
  for (let run = 0; run <= runs; run += 1) {
    const started = performance.now()
    const reply = await engine.call("capture", { target: windowId })
    const elapsed = performance.now() - started
    if (reply.error !== undefined) {
      error = reply.error
      break
    }
    if (run > 0) samples.push(elapsed)
    last = reply.result
  }
  engine.close()
  return {
    label,
    runs: samples.length,
    p50Ms: samples.length > 0 ? Number(percentile(samples, 0.5).toFixed(1)) : null,
    p95Ms: samples.length > 0 ? Number(percentile(samples, 0.95).toFixed(1)) : null,
    error: error ?? null,
    routes: [...new Set(routes(engine.stderr()))],
    png: last?.data === undefined ? undefined : Buffer.from(last.data, "base64"),
    frame:
      last === undefined
        ? null
        : {
            width: last.width,
            height: last.height,
            sourceWidth: last.sourceWidth,
            sourceHeight: last.sourceHeight,
            scale: last.displays?.[0]?.scale ?? null,
          },
  }
}

const report = {
  macos: text("sw_vers", ["-productVersion"]),
  terminalBundleId: process.env.__CFBundleIdentifier ?? null,
  approvalsPath: APPROVALS,
  read: await measureRead(),
}
report.read.promptLikely = report.read.elapsedMs >= BLOCKED_AFTER_MS
if (report.read.outcome === "present") report.plist = plistKeys()
if (enginePath !== undefined && existsSync(enginePath)) {
  const engine = startEngine({ SENPI_DESKTOP_CAPTURE_CONSENT_PROBE: "1" })
  await engine.call("session.open")
  const reply = await engine.call("capture", { target: "desktop", caps: { maxWidth: 320 } })
  engine.close()
  report.engine = { captureError: reply.error ?? null, logged: routes(engine.stderr()) }
}
writeFileSync(join(evidenceDir, "consent-probe.txt"), `${JSON.stringify(report, null, 2)}\n`)

let verdict = "PASS"
if (enginePath !== undefined && windowId !== undefined) {
  const skylight = await bench({}, "skylight-first")
  const sck = await bench({ SENPI_DESKTOP_DISABLE_SKYLIGHT: "1" }, "sck (SENPI_DESKTOP_DISABLE_SKYLIGHT=1)")
  let opaque = null
  if (skylight.png !== undefined) {
    writeFileSync(join(evidenceDir, "live.png"), skylight.png)
    opaque = pngHasOpaquePixel(skylight.png)
  }
  const lines = [skylight, sck].map(
    ({ label, runs: count, p50Ms, p95Ms, error, routes: logged }) =>
      `${label}: runs=${count} p50=${p50Ms}ms p95=${p95Ms}ms error=${JSON.stringify(error)} logged=${JSON.stringify(logged)}`,
  )
  lines.push(`window=${windowId} macos=${report.macos} live.png opaque=${opaque === null ? "not-a-png" : opaque}`)
  if (skylight.frame !== null) {
    const { width, height, sourceWidth, sourceHeight, scale } = skylight.frame
    const expected = scale === null ? null : `${Math.round(sourceWidth * scale)}x${Math.round(sourceHeight * scale)}`
    lines.push(
      `skylight frame=${width}x${height} source=${sourceWidth}x${sourceHeight} scale=${scale} expected=${expected} matches=${expected === null ? "unknown" : expected === `${width}x${height}`}`,
    )
  }
  writeFileSync(join(evidenceDir, "bench.txt"), `${lines.join("\n")}\n`)
  if (skylight.error !== null || sck.error !== null || opaque !== true) verdict = "FAIL"
}
console.log(JSON.stringify({ verdict, evidenceDir, read: report.read, engine: report.engine ?? null }, null, 2))
process.exit(verdict === "PASS" ? 0 : 1)
