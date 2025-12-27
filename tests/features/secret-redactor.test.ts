/**
 * Tests for secret redactor (LIF-73)
 * 
 * Test data is constructed dynamically to avoid security scanner false positives.
 */

import { describe, test, expect } from "bun:test"
import {
  redactSecrets,
  truncateExcerpt,
  sanitizeForStorage,
} from "../../src/features/context-learning/secret-redactor"

// Build test strings dynamically from parts to avoid scanner detection
const parts = {
  api: ["api", "_", "key"].join(""),
  secret: "secret",
  password: "password",
  bearer: "Bearer",
  ghp: ["ghp", "_"].join(""),
  gho: ["gho", "_"].join(""),
  ghu: ["ghu", "_"].join(""),
  ghs: ["ghs", "_"].join(""),
  ghr: ["ghr", "_"].join(""),
  sk: ["sk", "-"].join(""),
  xoxb: ["xoxb", "-"].join(""),
  xoxp: ["xoxp", "-"].join(""),
  xoxa: ["xoxa", "-"].join(""),
  xoxr: ["xoxr", "-"].join(""),
  xoxs: ["xoxs", "-"].join(""),
  akia: "AKIA",
  awsSecret: ["aws", "_", "secret", "_", "access", "_", "key"].join(""),
  secretKey: ["secret", "_", "key"].join(""),
  beginKey: ["-", "-", "-", "-", "-", "BEGIN"].join(""),
  endKey: ["-", "-", "-", "-", "-"].join(""),
  mongo: ["mongo", "db", "://"].join(""),
  mongoSrv: ["mongo", "db", "+srv://"].join(""),
  pg: ["post", "gres", "://"].join(""),
  my: ["my", "sql", "://"].join(""),
  rd: ["red", "is", "://"].join(""),
}

// Generate a test value that's long enough but doesn't look like a secret
function genTestValue(len: number = 40): string {
  const chars = "abcdefghijklmnopqrstuvwxyz"
  return Array.from({ length: len }, (_, i) => chars[i % chars.length]).join("")
}

const testValue = genTestValue(40)
const shortValue = "short"

describe("Secret Redactor", () => {
  describe("redactSecrets", () => {
    describe("API keys and secrets", () => {
      test("should redact api_key patterns", () => {
        const input = parts.api + ': "' + testValue + '"'
        const result = redactSecrets(input)
        expect(result.redacted).toContain("[REDACTED: api_key]")
        expect(result.secretsFound).toBeGreaterThan(0)
        expect(result.secretTypes).toContain("api_key")
      })

      test("should redact secret patterns", () => {
        const input = parts.secret + ': "' + testValue + '"'
        const result = redactSecrets(input)
        expect(result.redacted).toContain("[REDACTED: secret]")
        expect(result.secretTypes).toContain("secret")
      })

      test("should redact password patterns", () => {
        const input = parts.password + ' = "' + testValue + '"'
        const result = redactSecrets(input)
        expect(result.redacted).toContain("[REDACTED: secret]")
      })
    })

    describe("Bearer tokens", () => {
      test("should redact Bearer tokens", () => {
        const input = "Authorization: " + parts.bearer + " " + testValue
        const result = redactSecrets(input)
        expect(result.redacted).toContain("[REDACTED: bearer_token]")
        expect(result.secretTypes).toContain("bearer_token")
      })
    })

    describe("GitHub tokens", () => {
      test("should redact ghp_ tokens (personal access)", () => {
        const input = "token: " + parts.ghp + testValue
        const result = redactSecrets(input)
        expect(result.redacted).toContain("[REDACTED: github_token]")
        expect(result.secretTypes).toContain("github_token")
      })

      test("should redact gho_ tokens (OAuth)", () => {
        const input = "GITHUB_TOKEN=" + parts.gho + testValue
        const result = redactSecrets(input)
        expect(result.redacted).toContain("[REDACTED: github_token]")
      })

      test("should redact ghu_ tokens (user-to-server)", () => {
        const input = parts.ghu + testValue
        const result = redactSecrets(input)
        expect(result.redacted).toContain("[REDACTED: github_token]")
      })

      test("should redact ghs_ tokens (server-to-server)", () => {
        const input = parts.ghs + testValue
        const result = redactSecrets(input)
        expect(result.redacted).toContain("[REDACTED: github_token]")
      })

      test("should redact ghr_ tokens (refresh)", () => {
        const input = parts.ghr + testValue
        const result = redactSecrets(input)
        expect(result.redacted).toContain("[REDACTED: github_token]")
      })
    })

    describe("OpenAI keys", () => {
      test("should redact sk- prefixed keys", () => {
        const input = "key=" + parts.sk + testValue
        const result = redactSecrets(input)
        expect(result.redacted).toContain("[REDACTED: openai_key]")
        expect(result.secretTypes).toContain("openai_key")
      })
    })

    describe("Slack tokens", () => {
      test("should redact xoxb- tokens (bot)", () => {
        const input = "SLACK_TOKEN=" + parts.xoxb + testValue
        const result = redactSecrets(input)
        expect(result.redacted).toContain("[REDACTED: slack_token]")
        expect(result.secretTypes).toContain("slack_token")
      })

      test("should redact xoxp- tokens (user)", () => {
        const input = parts.xoxp + testValue
        const result = redactSecrets(input)
        expect(result.redacted).toContain("[REDACTED: slack_token]")
      })

      test("should redact xoxa- tokens (app)", () => {
        const input = parts.xoxa + testValue
        const result = redactSecrets(input)
        expect(result.redacted).toContain("[REDACTED: slack_token]")
      })

      test("should redact xoxr- tokens (refresh)", () => {
        const input = parts.xoxr + testValue
        const result = redactSecrets(input)
        expect(result.redacted).toContain("[REDACTED: slack_token]")
      })

      test("should redact xoxs- tokens (session)", () => {
        const input = parts.xoxs + testValue
        const result = redactSecrets(input)
        expect(result.redacted).toContain("[REDACTED: slack_token]")
      })
    })

    describe("Private keys", () => {
      test("should redact RSA private key headers", () => {
        const input = parts.beginKey + " RSA PRIVATE KEY" + parts.endKey
        const result = redactSecrets(input)
        expect(result.redacted).toContain("[REDACTED: private_key]")
        expect(result.secretTypes).toContain("private_key")
      })

      test("should redact generic private key headers", () => {
        const input = parts.beginKey + " PRIVATE KEY" + parts.endKey
        const result = redactSecrets(input)
        expect(result.redacted).toContain("[REDACTED: private_key]")
      })

      test("should redact DSA private key headers", () => {
        const input = parts.beginKey + " DSA PRIVATE KEY" + parts.endKey
        const result = redactSecrets(input)
        expect(result.redacted).toContain("[REDACTED: private_key]")
      })

      test("should redact EC private key headers", () => {
        const input = parts.beginKey + " EC PRIVATE KEY" + parts.endKey
        const result = redactSecrets(input)
        expect(result.redacted).toContain("[REDACTED: private_key]")
      })

      test("should redact OpenSSH private key headers", () => {
        const input = parts.beginKey + " OPENSSH PRIVATE KEY" + parts.endKey
        const result = redactSecrets(input)
        expect(result.redacted).toContain("[REDACTED: private_key]")
      })
    })

    describe("Database connection strings", () => {
      test("should redact MongoDB connection strings", () => {
        const input = parts.mongo + "user:pass@host:27017/db"
        const result = redactSecrets(input)
        expect(result.redacted).toContain("[REDACTED: db_connection]")
        expect(result.secretTypes).toContain("db_connection")
      })

      test("should redact MongoDB+srv connection strings", () => {
        const input = parts.mongoSrv + "user:pass@cluster.net/db"
        const result = redactSecrets(input)
        expect(result.redacted).toContain("[REDACTED: db_connection]")
      })

      test("should redact PostgreSQL connection strings", () => {
        const input = parts.pg + "user:pass@host:5432/db"
        const result = redactSecrets(input)
        expect(result.redacted).toContain("[REDACTED: db_connection]")
      })

      test("should redact MySQL connection strings", () => {
        const input = parts.my + "user:pass@host:3306/db"
        const result = redactSecrets(input)
        expect(result.redacted).toContain("[REDACTED: db_connection]")
      })

      test("should redact Redis connection strings", () => {
        const input = parts.rd + "user:pass@host:6379/0"
        const result = redactSecrets(input)
        expect(result.redacted).toContain("[REDACTED: db_connection]")
      })
    })

    describe("AWS credentials", () => {
      test("should redact AWS access key IDs", () => {
        const input = "AWS_ACCESS_KEY_ID=" + parts.akia + "ABCDEFGHIJKLMNOP"
        const result = redactSecrets(input)
        expect(result.redacted).toContain("[REDACTED: aws_access_key]")
        expect(result.secretTypes).toContain("aws_access_key")
      })

      test("should redact AWS secret access keys", () => {
        const input = parts.awsSecret + ": " + testValue
        const result = redactSecrets(input)
        expect(result.redacted).toContain("[REDACTED: aws_secret_key]")
        expect(result.secretTypes).toContain("aws_secret_key")
      })

      test("should redact secret_key patterns", () => {
        const input = parts.secretKey + "=" + testValue
        const result = redactSecrets(input)
        expect(result.redacted).toContain("[REDACTED: aws_secret_key]")
      })
    })

    describe("multiple secrets", () => {
      test("should redact multiple different secret types", () => {
        const input = [
          parts.api + ': "' + testValue + '"',
          parts.bearer + " " + testValue,
          parts.ghp + testValue,
        ].join("\n")
        const result = redactSecrets(input)
        expect(result.secretsFound).toBe(3)
        expect(result.secretTypes).toContain("api_key")
        expect(result.secretTypes).toContain("bearer_token")
        expect(result.secretTypes).toContain("github_token")
      })

      test("should count unique secret types only", () => {
        const input = [
          parts.api + ': "' + testValue + '1"',
          parts.api + ': "' + testValue + '2"',
        ].join("\n")
        const result = redactSecrets(input)
        expect(result.secretTypes).toHaveLength(1)
        expect(result.secretTypes).toContain("api_key")
      })
    })

    describe("no secrets", () => {
      test("should return unchanged content when no secrets found", () => {
        const input = "This is just regular text without any secrets."
        const result = redactSecrets(input)
        expect(result.redacted).toBe(input)
        expect(result.secretsFound).toBe(0)
        expect(result.secretTypes).toHaveLength(0)
      })

      test("should not redact short strings that look like keys", () => {
        const input = parts.api + ": " + shortValue
        const result = redactSecrets(input)
        expect(result.secretsFound).toBe(0)
      })
    })
  })

  describe("truncateExcerpt", () => {
    test("should return unchanged text if under max length", () => {
      const input = "Short text"
      const result = truncateExcerpt(input, 200)
      expect(result).toBe(input)
    })

    test("should truncate text at max length with ellipsis", () => {
      const input = "A".repeat(250)
      const result = truncateExcerpt(input, 200)
      expect(result.length).toBe(200)
      expect(result.endsWith("...")).toBe(true)
    })

    test("should use default max length of 200", () => {
      const input = "A".repeat(250)
      const result = truncateExcerpt(input)
      expect(result.length).toBe(200)
    })

    test("should handle exact length text", () => {
      const input = "A".repeat(200)
      const result = truncateExcerpt(input, 200)
      expect(result).toBe(input)
      expect(result.length).toBe(200)
    })

    test("should handle empty string", () => {
      const result = truncateExcerpt("", 200)
      expect(result).toBe("")
    })

    test("should handle very short max length", () => {
      const input = "Hello World"
      const result = truncateExcerpt(input, 10)
      expect(result.length).toBe(10)
      expect(result).toBe("Hello W...")
    })
  })

  describe("sanitizeForStorage", () => {
    test("should redact secrets and truncate", () => {
      const input = parts.api + ": " + testValue + " " + "A".repeat(300)
      const result = sanitizeForStorage(input, 200)
      expect(result).toContain("[REDACTED: api_key]")
      expect(result.length).toBe(200)
      expect(result.endsWith("...")).toBe(true)
    })

    test("should use default max length of 200", () => {
      const input = "A".repeat(300)
      const result = sanitizeForStorage(input)
      expect(result.length).toBe(200)
    })

    test("should handle content with no secrets under max length", () => {
      const input = "Just regular text"
      const result = sanitizeForStorage(input, 200)
      expect(result).toBe(input)
    })

    test("should handle empty string", () => {
      const result = sanitizeForStorage("")
      expect(result).toBe("")
    })
  })
})
