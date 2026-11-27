// The request loop every GitHub call goes through: the bearer token, rate-limit waits, GET retries and error kinds.
// The token lives only in this process; every error message passes through `redact` before it leaves.
import { SurfaceError } from "../vendor/surface/index.ts";
import { errorMessage, kindFor, rateLimit } from "./errors.ts";
import type { Deps, Method, Request } from "./types.ts";

const MAX_RATE_WAIT_MS = 60_000;
const RETRIES = 3;
const MAX_REDIRECTS = 3;
export const UPLOAD_ORIGIN = "https://uploads.github.com";

export type Wire = ReturnType<typeof createWire>;

export const createWire = (deps: Deps) => {
  const redact = async (text: string): Promise<string> => {
    const token = await deps.token().catch(() => "");
    return token ? text.split(token).join("[redacted]") : text;
  };

  const api = new URL(
    deps.apiUrl.endsWith("/") ? deps.apiUrl : `${deps.apiUrl}/`,
  );
  // Parsed origins are compared, never string prefixes: api.github.com.evil.example begins with api.github.com.
  const inApi = (u: URL): boolean =>
    u.origin === api.origin && u.pathname.startsWith(api.pathname);

  const url = (path: string, query: Request["query"]): URL => {
    const u = new URL(path.replace(/^\/+/, ""), api);
    if (!inApi(u))
      throw new SurfaceError(
        "usage",
        `path leaves the API: ${path}`,
        "pass a path like repos/owner/name/pulls",
      );
    for (const [k, v] of Object.entries(query ?? {}))
      if (v !== undefined) u.searchParams.set(k, String(v));
    return u;
  };

  const payload = (
    req: Request,
  ): {
    readonly type: Readonly<Record<string, string>>;
    readonly body: { readonly body?: string | Uint8Array };
  } => {
    if (req.raw !== undefined)
      return {
        type: { "content-type": req.raw.contentType },
        body: { body: req.raw.bytes },
      };
    if (req.body === undefined) return { type: {}, body: {} };
    return {
      type: { "content-type": "application/json" },
      body: { body: JSON.stringify(req.body) },
    };
  };

  const send = async (
    method: Method,
    target: URL,
    req: Request,
  ): Promise<Response> => {
    const token = await deps.token();
    const { type, body } = payload(req);
    let at = target;
    let redirects = 0;
    for (let attempt = 0; ; attempt++) {
      // The one place the token is attached. A page link or redirect GitHub hands back is not trusted to
      // name the destination: the token goes to the API and the upload host, and nowhere else.
      if (!inApi(at) && at.origin !== UPLOAD_ORIGIN)
        throw new SurfaceError(
          "invalid_response",
          `refusing to send the token to ${at.origin}`,
          "a page link or redirect pointed outside the GitHub API; inspect the response with `api rest`",
        );
      const res = await deps
        .fetch(at.href, {
          method,
          redirect: "manual",
          headers: {
            authorization: `Bearer ${token}`,
            accept: req.accept ?? "application/vnd.github+json",
            "x-github-api-version": "2022-11-28",
            "user-agent": "github-skill",
            ...type,
          },
          ...body,
        })
        .catch(async (error: unknown) => {
          throw new SurfaceError(
            "network",
            await redact(
              error instanceof Error ? error.message : String(error),
            ),
            "check connectivity and retry",
          );
        });
      const limit = rateLimit(res, deps.now());
      if (limit) {
        if (limit.waitMs <= MAX_RATE_WAIT_MS && attempt < RETRIES) {
          await deps.sleep(Math.max(limit.waitMs, 1000));
          continue;
        }
        throw new SurfaceError(
          "rate_limited",
          `GitHub rate limit hit on ${method} ${target.pathname}`,
          `resets ${limit.when}; check with \`api rate\``,
        );
      }
      // A renamed or transferred repo answers with a redirect to another API path. Only that is followed:
      // a redirect that leaves the API (a log or asset download) goes back to the caller, who drops the token.
      const location = res.headers.get("location");
      const next = location === null ? null : URL.parse(location);
      if (
        res.status >= 300 &&
        res.status < 400 &&
        next !== null &&
        inApi(next) &&
        (method === "GET" || res.status === 307 || res.status === 308) &&
        redirects < MAX_REDIRECTS
      ) {
        at = next;
        redirects++;
        continue;
      }
      if (res.status >= 500 && method === "GET" && attempt < RETRIES) {
        await deps.sleep(1000 * 2 ** attempt);
        continue;
      }
      return res;
    }
  };

  const fail = async (
    method: Method,
    target: URL,
    res: Response,
  ): Promise<never> => {
    const message = errorMessage(await res.text().catch(() => ""));
    const [kind, hint] = kindFor(res.status, message);
    throw new SurfaceError(
      kind,
      await redact(`${method} ${target.pathname} ${res.status}: ${message}`),
      hint,
    );
  };

  const decode = async (res: Response): Promise<unknown> => {
    const text = await res.text();
    if (text === "") return {};
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  };

  return { redact, url, send, fail, decode };
};
