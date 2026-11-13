// SP-W protocol-reach questions: KWin's plasma window management (bind and activation) and the wlr foreign-toplevel
// manager, read from the Wayland registry a client is shown.
import { mkdirSync, writeFileSync } from "node:fs"
import { type Answer, type Compositor, freshSession, globals, lastJson, run } from "./session-kit.ts"
import { activateAnswer, pwmAnswer } from "./verdicts.ts"

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
  const cacheBuilt = launch === "plain" || (await run(["kbuildsycoca6"], 60_000)).code === 0
  const g = await globals()
  const answer = pwmAnswer(g, PWM, cacheBuilt)
  if (answer === null || g === null)
    return {
      answer: null,
      observed: `wayland-info read=${g !== null}; service cache built=${cacheBuilt}`,
      reason: "wayland-info read nothing, or the service cache carrying the desktop file did not build",
    }
  return {
    answer,
    observed: `${PWM} advertised to /usr/bin/wayland-info (${launch === "plain" ? "plain child process, no desktop file" : "desktop file with X-KDE-Wayland-Interfaces"}): ${g.includes(PWM)}; globals=${g.length}`,
  }
}

export async function wlrForeignToplevel(c: Compositor): Promise<Answer> {
  await freshSession(c, "wlr-foreign-toplevel")
  const g = await globals()
  if (!g)
    return { answer: null, observed: "wayland-info failed or listed no global", reason: "the registry was not read" }
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
  const cacheBuilt = (await run(["kbuildsycoca6"], 60_000)).code === 0
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
        observed: `${seen}; service cache built=${cacheBuilt}`,
        reason: `${PWM} did not bind even for the desktop-file-authorised helper, so no activation request could be sent`,
      }
    const answer = activateAnswer(rec, firstPid, secondPid)
    if (answer === null)
      return {
        answer,
        observed: seen,
        reason:
          "a window pid was unknown, the target window was never found, the newer window was not active first, or no active window was read after the request",
      }
    return { answer, observed: seen }
  } finally {
    first.kill(9)
    second.kill(9)
  }
}
