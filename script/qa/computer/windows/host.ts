// Facts about the host the live Windows driver runs on, read by the driver's own process.

/** The Windows session id of this process (0 is the services session, with no interactive desktop). */
export async function sessionId(): Promise<number> {
  const child = Bun.spawn(["powershell", "-NoProfile", "-Command", `(Get-Process -Id ${process.pid}).SessionId`], {
    stdout: "pipe",
  })
  return Number((await new Response(child.stdout).text()).trim())
}
