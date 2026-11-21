import { describe, expect, test } from "bun:test"
import { readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { sightingsOf } from "./default-ports"
import { openSshPort } from "./ssh-port"

describe("sightingsOf", () => {
  test("#given the caller's device service is not running #when read #then unavailable, so read_back refuses at once", () => {
    expect(sightingsOf("not_running")).toBe("unavailable")
  })

  test("#given the caller's device service did not answer in time #when read #then no sighting yet, so the wait goes on", () => {
    expect(sightingsOf("no_answer")).toEqual([])
  })

  test("#given the service's rows #when read #then each row's online state", () => {
    expect(
      sightingsOf([
        { id: "a", online: true },
        { id: "b", online: false },
      ]),
    ).toEqual([
      { id: "a", state: "online" },
      { id: "b", state: "offline" },
    ])
  })
})

describe("openSshPort", () => {
  const knownDirs = () => readdirSync(tmpdir()).filter((name) => name.startsWith("omo-enroll-known-"))

  test("#given a host key and a session that fails before ssh runs #when opened #then no known-hosts dir is left", async () => {
    const before = knownDirs()
    const session = openSshPort({
      host: "target.example.test",
      hostKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIfixture",
    }).open({ kind: "account_show", origin: "https://x.test/'; rm -rf ~; '" }, {})
    await expect(session.exit).rejects.toThrow()
    expect(knownDirs().filter((name) => !before.includes(name))).toEqual([])
  })
})
