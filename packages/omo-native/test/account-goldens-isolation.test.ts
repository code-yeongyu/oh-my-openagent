import { afterAll, beforeAll, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type CaseRun, cleanUp, prepareLauncher, runAll } from "./account-goldens.test-support"

// The controls for the account goldens' fixture (account-goldens.fixture.ts): it must fail closed. A real entry given a
// non-local account service origin, a direct request to a non-local host, and a sign-in callback that is not on the
// loopback address are each refused before anything leaves the process, and each refusal is recorded.

const NON_LOCAL = "https://api.example.invalid"
let runs: ReadonlyMap<string, CaseRun> = new Map()

beforeAll(async () => {
  await prepareLauncher()
  runs = await runAll([
    {
      id: "native-sign-in",
      edition: "native",
      accounts: "closed",
      store: "empty",
      service: "approve",
      origin: NON_LOCAL,
      steps: [{ args: ["account", "sign-in"] }],
    },
    {
      id: "opencode-whoami",
      edition: "opencode",
      accounts: "closed",
      store: "seeded",
      service: "approve",
      origin: NON_LOCAL,
      steps: [{ args: ["whoami"] }],
    },
  ])
}, 300_000)

afterAll(cleanUp)

test.each(["native-sign-in", "opencode-whoami"])(
  "#given an entry handed a non-local account service origin #when %s runs #then every request to it is refused and recorded",
  (id) => {
    const refused = runs.get(id)?.refused ?? []
    expect(refused.length).toBeGreaterThan(0)
    expect(new Set(refused)).toEqual(new Set([NON_LOCAL]))
  },
)

const PROBE = `
const outcomes = []
const attempt = async (name, run) => {
  try { await run(); outcomes.push([name, "passed"]) } catch (error) { outcomes.push([name, String(error.message)]) }
}
await attempt("fetch", () => fetch("https://elsewhere.example/x"))
await attempt("https.get", () => new Promise((resolve, reject) => require("node:https").get("https://elsewhere.example/y", resolve).on("error", reject)))
await attempt("http.request", () => new Promise((resolve, reject) => { const request = require("node:http").request({ hostname: "10.0.0.1", port: 80 }, resolve); request.on("error", reject); request.end() }))
await attempt("opener", () => new Promise((resolve, reject) => require("node:child_process").execFile(process.platform === "darwin" ? "/usr/bin/open" : "xdg-open", ["https://signin.example/?redirect_uri=https%3A%2F%2Fcallback.example%2Fcallback&state=s"], {}, (error) => (error ? reject(error) : resolve(undefined)))))
console.log(JSON.stringify(outcomes))
`

test("#given the fixture #when a probe requests non-local hosts and hands the opener a non-local callback #then each is refused before it leaves and recorded", async () => {
  const home = mkdtempSync(join(tmpdir(), "omo-golden-isolation-"))
  try {
    writeFileSync(join(home, ".golden-store.json"), "{}")
    const child = Bun.spawn(
      [process.execPath, "--preload", join(import.meta.dir, "account-goldens.fixture.ts"), "-e", PROBE],
      {
        cwd: home,
        env: {
          PATH: process.env.PATH,
          HOME: home,
          GOLDEN_STORE_FILE: join(home, ".golden-store.json"),
          OMO_TEST_RUN: "1",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited])
    expect(code).toBe(0)
    expect(JSON.parse(stdout.trim())).toEqual([
      ["fetch", "account goldens: only the loopback address is reachable"],
      ["https.get", "account goldens: only the loopback address is reachable"],
      ["http.request", "account goldens: only the loopback address is reachable"],
      ["opener", "account goldens: the callback is not a loopback address"],
    ])
    const refusedFile = join(home, ".golden-refused")
    expect(existsSync(refusedFile)).toBe(true)
    expect(readFileSync(refusedFile, "utf8").trim().split("\n")).toEqual([
      "https://elsewhere.example",
      "https://elsewhere.example",
      "http://10.0.0.1",
      "https://callback.example",
    ])
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
