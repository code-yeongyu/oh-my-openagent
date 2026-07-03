import { existsSync } from "node:fs"

import {
  runCommentChecker,
  type CheckResult,
  type RunCommentCheckerInput,
  type SpawnProcess,
} from "@oh-my-opencode/comment-checker-core"

export async function defaultRunCommentChecker(input: RunCommentCheckerInput): Promise<CheckResult> {
  return runCommentChecker(input, {
    existsSync,
    spawn: spawnCommentChecker,
  })
}

function spawnCommentChecker(args: readonly string[]): SpawnProcess {
  const subprocess = Bun.spawn([...args], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  return {
    stdin: {
      write(input: string) {
        subprocess.stdin.write(input)
      },
      end() {
        subprocess.stdin.end()
      },
    },
    stdout: subprocess.stdout,
    stderr: subprocess.stderr,
    exited: subprocess.exited,
    kill(signal) {
      subprocess.kill(signal)
    },
  }
}
