// Negative control: prove the mock token endpoint genuinely validates PKCE.
// Performs authorize with a challenge derived from verifier A, then exchanges with verifier B.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
import { createHash, randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"

const mockPort = readFileSync("/tmp/opencode/issue-6724/mock-port.txt", "utf8").trim()
const base = `https://127.0.0.1:${mockPort}`

const registerResponse = await fetch(`${base}/register`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ redirect_uris: ["http://127.0.0.1:19999/callback"], client_name: "qa-negative" }),
})
const { client_id: clientId } = (await registerResponse.json()) as { client_id: string }

const verifierA = randomBytes(32).toString("base64url")
const verifierB = randomBytes(32).toString("base64url")
const challengeA = createHash("sha256").update(verifierA).digest("base64url")

const authorizeUrl =
  `${base}/authorize?response_type=code&client_id=${clientId}` +
  `&redirect_uri=${encodeURIComponent("http://127.0.0.1:19999/callback")}` +
  `&code_challenge=${challengeA}&code_challenge_method=S256&state=negative-control`
const authorizeResponse = await fetch(authorizeUrl, { redirect: "manual" })
const location = authorizeResponse.headers.get("location") ?? ""
const code = new URL(location).searchParams.get("code") ?? ""

const tokenResponse = await fetch(`${base}/token`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: "http://127.0.0.1:19999/callback",
    client_id: clientId,
    code_verifier: verifierB,
  }).toString(),
})

if (tokenResponse.status === 400) {
  console.log("negative-control: token endpoint rejected wrong PKCE verifier as expected: PASS")
  process.exit(0)
}
console.error(`negative-control FAILED: expected 400, got ${tokenResponse.status}`)
process.exit(1)
