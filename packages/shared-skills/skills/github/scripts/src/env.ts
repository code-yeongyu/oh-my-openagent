// Where the transport's inputs come from by default: the token (GH_TOKEN, GITHUB_TOKEN, else the gh login read once
// in-process) and the repo (the git origin of the working directory).
import { SurfaceError } from "../vendor/surface/index.ts";
import { gitChildEnv } from "./git-auth.ts";
import type { Deps, GitResult, Repo } from "./http.ts";

const spawnText = async (
  cmd: readonly string[],
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<string | undefined> => {
  try {
    const proc = Bun.spawn([...cmd], {
      env,
      stdout: "pipe",
      stderr: "ignore",
      stdin: "ignore",
    });
    const [out, code] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    return code === 0 ? out.trim() : undefined;
  } catch {
    return undefined;
  }
};

const runGit = async (
  args: readonly string[],
  cwd: string,
  env: Readonly<Record<string, string>>,
): Promise<GitResult> => {
  try {
    const proc = Bun.spawn(["git", ...args], {
      cwd,
      env,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code, stdout, stderr };
  } catch (error) {
    return {
      code: 127,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
    };
  }
};

export const defaultToken = (): (() => Promise<string>) => {
  let cached: Promise<string> | undefined;
  return () =>
    (cached ??= (async () => {
      const env = process.env["GH_TOKEN"] ?? process.env["GITHUB_TOKEN"];
      if (env) return env;
      const fromGh = await spawnText([
        "gh",
        "auth",
        "token",
        "--hostname",
        "github.com",
      ]);
      if (fromGh) return fromGh;
      throw new SurfaceError(
        "auth",
        "no GitHub token",
        "set GH_TOKEN, or log in once with `gh auth login`",
      );
    })());
};

export const parseRepo = (text: string): Repo | undefined => {
  const m =
    /^(?:https?:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(
      text.trim(),
    );
  if (!m?.[1] || !m[2]) return undefined;
  return { owner: m[1], name: m[2], full: `${m[1]}/${m[2]}` };
};

export const defaultDeps = (): Deps => ({
  fetch: (url, init) => fetch(url, init),
  git: runGit,
  env: () => process.env,
  token: defaultToken(),
  originRepo: () =>
    spawnText(
      ["git", "remote", "get-url", "origin"],
      gitChildEnv(process.env, {}),
    ),
  sleep: (ms) => Bun.sleep(ms),
  now: () => Date.now(),
  apiUrl: "https://api.github.com/",
});
