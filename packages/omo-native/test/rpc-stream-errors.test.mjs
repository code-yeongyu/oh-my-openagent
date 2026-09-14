import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const engineEntry = import.meta.resolve("@code-yeongyu/senpi")
// The source map preserves upstream input even after postinstall prepared the installed JS.
const rpcMap = JSON.parse(readFileSync(new URL("./modes/rpc/rpc-mode.js.map", engineEntry), "utf8"))
const rpcSource = new Bun.Transpiler({ loader: "ts" }).transformSync(rpcMap.sourcesContent[0])
const { toJsonEvent } = await import(new URL("./modes/json-event.js", engineEntry).href)
const patchScript = fileURLToPath(new URL("../bin/senpi-patch.mjs", import.meta.url))
const roots = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function engineFixture() {
  const root = mkdtempSync(join(tmpdir(), "rpc-serializer-test-"))
  roots.push(root)
  const rpcPath = join(root, "dist", "modes", "rpc", "rpc-mode.js")
  mkdirSync(join(root, "dist", "modes", "rpc"), { recursive: true })
  writeFileSync(rpcPath, rpcSource)
  const apiDir = join(root, "node_modules", "@earendil-works", "pi-ai", "dist", "api")
  mkdirSync(apiDir, { recursive: true })
  writeFileSync(join(apiDir, "anthropic-messages.js"), 'const claudeCodeVersion = "2.1.251";\n')
  return { root, rpcPath }
}

function patch(root) {
  const result = spawnSync("node", [patchScript], { env: { ...process.env, OMO_SENPI_PATCH_ROOT: root }, encoding: "utf8" })
  if (result.status !== 0) throw new Error(result.stderr)
}

function sinkFrom(source) {
  const sinkSource = source.match(/const sink = \{[\s\S]*?\n\s*\};/)?.[0]
  if (!sinkSource) throw new Error("upstream RPC sink was not found")
  const output = []
  const shutdowns = []
  const shutdown = Promise.withResolvers()
  const sink = new Function("toJsonEvent", "writeRawStdout", "waitForRawStdoutBackpressure", "shutdown", `${sinkSource}\nreturn sink;`)(
    toJsonEvent, (line) => output.push(JSON.parse(line)), () => Promise.resolve(), (code) => { shutdowns.push(code); shutdown.resolve() },
  )
  return { sink, output, shutdowns, closed: shutdown.promise }
}

const assistant = { role: "assistant", content: [], usage: { totalTokens: 20 } }

describe("installed RPC stream serializer", () => {
  for (const event of [
    { type: "message_update", message: assistant, assistantMessageEvent: { type: "toolcall_start", contentIndex: 0, partial: assistant } },
    { type: "message_update", message: { role: "user", content: "bad" } },
  ]) {
    test(`#given malformed ${event.message.role} stream data #when stdio serializes it #then RPC rejects it and shuts down`, async () => {
      const fixture = engineFixture()
      patch(fixture.root)
      const runtime = sinkFrom(readFileSync(fixture.rpcPath, "utf8"))
      runtime.sink.writeRaw(`${JSON.stringify(event)}\n`)
      await runtime.closed
      expect(runtime.output[0]).toMatchObject({ type: "response", command: "prompt", success: false, errorCode: "invalid_stream_event" })
      expect(runtime.output[0].error.length).toBeGreaterThan(0)
      expect(runtime.shutdowns).toEqual([1])
    })
  }

  test("#given a missing RPC target #when postinstall prepares the engine #then it fails with a named compatibility error", () => {
    const fixture = engineFixture()
    rmSync(fixture.rpcPath)
    expect(() => patch(fixture.root)).toThrow("rpc_patch_target_missing")
  })

  for (const prepared of [false, true]) {
    test(`#given shutdown renamed in ${prepared ? "prepared" : "upstream"} RPC code #when postinstall runs #then it rejects the missing binding`, () => {
      const fixture = engineFixture()
      if (prepared) patch(fixture.root)
      writeFileSync(fixture.rpcPath, readFileSync(fixture.rpcPath, "utf8").replace("async function shutdown(", "async function stopRpc("))
      expect(() => patch(fixture.root)).toThrow("rpc_patch_binding_missing: shutdown")
    })
  }

  for (const binding of [
    { name: "toJsonEvent", from: "import { toJsonEvent }", to: "import { toJsonEvent as serializeEvent }" },
    { name: "value", from: "const value = JSON.parse(line)", to: "const record = JSON.parse(line)" },
  ]) {
    test(`#given ${binding.name} missing from RPC code #when postinstall runs #then it rejects the missing binding`, () => {
      const fixture = engineFixture()
      writeFileSync(fixture.rpcPath, rpcSource.replace(binding.from, binding.to))
      expect(() => patch(fixture.root)).toThrow(`rpc_patch_binding_missing: ${binding.name}`)
    })
  }

  test("#given a valid tool start #when stdio serializes it #then tool metadata is preserved", () => {
    const fixture = engineFixture()
    patch(fixture.root)
    const runtime = sinkFrom(readFileSync(fixture.rpcPath, "utf8"))
    const message = { ...assistant, content: [{ type: "toolCall", id: "call-7", name: "read", arguments: {} }] }
    runtime.sink.writeRaw(`${JSON.stringify({ type: "message_update", message, assistantMessageEvent: { type: "toolcall_start", contentIndex: 0, partial: message } })}\n`)
    expect(runtime.output[0].assistantMessageEvent).toEqual({ type: "toolcall_start", contentIndex: 0, id: "call-7", toolName: "read" })
    expect(runtime.shutdowns).toEqual([])
  })

  test("#given an already prepared runtime #when postinstall runs again #then its bytes stay unchanged", () => {
    const fixture = engineFixture()
    patch(fixture.root)
    const first = readFileSync(fixture.rpcPath, "utf8")
    patch(fixture.root)
    expect(readFileSync(fixture.rpcPath, "utf8")).toBe(first)
  })
})
