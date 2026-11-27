// What the authenticated account sees across repositories: status digest, organizations and the token in use.
import { op, s, SurfaceError } from "../vendor/surface/index.ts";
import { enc, limitField, reads } from "./fields.ts";
import type { GitHub } from "./http.ts";
import { at, num, optNum, optStr, str } from "./read.ts";
import { searchRaw } from "./search.ts";

type Env = Readonly<Record<string, string | undefined>>;
type Scope = {
  readonly org: string | undefined;
  readonly exclude: readonly string[];
};

const SEARCH_LIMIT = 25;
const NOTIFICATION_LIMIT = 300;
const EVENT_LIMIT = 200;
const FETCH_WIDTH = 10;
const PREVIEW = 200;

const inScope = (
  scope: Scope,
  repo: string | null,
  owner: string | null,
): repo is string =>
  repo !== null &&
  (scope.org === undefined ||
    owner?.toLowerCase() === scope.org.toLowerCase()) &&
  !scope.exclude.some((x) => x.toLowerCase() === repo.toLowerCase());

const preview = (body: string | null) => body?.slice(0, PREVIEW) ?? null;

const searchItems = async (gh: GitHub, q: string) =>
  (await searchRaw(gh, q, SEARCH_LIMIT)).raw.map((i) => ({
    repo: (optStr(i, "repository_url") ?? "").replace(/^.*\/repos\//, ""),
    number: num(i, "number"),
    title: str(i, "title"),
    url: str(i, "html_url"),
    updatedAt: optStr(i, "updated_at"),
  }));

const commentMentioning = async (gh: GitHub, url: string, login: string) => {
  try {
    const c = await gh.rest("GET", new URL(url).pathname.slice(1));
    const body = optStr(c, "body") ?? "";
    return body.toLowerCase().includes(`@${login.toLowerCase()}`)
      ? { body, url: optStr(c, "html_url") }
      : undefined;
  } catch (error) {
    // gh skips comments that were deleted or sit behind SSO the token is not authorized for.
    if (
      error instanceof SurfaceError &&
      (error.kind === "not_found" || error.kind === "forbidden")
    )
      return undefined;
    throw error;
  }
};

const mentions = async (gh: GitHub, login: string, scope: Scope) => {
  const notes = (
    await gh.list("notifications", NOTIFICATION_LIMIT, {
      query: { participating: true, all: true },
    })
  ).flatMap((n) => {
    const repo = optStr(n, "repository", "full_name");
    const comment = optStr(n, "subject", "latest_comment_url");
    return optStr(n, "reason") === "mention" &&
      comment !== null &&
      inScope(scope, repo, optStr(n, "repository", "owner", "login"))
      ? [{ repo, comment, n }]
      : [];
  });
  const out = [];
  for (let i = 0; i < notes.length; i += FETCH_WIDTH) {
    const batch = notes.slice(i, i + FETCH_WIDTH);
    const found = await Promise.all(
      batch.map((x) => commentMentioning(gh, x.comment, login)),
    );
    for (const [j, hit] of found.entries()) {
      const note = batch[j];
      if (hit === undefined || note === undefined) continue;
      const number = Number(
        (optStr(note.n, "subject", "url") ?? "").split("/").pop(),
      );
      out.push({
        repo: note.repo,
        number: Number.isInteger(number) ? number : null,
        title: optStr(note.n, "subject", "title"),
        url: hit.url,
        preview: preview(hit.body),
      });
    }
  }
  return out;
};

const activityEntry = (e: unknown) => {
  const action = optStr(e, "payload", "action");
  switch (optStr(e, "type") ?? "") {
    case "IssuesEvent":
      return action === "opened"
        ? { reason: "new issue", subject: "issue", comment: false }
        : undefined;
    case "PullRequestEvent":
      return action === "opened"
        ? { reason: "new PR", subject: "pull_request", comment: false }
        : undefined;
    case "IssueCommentEvent":
      return { reason: "comment", subject: "issue", comment: true };
    case "PullRequestReviewCommentEvent":
      return { reason: "comment", subject: "pull_request", comment: true };
    default:
      return undefined;
  }
};

const activity = async (gh: GitHub, login: string, scope: Scope) =>
  (await gh.list(`users/${enc(login)}/received_events`, EVENT_LIMIT)).flatMap(
    (e) => {
      const kind = activityEntry(e);
      if (kind === undefined) return [];
      const repo = optStr(e, "repo", "name");
      const owner = optStr(e, "org", "login") ?? repo?.split("/")[0] ?? null;
      const subject = at(e, "payload", kind.subject);
      const number = optNum(subject, "number");
      if (number === null || !inScope(scope, repo, owner)) return [];
      return [
        {
          repo,
          number,
          title: optStr(subject, "title"),
          url: kind.comment
            ? optStr(e, "payload", "comment", "html_url")
            : optStr(subject, "html_url"),
          reason: kind.reason,
          preview: kind.comment
            ? preview(optStr(e, "payload", "comment", "body"))
            : null,
          createdAt: optStr(e, "created_at"),
        },
      ];
    },
  );

export const statusOp = (gh: GitHub) =>
  op({
    description:
      "The authenticated user's open assigned issues and PRs, open review requests, recent comments mentioning them and new issues, PRs and comments in watched repositories. `org` limits every section to one organization; `exclude` drops owner/name repos. Replaces `gh status`.",
    input: s.object({
      org: s.optional(s.string()),
      exclude: s.optional(
        s.array(s.string(), { description: "owner/name repos to leave out." }),
      ),
    }),
    annotations: reads,
    run: async ({ org, exclude }) => {
      const scope: Scope = { org, exclude: exclude ?? [] };
      const filter = [
        "state:open archived:false",
        org === undefined ? "" : `org:${org}`,
        ...scope.exclude.map((x) => `-repo:${x}`),
      ]
        .filter(Boolean)
        .join(" ");
      const login = str(await gh.rest("GET", "user"), "login");
      const [assignedIssues, assignedPrs, reviewRequests, mentioned, recent] =
        await Promise.all([
          searchItems(gh, `assignee:@me is:issue ${filter}`),
          searchItems(gh, `assignee:@me is:pr ${filter}`),
          searchItems(gh, `review-requested:@me is:pr ${filter}`),
          mentions(gh, login, scope),
          activity(gh, login, scope),
        ]);
      return {
        login,
        assignedIssues,
        assignedPrs,
        reviewRequests,
        mentions: mentioned,
        activity: recent,
      };
    },
  });

export const orgOps = (gh: GitHub) => ({
  list: op({
    description:
      "Logins of the organizations the authenticated user belongs to. Replaces `gh org list`.",
    input: s.object({ limit: limitField(30) }),
    annotations: reads,
    run: async ({ limit }) => ({
      items: (await gh.list("user/orgs", limit ?? 30)).map((o) =>
        str(o, "login"),
      ),
    }),
  }),
});

// Mirrors defaultToken in env.ts: a set but empty GH_TOKEN falls through to the gh login, not to GITHUB_TOKEN.
// A token provider passed to createClient replaces defaultToken, so the environment says nothing about it.
const tokenSource = (env: Env, tokenInjected: boolean) => {
  if (tokenInjected) return "injected";
  const name =
    env["GH_TOKEN"] !== undefined
      ? "GH_TOKEN"
      : env["GITHUB_TOKEN"] !== undefined
        ? "GITHUB_TOKEN"
        : undefined;
  return name !== undefined && env[name] !== "" ? name : "gh";
};

export const authOps = (
  gh: GitHub,
  env: Env = process.env,
  tokenInjected = false,
) => ({
  status: op({
    description:
      "The account behind the token: login, name, OAuth scopes (null for fine-grained and app tokens, which report none) and where the token came from (GH_TOKEN, GITHUB_TOKEN, the gh login, or `injected` for a token provider passed to createClient). The token itself is never returned. Replaces `gh auth status`.",
    input: s.object({}),
    annotations: reads,
    run: async () => {
      const [user, headers] = await Promise.all([
        gh.rest("GET", "user"),
        gh.headers("user"),
      ]);
      const scopes = headers.get("x-oauth-scopes");
      return {
        host: "github.com",
        login: str(user, "login"),
        name: optStr(user, "name"),
        scopes:
          scopes === null
            ? null
            : scopes
                .split(",")
                .map((x) => x.trim())
                .filter(Boolean),
        tokenSource: tokenSource(env, tokenInjected),
      };
    },
  }),
});
