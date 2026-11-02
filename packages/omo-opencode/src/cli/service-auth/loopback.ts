import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { createServer } from "node:http"
import { generateDeviceKeys } from "./device-keys"
import { type ChooseDevice, grantSchema, jsonRequest, parseReply, type Platform, serviceOrigin, SignInError } from "./protocol"
import type { Session } from "./session"

export class BrowserUnavailable extends SignInError {}

async function authorize(options: {
  readonly accounts: string
  readonly open: (url: string) => Promise<boolean>
  readonly signal?: AbortSignal
}) {
  const verifier = randomBytes(32).toString("base64url")
  const state = randomBytes(32).toString("base64url")
  const answer = Promise.withResolvers<string>()
  const abort = () => answer.reject(new SignInError("Browser sign-in cancelled or timed out."))
  let accepted = false
  let origin = ""
  const server = createServer((request, response) => {
    response.setHeader("cache-control", "no-store")
    response.setHeader("referrer-policy", "no-referrer")
    response.setHeader("content-type", "text/plain; charset=utf-8")
    const url = new URL(request.url ?? "/", origin)
    if (request.method !== "GET" || request.headers.host !== new URL(origin).host || url.origin !== origin ||
      url.pathname !== "/callback" || request.headers.forwarded || request.headers["x-forwarded-for"]) {
      response.writeHead(404).end("Not found")
      return
    }
    const code = url.searchParams.get("code")
    const suppliedState = Buffer.from(url.searchParams.get("state") ?? "")
    const expectedState = Buffer.from(state)
    if (accepted || url.searchParams.getAll("state").length !== 1 ||
      suppliedState.length !== expectedState.length || !timingSafeEqual(suppliedState, expectedState) ||
      url.searchParams.getAll("code").length !== 1 || !code) {
      response.writeHead(400).end("Invalid sign-in response")
      return
    }
    accepted = true
    response.writeHead(200).end("Return to the terminal to finish signing in.")
    answer.resolve(code)
  })
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve() })
    })
    const address = server.address()
    if (!address || typeof address === "string") throw new SignInError("Unable to start the sign-in callback.")
    origin = `http://127.0.0.1:${address.port}`
    const url = new URL(serviceOrigin(options.accounts))
    url.search = new URLSearchParams({
      redirect_uri: `${origin}/callback`,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256", state,
    }).toString()
    const timer = setTimeout(abort, 5 * 60_000)
    options.signal?.addEventListener("abort", abort, { once: true })
    try {
      options.signal?.throwIfAborted()
      const openerFailed = () => {
        if (!accepted) throw new BrowserUnavailable("No browser is available; use device sign-in.")
      }
      const [code] = await Promise.all([
        answer.promise,
        options.open(url.href).then(opened => {
          if (!opened) openerFailed()
        }, openerFailed),
      ])
      return { code, codeVerifier: verifier }
    } finally {
      clearTimeout(timer)
      options.signal?.removeEventListener("abort", abort)
    }
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}

export async function loginLoopback(session: Session, options: {
  readonly accounts: string
  readonly name: string
  readonly platform: Platform
  readonly open: (url: string) => Promise<boolean>
  readonly chooseDevice: ChooseDevice
}): Promise<void> {
  await session.ready()
  const keys = generateDeviceKeys()
  for (;;) {
    const authorization = await authorize({ accounts: options.accounts, open: options.open, signal: session.signal })
    try {
      const grant = parseReply(grantSchema, await session.request("/v1/session/exchange", jsonRequest({
        ...authorization, kind: "cli", deviceName: options.name, platform: options.platform, ...keys.public,
      })))
      await session.save({ ...grant, ...keys.private })
      return
    } catch (error) {
      if (await session.removeForLimit(error, options.chooseDevice)) continue
      throw new SignInError("Sign-in cancelled. No device was removed.")
    }
  }
}
