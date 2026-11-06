import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test"
import { commit, createRepo, removeTempDirs } from "./hooks.test-support"
import { scanSecretLikeMaterial } from "../sync/redact"

afterEach(removeTempDirs)

setDefaultTimeout(process.platform === "win32" ? 30000 : 10000)

// The hook and the TypeScript gates must agree (#10385): a note that only refers to a credential commits
// through the hook exactly as the reflection gate accepts it, and a real value is still refused by both.
describe("pre-commit hook: assignments that only reference a credential", () => {
  const references = [
    'const body = JSON.stringify({ password: process.env.TH_PASSWORD || "" })',
    "client_secret=[FILTERED]",
    "Authorization: Bearer <key>",
    "token: $GITHUB_TOKEN",
    "token: process.env.GITHUB_TOKEN",
    'secret: os.environ["SECRET"]',
    "api_key: env.API_KEY",
    "Authorization: Bearer $TOKEN",
  ]
  for (const line of references) {
    it(`#given ${JSON.stringify(line)} #when committed #then the hook accepts it`, async () => {
      const dir = await createRepo()
      const result = await commit(dir, { "reference/note.md": `---\ndescription: Note\n---\n\n${line}\n` })
      expect(result.stderr).not.toContain("secret-like content")
      expect(result.code).toBe(0)
      expect(scanSecretLikeMaterial(line)).toEqual([])
    })
  }

  const credentials = [
    "password: hunter2Abrx9",
    "token=nullable-9fQ2xK7",
    "Authorization: Bearer abcdef123456",
    // a reference-looking tail after the real value must not hide it (#10528 review)
    "password=hunter2Xyz9Qreal:true",
    "api_key=Qx9realSecretVal=env.",
    "token=s3cr3tRealValue:$HOME",
    // a value that only STARTS with a reference token still carries a literal secret
    "password=process.env.X||hunter2real",
    "token={{x}}realsecretvalue",
    // a literal glued after a balanced reference (#10528 delta review)
    "token: ${FOO}realsecret",
    "token: [FILTERED]realsecret",
  ]
  for (const line of credentials) {
    it(`#given ${JSON.stringify(line)} #when committed #then the hook still refuses it`, async () => {
      const dir = await createRepo()
      const result = await commit(dir, { "reference/note.md": `---\ndescription: Note\n---\n\n${line}\n` })
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain("secret-like content")
      expect(scanSecretLikeMaterial(line).length).toBeGreaterThan(0)
    })
  }
})
