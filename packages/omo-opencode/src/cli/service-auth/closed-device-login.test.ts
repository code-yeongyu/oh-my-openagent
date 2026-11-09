import { expect, onTestFinished, test } from "bun:test"
import { join, resolve } from "node:path"
import { trustLaunchKind } from "../../../../omo-native/compile-args"
import { SERVICE_ACCOUNTS_CLOSED_MESSAGE } from "./commands"
import { fakeApi, minted, temporaryHome } from "./test-support"

// #12639: while accounts are closed, the device-code sign-in (`login --device`, `login --no-browser`) is the one terminal
// sign-in a computer with no browser or desktop app has. The npm launcher (which dispatches through the committed
// service-auth bundle) runs the device flow end to end; the compiled entry hands it past its static refusal
// (trustLaunchKind), after which it re-runs the same command in a fresh process, so that half is proved at its own seam.
// Every other closed service-account argv keeps refusing (accounts-closed.test.ts).
const root = resolve(import.meta.dir, "../../../../..")
const launcher = join(root, "packages", "omo-native", "bin", "omo.js")
const deviceLogins = [["login", "--device"], ["login", "--no-browser"]] as const

async function run(entry: string, args: readonly string[]) {
  const home = await temporaryHome()
  const paths: string[] = []
  const api = fakeApi(request => {
    const path = new URL(request.url).pathname
    paths.push(path)
    if (path === "/v1/health") return Response.json({ ok: true })
    if (path === "/v1/device/code") return Response.json({ ...minted, expiresAt: new Date(Date.now() + 300_000).toISOString(), intervalSeconds: 1 })
    if (path === "/v1/device/token") {
      return Response.json({ error: { code: "access_denied", message: "denied", retryable: false, requestId: "r" } }, { status: 400 })
    }
    return new Response("", { status: 404 })
  })
  const child = Bun.spawn(
    [process.execPath, "--preload", join(import.meta.dir, "closed-device-login.fixture.ts"), entry, ...args],
    {
      cwd: home,
      env: {
        PATH: process.env.PATH, HOME: home, USERPROFILE: home, OMO_RUNTIME: "bun", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
        OMO_SERVICE_API_URL: api, OMO_SERVICE_ACCOUNTS_URL: api,
      },
      stdin: "ignore", stdout: "pipe", stderr: "pipe",
    },
  )
  onTestFinished(async () => { if (child.exitCode === null) child.kill(); await child.exited })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ])
  return { stdout, stderr, code, paths }
}

{
  test.each(deviceLogins.map(args => [args.join(" "), args] as const))(
    `#given accounts are closed #when the launcher runs omo %s #then it runs the device flow and stores nothing on a denial`,
    async (_argv, args) => {
      const result = await run(launcher, args)
      expect(result.stdout).toContain(`User code: ${minted.userCode}`)
      expect(result.stdout).toContain(`Matching code: ${minted.matchingCode}`)
      expect(result.paths).toContain("/v1/device/code")
      expect(result.paths).toContain("/v1/device/token")
      expect(result.stderr).not.toContain(SERVICE_ACCOUNTS_CLOSED_MESSAGE)
      expect(result.stderr).not.toContain("KEYSTORE_WRITE")
      expect(result.code).toBe(1)
    },
    60_000,
  )
}

test("#given accounts are closed #then only the device-code login leaves the static refusal", () => {
  expect(deviceLogins.map(args => trustLaunchKind(args))).toEqual(["one-shot-network", "one-shot-network"])
  expect([
    ["login"], ["login", "--accounts", "https://example.invalid"], ["login", "--help"], ["logout"], ["whoami"], ["whoami", "--device"],
  ].map(args => trustLaunchKind(args))).toEqual(Array(6).fill("static"))
})

// #12646: the compiled entry classifies a closed `login` with the same option parse commands.ts runs, so an argv the
// command refuses is a static refusal at the entry as well, and an argv the command runs is not.
test.each([
  [["login", "--device"], "one-shot-network"],
  [["login", "--no-browser"], "one-shot-network"],
  [["login", "--api", "https://example.invalid", "--device"], "one-shot-network"],
  [["login", "--device", "--api", "https://example.invalid"], "one-shot-network"],
  [["login", "--", "--device"], "static"],
  [["login", "--accounts", "https://example.invalid", "--device"], "static"],
  [["login", "--accounts", "--device"], "static"],
  [["login", "extra", "--device"], "static"],
  [["login", "--api"], "static"],
  [["login"], "static"],
  [["login", "--help"], "static"],
] as const)("#given accounts are closed #when the compiled entry classifies omo %j #then it is %s", (args, kind) => {
  expect(trustLaunchKind(args)).toBe(kind)
})
