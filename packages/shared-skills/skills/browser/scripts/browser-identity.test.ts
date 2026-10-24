import { describe, expect, test } from "bun:test"
import { resolveConnectedBrowser } from "./browser-identity.mjs"

describe("resolveConnectedBrowser (#10407)", () => {
  test("identifies Vivaldi when daemon reports chrome but primary detected browser is vivaldi", () => {
    const raw = {
      instance_id: "d7d561f2",
      browser_name: "chrome",
      browser_version: "152.0.0.0",
    }
    const report = {
      primary: { id: "vivaldi", label: "Vivaldi" },
      browsers: [{ id: "vivaldi", extensionRegistered: true }],
      identification: { candidates: [{ id: "vivaldi" }], defaultBrowser: "vivaldi" },
    }

    const resolved = resolveConnectedBrowser(raw, report)
    expect(resolved.name).toBe("vivaldi")
    expect(resolved.version).toBe("152.0.0.0")
    expect(resolved.instanceId).toBe("d7d561f2")
    expect(resolved.daemonProduct).toBe("chrome 152.0.0.0")
  })

  test("identifies Vivaldi when user agent contains Vivaldi token", () => {
    const raw = {
      instance_id: "a1b2c3d4",
      browser_name: "chrome",
      browser_version: "152.0.0.0",
      user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Vivaldi/6.9.3447.48",
    }
    const report = {}

    const resolved = resolveConnectedBrowser(raw, report)
    expect(resolved.name).toBe("vivaldi")
    expect(resolved.version).toBe("6.9.3447.48")
    expect(resolved.instanceId).toBe("a1b2c3d4")
    expect(resolved.daemonProduct).toBe("chrome 152.0.0.0")
  })

  test("identifies Vivaldi when registered browser and default is vivaldi", () => {
    const raw = {
      instance_id: "99887766",
      browser_name: "chrome",
      browser_version: "128.0.0.0",
    }
    const report = {
      browsers: [{ id: "vivaldi", extensionRegistered: true }],
      identification: { candidates: [{ id: "vivaldi" }], defaultBrowser: "vivaldi" },
    }

    const resolved = resolveConnectedBrowser(raw, report)
    expect(resolved.name).toBe("vivaldi")
    expect(resolved.version).toBe("128.0.0.0")
    expect(resolved.daemonProduct).toBe("chrome 128.0.0.0")
  })

  test("keeps genuine Chrome identified as chrome", () => {
    const raw = {
      instance_id: "chrome1",
      browser_name: "chrome",
      browser_version: "130.0.0.0",
    }
    const report = {
      primary: { id: "chrome", label: "Google Chrome" },
      browsers: [{ id: "chrome", extensionRegistered: true }],
      identification: { candidates: [{ id: "chrome" }], defaultBrowser: "chrome" },
    }

    const resolved = resolveConnectedBrowser(raw, report)
    expect(resolved.name).toBe("chrome")
    expect(resolved.version).toBe("130.0.0.0")
    expect(resolved.daemonProduct).toBe("chrome 130.0.0.0")
  })

  test("passes through other browsers unchanged with daemon product provenance", () => {
    const raw = {
      instance_id: "brave1",
      browser_name: "brave",
      browser_version: "1.70.0",
    }
    const report = {}

    const resolved = resolveConnectedBrowser(raw, report)
    expect(resolved.name).toBe("brave")
    expect(resolved.version).toBe("1.70.0")
    expect(resolved.daemonProduct).toBe("brave 1.70.0")
  })
})
