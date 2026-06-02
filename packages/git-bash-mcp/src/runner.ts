import { spawn } from "node:child_process";

export interface GitBashRunInput {
  readonly bashPath: string;
  readonly command: string;
  readonly cwd?: string;
  readonly timeoutMs: number;
  readonly env?: NodeJS.ProcessEnv;
}

export interface GitBashRunResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export type RunGitBashCommand = (input: GitBashRunInput) => Promise<GitBashRunResult>;

export async function runGitBashCommand(input: GitBashRunInput): Promise<GitBashRunResult> {
  return await new Promise<GitBashRunResult>((resolve, reject) => {
    const child = spawn(input.bashPath, ["-lc", input.command], {
      cwd: input.cwd,
      env: input.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, input.timeoutMs);
    timeout.unref();

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      resolve({ exitCode, stdout, stderr, timedOut });
    });
  });
}
