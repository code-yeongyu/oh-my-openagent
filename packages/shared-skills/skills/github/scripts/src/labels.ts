// Repository labels: list, create, edit, delete, and clone one repository's labels into another.
import { op, s, SurfaceError } from "../vendor/surface/index.ts";
import {
  enc,
  irreversible,
  limitField,
  reads,
  repoField,
  writes,
} from "./fields.ts";
import type { GitHub } from "./http.ts";
import { at, bool, nodes, num, optStr, str } from "./read.ts";

const LIST = `query($owner:String!,$name:String!,$first:Int!,$after:String,$query:String,$field:LabelOrderField!,$direction:OrderDirection!){
repository(owner:$owner,name:$name){labels(first:$first,after:$after,query:$query,orderBy:{field:$field,direction:$direction}){
nodes{name color description isDefault createdAt url} pageInfo{hasNextPage endCursor}}}}`;
const ALL_LABELS = 10_000;

const restLabel = (x: unknown) => ({
  id: num(x, "id"),
  name: str(x, "name"),
  color: str(x, "color"),
  description: optStr(x, "description"),
  isDefault: bool(x, "default"),
});

const defined = (o: Readonly<Record<string, unknown>>) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

const bare = (color: string | undefined) => color?.replace(/^#/, "");

const colorField = s.optional(
  s.string({ description: "Six-digit hex color, with or without '#'." }),
);

export const labelOps = (gh: GitHub) => ({
  list: op({
    description:
      "Labels of a repository with color, description and whether GitHub created them by default; `search` matches names and descriptions and GitHub then ranks by relevance, ignoring sort and order. Replaces `gh label list`.",
    input: s.object({
      repo: repoField,
      search: s.optional(s.string()),
      sort: s.optional(s.enum(["created", "name"])),
      order: s.optional(s.enum(["asc", "desc"])),
      limit: limitField(30),
    }),
    annotations: reads,
    run: async ({ repo, search, sort, order, limit }) => {
      const r = await gh.repo(repo);
      const max = limit ?? 30;
      const items: {
        readonly name: string;
        readonly color: string;
        readonly description: string | null;
        readonly isDefault: boolean;
        readonly createdAt: string | null;
        readonly url: string;
      }[] = [];
      let after: string | null = null;
      do {
        const data = await gh.graphql(LIST, {
          owner: r.owner,
          name: r.name,
          first: Math.min(100, max - items.length),
          after,
          query: search ?? null,
          field: sort === "name" ? "NAME" : "CREATED_AT",
          direction: order === "desc" ? "DESC" : "ASC",
        });
        const page = at(data, "repository", "labels");
        items.push(
          ...nodes(page).map((l) => ({
            name: str(l, "name"),
            color: str(l, "color"),
            description: optStr(l, "description"),
            isDefault: bool(l, "isDefault"),
            createdAt: optStr(l, "createdAt"),
            url: str(l, "url"),
          })),
        );
        after =
          at(page, "pageInfo", "hasNextPage") === true
            ? optStr(page, "pageInfo", "endCursor")
            : null;
      } while (after !== null && items.length < max);
      return { repo: r.full, items };
    },
  }),
  create: op({
    description:
      "Create a label; GitHub picks a color when none is given. With `force`, an existing label of that name gets the given color and description instead of failing. Replaces `gh label create`.",
    input: s.object({
      repo: repoField,
      name: s.string(),
      color: colorField,
      description: s.optional(s.string()),
      force: s.optional(
        s.boolean({ description: "Update the label if it already exists." }),
      ),
    }),
    annotations: writes,
    run: async ({ repo, name, color, description, force }) => {
      const r = await gh.repo(repo);
      const fields = defined({ color: bare(color), description });
      try {
        const x = await gh.rest("POST", `repos/${r.full}/labels`, {
          body: { name, ...fields },
        });
        return { repo: r.full, action: "created", ...restLabel(x) };
      } catch (error) {
        const exists =
          error instanceof SurfaceError &&
          error.kind === "invalid" &&
          error.message.includes("already_exists");
        if (force !== true || !exists) throw error;
      }
      const x = await gh.rest("PATCH", `repos/${r.full}/labels/${enc(name)}`, {
        body: fields,
      });
      return { repo: r.full, action: "updated", ...restLabel(x) };
    },
  }),
  edit: op({
    description:
      "Rename a label or change its color or description. Replaces `gh label edit`.",
    input: s.object({
      repo: repoField,
      name: s.string({ description: "Current label name." }),
      newName: s.optional(s.string()),
      color: colorField,
      description: s.optional(s.string()),
    }),
    annotations: writes,
    run: async ({ repo, name, newName, color, description }) => {
      const body = defined({
        new_name: newName,
        color: bare(color),
        description,
      });
      if (Object.keys(body).length === 0)
        throw new SurfaceError(
          "usage",
          "nothing to change",
          "pass newName, color or description",
        );
      const r = await gh.repo(repo);
      const x = await gh.rest("PATCH", `repos/${r.full}/labels/${enc(name)}`, {
        body,
      });
      return { repo: r.full, ...restLabel(x) };
    },
  }),
  delete: op({
    description:
      "Delete a label; it is removed from every issue and pull request that carried it. Replaces `gh label delete`.",
    input: s.object({ repo: repoField, name: s.string() }),
    annotations: irreversible,
    run: async ({ repo, name }) => {
      const r = await gh.repo(repo);
      await gh.rest("DELETE", `repos/${r.full}/labels/${enc(name)}`);
      return { repo: r.full, name, deleted: true };
    },
  }),
  clone: op({
    description:
      "Copy every label of `source` into `repo`. Labels whose name already exists (case-insensitive) are skipped, or overwritten with the source color and description when `force` is set. Returns the created, updated and skipped names. Replaces `gh label clone`.",
    input: s.object({
      repo: repoField,
      source: s.string({ description: "owner/name to copy labels from." }),
      force: s.optional(s.boolean()),
    }),
    annotations: writes,
    run: async ({ repo, source, force }) => {
      const [r, src] = await Promise.all([gh.repo(repo), gh.repo(source)]);
      const [from, to] = await Promise.all([
        gh.list(`repos/${src.full}/labels`, ALL_LABELS),
        gh.list(`repos/${r.full}/labels`, ALL_LABELS),
      ]);
      const existing = new Map(
        to.map((l) => [str(l, "name").toLowerCase(), str(l, "name")]),
      );
      const created: string[] = [];
      const updated: string[] = [];
      const skipped: string[] = [];
      for (const l of from) {
        const name = str(l, "name");
        const fields = {
          color: str(l, "color"),
          description: optStr(l, "description") ?? "",
        };
        const current = existing.get(name.toLowerCase());
        if (current === undefined) {
          await gh.rest("POST", `repos/${r.full}/labels`, {
            body: { name, ...fields },
          });
          created.push(name);
        } else if (force === true) {
          await gh.rest("PATCH", `repos/${r.full}/labels/${enc(current)}`, {
            body: { new_name: name, ...fields },
          });
          updated.push(name);
        } else {
          skipped.push(name);
        }
      }
      return { repo: r.full, source: src.full, created, updated, skipped };
    },
  }),
});
