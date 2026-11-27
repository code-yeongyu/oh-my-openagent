// One GitHub transport for every operation: JSON calls, pagination, GraphQL, downloads, uploads and local git.
import { SurfaceError } from "../vendor/surface/index.ts";
import { parseRepo } from "./env.ts";
import { gitAuthEnv, gitChildEnv } from "./git-auth.ts";
import { at, isObj, optStr } from "./read.ts";
import { createTransfer } from "./transfer.ts";
import type { Deps, GitHub } from "./types.ts";
import { createWire } from "./wire.ts";

export type {
  Deps,
  Fetch,
  GitHub,
  GitResult,
  Method,
  Repo,
  Request,
} from "./types.ts";

// Only these git commands talk to the remote. Every other one (checkout, merge, config) can run the
// checkout's hooks and filter drivers, so it gets no token.
const REMOTE_COMMANDS: ReadonlySet<string> = new Set(["clone", "fetch"]);

const nextLink = (link: string | null): string | undefined =>
  link
    ?.split(",")
    .find((part) => /rel="next"/.test(part))
    ?.match(/<([^>]+)>/)?.[1];

export const createGitHub = (deps: Deps): GitHub => {
  const wire = createWire(deps);
  const { url, send, fail, decode, redact } = wire;

  const rest: GitHub["rest"] = async (method, path, req = {}) => {
    const target = url(path, req.query);
    const res = await send(method, target, req);
    if (!res.ok) return fail(method, target, res);
    return decode(res);
  };

  const list: GitHub["list"] = async (path, limit, req = {}) => {
    const out: unknown[] = [];
    let target: URL | undefined = url(path, {
      ...req.query,
      per_page: Math.min(100, Math.max(1, limit)),
    });
    while (target && out.length < limit) {
      const res = await send("GET", target, req);
      if (!res.ok) return fail("GET", target, res);
      const body = await decode(res);
      const page = req.key === undefined ? body : at(body, req.key);
      if (!Array.isArray(page))
        throw new SurfaceError(
          "invalid_response",
          `${target.pathname} did not return a list`,
          "inspect it with `api rest`",
        );
      out.push(...page);
      const next = nextLink(res.headers.get("link"));
      target =
        next === undefined || page.length === 0 ? undefined : new URL(next);
    }
    return out.slice(0, limit);
  };

  const text: GitHub["text"] = async (path, accept) => {
    const target = url(path, undefined);
    const res = await send("GET", target, { accept });
    if (!res.ok) return fail("GET", target, res);
    return res.text();
  };

  const headers: GitHub["headers"] = async (path) => {
    const target = url(path, undefined);
    const res = await send("GET", target, {});
    if (!res.ok) return fail("GET", target, res);
    return res.headers;
  };

  const graphql: GitHub["graphql"] = async (query, variables) => {
    const body = await rest("POST", "graphql", { body: { query, variables } });
    const errors = at(body, "errors");
    if (Array.isArray(errors) && errors.length > 0) {
      const first = errors[0];
      const type = optStr(first, "type") ?? "";
      const message = errors.map((e) => optStr(e, "message") ?? "").join("; ");
      const kind =
        type === "NOT_FOUND"
          ? "not_found"
          : type === "FORBIDDEN"
            ? "forbidden"
            : "graphql";
      throw new SurfaceError(
        kind,
        await redact(message),
        kind === "not_found"
          ? "check owner/name and number"
          : "fix the query or its variables",
      );
    }
    const data = at(body, "data");
    if (!isObj(data))
      throw new SurfaceError(
        "invalid_response",
        "GraphQL response had no data",
        "inspect it with `api graphql`",
      );
    return data;
  };

  const repo: GitHub["repo"] = async (given) => {
    const source = given ?? (await deps.originRepo());
    const parsed = source === undefined ? undefined : parseRepo(source);
    if (parsed) return parsed;
    throw new SurfaceError(
      "usage",
      given === undefined
        ? "no repo given and the current directory has no GitHub origin"
        : `not a GitHub repo: ${given}`,
      "pass repo as owner/name",
    );
  };

  const git: GitHub["git"] = async (args, cwd) => {
    const res = await deps.git(
      args,
      cwd,
      gitChildEnv(
        deps.env(),
        REMOTE_COMMANDS.has(args[0] ?? "")
          ? gitAuthEnv(await deps.token())
          : {},
      ),
    );
    if (res.code !== 0)
      throw new SurfaceError(
        "git",
        await redact(
          `git ${args[0] ?? ""} exited ${res.code}: ${res.stderr.trim().slice(-400)}`,
        ),
        "run the same git command in that directory to see the cause",
      );
    return res.stdout;
  };

  return {
    rest,
    list,
    text,
    headers,
    graphql,
    repo,
    git,
    redact,
    ...createTransfer(deps, wire),
    now: deps.now,
    sleep: deps.sleep,
  };
};
