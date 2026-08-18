import { describe, expect, it } from "bun:test"
import { redactUrl } from "./redact"

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

  describe("#given an empty url", () => {
    it("#then the empty string is returned", () => {
      expect(redactUrl("")).toBe("")
    })
  })
})
