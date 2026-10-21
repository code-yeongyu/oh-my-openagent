"""Run a command on a real pty and answer its consent prompts.

Usage: tty-driver.py <answer> <prompt-marker> <command> [args...]

When the marker is non-empty the driver answers every time the marker appears in the output,
up to MAX_PROMPTS times. An empty marker runs the command on a pty without answering anything
(useful for crash dumps).

`expect` ships on macOS but not on the Linux CI image, and BSD `script` reports its own exit status
instead of the child's, so neither can drive this prompt on both platforms. PR-D made `omo setup`
interactive ask per server (one prompt per MCP server + one per custom provider), so a single
first-prompt answer was no longer enough — the driver now feeds the answer to every prompt
that carries the marker, capped at MAX_PROMPTS so a runaway cannot wedge the child.
"""

import os
import pty
import select
import sys

TIMEOUT_SECONDS = 60
MAX_PROMPTS = 32


def main() -> int:
    answer = sys.argv[1].encode()
    marker = sys.argv[2].encode()
    argv = sys.argv[3:]

    pid, fd = pty.fork()
    if pid == 0:
        os.execvp(argv[0], argv)

    output = bytearray()
    answered = 0
    cursor = 0
    while True:
        try:
            readable, _, _ = select.select([fd], [], [], TIMEOUT_SECONDS)
        except OSError:
            break
        if not readable:
            break
        try:
            chunk = os.read(fd, 65536)
        except OSError:
            break
        if not chunk:
            break
        output += chunk
        if not marker or answered >= MAX_PROMPTS:
            continue
        # Find the next marker past the cursor so the same prompt is not answered twice when its
        # bytes straddle two reads (the buffer is bytearray so index() returns the absolute offset).
        found = bytes(output).find(marker, cursor)
        while found != -1 and answered < MAX_PROMPTS:
            os.write(fd, answer)
            answered += 1
            cursor = found + len(marker)
            found = bytes(output).find(marker, cursor)

    os.close(fd)
    _, status = os.waitpid(pid, 0)
    sys.stdout.write(output.decode("utf8", "replace"))
    code = os.waitstatus_to_exitcode(status)
    return code if code >= 0 else 1


if __name__ == "__main__":
    sys.exit(main())
