import { defaultDeps } from "../src/env.ts";
import { createGitHub, type Deps, type GitResult } from "../src/http.ts";

export type Seen = {
  method: string;
  url: string;
  auth: string | null;
  contentType: string | null;
  body: unknown;
  bytes: Uint8Array | undefined;
};
export type Route = (req: Seen) => Response | undefined;
export type GitCall = { args: readonly string[]; cwd: string };
export type FakeGit = (call: GitCall) => Partial<GitResult> | undefined;

export const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

export const TOKEN = "ghp_test_secret_token_value";

export const fakeDeps = (
  routes: readonly Route[],
  origin = "git@github.com:acme/widgets.git",
  git: FakeGit = () => undefined,
) => {
  const seen: Seen[] = [];
  const slept: number[] = [];
  const gitCalls: GitCall[] = [];
  const gitEnvs: Readonly<Record<string, string>>[] = [];
  const deps: Partial<Deps> = {
    token: () => Promise.resolve(TOKEN),
    originRepo: () => Promise.resolve(origin),
    sleep: (ms) => {
      slept.push(ms);
      return Promise.resolve();
    },
    now: () => 1_700_000_000_000,
    env: () => ({
      PATH: "/usr/bin",
      HOME: "/home/u",
      GH_TOKEN: TOKEN,
      GITHUB_TOKEN: TOKEN,
    }),
    git: (args, cwd, env) => {
      const call = { args, cwd };
      gitCalls.push(call);
      gitEnvs.push(env);
      return Promise.resolve({ code: 0, stdout: "", stderr: "", ...git(call) });
    },
    fetch: (url, init) => {
      const headers = new Headers(init.headers);
      const req: Seen = {
        method: init.method ?? "GET",
        url,
        auth: headers.get("authorization"),
        contentType: headers.get("content-type"),
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
        bytes: init.body instanceof Uint8Array ? init.body : undefined,
      };
      seen.push(req);
      for (const route of routes) {
        const res = route(req);
        if (res) return Promise.resolve(res);
      }
      return Promise.resolve(
        json({ message: `unrouted ${req.method} ${url}` }, 418),
      );
    },
  };
  return { deps, seen, slept, gitCalls, gitEnvs };
};

/** The transport over fake routes, for testing an `xxxOps(gh)` factory directly. */
export const fakeGitHub = (
  routes: readonly Route[],
  origin?: string,
  git?: FakeGit,
) => {
  const fake = fakeDeps(routes, origin, git);
  return { ...fake, gh: createGitHub({ ...defaultDeps(), ...fake.deps }) };
};

export const on =
  (method: string, path: RegExp, reply: (req: Seen) => Response): Route =>
  (req) =>
    req.method === method &&
    path.test(new URL(req.url).pathname + new URL(req.url).search)
      ? reply(req)
      : undefined;
