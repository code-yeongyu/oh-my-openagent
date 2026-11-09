import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { prepareCliThinkingSession } from "../bin/lib/cli-thinking-session.js"

const roots: string[] = []
function fixture(source: string): string {
  const root = mkdtempSync(join(tmpdir(), "cli-thinking-"))
  roots.push(root)
  mkdirSync(join(root, "dist"))
  writeFileSync(join(root, "dist/main.js"), source)
  return root
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

test.each(["created.session.thinkingLevel", "selection?.requested ?? created.session.thinkingLevel"])("startup override is session-only and idempotent: %s", (argument) => {
  const source = `created.session.setThinkingLevel(${argument});\nctx.session.setThinkingLevel(command.level);\n`
  const root = fixture(source)
  prepareCliThinkingSession(root)
  const expected = source.replace("created.session.setThinkingLevel", "created.session.setSessionThinkingLevel")
  expect(readFileSync(join(root, "dist/main.js"), "utf8")).toBe(expected)
  prepareCliThinkingSession(root)
  expect(readFileSync(join(root, "dist/main.js"), "utf8")).toBe(expected)
})
test("bundled startup changes without changing RPC setters", () => {
  const root = fixture("created.session.setThinkingLevel(created.session.thinkingLevel)")
  mkdirSync(join(root, "dist/bundle/chunks"), { recursive: true })
  const path = join(root, "dist/bundle/chunks/startup.js")
  writeFileSync(path, "created.session.setThinkingLevel(selection?.requested??created.session.thinkingLevel);ctx.session.setThinkingLevel(command.level)")
  prepareCliThinkingSession(root)
  expect(readFileSync(path, "utf8")).toBe("created.session.setSessionThinkingLevel(selection?.requested??created.session.thinkingLevel);ctx.session.setThinkingLevel(command.level)")
})
test.each(["dist/main.js", "dist/bundle"])("unsupported startup fails naming %s", (target) => {
  const root = fixture(target === "dist/main.js" ? "export {}" : "created.session.setThinkingLevel(created.session.thinkingLevel)")
  if (target === "dist/bundle") {
    mkdirSync(join(root, target))
    writeFileSync(join(root, target, "cli.js"), "export {}")
  }
  expect(() => prepareCliThinkingSession(root)).toThrow(`unsupported Senpi ${target}: no CLI thinking application`)
})
