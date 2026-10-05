import { expect, test } from "bun:test"
import { tccIdentityPasses } from "./tcc"

const engine = "/opt/qa/senpi-desktop-engine"

test("passes when macOS attributes the denial to the engine itself", () => {
  const message = `Screen Recording permission denied for ${engine}. (TCC identity: responsible=${engine}, pid=41)`
  expect(tccIdentityPasses(message, engine)).toEqual({ pass: true, identity: engine })
})

test("passes when the responsible process also reports a bundle id", () => {
  const message = `denied (TCC identity: responsible=${engine} bundle=org.example.qa, pid=42)`
  expect(tccIdentityPasses(message, engine)).toEqual({ pass: true, identity: engine })
})

test("fails when another process is responsible for the denial", () => {
  const message = "denied (TCC identity: responsible=/Applications/Terminal.app/Contents/MacOS/Terminal, pid=7)"
  expect(tccIdentityPasses(message, engine).pass).toBe(false)
})

test("fails when the responsible process could not be resolved", () => {
  const message = `denied (TCC identity: unresolved (engine executable=${engine}))`
  expect(tccIdentityPasses(message, engine)).toEqual({ pass: false, identity: null })
})

test("fails when the message carries no TCC identity", () => {
  expect(tccIdentityPasses("screenshot failed", engine)).toEqual({ pass: false, identity: null })
})
