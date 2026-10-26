import { describe, expect, spyOn, test } from "bun:test"
import { putVerified, R2UploadError } from "./r2-signed-put"

const credentials = { accountId: "dummy", accessKeyId: "test-access-key", secretAccessKey: "test-secret-key", bucket: "omo-releases" }

describe("R2 write diagnostics", () => {
  test.each([
    { headers: {}, body: "<Error><Code>InternalError</Code><Message>Try again</Message><RequestId>body-request</RequestId></Error>", id: "body-request", code: "InternalError" },
    { headers: { "cf-ray": "ray-request" }, body: "upstream unavailable", id: "ray-request", code: "UnknownError" },
    { headers: { "x-amz-request-id": "", "cf-ray": "empty-header-ray" }, body: "<Error><Code>InternalError</Code><RequestId></RequestId></Error>", id: "empty-header-ray", code: "InternalError" },
    { headers: { "x-amz-request-id": "", "cf-ray": "unused-ray" }, body: "<Error><Code>InternalError</Code><RequestId>nonempty-body</RequestId></Error>", id: "nonempty-body", code: "InternalError" },
  ])("retains response identifiers when the S3 request header is absent: $id", async ({ headers, body, id, code }) => {
    // given
    const fetch = spyOn(globalThis, "fetch").mockResolvedValue(new Response(body, { status: 502, headers }))
    // when
    try {
      await putVerified(credentials, "channels/_scratch/test", new Blob(["5.1.48\n"]), "a".repeat(64), {})
      throw new Error("expected R2 write failure")
    } catch (error) {
      // then
      expect(error).toMatchObject({ status: 502, code, requestId: id })
    } finally {
      fetch.mockRestore()
    }
  })

  test("redacts the whole secret before an overlapping access key", async () => {
    const overlapping = { ...credentials, accessKeyId: "test-key", secretAccessKey: "prefix-test-key-suffix" }
    const fetch = spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      `<Error><Code>${overlapping.secretAccessKey}</Code><Message>${overlapping.secretAccessKey}</Message><RequestId>${overlapping.secretAccessKey}</RequestId></Error>`,
      { status: 502 },
    ))
    try {
      await putVerified(overlapping, "channels/test", new Blob(["x"]), "a".repeat(64), {})
      throw new Error("expected write failure")
    } catch (error) {
      expect(error).toMatchObject({ code: "<redacted>", requestId: "<redacted>" })
      expect(String(error)).not.toContain("prefix-")
      expect(String(error)).not.toContain("-suffix")
    } finally {
      fetch.mockRestore()
    }
  })

  test("preserves HTTP status, R2 code and request id without leaking credentials", async () => {
    // given
    const fetch = spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      `<Error><Code>InternalError</Code><Message>Failure ${credentials.accessKeyId} ${credentials.secretAccessKey}</Message><RequestId>body-request</RequestId></Error>`,
      { status: 500, headers: { "x-amz-request-id": "header-request" } },
    ))
    const body = new Blob(["5.1.48\n"])
    // when
    try {
      await putVerified(credentials, "channels/_scratch/test", body, "a".repeat(64), { "content-type": "text/plain" })
      throw new Error("expected R2 write failure")
    } catch (error) {
      // then
      expect(error).toBeInstanceOf(R2UploadError)
      expect(error).toMatchObject({ status: 500, code: "InternalError", requestId: "header-request" })
      if (!(error instanceof R2UploadError)) throw error
      expect(error.message).toContain("500")
      expect(error.message).toContain("InternalError")
      expect(error.message).toContain("header-request")
      expect(error.message).not.toContain(credentials.accessKeyId)
      expect(error.message).not.toContain(credentials.secretAccessKey)
    } finally {
      fetch.mockRestore()
    }
  })
})
