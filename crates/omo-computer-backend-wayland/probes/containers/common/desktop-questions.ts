// SP-W compositor-specific questions: GNOME extension and accessibility, KWin protocol reach.
import { mkdirSync, writeFileSync } from "node:fs"
import {
  type Answer,
  type Compositor,
  COMMON,
  freshSession,
  globals,
  lastJson,
  restartSession,
  run,
} from "./session-kit.ts"

const UUID = "spw-readonly@sisyphuslabs.ai"
const BUS_NAME = "ai.sisyphuslabs.SenpiShell"

async function nameHasOwner(name: string): Promise<boolean> {
  const r = await run([
    "gdbus",
    "call",
    "--session",
    "--dest",
    "org.freedesktop.DBus",
    "--object-path",
    "/org/freedesktop/DBus",
    "--method",
    "org.freedesktop.DBus.NameHasOwner",
    name,
  ])
  return r.out.includes("true")
}

// A read-only extension whose only effect is owning ai.sisyphuslabs.SenpiShell on the session bus.
function writeExtension(dir: string) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    `${dir}/metadata.json`,
    JSON.stringify({
      uuid: UUID,
      name: "SP-W read-only probe",
      description: "Owns a bus name; reads nothing, changes nothing.",
      "shell-version": ["46", "47", "48"],
    }),
  )
  writeFileSync(
    `${dir}/extension.js`,
    [
      "import Gio from 'gi://Gio';",
      "import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';",
      "export default class SpwReadOnly extends Extension {",
      `  enable() { this._id = Gio.bus_own_name(Gio.BusType.SESSION, '${BUS_NAME}', Gio.BusNameOwnerFlags.NONE, null, null, null); }`,
      "  disable() { Gio.bus_unown_name(this._id); this._id = 0; }",
      "}",
      "",
    ].join("\n"),
  )
}

export async function gnomeExtensionNoLogout(c: Compositor): Promise<Answer> {
  const home = await freshSession(c, "ext-no-logout")
  const src = `${home}/ext-src`
  writeExtension(src)
  const pack = await run(["gnome-extensions", "pack", "--force", "-o", home, src])
  const zip = `${home}/${UUID}.shell-extension.zip`
  const install = await run(["gnome-extensions", "install", "--force", zip])
  const enable = await run(["gnome-extensions", "enable", UUID])
  let owned = false
  for (let i = 0; i < 50 && !owned; i++) {
    owned = await nameHasOwner(BUS_NAME)
    if (!owned) await Bun.sleep(100)
  }
  const steps = `pack=${pack.code} install=${install.code} enable=${enable.code}${enable.err.trim() ? ` (${enable.err.trim().slice(0, 120)})` : ""}`
  // control: the same extension after a logout and login, which proves the fixture itself works
  await restartSession(c)
  let ownedAfterRelogin = false
  for (let i = 0; i < 100 && !ownedAfterRelogin; i++) {
    ownedAfterRelogin = await nameHasOwner(BUS_NAME)
    if (!ownedAfterRelogin) await Bun.sleep(100)
  }
  const observed = `${steps}; ${BUS_NAME} owned within 5 s without logout=${owned}; control after logout+login owned=${ownedAfterRelogin}`
  if (!owned && !ownedAfterRelogin)
    return {
      answer: null,
      observed,
      reason: "the fixture extension never owned its name even after a re-login, so the no-logout leg proves nothing",
    }
  return { answer: owned, observed }
}

async function setA11yEnabled(): Promise<string> {
  const r = await run([
    "gdbus",
    "call",
    "--session",
    "--dest",
    "org.a11y.Bus",
    "--object-path",
    "/org/a11y/bus",
    "--method",
    "org.freedesktop.DBus.Properties.Set",
    "org.a11y.Status",
    "IsEnabled",
    "<true>",
  ])
  return `IsEnabled write exit=${r.code}${r.err.trim() ? ` ${r.err.trim().slice(0, 120)}` : ""}`
}
const gsettingsA11y = async () =>
  (await run(["gsettings", "get", "org.gnome.desktop.interface", "toolkit-accessibility"])).out.trim()

export async function a11yGsettings(c: Compositor): Promise<Answer> {
  await freshSession(c, "a11y-gsettings")
  const before = await gsettingsA11y()
  const wrote = await setA11yEnabled()
  let after = before
  for (let i = 0; i < 20 && after !== "true"; i++) {
    await Bun.sleep(100)
    after = await gsettingsA11y()
  }
  return {
    answer: after === "true",
    observed: `toolkit-accessibility before=${before}; ${wrote}; after (within 2 s)=${after}`,
  }
}

const APPS: Record<string, { cmd: string[]; names: string[] }> = {
  gedit: { cmd: ["gedit", "--new-window"], names: ["gedit"] },
  qt6: { cmd: ["python3", "/probes/containers/gnome/qt6-fixture.py"], names: ["spw-qt6-fixture"] },
  chromium: {
    cmd: [
      "/opt/chromium/chrome",
      "--no-sandbox",
      "--ozone-platform=wayland",
      "--user-data-dir=/tmp/spw-chromium",
      "--no-first-run",
      "about:blank",
    ],
    names: ["Chromium", "chromium", "chrome"],
  },
}

export async function a11yRegistry(c: Compositor, app: keyof typeof APPS): Promise<Answer> {
  await freshSession(c, `a11y-registry-${app}`)
  const wrote = await setA11yEnabled()
  const spec = APPS[app]
  if (!spec) throw new Error(`unknown app ${app}`)
  const proc = Bun.spawn(spec.cmd, { stdout: "ignore", stderr: "pipe" })
  let names: string[] = []
  try {
    for (let i = 0; i < 40; i++) {
      names = (lastJson((await run(["python3", `${COMMON}/atspi.py`, "list"])).out).apps ?? []) as string[]
      if (names.some((n) => spec.names.includes(n))) break
      await Bun.sleep(500)
    }
  } finally {
    proc.kill(9)
  }
  const found = names.some((n) => spec.names.includes(n))
  return {
    answer: found,
    observed: `${wrote}; started ${app} after the write, no other step; registry apps within 20 s: [${names.join(", ")}]`,
  }
}

const PWM = "org_kde_plasma_window_management"

export async function kdePwmBind(c: Compositor, launch: "plain" | "desktop-file"): Promise<Answer> {
  await freshSession(c, `kde-pwm-bind-${launch}`, async (home) => {
    if (launch !== "desktop-file") return
    mkdirSync(`${home}/.local/share/applications`, { recursive: true })
    writeFileSync(
      `${home}/.local/share/applications/spw-wayland-info.desktop`,
      `[Desktop Entry]\nType=Application\nName=spw wayland-info\nExec=/usr/bin/wayland-info\nNoDisplay=true\nX-KDE-Wayland-Interfaces=${PWM}\n`,
    )
  })
  if (launch === "desktop-file") await run(["kbuildsycoca6"], 60_000)
  const g = await globals()
  return {
    answer: g.includes(PWM),
    observed: `${PWM} advertised to /usr/bin/wayland-info (${launch === "plain" ? "plain child process, no desktop file" : "desktop file with X-KDE-Wayland-Interfaces"}): ${g.includes(PWM)}; globals=${g.length}`,
  }
}

export async function wlrForeignToplevel(c: Compositor): Promise<Answer> {
  await freshSession(c, "wlr-foreign-toplevel")
  const g = await globals()
  const has = g.includes("zwlr_foreign_toplevel_manager_v1")
  return {
    answer: has,
    observed: `zwlr_foreign_toplevel_manager_v1 advertised: ${has}; ext_foreign_toplevel_list_v1: ${g.includes("ext_foreign_toplevel_list_v1")}`,
  }
}

// The KDE rung of the activation ladder: org_kde_plasma_window_management's activation request (set_state active),
// sent by a client KWin authorised through a desktop file, for a window that is NOT the active one.
export async function kdeActivate(c: Compositor): Promise<Answer> {
  // KWin authorises by executable path and takes the FIRST desktop file naming it; Debian's python3.x.desktop
  // already names the system interpreter, so the helper runs from its own copy of it (an engine has its own binary)
  let py = ""
  await freshSession(c, "kde-activate", async (home) => {
    py = `${home}/spw-pwm-python`
    await run(["cp", (await run(["readlink", "-f", "/usr/bin/python3"])).out.trim(), py])
    mkdirSync(`${home}/.local/share/applications`, { recursive: true })
    writeFileSync(
      `${home}/.local/share/applications/spw-pwm.desktop`,
      `[Desktop Entry]\nType=Application\nName=spw pwm probe\nExec=${py}\nNoDisplay=true\nX-KDE-Wayland-Interfaces=${PWM}\n`,
    )
  })
  await run(["kbuildsycoca6"], 60_000)
  const first = Bun.spawn(["timeout", "-s", "KILL", "60", "wev"], { stdout: "ignore", stderr: "ignore" })
  await Bun.sleep(1500)
  const second = Bun.spawn(["timeout", "-s", "KILL", "60", "wev"], { stdout: "ignore", stderr: "ignore" })
  await Bun.sleep(1500)
  // each wev runs under timeout; the window belongs to timeout's child
  const child = async (pid: number) => Number((await run(["pgrep", "-P", String(pid)])).out.trim().split("\n")[0] ?? 0)
  const [firstPid, secondPid] = [await child(first.pid), await child(second.pid)]
  try {
    const r = await run([py, "/probes/containers/kde/kde-pwm.py", String(firstPid)], 30_000)
    const rec = lastJson(r.out)
    const seen = `first window pid=${firstPid}, second (newer, focused) pid=${secondPid}; helper=${JSON.stringify(rec)}${r.code ? ` exit=${r.code} ${r.err.trim().split("\n").slice(-1)[0] ?? ""}` : ""}`
    if (r.code !== 0)
      return {
        answer: null,
        observed: seen,
        reason: "the activation helper itself failed before it could bind, so nothing was measured",
      }
    if (rec.bound !== true)
      return {
        answer: null,
        observed: seen,
        reason: `${PWM} did not bind even for the desktop-file-authorised helper, so no activation request could be sent`,
      }
    if (rec.active_before !== secondPid)
      return {
        answer: null,
        observed: seen,
        reason: "the newer window was not active before the request, so an activation could not be told apart",
      }
    return { answer: rec.active_after === firstPid, observed: seen }
  } finally {
    first.kill(9)
    second.kill(9)
  }
}
