import { describe, expect, it } from "bun:test"
import { containsSecretLikeMaterial, redactSecretLikeMaterial, redactUrl, scanSecretLikeMaterial } from "./redact"

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

describe("scanSecretLikeMaterial / redactSecretLikeMaterial", () => {
  describe("#given a credential assignment", () => {
    it("#then scan reports one credential_assignment match spanning the whole assignment and redact masks it whole", () => {
      // given
      const value = "token=abcdef123456"

      // when
      const matches = scanSecretLikeMaterial(value)

      // then
      expect(matches).toHaveLength(1)
      expect(matches[0].class).toBe("credential_assignment")
      expect(matches[0].start).toBe(0)
      expect(matches[0].end).toBe(value.length)
      expect(redactSecretLikeMaterial(value)).toBe("***")
    })
  })

  describe("#given a credential assignment inside prose and structured text", () => {
    it("#then masking stops at the surrounding delimiters", () => {
      // given
      const prose = "see token=abc123456, then more"
      const json = JSON.stringify({ d: "token=abc123456", n: 3 })

      // when
      const maskedProse = redactSecretLikeMaterial(prose)
      const maskedJson = redactSecretLikeMaterial(json)

      // then
      expect(maskedProse).toBe("see ***, then more")
      expect(JSON.parse(maskedJson)).toEqual({ d: "***", n: 3 })
    })
  })

  describe("#given zero-width evasion inside a key prefix", () => {
    it("#then the material is still detected and the original span is masked", () => {
      // given
      const bare = "sk-\u200bproj-AAAABBBBCCCC"
      const embedded = "the key is sk-\u200bproj-AAAA1111BBBB ok"

      // when
      const maskedBare = redactSecretLikeMaterial(bare)
      const maskedEmbedded = redactSecretLikeMaterial(embedded)

      // then
      expect(containsSecretLikeMaterial(bare)).toBe(true)
      expect(maskedBare).toBe("***")
      expect(maskedEmbedded).toContain("***")
      expect(maskedEmbedded).not.toContain("AAAA1111BBBB")
      expect(maskedEmbedded).not.toContain("sk-")
    })
  })

  describe("#given split and non-breaking-space credential keys", () => {
    it("#then they are classified as split_credential_assignment and masked", () => {
      // given
      const spaced = "t o k e n : hunter2hunter2"
      const nbsp = "api\u00a0key=hunter2hunter2"

      // when
      const spacedMatches = scanSecretLikeMaterial(spaced)
      const nbspMatches = scanSecretLikeMaterial(nbsp)

      // then
      expect(spacedMatches).toHaveLength(1)
      expect(spacedMatches[0].class).toBe("split_credential_assignment")
      expect(redactSecretLikeMaterial(spaced)).toBe("***")
      expect(nbspMatches).toHaveLength(1)
      expect(nbspMatches[0].class).toBe("split_credential_assignment")
      expect(redactSecretLikeMaterial(nbsp)).toBe("***")
    })
  })

  describe("#given a bidirectional format character before an assignment", () => {
    it("#then the assignment is still detected and masked", () => {
      // given
      const value = "\u202etoken=abcdef123456"

      // when
      const matches = scanSecretLikeMaterial(value)
      const masked = redactSecretLikeMaterial(value)

      // then
      expect(containsSecretLikeMaterial(value)).toBe(true)
      expect(matches).toHaveLength(1)
      expect(matches[0].class).toBe("credential_assignment")
      expect(masked).not.toContain("abcdef123456")
      expect(masked).toContain("***")
    })
  })

  describe("#given prose that merely mentions credential concepts", () => {
    it("#then scan returns no matches and every line passes through byte-identical", () => {
      // given
      const lines = [
        "the token budget is 30000 tokens",
        "password policy doc",
        "alice@example.com",
        "file:///tmp/mirror.git",
      ]

      // when
      const scans = lines.map(scanSecretLikeMaterial)
      const masked = lines.map(redactSecretLikeMaterial)

      // then
      for (const matches of scans) expect(matches).toEqual([])
      expect(masked).toEqual(lines)
    })
  })

  describe("#given a PEM block", () => {
    it("#then scan reports a pem_block match spanning the whole block and redact masks it whole", () => {
      // given
      const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSk\n-----END RSA PRIVATE KEY-----"

      // when
      const matches = scanSecretLikeMaterial(pem)

      // then
      expect(matches).toHaveLength(1)
      expect(matches[0].class).toBe("pem_block")
      expect(matches[0].start).toBe(0)
      expect(matches[0].end).toBe(pem.length)
      expect(redactSecretLikeMaterial(pem)).toBe("***")
    })

    it("#then a zero-width character inside a marker label does not hide the block", () => {
      // given
      const pem = "note -----BEGIN RSA PRIV\u200bATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSk\n-----END RSA PRIVATE KEY----- tail"

      // when
      const matches = scanSecretLikeMaterial(pem)

      // then
      expect(matches.map((match) => match.class)).toContain("pem_block")
      expect(redactSecretLikeMaterial(pem)).toBe("note *** tail")
    })
  })
})
