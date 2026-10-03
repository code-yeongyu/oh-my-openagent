import { describe, expect, test } from "bun:test"

import {
  chooseInstallers,
  detectDesktopPlatform,
  fetchChannelState,
  formatInstallerSize,
  parseChannelManifest,
  type ChannelState,
  type DesktopClient,
  type DesktopRelease,
} from "./desktop-download"

const HASH_A = "a".repeat(64)
const HASH_B = "b".repeat(64)
const HASH_C = "c".repeat(64)
const HASH_D = "d".repeat(64)
const HASH_E = "e".repeat(64)

const MAC_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"
const WINDOWS_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
const UBUNTU_FIREFOX =
  "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0"
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"

function stableManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    channel: "stable",
    version: "0.1.0",
    date: "2026-11-10T08:00:00Z",
    stagingPercentage: 100,
    notesUrl: "https://get.omo.dev/stable/0.1.0/RELEASE-NOTES.md",
    platforms: {
      "mac-arm64": {
        url: "https://get.omo.dev/stable/0.1.0/OmO-0.1.0-arm64.dmg",
        sha256: HASH_A,
        size: 212_000_000,
        kind: "dmg",
      },
      "mac-x64": {
        url: "https://get.omo.dev/stable/0.1.0/OmO-0.1.0-x64.dmg",
        sha256: HASH_B,
        size: 224_500_000,
        kind: "dmg",
      },
      "win-x64": {
        url: "https://get.omo.dev/stable/0.1.0/OmO-0.1.0-x64.exe",
        sha256: HASH_C,
        size: 198_300_000,
        kind: "exe",
      },
      "linux-x64": [
        {
          url: "https://get.omo.dev/stable/0.1.0/OmO-0.1.0-x64.AppImage",
          sha256: HASH_E,
          size: 205_000_000,
          kind: "appimage",
        },
        {
          url: "https://get.omo.dev/stable/0.1.0/OmO-0.1.0-amd64.deb",
          sha256: HASH_D,
          size: 190_000_000,
          kind: "deb",
        },
      ],
    },
    ...overrides,
  }
}

function readyRelease(overrides: Record<string, unknown> = {}): DesktopRelease {
  const state = parseChannelManifest("stable", stableManifest(overrides))
  if (state.status !== "ready") throw new Error(`fixture manifest is ${state.status}`)
  return state.release
}

function client(userAgent: string, extra: Partial<DesktopClient> = {}): DesktopClient {
  return { userAgent, ...extra }
}

describe("which installer a visitor is offered first", () => {
  test("an Apple silicon Mac gets the arm64 disk image", () => {
    // given
    const release = readyRelease()
    const visitor = detectDesktopPlatform(
      client(MAC_SAFARI, { uaPlatform: "macOS", architecture: "arm" }),
    )

    // when
    const choice = chooseInstallers(release, visitor)

    // then
    expect(choice.primary?.fileName).toBe("OmO-0.1.0-arm64.dmg")
    expect(choice.archAssumed).toBe(false)
  })

  test("an Intel Mac gets the x64 disk image", () => {
    // given
    const release = readyRelease()
    const visitor = detectDesktopPlatform(
      client(MAC_SAFARI, { uaPlatform: "macOS", architecture: "x86" }),
    )

    // when
    const choice = chooseInstallers(release, visitor)

    // then
    expect(choice.primary?.fileName).toBe("OmO-0.1.0-x64.dmg")
  })

  test("a Mac whose browser hides the CPU gets Apple silicon first and the Intel build is still listed", () => {
    // given
    const release = readyRelease()
    const visitor = detectDesktopPlatform(client(MAC_SAFARI, { platform: "MacIntel" }))

    // when
    const choice = chooseInstallers(release, visitor)

    // then
    expect(choice.primary?.arch).toBe("arm64")
    expect(choice.archAssumed).toBe(true)
    expect(choice.rest.map((installer) => installer.fileName)).toContain("OmO-0.1.0-x64.dmg")
  })

  test("a Windows PC gets the exe, even when its browser reports an ARM CPU", () => {
    // given
    const release = readyRelease()
    const visitor = detectDesktopPlatform(
      client(WINDOWS_CHROME, { uaPlatform: "Windows", architecture: "arm" }),
    )

    // when
    const choice = chooseInstallers(release, visitor)

    // then
    expect(choice.primary?.fileName).toBe("OmO-0.1.0-x64.exe")
  })

  test("a Linux PC gets the deb before the AppImage and keeps the AppImage in the list", () => {
    // given
    const release = readyRelease()
    const visitor = detectDesktopPlatform(client(UBUNTU_FIREFOX, { platform: "Linux x86_64" }))

    // when
    const choice = chooseInstallers(release, visitor)

    // then
    expect(choice.primary?.fileName).toBe("OmO-0.1.0-amd64.deb")
    expect(choice.rest[0]?.fileName).toBe("OmO-0.1.0-x64.AppImage")
  })

  test("a Linux visitor is offered the AppImage when no deb is published", () => {
    // given
    const release = readyRelease({
      platforms: {
        "linux-x64": {
          url: "https://get.omo.dev/stable/0.1.0/OmO-0.1.0-x64.AppImage",
          sha256: HASH_E,
          size: 205_000_000,
          kind: "appimage",
        },
      },
    })

    // when
    const choice = chooseInstallers(
      release,
      detectDesktopPlatform(client(UBUNTU_FIREFOX, { platform: "Linux x86_64" })),
    )

    // then
    expect(choice.primary?.kind).toBe("appimage")
  })

  test("every other installer stays listed with its checksum and size, the visitor's system first", () => {
    // given
    const release = readyRelease()
    const visitor = detectDesktopPlatform(client(WINDOWS_CHROME, { uaPlatform: "Windows" }))

    // when
    const choice = chooseInstallers(release, visitor)

    // then
    expect(choice.rest).toHaveLength(release.installers.length - 1)
    expect(choice.rest.every((installer) => /^[0-9a-f]{64}$/.test(installer.sha256))).toBe(true)
    expect(choice.rest.every((installer) => installer.size !== null)).toBe(true)
    expect(choice.rest.some((installer) => installer.os === "windows")).toBe(false)
  })
})

describe("visitors the app cannot serve with one button", () => {
  test("a Linux visitor gets no primary button when the release has no Linux build yet", () => {
    // given
    const release = readyRelease({
      platforms: {
        "mac-arm64": {
          url: "https://get.omo.dev/stable/0.1.0/OmO-0.1.0-arm64.dmg",
          sha256: HASH_A,
          size: 212_000_000,
          kind: "dmg",
        },
      },
    })

    // when
    const choice = chooseInstallers(
      release,
      detectDesktopPlatform(client(UBUNTU_FIREFOX, { platform: "Linux x86_64" })),
    )

    // then
    expect(choice.primary).toBeNull()
    expect(choice.rest.map((installer) => installer.os)).toEqual(["macos"])
  })

  test("an ARM Linux visitor is never handed an x64 build that would not run", () => {
    // given
    const release = readyRelease()
    const visitor = detectDesktopPlatform(
      client(UBUNTU_FIREFOX, { platform: "Linux aarch64", architecture: "arm" }),
    )

    // when
    const choice = chooseInstallers(release, visitor)

    // then
    expect(choice.primary).toBeNull()
  })

  test("a phone visitor is told to use a computer instead of being offered an installer", () => {
    // given
    const release = readyRelease()
    const visitor = detectDesktopPlatform(
      client(IPHONE_SAFARI, { platform: "iPhone", maxTouchPoints: 5 }),
    )

    // when
    const choice = chooseInstallers(release, visitor)

    // then
    expect(visitor.device).toBe("phone")
    expect(choice.primary).toBeNull()
    expect(choice.rest).toHaveLength(release.installers.length)
  })

  test("an iPad that asks for the desktop site is still treated as a phone or tablet", () => {
    // when
    const visitor = detectDesktopPlatform(
      client(MAC_SAFARI, { platform: "MacIntel", maxTouchPoints: 5 }),
    )

    // then
    expect(visitor.device).toBe("phone")
    expect(visitor.os).toBeNull()
  })
})

describe("what the page reads from the manifest", () => {
  test("a published manifest becomes a release with every installer's size and checksum", () => {
    // when
    const state = parseChannelManifest("stable", stableManifest())

    // then
    expect(state.status).toBe("ready")
    if (state.status !== "ready") return
    expect(state.release.version).toBe("0.1.0")
    expect(state.release.installers).toHaveLength(5)
    expect(state.release.notesUrl).toBe("https://get.omo.dev/stable/0.1.0/RELEASE-NOTES.md")
    expect(state.release.checksumsUrl).toBe("https://get.omo.dev/stable/0.1.0/SHA256SUMS")
  })

  test("an installer hosted on GitHub is never shown, whatever the manifest says", () => {
    // given
    const manifest = stableManifest({
      platforms: {
        "win-x64": {
          url: "https://github.com/code-yeongyu/omo-desktop-app/releases/download/v0.1.0/OmO.exe",
          sha256: HASH_C,
          size: 198_300_000,
          kind: "exe",
        },
        "mac-arm64": {
          url: "https://get.omo.dev/stable/0.1.0/OmO-0.1.0-arm64.dmg",
          sha256: HASH_A,
          size: 212_000_000,
          kind: "dmg",
        },
      },
    })

    // when
    const state = parseChannelManifest("stable", manifest)

    // then
    expect(state.status).toBe("ready")
    if (state.status !== "ready") return
    expect(state.release.installers.map((installer) => installer.os)).toEqual(["macos"])
  })

  test("release notes that live on GitHub are dropped rather than linked", () => {
    // when
    const state = parseChannelManifest(
      "stable",
      stableManifest({
        notesUrl: "https://github.com/code-yeongyu/omo-desktop-app/releases/tag/v0.1.0",
      }),
    )

    // then
    expect(state.status).toBe("ready")
    if (state.status !== "ready") return
    expect(state.release.notesUrl).toBeNull()
  })

  test("an installer with a malformed checksum is not offered", () => {
    // given
    const manifest = stableManifest({
      platforms: {
        "win-x64": {
          url: "https://get.omo.dev/stable/0.1.0/OmO-0.1.0-x64.exe",
          sha256: "not-a-checksum",
          size: 198_300_000,
          kind: "exe",
        },
        "mac-arm64": {
          url: "https://get.omo.dev/stable/0.1.0/OmO-0.1.0-arm64.dmg",
          sha256: HASH_A.toUpperCase(),
          size: 212_000_000,
          kind: "dmg",
        },
      },
    })

    // when
    const state = parseChannelManifest("stable", manifest)

    // then
    expect(state.status).toBe("ready")
    if (state.status !== "ready") return
    expect(state.release.installers.map((installer) => installer.os)).toEqual(["macos"])
    expect(state.release.installers[0]?.sha256).toBe(HASH_A)
  })

  test("a release whose every installer is unusable is reported as unavailable, not as a blank page", () => {
    // when
    const state = parseChannelManifest(
      "stable",
      stableManifest({
        platforms: {
          "win-x64": { url: "javascript:alert(1)", sha256: HASH_C, size: 1, kind: "exe" },
        },
      }),
    )

    // then
    expect(state.status).toBe("unavailable")
  })

  test("a manifest with a launch date and no release yet becomes a coming-soon state with that date", () => {
    // when
    const state = parseChannelManifest("stable", {
      channel: "stable",
      launchAt: "2026-12-01T00:00:00Z",
    })

    // then
    expect(state).toEqual({ status: "coming", launchAt: "2026-12-01T00:00:00.000Z" })
  })

  test("a body that is not a manifest at all is unavailable", () => {
    expect(parseChannelManifest("stable", "<html>oops</html>").status).toBe("unavailable")
    expect(parseChannelManifest("stable", null).status).toBe("unavailable")
    expect(parseChannelManifest("stable", []).status).toBe("unavailable")
  })

  test("sizes read the way a person would say them", () => {
    expect(formatInstallerSize(212_000_000, "en")).toBe("212 MB")
    expect(formatInstallerSize(1_480_000_000, "en")).toBe("1.48 GB")
    expect(formatInstallerSize(null, "en")).toBe("")
  })
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

describe("loading a channel's manifest from the download host", () => {
  const baseUrl = "https://get.omo.dev"

  test("reads the manifest for the chosen channel from that channel's folder", async () => {
    // given
    const requested: string[] = []
    const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
      requested.push(String(input))
      return jsonResponse(stableManifest())
    }

    // when
    const state = await fetchChannelState("stable", { baseUrl, fetchImpl })

    // then
    expect(requested).toEqual(["https://get.omo.dev/stable/manifest.json"])
    expect(state.status).toBe("ready")
  })

  test("the beta channel reads beta/manifest.json", async () => {
    // given
    const requested: string[] = []
    const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
      requested.push(String(input))
      return jsonResponse(stableManifest({ channel: "beta", version: "0.1.1-beta.2" }))
    }

    // when
    const state = await fetchChannelState("beta", { baseUrl, fetchImpl })

    // then
    expect(requested).toEqual(["https://get.omo.dev/beta/manifest.json"])
    expect(state.status === "ready" && state.release.channel).toBe("beta")
  })

  test("before launch there is no stable manifest, and the page shows the launch date instead of an error", async () => {
    // given
    const fetchImpl = async (): Promise<Response> => new Response("not found", { status: 404 })

    // when
    const state: ChannelState = await fetchChannelState("stable", { baseUrl, fetchImpl })

    // then
    expect(state).toEqual({ status: "coming", launchAt: "2026-11-10T00:00:00.000Z" })
  })

  test("a server error is unavailable, never a made-up release", async () => {
    // given
    const fetchImpl = async (): Promise<Response> => new Response("boom", { status: 503 })

    // when
    const state = await fetchChannelState("stable", { baseUrl, fetchImpl })

    // then
    expect(state).toEqual({ status: "unavailable" })
  })

  test("an unreachable host is unavailable", async () => {
    // given
    const fetchImpl = async (): Promise<Response> => {
      throw new TypeError("fetch failed")
    }

    // when
    const state = await fetchChannelState("stable", { baseUrl, fetchImpl })

    // then
    expect(state).toEqual({ status: "unavailable" })
  })

  test("a 200 with a broken body is unavailable", async () => {
    // given
    const fetchImpl = async (): Promise<Response> => new Response("{not json", { status: 200 })

    // when
    const state = await fetchChannelState("stable", { baseUrl, fetchImpl })

    // then
    expect(state).toEqual({ status: "unavailable" })
  })
})
