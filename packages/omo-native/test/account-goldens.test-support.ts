import { onTestFinished } from "bun:test"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { buildServiceAuth } from "../../../script/build-service-auth"

export const CANARY = {
  accessToken: "golden-canary-access-token",
  refreshToken: "golden-canary-refresh-token",
  offlineGrant: "golden-canary-offline-grant",
  signingPrivateKey: "golden-canary-signing-private",
  sealingPrivateKey: "golden-canary-sealing-private",
  deviceCode: `dc.golden-canary-device-code-${"x".repeat(17)}`,
} as const

const credential = (deviceId: string, name: string) => ({
  accessToken: CANARY.accessToken,
  accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
  refreshToken: CANARY.refreshToken,
  offlineGrant: CANARY.offlineGrant,
  device: { id: deviceId, name },
})

const STORES = {
  empty: {},
  seeded: {
    "*": JSON.stringify({
      ...credential("seeded-device", "Seeded CLI"),
      signingPrivateKey: CANARY.signingPrivateKey,
      sealingPrivateKey: CANARY.sealingPrivateKey,
    }),
  },
} as const

export type Service = "approve" | "deny" | "expire" | "me-fails" | "machine-exists" | "unreachable"
export type Step = {
  readonly args: readonly string[]
  readonly stdin?: string
}
export type GoldenCase = {
  readonly id: string
  readonly edition: "native" | "opencode"
  readonly accounts: "closed" | "open"
  readonly store: keyof typeof STORES
  readonly service: Service
  readonly helper?: "ready" | "missing"
  readonly steps: readonly Step[]
}
export type Observed = {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
  readonly requests: readonly string[]
  readonly storedDevices: readonly string[]
}

const root = resolve(import.meta.dir, "../../..")
let launcherTree: string | undefined

export async function prepareLauncher(): Promise<void> {
  launcherTree = mkdtempSync(join(tmpdir(), "omo-golden-launcher-"))
  cpSync(join(root, "packages", "omo-native", "bin"), launcherTree, { recursive: true })
  await buildServiceAuth(false, join(launcherTree, "lib", "service-auth.generated.js"))
}

export const removeLauncher = (): void => {
  if (launcherTree !== undefined) rmSync(launcherTree, { recursive: true, force: true })
}

const entryOf = (edition: GoldenCase["edition"]): string => {
  if (edition === "opencode") return join(root, "packages", "omo-opencode", "src", "cli", "index.ts")
  if (launcherTree === undefined) throw new Error("prepareLauncher() first")
  return join(launcherTree, "omo.js")
}

const grant = credential("golden-device", "Golden CLI")
const refusal = (code: string, status = 400) =>
  Response.json({ error: { code, message: "synthetic refusal", retryable: false, requestId: "r" } }, { status })

function fakeService(service: Service, requests: string[]): string {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const path = new URL(request.url).pathname
      requests.push(`${request.method} ${path}`)
      if (service === "unreachable") return new Response("", { status: 503 })
      if (path === "/v1/health") return Response.json({ ok: true })
      if (path === "/v1/device/code")
        return Response.json({
          deviceCode: CANARY.deviceCode,
          userCode: "BCDF-GHJK",
          matchingCode: "482 913",
          verificationUri: "https://signin.omo.dev/device?code=BCDF-GHJK",
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
          intervalSeconds: 1,
        })
      if (path === "/v1/device/token" || path === "/v1/session/exchange") {
        if (service === "deny") return refusal("access_denied")
        if (service === "expire") return refusal("expired_token")
        if (service === "machine-exists")
          return Response.json(
            {
              error: {
                code: "machine_exists",
                message: "synthetic",
                retryable: false,
                requestId: "r",
                detail: { deviceId: "earlier-device", deviceName: "Earlier CLI" },
              },
            },
            { status: 409 },
          )
        return Response.json(grant)
      }
      if (path === "/v1/me")
        return service === "me-fails"
          ? new Response("", { status: 500 })
          : Response.json({ user: { email: "golden@example.com" }, account: { id: "acc-golden" } })
      if (path === "/v1/devices" && request.method === "GET") return Response.json({ devices: [], browsers: [] })
      if (path.startsWith("/v1/devices/") && request.method === "DELETE") return new Response(null, { status: 204 })
      if (path === "/v1/session/refresh") return Response.json(grant)
      return new Response("", { status: 404 })
    },
  })
  onTestFinished(() => server.stop(true))
  return server.url.origin
}

const storedDevices = (file: string): string[] =>
  Object.values(JSON.parse(readFileSync(file, "utf8")) as Record<string, string>).map((value) => {
    try {
      return String((JSON.parse(value) as { device?: { id?: unknown } }).device?.id ?? "unparsed")
    } catch {
      return "unparsed"
    }
  })

function normalize(text: string, api: string, home: string): string {
  return text
    .replaceAll(api, "<api>")
    .replaceAll(realpathSync(home), "<home>")
    .replaceAll(home, "<home>")
    .replaceAll("\\", "/")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, "<time>")
    .replace(/127\.0\.0\.1:\d+/g, "127.0.0.1:<port>")
}

export async function runCase(golden: GoldenCase): Promise<readonly Observed[]> {
  const home = mkdtempSync(join(tmpdir(), "omo-golden-home-"))
  onTestFinished(() => rmSync(home, { recursive: true, force: true }))
  const runtimeDir = join(home, "xdg-run")
  mkdirSync(runtimeDir, { recursive: true })
  const storeFile = join(home, ".golden-store.json")
  writeFileSync(storeFile, JSON.stringify(STORES[golden.store]))
  const observed: Observed[] = []
  for (const step of golden.steps) {
    const requests: string[] = []
    const api = fakeService(golden.service, requests)
    const child = Bun.spawn(
      [
        process.execPath,
        "--preload",
        join(import.meta.dir, "account-goldens.fixture.ts"),
        entryOf(golden.edition),
        ...step.args.map((arg) => (arg === "<api>" ? api : arg)),
      ],
      {
        cwd: home,
        env: {
          PATH: process.env.PATH,
          HOME: home,
          USERPROFILE: home,
          XDG_RUNTIME_DIR: runtimeDir,
          DISPLAY: ":0",
          NO_PROXY: "127.0.0.1",
          OMO_RUNTIME: "bun",
          BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
          OMO_SERVICE_API_URL: api,
          OMO_SERVICE_ACCOUNTS_URL: api,
          OMO_TEST_CREDENTIAL_LOCK_HOME: home,
          GOLDEN_STORE_FILE: storeFile,
          GOLDEN_ACCOUNTS: golden.accounts,
          GOLDEN_HELPER: golden.helper ?? "ready",
        },
        stdin: step.stdin === undefined ? "ignore" : new TextEncoder().encode(step.stdin),
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    onTestFinished(async () => {
      if (child.exitCode === null) child.kill()
      await child.exited
    })
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    observed.push({
      code,
      stdout: normalize(stdout, api, home),
      stderr: normalize(stderr, api, home),
      requests,
      storedDevices: storedDevices(storeFile),
    })
  }
  return observed
}
