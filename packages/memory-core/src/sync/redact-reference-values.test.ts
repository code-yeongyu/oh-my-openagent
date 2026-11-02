import { describe, expect, it } from "bun:test"
import { containsSecretLikeMaterial } from "./redact"

describe("secret scanner: assignments that only reference a credential", () => {
  const references = [
    "Authorization: Bearer <key>",
    "client_secret=[FILTERED]",
    'JSON.stringify({ password: process.env.TH_PASSWORD || "" })',
    "password: os.environ",
    "token: $GITHUB_TOKEN",
    "token = ${GITHUB_TOKEN}",
    "api_key: {{ api_key }}",
    "secret: REDACTED",
    "password: null",
    "token: undefined",
    "secret: example",
    "Authorization: Bearer",
    "token: process.env.GITHUB_TOKEN",
    "password: os.environ",
    'secret: os.environ["SECRET"]',
    "api_key: env.API_KEY",
    "token: {{ secrets.TOKEN }}",
  ]
  for (const text of references) {
    it(`#given ${JSON.stringify(text)} #when scanned #then it is not secret-like`, () => {
      expect(containsSecretLikeMaterial(text)).toBe(false)
    })
  }

  const jwtHeader = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url")

  const credentials = [
    "password: hunter2Abrx9",
    "token=nullable-9fQ2xK7",
    "secret: exampleValue123",
    "api_key: $ecretValue9!x",
    `Authorization: Bearer ${jwtHeader}.payload.signature`,
    "client_secret=abcDEF123456",
    "a p i _ k e y : hunter2Abrx9",
    "sk-proj-AbCdEf123456",
    "AKIAABCDEFGHIJKLMNOP",
    "ghp_Ab3dEf5hJ7kL9mN1pQ3rS5tU7vW9xY1zB3C5",
    "password=process.env.X||hunter2real",
    "token={{x}}realsecretvalue",
    "secret: os.environDEFAULT9xQ",
    "api_key=env.FOO.realtail9xQ",
    "token: ${FOO}realsecret",
    "token: [FILTERED]realsecret",
  ]
  for (const text of credentials) {
    it(`#given ${JSON.stringify(text)} #when scanned #then it is still secret-like`, () => {
      expect(containsSecretLikeMaterial(text)).toBe(true)
    })
  }
})
