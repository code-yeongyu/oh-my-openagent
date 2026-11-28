import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// senpi's OSC 7577 hand-off re-execs this same image in the same pid, with the token moved off the environment. Every
// module evaluated before it runs again, the second time on argv that buildSenpiArgs already rewrote (senpi#7493). A
// probe showed it: with the hand-off imported second, the code imported before it ran twice in one pid, the second time
// with --senpi-osc7577-token-fd already in argv. So it must be the compiled entry's very first import.
test("the compiled entry imports senpi's OSC 7577 resume startup before anything else", () => {
  const source = readFileSync(join(import.meta.dir, "..", "compile-entry.ts"), "utf8")
  const imports = [...source.matchAll(/^import\s.*$/gm)].map((match) => match[0])
  expect(imports[0]).toBe('import "@code-yeongyu/senpi/program-resume-startup"')
})

test("the resume startup the compiled entry imports is exported by the pinned senpi", () => {
  expect(() => import.meta.resolve("@code-yeongyu/senpi/program-resume-startup")).not.toThrow()
})
