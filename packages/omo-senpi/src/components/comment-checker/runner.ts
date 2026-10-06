import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { Readable } from "node:stream"

import {
  runCommentChecker,
  sendAndCloseStdin,
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
  const [command, ...commandArgs] = args
  if (command === undefined) {
    throw new Error("comment-checker command is required")
  }
  const subprocess = spawn(command, commandArgs, {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  })
  const exited = new Promise<number>((resolve, reject) => {
    subprocess.on("error", reject)
    subprocess.on("close", (code) => resolve(code ?? 1))
  })
  return {
    stdin: {
      send: (input: string) => sendAndCloseStdin(subprocess.stdin, input),
    },
    stdout: Readable.toWeb(subprocess.stdout),
    stderr: Readable.toWeb(subprocess.stderr),
    exited,
    kill(signal) {
      subprocess.kill(signal)
    },
  }
}
