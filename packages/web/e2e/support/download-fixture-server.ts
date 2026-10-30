/**
 * Stands in for get.omo.dev while the download page is tested: serves each channel's
 * manifest.json in the shape the release publisher writes, and each release's SHA256SUMS. A test
 * picks what the visitor would find on the host with `PUT /__scenario/<name>`.
 */

import { FIXTURE_PORT } from "./download-fixture-port"

const HOST = "https://get.omo.dev"

interface Entry {
  readonly url: string
  readonly sha256: string
  readonly size: number
  readonly kind: string
}

function entry(
  channel: string,
  version: string,
  file: string,
  kind: string,
  size: number,
  hashChar: string,
): Entry {
  return {
    url: `${HOST}/${channel}/${version}/${file}`,
    sha256: hashChar.repeat(64),
    size,
    kind,
  }
}

function manifest(
  channel: "stable" | "beta",
  version: string,
  omit: readonly string[] = [],
): unknown {
  const platforms: Record<string, Entry | Entry[]> = {
    "mac-arm64": entry(channel, version, `OmO-${version}-arm64.dmg`, "dmg", 212_000_000, "1"),
    "mac-x64": entry(channel, version, `OmO-${version}-x64.dmg`, "dmg", 224_500_000, "2"),
    "win-x64": entry(channel, version, `OmO-${version}-x64.exe`, "exe", 198_300_000, "3"),
    "linux-x64": [
      entry(channel, version, `OmO-${version}-x64.AppImage`, "appimage", 205_000_000, "5"),
      entry(channel, version, `OmO-${version}-amd64.deb`, "deb", 190_000_000, "4"),
    ],
  }
  for (const key of omit) delete platforms[key]
  return {
    channel,
    version,
    date: "2026-11-10T08:00:00Z",
    stagingPercentage: 100,
    notesUrl: `${HOST}/${channel}/${version}/RELEASE-NOTES.md`,
    platforms,
  }
}

type Reply = { readonly status: number; readonly body: unknown }

/** SHA256SUMS lines for a manifest's installers, as the publisher writes them. */
function sumsFor(body: unknown, replace: Readonly<Record<string, string>> = {}): string {
  const platforms = (body as { platforms: Record<string, Entry | Entry[]> }).platforms
  return Object.values(platforms)
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .map((installer) => {
      const file = installer.url.split("/").pop() ?? ""
      return `${replace[file] ?? installer.sha256}  ${file}\n`
    })
    .join("")
}

/** Per scenario: a SHA256SUMS hash to publish instead of the manifest's, keyed by file name. */
const SUMS_OVERRIDES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  tampered: { "OmO-0.1.0-x64.dmg": "f".repeat(64) },
}

const SCENARIOS: Readonly<Record<string, Readonly<Record<"stable" | "beta", Reply>>>> = {
  launched: {
    stable: { status: 200, body: manifest("stable", "0.1.0") },
    beta: { status: 200, body: manifest("beta", "0.2.0-beta.3") },
  },
  "no-linux": {
    stable: { status: 200, body: manifest("stable", "0.1.0", ["linux-x64"]) },
    beta: { status: 404, body: "not found" },
  },
  "before-launch": {
    stable: { status: 404, body: "not found" },
    beta: { status: 200, body: manifest("beta", "0.2.0-beta.3") },
  },
  "host-down": {
    stable: { status: 503, body: "unavailable" },
    beta: { status: 503, body: "unavailable" },
  },
  // Before launch the host answers 401 to anyone without the release read token.
  gated: {
    stable: { status: 401, body: "Unauthorized" },
    beta: { status: 401, body: "Unauthorized" },
  },
  // Today's releases: the desktop publisher ships the macOS disk images only.
  "mac-only": {
    stable: { status: 200, body: manifest("stable", "0.1.0", ["win-x64", "linux-x64"]) },
    beta: { status: 404, body: "not found" },
  },
  tampered: {
    stable: { status: 200, body: manifest("stable", "0.1.0") },
    beta: { status: 404, body: "not found" },
  },
}

let scenario = "launched"

Bun.serve({
  port: FIXTURE_PORT,
  hostname: "127.0.0.1",
  fetch(request) {
    const { pathname } = new URL(request.url)
    if (pathname === "/health") return new Response("ok")
    const pick = /^\/__scenario\/([\w-]+)$/.exec(pathname)
    if (request.method === "PUT" && pick) {
      const name = pick[1] ?? ""
      if (!(name in SCENARIOS)) return new Response("unknown scenario", { status: 400 })
      scenario = name
      return new Response("ok")
    }
    const sums = /^\/(stable|beta)\/([^/]+)\/SHA256SUMS$/.exec(pathname)
    if (sums) {
      const reply = SCENARIOS[scenario]?.[sums[1] === "beta" ? "beta" : "stable"]
      const body = reply?.body as { version?: string } | undefined
      if (!reply || reply.status !== 200 || body?.version !== sums[2]) {
        return new Response("not found", { status: 404 })
      }
      return new Response(sumsFor(reply.body, SUMS_OVERRIDES[scenario]))
    }
    const channel = /^\/(stable|beta)\/manifest\.json$/.exec(pathname)?.[1]
    if (channel === "stable" || channel === "beta") {
      const reply = SCENARIOS[scenario]?.[channel]
      if (!reply) return new Response("unknown scenario", { status: 500 })
      return typeof reply.body === "string"
        ? new Response(reply.body, { status: reply.status })
        : Response.json(reply.body, { status: reply.status })
    }
    return new Response("not found", { status: 404 })
  },
})
