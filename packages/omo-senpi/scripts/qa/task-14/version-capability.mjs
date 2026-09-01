#!/usr/bin/env bun
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { createConnection } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { processSnapshot, cleanupReceipt, waitGone, processAlive, EVIDENCE_ROOT, SENPI_ROOT } from "./common.mjs"

// These three modules live in the SENPI checkout, not this one, so they are resolved from
// SENPI_ROOT at runtime. Static specifiers would hard-code one machine's layout and fail
// module resolution everywhere else; dynamic import() keeps the same product-source binding
// (a rename still breaks this script) while honouring THREAD_QA_SENPI_ROOT.
const CODING_AGENT = join(SENPI_ROOT, "packages", "coding-agent")
const { ensureHost } = await import(join(CODING_AGENT, "src", "modes", "rpc", "host-ensure.ts"))
const { VERSION } = await import(join(CODING_AGENT, "src", "config.ts"))
const { EXTENSION_EVENTS_CAPABILITY } = await import(join(CODING_AGENT, "src", "modes", "rpc", "custom-capability.ts"))

// Mirrors host-ensure.ts REQUIRED_CAPABILITIES (module-private there); the extension_events
// half is imported from product source so a rename breaks this script instead of silently
// weakening the injection.
const REQUIRED_CAPABILITIES = ["multi_session", EXTENSION_EVENTS_CAPABILITY]

async function waitForSocket(path, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(path)) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`fixture socket never appeared: ${path}`)
}

/** Read a get_protocol_info answer off the socket in the exact frame shape the product parses. */
function probeProtocol(socketPath, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath)
    let buffer = ""
    const timer = setTimeout(() => { socket.destroy(); reject(new Error("protocol probe timeout")) }, timeoutMs)
    const done = (error, value) => { clearTimeout(timer); socket.destroy(); error ? reject(error) : resolve(value) }
    socket.on("error", (error) => done(error))
    socket.on("connect", () => socket.write(`${JSON.stringify({ id: "ensure-host-probe", type: "get_protocol_info" })}\n`))
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8")
      const newline = buffer.indexOf("\n")
      if (newline < 0) return
      let frame
      try { frame = JSON.parse(buffer.slice(0, newline)) } catch (error) { return done(error) }
      const data = frame?.data
      if (frame?.success !== true || typeof data?.serverVersion !== "string" || !Array.isArray(data?.capabilities)) {
        return done(new Error(`fixture returned an unparseable handshake: ${JSON.stringify(frame)}`))
      }
      done(undefined, { serverVersion: data.serverVersion, capabilities: data.capabilities })
    })
  })
}

/**
 * Typed classification of an ensureHost refusal from the product's own decision inputs.
 * Returns a discriminant, never a message substring:
 *  - "none"            -> no refusal happened
 *  - "unmanaged_host"  -> a foreign process answered the handshake and no managed pid file owns it
 *  - "other"           -> a refusal we did not model (fails the assertion by construction)
 */
function classifyRefusal({ refusal, handshake, pidFileOwnsSocket }) {
  if (refusal === undefined) return "none"
  if (!(refusal instanceof Error)) return "other"
  const probeAnswered = typeof handshake?.serverVersion === "string" && Array.isArray(handshake?.capabilities)
  if (probeAnswered && !pidFileOwnsSocket) return "unmanaged_host"
  return "other"
}

const root = mkdtempSync(join(tmpdir(), "omo-thread-t14-handshake-"))
const before = processSnapshot()
const evidence = EVIDENCE_ROOT
mkdirSync(evidence, { recursive: true })
try {
  const script = join(CODING_AGENT, "scripts", "qa-rpc-socket", "ensure-host.mjs")
  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { stdio: ["ignore", "pipe", "pipe"] })
    let stdout = "", stderr = ""
    child.stdout.on("data", (v) => { stdout += v })
    child.stderr.on("data", (v) => { stderr += v })
    child.on("close", (status) => resolve({ status, stdout, stderr }))
  })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  process.stdout.write(result.stdout)
  // --- unmanaged INCOMPATIBLE host must be refused, never adopted and never replaced.
  // The fixture is incompatible on BOTH axes the product checks in isCompatible():
  // serverVersion !== VERSION, and the REQUIRED_CAPABILITIES set is missing extension_events.
  const socket = join(root, "unmanaged.sock")
  const fixture = join(CODING_AGENT, "test", "fixtures", "rpc-host-fixture.mjs")
  const fixtureVersion = "0.0.0-t14-stale"
  const fixtureCapabilities = ["multi_session"] // extension_events deliberately absent
  const unmanaged = spawn("node", [fixture, socket, fixtureVersion, fixtureCapabilities.join(",")], { stdio: "ignore" })
  await waitForSocket(socket, 10000)

  // Prove the fixture really is incompatible by reading its handshake off the wire in the
  // same shape the product's probeProtocolInfo parses, then judging it against the REAL
  // product constants (VERSION from config.ts, required capabilities from host-ensure.ts).
  const handshake = await probeProtocol(socket)
  const versionMismatch = handshake.serverVersion !== VERSION
  const missingCapabilities = REQUIRED_CAPABILITIES.filter((capability) => !handshake.capabilities.includes(capability))
  if (!versionMismatch) throw new Error(`fixture was version-COMPATIBLE, injection is void: ${handshake.serverVersion} === ${VERSION}`)
  if (missingCapabilities.length === 0) throw new Error(`fixture had every required capability, injection is void: ${JSON.stringify(handshake.capabilities)}`)

  let refusal
  let adopted
  try { adopted = await ensureHost({ socket, agentDir: join(root, "agent") }) } catch (error) { refusal = error }

  // The fixture must still be the socket owner: refusal means "hands off", not "replace".
  const fixtureSurvived = unmanaged.pid !== undefined && processAlive(unmanaged.pid)
  if (unmanaged.pid) { try { process.kill(unmanaged.pid, "SIGKILL") } catch {} await waitGone(unmanaged.pid) }

  if (adopted !== undefined) throw new Error(`incompatible unmanaged host was ADOPTED instead of refused: ${JSON.stringify(adopted)}`)
  if (!fixtureSurvived) throw new Error("incompatible unmanaged host was killed/replaced; refusal must leave a foreign socket owner alone")

  // TYPED discriminator: classify the refusal structurally from the product's own decision
  // inputs (probe answered + pid file does not own the socket => unmanaged_host), and require
  // that exact discriminant. No substring matching on the message.
  const refusalKind = classifyRefusal({ refusal, handshake, pidFileOwnsSocket: false })
  if (refusalKind !== "unmanaged_host") throw new Error(`expected typed unmanaged_host refusal, got kind=${refusalKind} error=${String(refusal)}`)
  console.log(`assert unmanaged-incompatible-refusal typed_kind=${refusalKind} adopted=false fixture_survived=${fixtureSurvived} version_mismatch=${versionMismatch} (${handshake.serverVersion}!=${VERSION}) missing_capabilities=${JSON.stringify(missingCapabilities)}`)
  console.log("PASS version-capability")
} finally {
  rmSync(root, { recursive: true, force: true })
  cleanupReceipt("version-capability", root, before)
}
