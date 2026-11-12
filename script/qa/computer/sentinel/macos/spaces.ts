import type { MacSession } from "./session.ts"

// The Space plant needs a second Space. A fresh hosted macOS session has one, so the self-test adds one through
// Mission Control's own "add desktop" button (System Events, the accessibility route the QA session grants) before the
// typist starts. The Spaces bar only shows that button while the pointer is at the top edge, so the planter moves the
// pointer there first. The result is reported, never assumed: the Space plant itself checks the count again.

const ADD_DESKTOP = `
tell application "Mission Control" to launch
delay 1.5
tell application "System Events"
  set clicked to false
  set seen to {}
  repeat with element in (entire contents of process "Dock")
    try
      set label to description of element
      if label is "add desktop" then
        click element
        set clicked to true
        exit repeat
      end if
      if (count of seen) < 12 and label is not missing value and label is not "" then set end of seen to label
    end try
  end repeat
  delay 1
  key code 53
end tell
set AppleScript's text item delimiters to "|"
return (clicked as text) & " seen=" & (seen as text)
`

export async function ensureSecondSpace(session: MacSession): Promise<string> {
  const planter = session.planter
  if (planter !== undefined) {
    const hovered = planter.next((line) => line.ctl === "hovered", 3_000, "pointer at the top edge")
    planter.send("hover-top")
    await hovered
  }
  const script = Bun.spawn(["/usr/bin/osascript", "-e", ADD_DESKTOP], { stdout: "pipe", stderr: "pipe" })
  const [code, stdout, stderr] = await Promise.all([
    script.exited,
    new Response(script.stdout).text(),
    new Response(script.stderr).text(),
  ])
  await Bun.sleep(1_000)
  return code === 0 ? `add_desktop_clicked=${stdout.trim()}` : `add_desktop_failed:${stderr.trim().slice(0, 200)}`
}
