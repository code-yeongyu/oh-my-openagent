import { describe, expect, it } from "bun:test"
import { containsSecretLikeMaterial, redactUrl } from "./redact"

describe("redactUrl", () => {
  describe("#given an https url carrying a token", () => {
    it("#then the credential is masked and the host and path survive", () => {
      // given
      const url = "https://ghp_abcdef1234567890@github.com/acme/memory.git"

      // when
      const redacted = redactUrl(url)

      // then
      expect(redacted).toBe("https://***@github.com/acme/memory.git")
      expect(redacted).not.toContain("ghp_abcdef1234567890")
    })
  })

  describe("#given an https url with user and password", () => {
    it("#then both halves of the credential are masked", () => {
      // given
      const url = "https://alice:s3cr3t-pat@gitlab.example.com/team/memory.git"

      // when
      const redacted = redactUrl(url)

      // then
      expect(redacted).toBe("https://***:***@gitlab.example.com/team/memory.git")
      expect(redacted).not.toContain("s3cr3t-pat")
      expect(redacted).not.toContain("alice")
    })
  })

  describe("#given an ssh scp-style url", () => {
    it("#then the user info is masked and host plus path survive", () => {
      // given
      const url = "git@github.com:acme/memory.git"

      // when
      const redacted = redactUrl(url)

      // then
      expect(redacted).toBe("***@github.com:acme/memory.git")
      expect(redacted).not.toContain("git@")
    })
  })

  describe("#given an ssh:// url with user info", () => {
    it("#then the user info is masked", () => {
      // given
      const url = "ssh://deploy:key123@git.example.com:2222/srv/memory.git"

      // when
      const redacted = redactUrl(url)

      // then
      expect(redacted).toBe("ssh://***:***@git.example.com:2222/srv/memory.git")
      expect(redacted).not.toContain("key123")
    })
  })

  describe("#given urls without credentials", () => {
    it("#then https, file and bare paths pass through unchanged", () => {
      // given
      const urls = [
        "https://github.com/acme/memory.git",
        "file:///tmp/mirror.git",
        "/srv/mirrors/memory.git",
      ]

      // when
      const redacted = urls.map(redactUrl)

      // then
      expect(redacted).toEqual(urls)
    })
  })

  describe("#given free text containing a credentialed url", () => {
    it("#then embedded credentials inside log output are masked", () => {
      // given
      const line = "fatal: could not read from https://x-token:abc123@github.com/acme/memory.git"

      // when
      const redacted = redactUrl(line)

      // then
      expect(redacted).toContain("https://***:***@github.com/acme/memory.git")
      expect(redacted).not.toContain("abc123")
    })
  })

  describe("#given secret-like material in sync output", () => {
    it("#then redactUrl masks the same material recognized by the predicate", () => {
      // given
      const value = "token=abc123 and AKIA1234567890ABCDEF"

      // when
      const redacted = redactUrl(value)

      // then
      expect(containsSecretLikeMaterial(value)).toBe(true)
      expect(redacted).toBe("*** and ***")
      expect(containsSecretLikeMaterial(redacted)).toBe(false)
    })
  })

  describe("#given common credential forms", () => {
    it("#then password assignments, bearer headers, and OpenAI keys are recognized", () => {
      for (const value of [
        "password=hunter2",
        "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc",
        "sk-proj-AAAABBBBCCCCDDDD",
      ]) expect(containsSecretLikeMaterial(value)).toBe(true)
    })
  })

  describe("#given repeated secret-like material", () => {
    it("#then every AWS-style key is masked", () => {
      const value = "AKIA1234567890ABCDEF and AKIAABCDEFGHIJKLMNOP"
      const redacted = redactUrl(value)
      expect(redacted).toBe("*** and ***")
      expect(containsSecretLikeMaterial(redacted)).toBe(false)
    })

    it("#then every token pair is masked", () => {
      const value = "token=aaa token=bbb"
      const redacted = redactUrl(value)
      expect(redacted).toBe("*** ***")
      expect(containsSecretLikeMaterial(redacted)).toBe(false)
    })

    it("#then repeated secrets and URL userinfo are masked", () => {
      const value = "token=aaa https://alice:password@example.test token=bbb"
      const redacted = redactUrl(value)
      expect(redacted).toBe("*** https://***:***@example.test ***")
      expect(containsSecretLikeMaterial(redacted)).toBe(false)
    })

    it("#then repeated predicate checks remain true", () => {
      const value = "token=aaa token=bbb"
      expect(containsSecretLikeMaterial(value)).toBe(true)
      expect(containsSecretLikeMaterial(value)).toBe(true)
    })
  })

  describe("#given malformed PEM-shaped input", () => {
    it("#then redaction completes within a bounded time and real PEM blocks remain masked", () => {
      const hostile = `-----BEGIN ${"A".repeat(100_000)}-----${"B".repeat(100_000)}`
      const started = performance.now()
      const redacted = redactUrl(hostile)
      expect(performance.now() - started).toBeLessThan(500)
      expect(redacted).toBe(hostile)

      const pem = "-----BEGIN PRIVATE KEY-----secret-----END PRIVATE KEY-----"
      expect(redactUrl(pem)).toBe("***")
    })
  })

  describe("#given an empty url", () => {
    it("#then the empty string is returned", () => {
      expect(redactUrl("")).toBe("")
    })
  })
})
