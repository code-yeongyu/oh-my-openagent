import { describe, expect, test } from "bun:test"
import { createServiceAliasRegistry } from "./alias-registry"

type Seen = {
  readonly method: string
  readonly url: string
  readonly authorization: string | null
  readonly body: unknown
}

function service(
  reply: (path: string, body: Record<string, unknown>) => { readonly status: number; readonly body: unknown },
) {
  const seen: Seen[] = []
  const fetch = async (request: Request): Promise<Response> => {
    const body = (await request.json()) as Record<string, unknown>
    seen.push({ method: request.method, url: request.url, authorization: request.headers.get("authorization"), body })
    const answer = reply(new URL(request.url).pathname, body)
    return new Response(JSON.stringify(answer.body), {
      status: answer.status,
      headers: { "content-type": "application/json" },
    })
  }
  return { seen, fetch }
}

const holding = { alias_value: "build bot", session_value: "dur-1", device: "dev-a" }

// The account service's session-alias routes (contract 1.31.0, plain-v1): the wire the port v1 is spoken over.
describe("the account service alias registry client", () => {
  test("#given a signed-in device #when it claims an alias #then one POST /v1/session-aliases carries the bearer token and the normalized plain-v1 body, and the holding comes back", async () => {
    const svc = service(() => ({ status: 200, body: holding }))
    const registry = createServiceAliasRegistry({
      origin: "https://api.example.test",
      accessToken: async () => "tok-1",
      fetch: svc.fetch,
    })
    expect(
      await registry.claim({
        alias: "  Build   Bot ",
        holder: { session_id: "dur-1", device: "dev-a" },
        idempotency_key: "k-1",
      }),
    ).toEqual({ kind: "ok", value: { alias: "build bot", holder: { session_id: "dur-1", device: "dev-a" } } })
    expect(svc.seen).toEqual([
      {
        method: "POST",
        url: "https://api.example.test/v1/session-aliases",
        authorization: "Bearer tok-1",
        body: {
          scheme: "plain-v1",
          alias_key: "build bot",
          alias_value: "build bot",
          session_key: "dur-1",
          session_value: "dur-1",
          device: "dev-a",
          idempotency_key: "k-1",
        },
      },
    ])
  })

  test("#given the service's refusals #when each comes back #then alias_taken names the holder, alias_not_found stays itself, and any other refusal is alias_registry_unavailable naming its code", async () => {
    const refusals: Record<string, { readonly status: number; readonly body: unknown }> = {
      "/v1/session-aliases": {
        status: 409,
        body: {
          error: {
            code: "alias_taken",
            message: "taken",
            detail: { reason: "alias_holder", holder: { session_value: "dur-9", device: "dev-b" } },
          },
        },
      },
      "/v1/session-aliases/resolve": { status: 404, body: { error: { code: "alias_not_found", message: "none" } } },
      "/v1/session-aliases/of": {
        status: 401,
        body: { error: { code: "unauthorized", message: "sign in to continue" } },
      },
    }
    const svc = service((path) => refusals[path] ?? { status: 500, body: null })
    const registry = createServiceAliasRegistry({
      origin: "https://api.example.test",
      accessToken: async () => "tok",
      fetch: svc.fetch,
    })
    expect(
      await registry.claim({ alias: "x", holder: { session_id: "dur-1", device: "dev-a" }, idempotency_key: "k" }),
    ).toMatchObject({
      kind: "error",
      error: { code: "alias_taken", details: { holder: { session_id: "dur-9", device: "dev-b" } } },
    })
    expect(await registry.resolve("x")).toMatchObject({ kind: "error", error: { code: "alias_not_found" } })
    expect(await registry.aliasesOf(["dur-1"])).toMatchObject({
      kind: "error",
      error: { code: "alias_registry_unavailable", details: { reason: "unauthorized" } },
    })
  })

  test("#given no usable sign-in, or an address that can never be an alias #when the registry is asked #then nothing is sent: the first is alias_registry_unavailable, the second alias_not_found", async () => {
    const svc = service(() => ({ status: 200, body: holding }))
    const signedOut = createServiceAliasRegistry({
      origin: "https://api.example.test",
      accessToken: async () => {
        throw new Error("Not signed in.")
      },
      fetch: svc.fetch,
    })
    expect(await signedOut.resolve("build bot")).toMatchObject({
      kind: "error",
      error: { code: "alias_registry_unavailable", details: { reason: "sign_in" } },
    })
    const registry = createServiceAliasRegistry({
      origin: "https://api.example.test",
      accessToken: async () => "tok",
      fetch: svc.fetch,
    })
    expect(await registry.resolve("0190f1c2-7a3b-7c4d-8e5f-0123456789ab")).toMatchObject({
      kind: "error",
      error: { code: "alias_not_found" },
    })
    expect(await registry.resolve("x".repeat(65))).toMatchObject({ kind: "error", error: { code: "alias_not_found" } })
    expect(svc.seen).toEqual([])
  })
})
