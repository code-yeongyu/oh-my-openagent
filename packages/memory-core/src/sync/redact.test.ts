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
    // Linear by WORK, not by time (#14860; #12693 replaced a wall-clock bound with a fastest-of-5 time ratio, which still
    // timed the host and went red at 9.56 on a slow macOS runner). The PEM scan walks the input with String.indexOf, so
    // the characters indexOf examines are its work: four times the input must cost about four times the work. A scan
    // that restarts after every failed candidate costs about sixteen times.
    it("#then the PEM scan's work grows linearly with the input and real PEM blocks remain masked", () => {
      const hostile = (size: number) => `-----BEGIN ${"A".repeat(size)}-----${"B".repeat(size)}`
      const work = (input: string) => {
        // Patched only for this synchronous call and restored in finally (also when redactUrl throws); nothing awaits in
        // between, so no other test of this file or worker runs while it is installed.
        const indexOf = String.prototype.indexOf
        let scanned = 0
        String.prototype.indexOf = function (this: string, search: string, position?: number) {
          const from = Math.max(0, Math.min(position ?? 0, this.length))
          const found = indexOf.call(this, search, from)
          scanned += (found < 0 ? this.length : found + search.length) - from
          return found
        }
        try {
          expect(redactUrl(input)).toBe(input)
        } finally {
          String.prototype.indexOf = indexOf
        }
        return scanned
      }

      const small = work(hostile(12_500))
      const large = work(hostile(50_000))
      // A scan that stops going through indexOf (a regex, includes, a manual loop) counts nothing; fail loudly so this
      // guard can never pass on zero work.
      if (small <= 0 || large <= small)
        throw new Error(
          `the PEM scan no longer goes through String.indexOf (work ${small} -> ${large}): re-instrument this test`,
        )
      expect(large / small).toBeLessThan(8)

      const pem = "-----BEGIN PRIVATE KEY-----secret-----END PRIVATE KEY-----"
      expect(redactUrl(pem)).toBe("***")
    }, 30_000)

    // Catastrophic-backtracking guard for the regex passes (secret patterns, seams, split credentials), which run inside
    // V8's regex engine where no work can be counted (#14860). Here time is the behaviour under test, and the bound sits
    // far from both sides: redactUrl on this 400k-character input takes ~15-25 ms on a fast Mac (~65 ms at the 2.7x of
    // the slowest macOS runner measured), and one quadratic pattern ("A+X") makes it ~9.7 s. The bound is 2 s.
    it("#then the regex passes finish far below a catastrophic-backtracking bound", () => {
      const input = `-----BEGIN ${"A".repeat(200_000)}-----${"B".repeat(200_000)}`
      const started = performance.now()
      expect(redactUrl(input)).toBe(input)
      expect(performance.now() - started).toBeLessThan(2_000)
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
