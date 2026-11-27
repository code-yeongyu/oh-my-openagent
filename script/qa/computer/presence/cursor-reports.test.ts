import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"

test("row 52(c) drives the production cursor report and input boundaries", async () => {
  const cargo = Bun.spawn(
    ["cargo", "test", "--locked", "-p", "omo-computer-session", "--lib", "mutate::tests::cursor_presence::"],
    {
      cwd: fileURLToPath(new URL("../../../../", import.meta.url)),
      env: process.env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: 240_000,
    },
  )
  const [stdout, stderr, code] = await Promise.all([
    new Response(cargo.stdout).text(),
    new Response(cargo.stderr).text(),
    cargo.exited,
  ])
  expect({ code, ...(code !== 0 && { stdout, stderr }) }).toEqual({ code: 0 })
  expect(stdout).toContain("test result: ok. 5 passed;")
  console.info(stdout.trim())
}, 250_000)
