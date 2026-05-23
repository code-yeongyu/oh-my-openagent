/// <reference path="../../bun-test.d.ts" />
import { describe, test, expect } from "bun:test"

import { buildTeamIdleWakeHintClient } from "./build-team-idle-wake-hint-client"

type FakeSdkHttp = {
  post: (args: { url: string; body?: unknown }) => Promise<{ url: string; body?: unknown }>
}

type SdkLikeSession = {
  _client: FakeSdkHttp
  promptAsync: (options: { path: { id: string }; body?: unknown }) => Promise<{ url: string; body?: unknown }>
  status: () => Promise<{ url: string; _client: FakeSdkHttp }>
  messages: (options: { path: { id: string } }) => Promise<{ url: string; _client: FakeSdkHttp }>
}

function createSdkLikeSession(http: FakeSdkHttp): SdkLikeSession {
  return {
    _client: http,
    async promptAsync(options) {
      return this._client.post({ url: `/session/${options.path.id}/prompt_async`, body: options.body })
    },
    async status() {
      return { url: "/session", _client: this._client }
    },
    async messages(options) {
      return { url: `/session/${options.path.id}/messages`, _client: this._client }
    },
  }
}

describe("buildTeamIdleWakeHintClient", () => {
  test("#given a real-SDK-like session whose promptAsync reads this._client #when the wrapper dispatches the bound method #then the SDK receives the call with _client preserved", async () => {
    // given
    const calls: Array<{ url: string; body?: unknown }> = []
    const http: FakeSdkHttp = {
      post: async (args) => {
        calls.push(args)
        return args
      },
    }
    const session = createSdkLikeSession(http)
    const sdkClient = { session } as unknown as Parameters<typeof buildTeamIdleWakeHintClient>[0]

    // when
    const wrapped = buildTeamIdleWakeHintClient(sdkClient)
    await wrapped.session.promptAsync?.({ path: { id: "ses_regression" }, body: { hello: "world" } } as never)

    // then
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe("/session/ses_regression/prompt_async")
    expect(calls[0]?.body).toEqual({ hello: "world" })
  })

  test("#given a real-SDK-like session whose status reads this._client #when the wrapper dispatches the bound status #then _client is preserved", async () => {
    // given
    const http: FakeSdkHttp = {
      post: async (args) => args,
    }
    const session = createSdkLikeSession(http)
    const sdkClient = { session } as unknown as Parameters<typeof buildTeamIdleWakeHintClient>[0]

    // when
    const wrapped = buildTeamIdleWakeHintClient(sdkClient)
    const result = (await wrapped.session.status?.()) as { _client?: FakeSdkHttp } | undefined

    // then
    expect(result?._client).toBe(http)
  })

  test("#given a session without optional methods #when the wrapper is built #then it gracefully exposes undefined entries", async () => {
    // given
    const partial = { session: {} } as unknown as Parameters<typeof buildTeamIdleWakeHintClient>[0]

    // when
    const wrapped = buildTeamIdleWakeHintClient(partial)

    // then
    expect(wrapped.session.promptAsync).toBeUndefined()
    expect(wrapped.session.status).toBeUndefined()
    expect(wrapped.session.messages).toBeUndefined()
  })

  test("#given a real-SDK-like session whose messages reads this._client #when the wrapper dispatches the bound messages #then _client is preserved", async () => {
    // given
    const http: FakeSdkHttp = { post: async (args) => args }
    const session = createSdkLikeSession(http)
    const sdkClient = { session } as unknown as Parameters<typeof buildTeamIdleWakeHintClient>[0]

    // when
    const wrapped = buildTeamIdleWakeHintClient(sdkClient)
    const result = (await wrapped.session.messages?.({ path: { id: "ses_messages" } } as never)) as { _client?: FakeSdkHttp; url?: string } | undefined

    // then
    expect(result?._client).toBe(http)
    expect(result?.url).toBe("/session/ses_messages/messages")
  })

  test("#given a destructure-without-bind pattern #when promptAsync is invoked via a plain wrapper #then this._client is undefined (historical bug)", async () => {
    // given
    const http: FakeSdkHttp = { post: async (args) => args }
    const session = createSdkLikeSession(http)
    const brokenWrapper = {
      session: {
        promptAsync: session.promptAsync,
      },
    }

    // when
    let caughtMessage = ""
    try {
      await brokenWrapper.session.promptAsync({ path: { id: "ses_x" } } as never)
    } catch (error) {
      caughtMessage = error instanceof Error ? error.message : String(error)
    }

    // then
    expect(caughtMessage).toContain("_client")
  })
})
