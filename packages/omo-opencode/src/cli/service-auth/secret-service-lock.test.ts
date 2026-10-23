import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { parseLockedReply } from "./secret-service-lock"

const FAKE_SECRET_SERVICE = `
import sys
from gi.repository import Gio, GLib
locked = sys.argv[1] == "locked"
xml = """<node><interface name="org.freedesktop.Secret.Collection"><property name="Locked" type="b" access="read"/></interface></node>"""
info = Gio.DBusNodeInfo.new_for_xml(xml).interfaces[0]
def get_property(conn, sender, path, iface, name):
    return GLib.Variant("b", locked)
def on_bus(conn, name):
    conn.register_object("/org/freedesktop/secrets/aliases/default", info, None, get_property, None)
def on_name(conn, name):
    print("READY", flush=True)
Gio.bus_own_name(Gio.BusType.SESSION, "org.freedesktop.secrets", Gio.BusNameOwnerFlags.NONE, on_bus, on_name, None)
GLib.MainLoop().run()
`

const has = (cmd: string, args: string[]) => spawnSync(cmd, args, { stdio: "ignore" }).status === 0
const canRun = process.platform === "linux" && has("dbus-run-session", ["--version"]) && has("gdbus", ["help"])
  && has("python3", ["-c", "from gi.repository import Gio"])

describe("probeSecretServiceLock without gdbus", () => {
  // #10658 review: a minimal install without libglib2.0-bin has no gdbus; that says nothing about the keyring.
  test("is unknown, never absent", async () => {
    const path = process.env.PATH
    const emptyBin = mkdtempSync(join(tmpdir(), "omo-no-gdbus-"))
    process.env.PATH = emptyBin
    try {
      const { probeSecretServiceLock } = await import("./secret-service-lock")
      expect(await probeSecretServiceLock()).toBe("unknown")
    } finally {
      process.env.PATH = path
      rmSync(emptyBin, { recursive: true, force: true })
    }
  })
})

describe("parseLockedReply", () => {
  test("reads gdbus's Locked property reply", () => {
    expect(parseLockedReply("(<true>,)\n")).toBe("locked")
    expect(parseLockedReply("(<false>,)\n")).toBe("unlocked")
    expect(parseLockedReply("garbage")).toBeNull()
  })
})

describe.skipIf(!canRun)("probeSecretServiceLock against a fake Secret Service on a private D-Bus (desktop#3509)", () => {
  const probeIn = (fake: "locked" | "unlocked" | "none"): string => {
    const dir = mkdtempSync(join(tmpdir(), "omo-secret-service-"))
    try {
      const fakePath = join(dir, "fake.py")
      writeFileSync(fakePath, FAKE_SECRET_SERVICE)
      const probeModule = join(import.meta.dir, "secret-service-lock.ts")
      const start = fake === "none" ? "" : `python3 ${JSON.stringify(fakePath)} ${fake} > "$D/ready" & until grep -q READY "$D/ready" 2>/dev/null; do :; done;`
      const run = spawnSync("dbus-run-session", ["--", "bash", "-c",
        `D=${JSON.stringify(dir)}; ${start} bun -e 'const { probeSecretServiceLock } = await import(${JSON.stringify(probeModule)}); console.log(await probeSecretServiceLock())'`],
        { encoding: "utf8", timeout: 20_000 })
      return run.stdout.trim().split("\n").at(-1) ?? ""
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  test("a locked default collection is locked", () => { expect(probeIn("locked")).toBe("locked") })
  test("an unlocked default collection is unlocked", () => { expect(probeIn("unlocked")).toBe("unlocked") })
  test("no Secret Service on the bus is absent", () => { expect(probeIn("none")).toBe("absent") })
})
