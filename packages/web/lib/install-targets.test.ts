import { describe, expect, test } from "bun:test"

import {
  detectInstall,
  INSTALL_COMMANDS,
  INSTALL_TARGETS,
  installDetectScript,
  type InstallClient,
  type InstallOs,
  type InstallTarget,
} from "./install-targets"

const MAC_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"

interface Case {
  readonly name: string
  readonly client: InstallClient
  readonly os: InstallOs
  readonly target: InstallTarget
  readonly onComputer: boolean
}

const CASES: readonly Case[] = [
  {
    name: "Windows 11 x64 Chrome",
    client: {
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
      uaPlatform: "Windows",
      platform: "Win32",
      mobile: false,
    },
    os: "windows",
    target: "powershell",
    onComputer: false,
  },
  {
    name: "Windows on ARM Firefox",
    client: {
      userAgent: "Mozilla/5.0 (Windows NT 10.0; ARM64; rv:131.0) Gecko/20100101 Firefox/131.0",
      platform: "Win32",
    },
    os: "windows",
    target: "powershell",
    onComputer: false,
  },
  {
    name: "macOS Safari",
    client: { userAgent: MAC_SAFARI, platform: "MacIntel", maxTouchPoints: 0 },
    os: "macos",
    target: "unix",
    onComputer: false,
  },
  {
    name: "iPadOS asking for the desktop site",
    client: { userAgent: MAC_SAFARI, platform: "MacIntel", maxTouchPoints: 5 },
    os: "ios",
    target: "unix",
    onComputer: true,
  },
  {
    name: "iPhone Safari",
    client: {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      platform: "iPhone",
      maxTouchPoints: 5,
    },
    os: "ios",
    target: "unix",
    onComputer: true,
  },
  {
    name: "Android Chrome",
    client: {
      userAgent:
        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
      uaPlatform: "Android",
      platform: "Linux armv81",
      mobile: true,
    },
    os: "android",
    target: "unix",
    onComputer: true,
  },
  {
    name: "ChromeOS with only navigator.platform",
    client: {
      userAgent:
        "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
      platform: "Linux x86_64",
    },
    os: "chromeos",
    target: "unix",
    onComputer: false,
  },
  {
    name: "ChromeOS reporting through userAgentData",
    client: {
      userAgent:
        "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
      uaPlatform: "Chrome OS",
      platform: "Linux x86_64",
      mobile: false,
    },
    os: "chromeos",
    target: "unix",
    onComputer: false,
  },
  {
    name: "Linux x64 Firefox",
    client: {
      userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
      platform: "Linux x86_64",
    },
    os: "linux",
    target: "unix",
    onComputer: false,
  },
  {
    name: "Linux ARM64 Chromium",
    client: {
      userAgent:
        "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
      platform: "Linux aarch64",
    },
    os: "linux",
    target: "unix",
    onComputer: false,
  },
  {
    name: "unknown agent",
    client: { userAgent: "Mozilla/5.0 (compatible; ExampleBot/1.0)" },
    os: "unknown",
    target: "unix",
    onComputer: true,
  },
]

describe("detectInstall", () => {
  for (const { name, client, os, target, onComputer } of CASES) {
    test(name, () => {
      expect(detectInstall(client)).toEqual({ os, target, onComputer })
    })
  }
})

function runDetectScript(client: InstallClient): Record<string, string> {
  const attributes: Record<string, string> = {}
  const root = { setAttribute: (key: string, value: string) => (attributes[key] = value) }
  const fakeDocument = { documentElement: root }
  const fakeNavigator = {
    userAgent: client.userAgent,
    platform: client.platform,
    maxTouchPoints: client.maxTouchPoints,
    userAgentData:
      client.uaPlatform === undefined
        ? undefined
        : { platform: client.uaPlatform, mobile: client.mobile },
  }
  new Function("document", "navigator", installDetectScript)(fakeDocument, fakeNavigator)
  return attributes
}

describe("installDetectScript", () => {
  test("marks a Windows visitor's page before the body parses, without any module in scope", () => {
    expect(runDetectScript(CASES[0]!.client)).toEqual({ "data-install": "powershell" })
  })

  test("marks a phone with the run-it-on-a-computer hint", () => {
    const iphone = CASES.find((entry) => entry.name === "iPhone Safari")!
    expect(runDetectScript(iphone.client)).toEqual({
      "data-install": "unix",
      "data-install-hint": "computer",
    })
  })
})

describe("install guide", () => {
  test("docs/guide/install.md carries every command the site shows", async () => {
    const guide = await Bun.file(new URL("../../../docs/guide/install.md", import.meta.url)).text()
    for (const target of INSTALL_TARGETS) expect(guide).toContain(INSTALL_COMMANDS[target])
  })
})
