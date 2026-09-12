// QA driver for issue #6724.
// mode "default":  McpOAuthProvider.login() with the platform opener dispatched through a
//                  PATH-stubbed xdg-open recorder; the driver then plays the browser by
//                  fetching the recorded URL verbatim and following the 302 into the
//                  loopback callback server.
// mode "injected": runAuthorizationCodeRedirect driven directly with an injected opener seam;
//                  asserts returned authorizationUrl === opener argument byte-for-byte.
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"

const CORE = "/home/viprix/projects/oom-wt-6724/packages/mcp-client-core/src/mcp-oauth"
const RUN_DIR = "/tmp/opencode/issue-6724/run"
const mode = process.argv[2] ?? "default"

if (mode !== "default" && mode !== "injected") {
  console.error(`unknown mode: ${mode}`)
  process.exit(2)
}

mkdirSync(RUN_DIR, { recursive: true })

async function waitForFile(path: string, timeoutMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      return readFileSync(path, "utf8")
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return null
}

function fail(message: string): never {
  console.error(`QA-FAIL: ${message}`)
  process.exit(1)
}

const mockPort = readFileSync("/tmp/opencode/issue-6724/mock-port.txt", "utf8").trim()
const serverUrl = `https://127.0.0.1:${mockPort}/mcp`

if (mode === "default") {
  const { McpOAuthProvider } = await import(`${CORE}/provider.ts`)
  const openUrlFile = `${RUN_DIR}/default-opener-url.txt`

  process.env.OMO_QA_OPEN_URL_FILE = openUrlFile

  const provider = new McpOAuthProvider({ serverUrl })
  const loginPromise = provider.login()

  const openerUrl = await waitForFile(openUrlFile, 10_000)
  if (openerUrl === null) {
    fail("browser opener stub never recorded a URL")
  }
  console.log(`opener-recorded-url: ${openerUrl}`)

  // Play the browser: request the exact recorded URL, then follow the redirect manually.
  const authorizeResponse = await fetch(openerUrl, { redirect: "manual" })
  const location = authorizeResponse.headers.get("location")
  if (authorizeResponse.status !== 302 || location === null) {
    fail(`authorize endpoint did not redirect (status ${authorizeResponse.status})`)
  }
  await fetch(location, { headers: { connection: "close" } }).then((r) => r.arrayBuffer())

  const tokenData = await loginPromise
  if (!tokenData.accessToken.startsWith("qa-access-")) {
    fail("token exchange did not yield the mock access token")
  }

  const stored = provider.tokens()
  if (stored === null || stored.accessToken !== tokenData.accessToken) {
    fail("token was not persisted to the sandboxed config dir")
  }

  const mockReceived = readFileSync("/tmp/opencode/issue-6724/mock-state/authorize-url.txt", "utf8")
  if (mockReceived !== openerUrl) {
    fail(`byte mismatch:\n  opener : ${openerUrl}\n  mock   : ${mockReceived}`)
  }

  const tokenRejected = existsSync("/tmp/opencode/issue-6724/mock-state/token-rejected.json")
  if (tokenRejected) {
    fail("mock token endpoint rejected the exchange")
  }

  console.log("byte-equality opener-vs-mock-received: PASS")
  console.log("callback validated + PKCE token exchange: PASS")
  console.log("token persisted under sandboxed OPENCODE_CONFIG_DIR: PASS")
  console.log("QA-PASS(default-opener)")
  process.exit(0)
}

if (mode === "injected") {
  const { discoverOAuthServerMetadata } = await import(`${CORE}/discovery.ts`)
  const { runAuthorizationCodeRedirect } = await import(`${CORE}/oauth-authorization-flow.ts`)

  const metadata = await discoverOAuthServerMetadata(serverUrl)
  const callbackPort = 19877 + Math.floor(Math.random() * 100)

  let openerArgument: string | null = null
  const result = await runAuthorizationCodeRedirect({
    authorizationEndpoint: metadata.authorizationEndpoint,
    callbackPort,
    clientId: "qa-static-client",
    redirectUri: `http://127.0.0.1:${callbackPort}/callback`,
    scopes: ["mcp:read"],
    resource: metadata.resource,
    openBrowser: async (authorizationUrl) => {
      openerArgument = authorizationUrl
      writeFileSync(`${RUN_DIR}/injected-opener-url.txt`, authorizationUrl)
      const authorizeResponse = await fetch(authorizationUrl, { redirect: "manual" })
      const location = authorizeResponse.headers.get("location")
      if (authorizeResponse.status !== 302 || location === null) {
        fail(`authorize endpoint did not redirect (status ${authorizeResponse.status})`)
      }
      await fetch(location, { headers: { connection: "close" } }).then((r) => r.arrayBuffer())
    },
  })

  if (openerArgument === null) {
    fail("injected opener was never invoked")
  }
  if (result.authorizationUrl !== openerArgument) {
    fail(`byte mismatch:\n  returned: ${result.authorizationUrl}\n  opener  : ${openerArgument}`)
  }
  console.log(`returned authorizationUrl === opener argument (byte-for-byte): PASS`)
  console.log(`callback code accepted, state validated: code=${result.code.slice(0, 8)}... verifierLen=${result.verifier.length}`)
  console.log("QA-PASS(injected-opener)")
  process.exit(0)
}
