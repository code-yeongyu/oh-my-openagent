// The Space plant needs a second Space. A fresh hosted macOS session has one, so the self-test adds one through
// Mission Control's own "add desktop" button (System Events, the accessibility route the QA session grants) before the
// typist starts. The result is reported, never assumed: the Space plant itself checks the count again.

const ADD_DESKTOP = `
tell application "Mission Control" to launch
delay 1.5
tell application "System Events"
  set clicked to false
  repeat with element in (entire contents of process "Dock")
    try
      if description of element is "add desktop" then
        click element
        set clicked to true
        exit repeat
      end if
    end try
  end repeat
  delay 1
  key code 53
end tell
return clicked
`

export async function ensureSecondSpace(): Promise<string> {
  const script = Bun.spawn(["/usr/bin/osascript", "-e", ADD_DESKTOP], { stdout: "pipe", stderr: "pipe" })
  const [code, stdout, stderr] = await Promise.all([
    script.exited,
    new Response(script.stdout).text(),
    new Response(script.stderr).text(),
  ])
  await Bun.sleep(1_000)
  return code === 0 ? `add_desktop_clicked=${stdout.trim()}` : `add_desktop_failed:${stderr.trim().slice(0, 200)}`
}
