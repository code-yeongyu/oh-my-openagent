// `repo list`: an owner's repositories through GraphQL, or through repository search when filtering by language or topic.
import { op, s, SurfaceError } from "../vendor/surface/index.ts";
import { limitField, reads } from "./fields.ts";
import type { GitHub } from "./http.ts";
import type { Json } from "./read.ts";
import { at, bool, nodes, optNum, optStr, str } from "./read.ts";

const FIELDS = `nameWithOwner description visibility isFork isArchived isTemplate
  primaryLanguage { name } repositoryTopics(first: 20) { nodes { topic { name } } }
  stargazerCount defaultBranchRef { name } pushedAt url`;
const PAGE = "pageInfo { hasNextPage endCursor }";

const OWNER_QUERY = `query($login: String!, $first: Int!, $after: String, $visibility: RepositoryVisibility, $isFork: Boolean, $isArchived: Boolean) {
  repositoryOwner(login: $login) {
    repositories(first: $first, after: $after, visibility: $visibility, isFork: $isFork, isArchived: $isArchived,
      ownerAffiliations: [OWNER], orderBy: { field: PUSHED_AT, direction: DESC }) { nodes { ${FIELDS} } ${PAGE} }
  }
}`;
const SEARCH_QUERY = `query($q: String!, $first: Int!, $after: String) {
  search(query: $q, type: REPOSITORY, first: $first, after: $after) { nodes { ... on Repository { ${FIELDS} } } ${PAGE} }
}`;

const listed = (n: unknown) => ({
  repo: str(n, "nameWithOwner"),
  description: optStr(n, "description"),
  visibility: str(n, "visibility").toLowerCase(),
  fork: bool(n, "isFork"),
  archived: bool(n, "isArchived"),
  template: bool(n, "isTemplate"),
  language: optStr(n, "primaryLanguage", "name"),
  topics: nodes(n, "repositoryTopics").flatMap((t) => {
    const name = optStr(t, "topic", "name");
    return name === null ? [] : [name];
  }),
  stars: optNum(n, "stargazerCount"),
  defaultBranch: optStr(n, "defaultBranchRef", "name"),
  pushedAt: optStr(n, "pushedAt"),
  url: str(n, "url"),
});

const quote = (v: string) => (/\s/.test(v) ? `"${v}"` : v);

export const listOp = (gh: GitHub) =>
  op({
    description:
      "An owner's repositories, most recently pushed first; the authenticated user's when owner is omitted. Language and topic filters go through repository search, which can lag behind brand-new repositories. Replaces `gh repo list`.",
    input: s.object({
      owner: s.optional(
        s.string({ description: "User or organization login." }),
      ),
      visibility: s.optional(s.enum(["public", "private", "internal"])),
      fork: s.optional(
        s.boolean({
          description:
            "true: only forks (gh --fork); false: only non-forks (gh --source).",
        }),
      ),
      archived: s.optional(
        s.boolean({
          description:
            "true: only archived (gh --archived); false: omit archived (gh --no-archived).",
        }),
      ),
      language: s.optional(s.string({ description: "Primary language." })),
      topics: s.optional(s.array(s.string())),
      limit: limitField(30),
    }),
    annotations: reads,
    run: async ({
      owner,
      visibility,
      fork,
      archived,
      language,
      topics,
      limit,
    }) => {
      const login =
        owner ??
        str(
          await gh.graphql("query { viewer { login } }", {}),
          "viewer",
          "login",
        );
      const searching = language !== undefined || (topics?.length ?? 0) > 0;
      const [query, base, path]: [string, Json, readonly string[]] = searching
        ? [
            SEARCH_QUERY,
            {
              q: [
                `user:${login}`,
                fork === undefined
                  ? "fork:true"
                  : fork
                    ? "fork:only"
                    : "fork:false",
                archived === undefined ? undefined : `archived:${archived}`,
                visibility === undefined ? undefined : `is:${visibility}`,
                language === undefined
                  ? undefined
                  : `language:${quote(language)}`,
                ...(topics ?? []).map((t) => `topic:${quote(t)}`),
                "sort:updated",
              ]
                .filter((part) => part !== undefined)
                .join(" "),
            },
            ["search"],
          ]
        : [
            OWNER_QUERY,
            {
              login,
              visibility: visibility?.toUpperCase() ?? null,
              isFork: fork ?? null,
              isArchived: archived ?? null,
            },
            ["repositoryOwner", "repositories"],
          ];
      const want = limit ?? 30;
      const items: ReturnType<typeof listed>[] = [];
      let after: string | null = null;
      do {
        const data = await gh.graphql(query, {
          ...base,
          first: Math.min(100, want - items.length),
          after,
        });
        if (!searching && at(data, "repositoryOwner") === null)
          throw new SurfaceError(
            "not_found",
            `no user or organization ${login}`,
            "check the owner login",
          );
        const conn = at(data, ...path);
        items.push(...nodes(conn).map(listed));
        after = bool(conn, "pageInfo", "hasNextPage")
          ? optStr(conn, "pageInfo", "endCursor")
          : null;
      } while (after !== null && items.length < want);
      return { owner: login, items: items.slice(0, want) };
    },
  });
