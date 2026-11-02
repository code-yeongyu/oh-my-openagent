import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"

const probe = fileURLToPath(new URL("../scripts/check-deploy-coherence.mjs", import.meta.url))

async function scenario(mode) {
  const oldPath = "/_next/static/chunks/old.css"
  const newPath = "/_next/static/chunks/new.css"
  const visited = []
  const css = () =>
    new Response("body { font-family: sans-serif }", {
      headers: { "content-type": "text/css" },
    })
  const page = (href) =>
    new Response(`<link rel="stylesheet" href="${href}"><main>OmO</main>`, {
      headers: { "content-type": "text/html" },
    })
  const a = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const href = mode === "missing-absolute" ? new URL(oldPath, request.url).href : oldPath
      return new URL(request.url).pathname === oldPath ? css() : page(href)
    },
  })
  const b = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname
      visited.push(path)
      if (path === newPath) return mode === "bad-control" ? page(newPath) : css()
      if (path === oldPath) {
        if (mode === "retained") return css()
        if (mode === "wrong-mime") return page(newPath)
        return new Response("Not found", { status: 404 })
      }
      return page(mode === "missing-absolute" ? new URL(newPath, request.url).href : newPath)
    },
  })
  try {
    const child = Bun.spawn([process.execPath, probe, a.url.origin, b.url.origin], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const [exit, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    return {
      exit,
      rows: stdout.trim().split("\n").filter(Boolean).map(JSON.parse),
      stderr,
      oldRequests: visited.filter((path) => path === oldPath),
    }
  } finally {
    a.stop(true)
    b.stop(true)
  }
}

test("retained HTML stays usable when the new deployment still serves its CSS", async () => {
  // Given: B retains A's stylesheet while publishing a different one.
  // When: the real CLI fetches both documents and their stylesheets.
  const result = await scenario("retained")
  // Then: the gate succeeds only after requesting the old CSS from B.
  expect(result.exit).toBe(0)
  expect(result.oldRequests.length).toBeGreaterThan(0)
  expect(result.rows.at(-1).failures).toBe(0)
})

for (const mode of ["missing", "wrong-mime", "missing-absolute"]) {
  test(`the deployment gate rejects ${mode} CSS for a retained document`, async () => {
    // Given: B's own page works, but an old stylesheet is missing or is HTML.
    // When: the CLI checks retained A references against B.
    const result = await scenario(mode)
    // Then: the gate fails for observed stylesheet failures, not just changed hashes.
    expect(result.exit).toBe(2)
    expect(result.oldRequests.length).toBeGreaterThan(0)
    expect(result.rows.at(-1).failures).toBeGreaterThan(0)
  })
}

test("a broken unchanged-build control cannot certify deployment coherence", async () => {
  // Given: B already serves HTML instead of its own CSS.
  // When: the CLI runs the same matrix.
  const result = await scenario("bad-control")
  // Then: it rejects the invalid setup rather than reporting a valid skew result.
  expect(result.exit).toBe(1)
  expect(result.rows.some((row) => row.kind === "retained-document-styles")).toBe(false)
})
