import type { MacSession } from "./session.ts"

// The Space plant needs a second Space. A fresh hosted macOS session has one, so the self-test adds one through
// Mission Control's own "add desktop" button (System Events, the accessibility route the QA session grants) before the
// typist starts. The Spaces bar shows that button only while the pointer is at the top edge, and only a real pointer
// event (not a warp) opens it, so Mission Control is opened first and the planter then moves the pointer there. The
// result is reported, never assumed: the Space plant itself checks the count again.

const ADD_DESKTOP = `
tell application "System Events"
  tell process "Dock"
    set clicked to false
    set seen to {}
    try
      set bar to group "Spaces Bar" of group 1 of group "Mission Control"
      repeat with candidate in (buttons of bar)
        set label to description of candidate
        set end of seen to label
        if label is "add desktop" then
          click candidate
          set clicked to true
          exit repeat
        end if
      end repeat
    on error message
      set end of seen to "no Spaces Bar: " & message
      try
        repeat with child in (UI elements of group "Mission Control")
          set end of seen to (role of child) & ":" & (description of child)
        end repeat
      on error inner
        set end of seen to "no Mission Control group: " & inner
      end try
    end try
  end tell
  delay 1
  key code 53
end tell
set AppleScript's text item delimiters to "|"
return (clicked as text) & " seen=" & (seen as text)
`

async function output(command: readonly string[]): Promise<{ code: number; text: string }> {
  const child = Bun.spawn([...command], { stdout: "pipe", stderr: "pipe" })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { code, text: (code === 0 ? stdout : stderr).trim().slice(0, 400) }
}

export async function ensureSecondSpace(session: MacSession): Promise<string> {
  const opened = await output(["/usr/bin/open", "-a", "Mission Control"])
  if (opened.code !== 0) return `mission_control_failed:${opened.text}`
  await Bun.sleep(1_500)
  const planter = session.planter
  if (planter !== undefined) {
    const hovered = planter.next((line) => line.ctl === "hovered", 3_000, "pointer at the top edge")
    planter.send("hover-top")
    await hovered
    await Bun.sleep(1_000)
  }
  const clicked = await output(["/usr/bin/osascript", "-e", ADD_DESKTOP])
  await Bun.sleep(1_000)
  return clicked.code === 0 ? `add_desktop_clicked=${clicked.text}` : `add_desktop_failed:${clicked.text}`
}
