import { expect, test } from "bun:test"
import { join } from "node:path"

// Checker LOW (#13337 @ e6ac0bca): releasing the controlling terminal closes each descriptor exactly once. The
// fixture runs on a real pty (Python's pty.fork) and reports whether a late second close hit a reused fd.
const DRIVE = [
  "import os, pty, sys",
  "pid, fd = pty.fork()",
  "if pid == 0:",
  "    os.execvp(sys.argv[1], sys.argv[1:])",
  "out = b''",
  "while True:",
  "    try:",
  "        chunk = os.read(fd, 4096)",
  "    except OSError:",
  "        break",
  "    if not chunk:",
  "        break",
  "    out += chunk",
  "os.waitpid(pid, 0)",
  "sys.stdout.write(out.decode('utf-8', 'replace'))",
].join("\n")

test.skipIf(process.platform === "win32")(
  "#given the real controlling terminal #when the phrase terminal is opened and released #then no descriptor is closed twice",
  async () => {
    const child = Bun.spawn(
      ["python3", "-c", DRIVE, "bun", join(import.meta.dir, "fixtures/tty-close-once.fixture.ts")],
      {
        stdout: "pipe",
        stderr: "pipe",
        timeout: 30_000,
      },
    )
    const [stdout] = await Promise.all([new Response(child.stdout).text(), child.exited])
    expect(stdout).toContain("CLOSED_ONCE")
  },
  40_000,
)
