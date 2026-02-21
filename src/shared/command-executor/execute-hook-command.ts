import { spawn } from "node:child_process";
import { getHomeDirectory } from "./home-directory";
import { findBashPath, findZshPath } from "./shell-path";

export interface CommandResult {
  exitCode: number;
  stdout?: string;
  stderr?: string;
}

const DEFAULT_HOOK_TIMEOUT_MS = 30_000;
const SIGKILL_GRACE_MS = 5_000;

export interface ExecuteHookOptions {
  forceZsh?: boolean;
  zshPath?: string;
  /** Timeout in milliseconds. Process is killed after this. Default: 30000 */
  timeoutMs?: number;
}

export async function executeHookCommand(
  command: string,
  stdin: string,
  cwd: string,
  options?: ExecuteHookOptions,
): Promise<CommandResult> {
  const home = getHomeDirectory();
  const timeoutMs = options?.timeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS;

  const expandedCommand = command
    .replace(/^~(?=\/|$)/g, home)
    .replace(/\s~(?=\/)/g, ` ${home}`)
    .replace(/\$CLAUDE_PROJECT_DIR/g, cwd)
    .replace(/\$\{CLAUDE_PROJECT_DIR\}/g, cwd);

  let finalCommand = expandedCommand;

  if (options?.forceZsh) {
    const zshPath = findZshPath(options.zshPath);
    const escapedCommand = expandedCommand.replace(/'/g, "'\\''");
    if (zshPath) {
      finalCommand = `${zshPath} -lc '${escapedCommand}'`;
    } else {
      const bashPath = findBashPath();
      if (bashPath) {
        finalCommand = `${bashPath} -lc '${escapedCommand}'`;
      }
    }
  }

  return new Promise(resolve => {
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | null = null;

    const proc = spawn(finalCommand, {
      cwd,
      shell: true,
      env: { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: cwd },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.stdin?.write(stdin);
    proc.stdin?.end();

    const settle = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      resolve(result);
    };

    proc.on("close", code => {
      settle({
        exitCode: code ?? 1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });

    proc.on("error", err => {
      settle({ exitCode: 1, stderr: err.message });
    });

    const timeoutTimer = setTimeout(() => {
      if (settled) return;
      // Try graceful shutdown first
      try {
        proc.kill("SIGTERM");
      } catch {}
      killTimer = setTimeout(() => {
        if (settled) return;
        try {
          proc.kill("SIGKILL");
        } catch {}
      }, SIGKILL_GRACE_MS);
      // Append timeout notice to stderr
      stderr += `\nHook command timed out after ${timeoutMs}ms`;
    }, timeoutMs);

    // Don't let the timeout timer keep the process alive
    if (timeoutTimer && typeof timeoutTimer === "object" && "unref" in timeoutTimer) {
      timeoutTimer.unref();
    }
  });
}
