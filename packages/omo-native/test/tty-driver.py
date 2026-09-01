"""Run a command on a real pty and answer its first consent prompt.

Usage: tty-driver.py <answer> <prompt-marker> <command> [args...]

An empty marker runs the command on a pty without answering anything.

`expect` ships on macOS but not on the Linux CI image, and BSD `script` reports its own exit status
instead of the child's, so neither can drive this prompt on both platforms.
"""

import os
import pty
import select
import sys

TIMEOUT_SECONDS = 60


def main() -> int:
    answer = sys.argv[1].encode()
    marker = sys.argv[2].encode()
    argv = sys.argv[3:]

    pid, fd = pty.fork()
    if pid == 0:
        os.execvp(argv[0], argv)

    output = bytearray()
    answered = False
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
        if not answered and marker and marker in bytes(output):
            os.write(fd, answer)
            answered = True

    os.close(fd)
    _, status = os.waitpid(pid, 0)
    sys.stdout.write(output.decode("utf8", "replace"))
    code = os.waitstatus_to_exitcode(status)
    return code if code >= 0 else 1


if __name__ == "__main__":
    sys.exit(main())
