import { op, s } from "../vendor/surface/index.ts";
import { fetchChecks } from "./checks.ts";
import { pullViewOp } from "./pr-view.ts";
import { enc, limitField, numberField, reads, repoField } from "./fields.ts";
import type { GitHub } from "./http.ts";
import { bool, num, optStr, str } from "./read.ts";
import { searchRaw } from "./search.ts";

const pullFromRest = (p: unknown) => ({
  number: num(p, "number"),
  title: str(p, "title"),
  state: str(p, "state"),
  draft: bool(p, "draft"),
  author: optStr(p, "user", "login"),
  head: optStr(p, "head", "ref"),
  base: optStr(p, "base", "ref"),
  url: str(p, "html_url"),
  createdAt: optStr(p, "created_at"),
  updatedAt: optStr(p, "updated_at"),
});

export const pullReadOps = (gh: GitHub) => ({
  view: pullViewOp(gh),
  list: op({
    description:
      "List pull requests. Plain state/base/head filters use the pulls API; author, label, merged-only or free text go through search. Replaces `gh pr list`.",
    input: s.object({
      repo: repoField,
      state: s.optional(s.enum(["open", "closed", "merged", "all"])),
      base: s.optional(s.string({ description: "Base branch." })),
      head: s.optional(
        s.string({ description: "Head branch (owner:branch for forks)." }),
      ),
      author: s.optional(s.string()),
      label: s.optional(s.string()),
      search: s.optional(
        s.string({ description: "Extra GitHub search qualifiers or words." }),
      ),
      limit: limitField(30),
    }),
    annotations: reads,
    run: async ({ repo, state, base, head, author, label, search, limit }) => {
      const r = await gh.repo(repo);
      const max = limit ?? 30;
      if (
        author !== undefined ||
        label !== undefined ||
        search !== undefined ||
        state === "merged"
      ) {
        const q = [
          `repo:${r.full}`,
          "is:pr",
          state === "merged"
            ? "is:merged"
            : state === "all"
              ? ""
              : `is:${state ?? "open"}`,
          base === undefined ? "" : `base:${base}`,
          head === undefined ? "" : `head:${head}`,
          author === undefined ? "" : `author:${author}`,
          label === undefined ? "" : `label:"${label}"`,
          search ?? "",
        ];
        return {
          repo: r.full,
          items: (
            await searchRaw(gh, q.filter(Boolean).join(" "), max)
          ).raw.map(pullFromRest),
        };
      }
      const raw = await gh.list(`repos/${r.full}/pulls`, max, {
        query: {
          state: state ?? "open",
          base,
          head:
            head === undefined || head.includes(":")
              ? head
              : `${r.owner}:${head}`,
          sort: "updated",
          direction: "desc",
        },
      });
      return { repo: r.full, items: raw.map(pullFromRest) };
    },
  }),
  checks: op({
    description:
      "Checks on a PR's head commit: each check run and commit status with bucket pass|fail|pending|skipping|cancel, required flag and Actions run id, plus counts. Replaces `gh pr checks`.",
    input: s.object({
      repo: repoField,
      number: numberField,
      only: s.optional(
        s.array(s.enum(["pass", "fail", "pending", "skipping", "cancel"]), {
          description: "Return only checks in these buckets.",
        }),
      ),
      requiredOnly: s.optional(s.boolean()),
    }),
    annotations: reads,
    run: async ({ repo, number, only, requiredOnly }) => {
      const r = await gh.repo(repo);
      const all = await fetchChecks(gh, r, number);
      const checks = all.checks.filter(
        (c) =>
          (only === undefined || only.includes(c.bucket)) &&
          (requiredOnly !== true || c.required),
      );
      return { repo: r.full, number, ...all, checks };
    },
  }),
  diff: op({
    description:
      "Unified diff of a PR, truncated at maxBytes. Use `files` first when you only need the changed paths. Replaces `gh pr diff`.",
    input: s.object({
      repo: repoField,
      number: numberField,
      maxBytes: s.optional(s.integer({ description: "Default 200000." })),
    }),
    annotations: reads,
    run: async ({ repo, number, maxBytes }) => {
      const r = await gh.repo(repo);
      const diff = await gh.text(
        `repos/${r.full}/pulls/${number}`,
        "application/vnd.github.diff",
      );
      const cap = maxBytes ?? 200_000;
      return {
        repo: r.full,
        number,
        bytes: diff.length,
        truncated: diff.length > cap,
        diff: diff.slice(0, cap),
      };
    },
  }),
  files: op({
    description:
      "Changed files of a PR with status and line counts; patches only when asked. Replaces `gh pr diff --name-only` / `gh pr view --json files`.",
    input: s.object({
      repo: repoField,
      number: numberField,
      patch: s.optional(s.boolean()),
      limit: limitField(300),
    }),
    annotations: reads,
    run: async ({ repo, number, patch, limit }) => {
      const r = await gh.repo(repo);
      const raw = await gh.list(
        `repos/${r.full}/pulls/${number}/files`,
        limit ?? 300,
      );
      return raw.map((f) => ({
        path: str(f, "filename"),
        status: str(f, "status"),
        additions: num(f, "additions"),
        deletions: num(f, "deletions"),
        previousPath: optStr(f, "previous_filename"),
        ...(patch === true ? { patch: optStr(f, "patch") } : {}),
      }));
    },
  }),
});

export const pullNodeId = async (
  gh: GitHub,
  full: string,
  number: number,
): Promise<{ id: string; head: string; headRepo: string | null }> => {
  const p = await gh.rest("GET", `repos/${full}/pulls/${enc(String(number))}`);
  return {
    id: str(p, "node_id"),
    head: str(p, "head", "ref"),
    headRepo: optStr(p, "head", "repo", "full_name"),
  };
};
