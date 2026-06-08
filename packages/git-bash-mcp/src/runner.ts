import { spawn } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
    const outputDirectory = mkdtempSync(join(tmpdir(), "omo-git-bash-run-"));
    const stdoutPath = join(outputDirectory, "stdout");
    const stderrPath = join(outputDirectory, "stderr");
    const stdoutFd = openSync(stdoutPath, "w+");
    const stderrFd = openSync(stderrPath, "w+");
    let outputClosed = false;

    function closeOutputFiles(): void {
      if (outputClosed) {
        return;
      }

      closeSync(stdoutFd);
      closeSync(stderrFd);
      outputClosed = true;
    }

    function readAndRemoveOutput(): Pick<GitBashRunResult, "stdout" | "stderr"> {
      closeOutputFiles();
      const stdout = readFileSync(stdoutPath, "utf8");
      const stderr = readFileSync(stderrPath, "utf8");
      rmSync(outputDirectory, { recursive: true, force: true });
      return { stdout, stderr };
    }

    const child = spawn(input.bashPath, ["-lc", input.command], {
      cwd: input.cwd,
      env: input.env,
      windowsHide: true,
      stdio: ["ignore", stdoutFd, stderrFd],
    });

    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, input.timeoutMs);
    timeout.unref();

    child.on("error", (error) => {
      clearTimeout(timeout);
      closeOutputFiles();
      rmSync(outputDirectory, { recursive: true, force: true });
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      const output = readAndRemoveOutput();
      resolve({ exitCode, ...output, timedOut });
    });
  });
}
