import { describe, expect, spyOn, test } from "bun:test"
import { inspectChannel, parseMaintenanceArgs, recreateChannel } from "./channel-maintenance"
import { R2UploadError } from "./r2-signed-put"

const credentials = { accountId: "dummy", accessKeyId: "test-access-key", secretAccessKey: "test-secret-key", bucket: "omo-releases" }
const base = "https://dummy.r2.cloudflarestorage.com/omo-releases"

type Reply = { readonly status: number; readonly body?: string; readonly headers?: Record<string, string> }

function recordFetch(replies: readonly Reply[]) {
  const fetch = spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected request"))
  for (const reply of replies) fetch.mockResolvedValueOnce(new Response(reply.body ?? null, { status: reply.status, headers: reply.headers }))
  return fetch
}

function requests(fetch: ReturnType<typeof recordFetch>) {
  return fetch.mock.calls.map(([url, init]) => ({ method: init?.method ?? "GET", url: String(url), headers: new Headers(init?.headers), body: init?.body }))
}

describe("parseMaintenanceArgs", () => {
  test("accepts head and recreate on the allowlisted channels", () => {
    expect(parseMaintenanceArgs(["--op", "head", "--channel", "beta"])).toEqual({ op: "head", channel: "beta", version: null })
    expect(parseMaintenanceArgs(["--op", "recreate", "--channel", "latest", "--version", "5.1.49"])).toEqual({ op: "recreate", channel: "latest", version: "5.1.49" })
  })

  test.each([
    { argv: ["--op", "delete", "--channel", "latest"], error: "--op" },
    { argv: ["--op", "head", "--channel", "none"], error: "--channel" },
    { argv: ["--op", "head", "--channel", "../releases/v5.1.49/x"], error: "--channel" },
    { argv: ["--op", "recreate", "--channel", "latest"], error: "--version" },
    { argv: ["--op", "recreate", "--channel", "latest", "--version", "v5.1.49"], error: "--version" },
    { argv: ["--op", "recreate", "--channel", "latest", "--version", "5.1.49\n"], error: "--version" },
  ])("rejects $argv", ({ argv, error }) => {
    expect(() => parseMaintenanceArgs(argv)).toThrow(error)
  })
})

describe("inspectChannel", () => {
  test("logs the status and every response header of a signed HEAD and GET, plus the body, without credentials", async () => {
    // given
    const headers = { "x-amz-request-id": "req-1", etag: '"abc"', "x-echo": `key ${credentials.accessKeyId} ${credentials.secretAccessKey}` }
    const fetch = recordFetch([
      { status: 200, headers },
      { status: 200, headers, body: `5.1.48\n${credentials.secretAccessKey}` },
    ])
    const lines: string[] = []
    try {
      // when
      await inspectChannel(credentials, "latest", (line) => lines.push(line))
      // then
      const sent = requests(fetch)
      expect(sent.map((request) => [request.method, request.url])).toEqual([
        ["HEAD", `${base}/channels/latest`],
        ["GET", `${base}/channels/latest`],
      ])
      for (const request of sent) expect(request.headers.get("authorization")).toStartWith("AWS4-HMAC-SHA256 Credential=")
      const output = lines.join("\n")
      expect(output).toContain("HEAD channels/latest -> HTTP 200")
      expect(output).toContain("GET channels/latest -> HTTP 200")
      expect(output).toContain("x-amz-request-id: req-1")
      expect(output).toContain('etag: "abc"')
      expect(output).toContain("x-echo: key <redacted> <redacted>")
      expect(output).toContain("5.1.48")
      expect(output).not.toContain(credentials.accessKeyId)
      expect(output).not.toContain(credentials.secretAccessKey)
      expect(output).not.toContain("Signature=")
    } finally {
      fetch.mockRestore()
    }
  })

  test("reports an error status instead of throwing", async () => {
    const fetch = recordFetch([
      { status: 500, headers: { "cf-ray": "ray-1" } },
      { status: 500, body: "<Error><Code>InternalError</Code></Error>" },
    ])
    const lines: string[] = []
    try {
      await inspectChannel(credentials, "beta", (line) => lines.push(line))
      expect(lines.join("\n")).toContain("HEAD channels/beta -> HTTP 500")
      expect(lines.join("\n")).toContain("cf-ray: ray-1")
      expect(lines.join("\n")).toContain("InternalError")
    } finally {
      fetch.mockRestore()
    }
  })
})

describe("recreateChannel", () => {
  test("deletes the pointer, writes the version once and verifies the read-back, logging the old body without credentials", async () => {
    // given
    const fetch = recordFetch([
      { status: 200 },
      { status: 200, body: `5.1.48\n${credentials.secretAccessKey}` },
      { status: 204 },
      { status: 200 },
      { status: 200, body: "5.1.49\n" },
    ])
    const lines: string[] = []
    try {
      // when
      await recreateChannel(credentials, "latest", "5.1.49", (line) => lines.push(line))
      // then
      const output = lines.join("\n")
      expect(output).toContain("channels/latest before: HTTP 200")
      expect(output).toContain("5.1.48")
      expect(output).toContain("<redacted>")
      expect(output).not.toContain(credentials.secretAccessKey)
      const sent = requests(fetch)
      expect(sent.map((request) => [request.method, request.url])).toEqual([
        ["HEAD", `${base}/releases/v5.1.49/.complete`],
        ["GET", `${base}/channels/latest`],
        ["DELETE", `${base}/channels/latest`],
        ["PUT", `${base}/channels/latest`],
        ["GET", `${base}/channels/latest`],
      ])
      const put = sent[3]
      if (!(put?.body instanceof Blob)) throw new Error("expected a fixed-length PUT body")
      expect(await put.body.text()).toBe("5.1.49\n")
      expect(put.headers.get("content-type")).toBe("text/plain")
    } finally {
      fetch.mockRestore()
    }
  })

  // Same rule as publish.yml's omo-ai metadata step: a prerelease ships on beta, a stable release on latest.
  test.each([
    { channel: "latest", version: "5.2.0-beta.1" },
    { channel: "beta", version: "5.1.49" },
  ] as const)("refuses $version for channels/$channel before any request", async ({ channel, version }) => {
    const fetch = recordFetch([])
    try {
      await expect(recreateChannel(credentials, channel, version, () => {})).rejects.toThrow(`not channels/${channel}`)
      expect(fetch.mock.calls).toHaveLength(0)
    } finally {
      fetch.mockRestore()
    }
  })

  test("refuses a version whose mirror is not complete, before touching the pointer", async () => {
    const fetch = recordFetch([{ status: 404 }])
    try {
      await expect(recreateChannel(credentials, "latest", "5.1.49", () => {})).rejects.toThrow("releases/v5.1.49/.complete")
      expect(requests(fetch).map((request) => request.method)).toEqual(["HEAD"])
    } finally {
      fetch.mockRestore()
    }
  })

  test("stops after a failed DELETE with its status, code and request id", async () => {
    const fetch = recordFetch([
      { status: 200 },
      { status: 200, body: "5.1.48\n" },
      { status: 500, headers: { "x-amz-request-id": "del-req" }, body: "<Error><Code>InternalError</Code><Message>We encountered an internal error.</Message></Error>" },
    ])
    try {
      const error = await recreateChannel(credentials, "latest", "5.1.49", () => {}).catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(R2UploadError)
      expect(error).toMatchObject({ status: 500, code: "InternalError", requestId: "del-req" })
      expect(String(error)).toContain("DELETE channels/latest")
      expect(requests(fetch).map((request) => request.method)).toEqual(["HEAD", "GET", "DELETE"])
    } finally {
      fetch.mockRestore()
    }
  })

  test("a failed create is reported after one attempt, with no retry and no restore", async () => {
    const sleep = spyOn(Bun, "sleep").mockResolvedValue(undefined)
    const fetch = recordFetch([
      { status: 200 },
      { status: 200, body: "5.1.48\n" },
      { status: 204 },
      { status: 500, headers: { "x-amz-request-id": "put-req" }, body: "<Error><Code>InternalError</Code></Error>" },
    ])
    try {
      await expect(recreateChannel(credentials, "latest", "5.1.49", () => {})).rejects.toMatchObject({ status: 500, requestId: "put-req" })
      expect(requests(fetch).map((request) => request.method)).toEqual(["HEAD", "GET", "DELETE", "PUT"])
      expect(sleep.mock.calls).toHaveLength(0)
    } finally {
      fetch.mockRestore()
      sleep.mockRestore()
    }
  })

  test("a read-back that differs from the written version fails", async () => {
    const fetch = recordFetch([
      { status: 200 },
      { status: 200, body: "5.1.48\n" },
      { status: 204 },
      { status: 200 },
      { status: 200, body: "5.1.48\n" },
    ])
    try {
      await expect(recreateChannel(credentials, "latest", "5.1.49", () => {})).rejects.toThrow("read-back")
    } finally {
      fetch.mockRestore()
    }
  })
})
