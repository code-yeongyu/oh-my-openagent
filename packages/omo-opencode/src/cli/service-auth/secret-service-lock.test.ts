import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { parseLockedReply } from "./secret-service-lock"

const FAKE_SECRET_SERVICE = `
import sys
from gi.repository import Gio, GLib
mode = sys.argv[1]
state = {"locked": mode != "unlocked"}
COLLECTION = "/org/freedesktop/secrets/aliases/default"
xml = """<node><interface name="org.freedesktop.Secret.Collection"><property name="Locked" type="b" access="read"/></interface>
<interface name="org.freedesktop.Secret.Service"><method name="Unlock"><arg name="objects" type="ao" direction="in"/><arg name="unlocked" type="ao" direction="out"/><arg name="prompt" type="o" direction="out"/></method></interface></node>"""
node = Gio.DBusNodeInfo.new_for_xml(xml)
def get_property(conn, sender, path, iface, name):
    return GLib.Variant("b", state["locked"])
# Unlock replies by mode: (unlocked paths, prompt, collection unlocked afterwards). "resolved" answers the alias with the
# real collection path (as oo7 does), "raced" lists nothing because another client unlocked first, "stuck" says no prompt
# yet stays locked, "locked" needs a prompt, which nothing may ever open, and "error" fails the call.
REPLIES = {
    "resolved": (["/org/freedesktop/secrets/collection/login"], "/", True),
    "raced": ([], "/", True),
    "stuck": ([], "/", False),
    "locked": ([], "/org/freedesktop/secrets/prompt/u1", False),
}
def unlock(conn, sender, path, iface, method, params, invocation):
    if mode == "error":
        invocation.return_dbus_error("org.freedesktop.Secret.Error.NoSuchObject", "no such collection")
        return
    unlocked, prompt, opened = REPLIES[mode]
    if opened:
        state["locked"] = False
    invocation.return_value(GLib.Variant("(aoo)", (unlocked, prompt)))
def on_bus(conn, name):
    conn.register_object(COLLECTION, node.interfaces[0], None, get_property, None)
    conn.register_object("/org/freedesktop/secrets", node.interfaces[1], unlock, None, None)
def on_name(conn, name):
    print("READY", flush=True)
Gio.bus_own_name(Gio.BusType.SESSION, "org.freedesktop.secrets", Gio.BusNameOwnerFlags.NONE, on_bus, on_name, None)
GLib.MainLoop().run()
`

// A private session bus with no <servicedir>: nothing on it can be D-Bus-activated, so "none" means no Secret Service
// even on a host whose gnome-keyring ships an activatable org.freedesktop.secrets (#12643).
const PRIVATE_BUS_CONFIG = `<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <type>session</type>
  <listen>unix:tmpdir=/tmp</listen>
  <auth>EXTERNAL</auth>
  <policy context="default">
    <allow send_destination="*" eavesdrop="true"/>
    <allow eavesdrop="true"/>
    <allow own="*"/>
  </policy>
</busconfig>
`

// What such a host looks like to a session bus that does read service dirs: an activatable Secret Service that never
// answers. Every probe runs with it on its XDG data path.
const HANGING_SECRET_SERVICE = "[D-BUS Service]\nName=org.freedesktop.secrets\nExec=/bin/sleep 600\n"

const has = (cmd: string, args: string[]) => spawnSync(cmd, args, { stdio: "ignore" }).status === 0
const canRun =
  process.platform === "linux" &&
  has("dbus-run-session", ["--version"]) &&
  has("gdbus", ["help"]) &&
  has("python3", ["-c", "from gi.repository import Gio"])

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

describe.skipIf(!canRun)(
  "probeSecretServiceLock against a fake Secret Service on a private D-Bus (desktop#3509)",
  () => {
    const probeIn = (fake: "locked" | "resolved" | "raced" | "stuck" | "error" | "unlocked" | "none"): string => {
      const dir = mkdtempSync(join(tmpdir(), "omo-secret-service-"))
      try {
        const fakePath = join(dir, "fake.py")
        writeFileSync(fakePath, FAKE_SECRET_SERVICE)
        const busConfig = join(dir, "bus.conf")
        writeFileSync(busConfig, PRIVATE_BUS_CONFIG)
        const services = join(dir, "data", "dbus-1", "services")
        mkdirSync(services, { recursive: true })
        writeFileSync(join(services, "org.freedesktop.secrets.service"), HANGING_SECRET_SERVICE)
        const probeModule = join(import.meta.dir, "secret-service-lock.ts")
        const start =
          fake === "none"
            ? ""
            : `python3 ${JSON.stringify(fakePath)} ${fake} > "$D/ready" & until grep -q READY "$D/ready" 2>/dev/null; do :; done;`
        const run = spawnSync(
          "dbus-run-session",
          [
            `--config-file=${busConfig}`,
            "--",
            "bash",
            "-c",
            `D=${JSON.stringify(dir)}; ${start} bun -e 'const { probeSecretServiceLock } = await import(${JSON.stringify(probeModule)}); console.log(await probeSecretServiceLock())'`,
          ],
          { encoding: "utf8", timeout: 20_000, env: { ...process.env, XDG_DATA_HOME: join(dir, "data") } },
        )
        return run.stdout.trim().split("\n").at(-1) ?? ""
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }

    // #14039: a locked collection is asked to Unlock; only a finished unlock (prompt "/") followed by Locked=false counts.
    test.each([
      ["answers with the real collection path", "unlocked", "resolved"],
      ["lists nothing because another client unlocked it first", "unlocked", "raced"],
      ["finishes without a prompt but the collection stays locked", "locked", "stuck"],
      ["needs a prompt", "locked", "locked"],
      ["fails with a D-Bus error", "locked", "error"],
    ] as const)("a locked default collection whose Unlock %s is %s", (_case, expected, fake) => {
      expect(probeIn(fake)).toBe(expected)
    })
    test("an unlocked default collection is unlocked", () => {
      expect(probeIn("unlocked")).toBe("unlocked")
    })
    test("no Secret Service on the bus is absent, also where the host could activate one (#12643)", () => {
      expect(probeIn("none")).toBe("absent")
    })
  },
)
