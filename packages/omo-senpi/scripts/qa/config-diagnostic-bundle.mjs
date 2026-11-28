import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

// Exercise the real shipped startup component, not a source import or a string search.
const secret = "sk-test-BUNDLE-DO-NOT-PRINT-0000"
const token = "eyJhbGciOiJub25lIn0.BUNDLE-DO-NOT-PRINT.signature"
const root = mkdtempSync(join(tmpdir(), "config-bundle-security-"))
const previousCwd = process.cwd()
const previousEnv = { ...process.env }
const bundlePath = process.argv[2] ?? new URL("../../plugin/extensions/omo.js", import.meta.url).pathname
const notices = []
try {
  mkdirSync(join(root, ".omo"))
  writeFileSync(join(root, ".omo", "config.jsonc"), JSON.stringify({
    "[opencode]": { provider: { custom: { apiKey: secret } } },
  }))
  writeFileSync(join(root, ".omo", "omo.jsonc"), JSON.stringify({
    "[opencode]": { provider: { custom: { apiKey: token } } },
  }))
  process.chdir(root)
  for (const key of ["HOME", "USERPROFILE", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME"]) process.env[key] = root
  for (const key of ["OMO_CODING_AGENT_DIR", "SENPI_CODING_AGENT_DIR", "PI_CODING_AGENT_DIR"]) process.env[key] = join(root, "agent")
  const bundle = await import(pathToFileURL(bundlePath).href)
  const component = bundle.omoSenpiComponents.find(entry => entry.name === "config-startup")
  assert.ok(component, "shipped config-startup component is present")
  const handlers = []
  await component.register({ on(event, handler) { if (event === "session_start") handlers.push(handler) } }, {
    logger: { info(message) { notices.push(message) }, warn(message) { notices.push(message) }, error(message) { notices.push(message) } },
  })
  assert.equal(handlers.length, 1)
  for (const handler of handlers) await handler({ type: "session_start" }, { ui: { notify(message) { notices.push(message) } } })
  assert.ok(notices.some(message => message.includes("apiKey")), "conflict path must reach actual startup notices")
  for (const credential of [secret, token]) assert.ok(!JSON.stringify(notices).includes(credential), "shipped startup diagnostics disclosed a fake credential")
  assert.equal(JSON.parse(readFileSync(join(root, ".omo", "omo.jsonc"), "utf8"))["[opencode]"].provider.custom.apiKey, token)
  assert.equal(existsSync(join(root, ".omo", ".migration-journal.json")), false)
} finally {
  process.chdir(previousCwd)
  for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key]
  Object.assign(process.env, previousEnv)
  rmSync(root, { recursive: true, force: true })
}
assert.equal(existsSync(root), false)
console.log(JSON.stringify({ verdict: "PASS", surface: "shipped-bundle-startup", keyPathVisible: true, fakeCredentialsAbsent: true, retainedValuePreserved: true, sandboxRemoved: true }))
