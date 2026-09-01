import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { readFile, stat } from "node:fs/promises"
import { dirname } from "node:path"

import { generatePalaceHtml } from "./generator"
import {
  INJECTION_PAYLOAD,
  cleanupPalaceFixtures,
  commitPalaceFile,
  createPalaceFixture,
} from "./palace.test-support"

afterAll(cleanupPalaceFixtures)

// Every case commits into a real git fixture repository; the 5s default is not a budget those
// subprocesses fit on a loaded Windows runner.
setDefaultTimeout(process.platform === "win32" ? 30_000 : 5_000)

function inlineJson(html: string): Record<string, unknown> {
  const match = html.match(
    /<script type="application\/json" id="omo-palace-data">([\s\S]*?)<\/script>/,
  )
  if (match?.[1] === undefined) throw new Error("palace html has no inline data script")
  const decoded = match[1]
    .replace(/\\u003c/g, "<")
    .replace(/\\u2028/g, "\u2028")
    .replace(/\\u2029/g, "\u2029")
  const parsed: unknown = JSON.parse(decoded)
  if (parsed === null || typeof parsed !== "object") throw new Error("palace data is not an object")
  return parsed as Record<string, unknown>
}

function section(data: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = data[key]
  if (value === null || typeof value !== "object") throw new Error(`palace data missing ${key}`)
  return value as Record<string, unknown>
}

describe("palace generator machine gate", () => {
  test("#given a fixture memory repo #when the palace is generated #then inline data pins the persona entry, HEAD sha and identity metadata", async () => {
    const fixture = await createPalaceFixture()

    const result = await generatePalaceHtml(fixture.context, { now: () => new Date("2026-08-09T12:00:00.000Z") })
    const html = await readFile(result.path, "utf8")
    const data = inlineJson(html)

    const core = section(data, "core").entries
    expect(Array.isArray(core)).toBe(true)
    expect(JSON.stringify(core)).toContain("system/persona.md")
    const metadata = section(data, "metadata")
    expect(metadata.identity).toBe(fixture.identity)
    expect(metadata.headSha).toBe(fixture.head)
    expect(metadata.recompiledAt).toBe("2026-08-09T12:00:00.000Z")
    expect(html).toContain(fixture.head)
  })

  test("#given the default people gate #when the palace markup is parsed #then every tab has a matching panel", async () => {
    const fixture = await createPalaceFixture()

    const result = await generatePalaceHtml(fixture.context)
    const html = await readFile(result.path, "utf8")

    const tabs = [...html.matchAll(/data-tab="([a-z]+)"/g)].map((match) => match[1])
    expect(tabs).toEqual(["core", "external", "history", "reflection", "people"])
    for (const tab of tabs) expect(html).toContain(`id="panel-${tab}"`)
  })

  test("#given people collection disabled #when the palace markup is parsed #then only the four always-on tabs remain", async () => {
    const fixture = await createPalaceFixture()

    const result = await generatePalaceHtml(fixture.context, {
      people: { enabled: false, limits: { maxEntries: 40, maxEntryChars: 200 } },
    })
    const html = await readFile(result.path, "utf8")

    const tabs = [...html.matchAll(/data-tab="([a-z]+)"/g)].map((match) => match[1])
    expect(tabs).toEqual(["core", "external", "history", "reflection"])
    for (const tab of tabs) expect(html).toContain(`id="panel-${tab}"`)
  })

  test("#given the viewers runtime directory #when the palace is written #then the file is 0600 inside a 0700 directory", async () => {
    const fixture = await createPalaceFixture()

    const result = await generatePalaceHtml(fixture.context)

    expect(result.path).toMatch(/[\\/]viewers[\\/]palace-[0-9TZ-]+\.html$/)
    if (process.platform !== "win32") {
      expect((await stat(result.path)).mode & 0o777).toBe(0o600)
      expect((await stat(dirname(result.path))).mode & 0o777).toBe(0o700)
    }
  })

  test("#given memory content carrying a script-breakout payload #when the palace is generated #then the raw payload never appears and the escaped form does", async () => {
    const fixture = await createPalaceFixture({ injection: true })

    const result = await generatePalaceHtml(fixture.context)
    const html = await readFile(result.path, "utf8")

    expect(html).not.toContain(INJECTION_PAYLOAD)
    expect(html).not.toContain("</script><img")
    // Escaping `<` is what neutralises the breakout: no `</script` sequence can survive.
    expect(html.indexOf("</script", html.indexOf("id=\"omo-palace-data\""))).toBe(
      html.indexOf("</script>\n<script>"),
    )
    expect(html).toContain("\\u003c/script>\\u003cimg src=x onerror=alert(1)>")
    expect(JSON.stringify(inlineJson(html))).toContain(INJECTION_PAYLOAD)
  })

  test("#given line-separator characters in memory content #when the palace is generated #then U+2028 and U+2029 are escaped in the inline payload", async () => {
    const fixture = await createPalaceFixture()
    await commitPalaceFile(
      fixture,
      "system/separators.md",
      "---\ndescription: separators\n---\n\nline\u2028break\u2029paragraph\n",
      "chore: add separator fixture",
    )

    const result = await generatePalaceHtml(fixture.context)
    const html = await readFile(result.path, "utf8")

    expect(html).not.toContain("\u2028")
    expect(html).not.toContain("\u2029")
    expect(html).toContain("\\u2028")
    expect(html).toContain("\\u2029")
  })

  test("#given a self-contained requirement #when the palace html is inspected #then it references no external fonts or CDNs", async () => {
    const fixture = await createPalaceFixture()

    const result = await generatePalaceHtml(fixture.context)
    const html = await readFile(result.path, "utf8")

    expect(html).not.toContain("http://")
    expect(html).not.toContain("https://")
    expect(html).not.toContain("@import")
    expect(html).not.toContain("<link")
  })

  test("#given a committed binary asset #when the palace is generated #then the external tab lists name and size but no binary body", async () => {
    const fixture = await createPalaceFixture()

    const result = await generatePalaceHtml(fixture.context)
    const html = await readFile(result.path, "utf8")
    const external = section(inlineJson(html), "external").entries

    expect(Array.isArray(external)).toBe(true)
    const binary = (external as Array<Record<string, unknown>>).find(
      (entry) => entry.path === "reference/logo.png",
    )
    expect(binary?.binary).toBe(true)
    expect(binary?.byteSize).toBe(12)
    expect(binary?.body).toBeUndefined()
    expect(html).not.toContain("\\u0089PNG")
  })
})
