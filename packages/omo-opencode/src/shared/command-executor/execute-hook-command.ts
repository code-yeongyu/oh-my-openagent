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
  /** Grace period before force-killing and resolving timed-out commands. Default: 5000 */
  killGraceMs?: number;
  /** When provided, scrub process.env to only include these vars plus HOME/PATH/etc. Used for plugin-sourced hooks. */
  allowedEnvVars?: string[];
  /**
   * Plugin install path. When set, CLAUDE_PLUGIN_ROOT is exported into the
   * spawn env and substituted in the command string so plugin-sourced hooks
   * can reference $CLAUDE_PLUGIN_ROOT / ${CLAUDE_PLUGIN_ROOT} the same way
   * Claude Code's CLI does (#4458).
   */
  pluginRoot?: string;
}

export async function executeHookCommand(
  command: string,
  stdin: string,
  cwd: string,
  options?: ExecuteHookOptions,
): Promise<CommandResult> {
  const home = getHomeDirectory();
  const timeoutMs = options?.timeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS;
  const killGraceMs = options?.killGraceMs ?? SIGKILL_GRACE_MS;

  const pluginRoot = options?.pluginRoot;
  let expandedCommand = command
    .replace(/^~(?=\/|$)/g, home)
    .replace(/\s~(?=\/)/g, ` ${home}`)
    .replace(/\$CLAUDE_PROJECT_DIR/g, cwd)
    .replace(/\$\{CLAUDE_PROJECT_DIR\}/g, cwd);

  if (pluginRoot) {
    expandedCommand = expandedCommand
      .replace(/\$CLAUDE_PLUGIN_ROOT/g, pluginRoot)
      .replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, pluginRoot);
  }

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
    let timedOut = false;
    let killTimer: ReturnType<typeof setTimeout> | null = null;

    const isWin32 = process.platform === "win32";

    // Keys that are always set from normalized sources and must not be
    // overwritten by ambient process.env values during the allowlist merge.
    const PROTECTED_ENV_KEYS = new Set(["HOME", "CLAUDE_PROJECT_DIR", "CLAUDE_PLUGIN_ROOT"]);

    let env: Record<string, string | undefined>;
    if (options?.allowedEnvVars) {
      const allowedSet = new Set(options.allowedEnvVars);
      env = {
        HOME: home,
        CLAUDE_PROJECT_DIR: cwd,
        PATH: process.env.PATH,
      };
      for (const key of Object.keys(process.env)) {
        if (allowedSet.has(key) && !PROTECTED_ENV_KEYS.has(key)) {
          env[key] = process.env[key];
        }
      }
    } else {
      env = { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: cwd };
    }

    if (pluginRoot) {
      env.CLAUDE_PLUGIN_ROOT = pluginRoot;
    }

    const proc = spawn(finalCommand, {
      cwd,
      shell: true,
      detached: !isWin32,
      env,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.stdin?.on("error", () => {});
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
      if (timedOut) {
        appendTimeoutNotice();
        settle({
          exitCode: 124,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        });
        return;
      }
      settle({
        exitCode: code ?? 1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });

    proc.on("error", err => {
      settle({ exitCode: 1, stderr: err.message });
    });

    const killWindowsProcessTree = (onComplete?: () => void) => {
      if (!proc.pid) {
        onComplete?.();
        return;
      }
      const killer = spawn("taskkill", ["/PID", String(proc.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      const finish = () => onComplete?.();
      killer.on("error", finish);
      killer.on("close", finish);
    };

    const killProcessGroup = (signal: NodeJS.Signals) => {
      try {
        if (!isWin32 && proc.pid) {
          try {
            process.kill(-proc.pid, signal);
          } catch (error) {
            if (!(error instanceof Error)) {
              throw error;
            }
            proc.kill(signal);
          }
        } else {
          proc.kill(signal);
          if (signal === "SIGKILL") {
            killWindowsProcessTree();
          }
        }
      } catch (error) {
        if (!(error instanceof Error)) {
          throw error;
        }
      }
    };

    const appendTimeoutNotice = () => {
      if (!stderr.includes("Hook command timed out after")) {
        stderr += `\nHook command timed out after ${timeoutMs}ms`;
      }
    };

    const timeoutTimer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      appendTimeoutNotice();
      if (isWin32) {
        killWindowsProcessTree(() => {
          settle({
            exitCode: 124,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
          });
        });
        return;
      }
      // Kill entire process group to avoid orphaned children
      killProcessGroup("SIGTERM");
      killTimer = setTimeout(() => {
        if (settled) return;
        if (isWin32) {
          killWindowsProcessTree(() => {
            settle({
              exitCode: 124,
              stdout: stdout.trim(),
              stderr: stderr.trim(),
            });
          });
          return;
        }
        killProcessGroup("SIGKILL");
        settle({
          exitCode: 124,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        });
      }, killGraceMs);
      if (killTimer && typeof killTimer === "object" && "unref" in killTimer) {
        killTimer.unref();
      }
    }, timeoutMs);

    // Don't let the timeout timer keep the process alive
    if (timeoutTimer && typeof timeoutTimer === "object" && "unref" in timeoutTimer) {
      timeoutTimer.unref();
    }
  });
}
