// Listing discussions: the repository connection, or GitHub search when author, label or text filters are given.
import { op, s } from "../vendor/surface/index.ts";
import {
  categoryField,
  DISCUSSION,
  discussionSummary,
  lookup,
} from "./discussion-lookup.ts";
import { limitField, reads, repoField } from "./fields.ts";
import type { GitHub } from "./http.ts";
import { at, bool, nodes, optStr } from "./read.ts";

const LIST = `query($owner:String!,$name:String!,$first:Int!,$after:String,$states:[DiscussionState!],$categoryId:ID,$answered:Boolean,$orderBy:DiscussionOrder){
repository(owner:$owner,name:$name){discussions(first:$first,after:$after,states:$states,categoryId:$categoryId,answered:$answered,orderBy:$orderBy){
pageInfo{endCursor hasNextPage} nodes{${DISCUSSION}}}}}`;
const SEARCH = `query($q:String!,$first:Int!,$after:String){search(type:DISCUSSION,query:$q,first:$first,after:$after){
pageInfo{endCursor hasNextPage} nodes{... on Discussion{${DISCUSSION}}}}}`;

type Page = {
  readonly items: readonly unknown[];
  readonly next: string | null;
};

const pages = async (
  limit: number,
  after: string | undefined,
  fetch: (first: number, after: string | null) => Promise<unknown>,
) => {
  const items: unknown[] = [];
  let cursor = after ?? null;
  let next: string | null = cursor;
  do {
    const conn = await fetch(Math.min(100, limit - items.length), cursor);
    const page: Page = {
      items: nodes(conn),
      next: bool(conn, "pageInfo", "hasNextPage")
        ? optStr(conn, "pageInfo", "endCursor")
        : null,
    };
    items.push(...page.items);
    next = page.next;
    cursor = next;
  } while (next !== null && items.length < limit);
  return { items, endCursor: next };
};

const quote = (v: string) => `"${v.replaceAll('"', "")}"`;

export const discussionListOp = (gh: GitHub) =>
  op({
    description:
      "Discussions in a repository, newest activity first, with the cursor for the next page in endCursor. Author, label and search filters go through GitHub search. Replaces `gh discussion list`.",
    input: s.object({
      repo: repoField,
      state: s.optional(s.enum(["open", "closed", "all"])),
      category: s.optional(categoryField),
      author: s.optional(s.string()),
      labels: s.optional(s.array(s.string())),
      answered: s.optional(s.boolean()),
      search: s.optional(s.string({ description: "Search query text." })),
      sort: s.optional(s.enum(["created", "updated"])),
      order: s.optional(s.enum(["asc", "desc"])),
      limit: limitField(30),
      after: s.optional(
        s.string({ description: "endCursor of a previous page." }),
      ),
    }),
    annotations: reads,
    run: async (input) => {
      const r = await gh.repo(input.repo);
      const state = input.state ?? "open";
      const sort = input.sort ?? "updated";
      const order = input.order ?? "desc";
      const category =
        input.category === undefined
          ? undefined
          : (await lookup(gh, r, { category: input.category })).category;
      const viaSearch =
        input.author !== undefined ||
        (input.labels?.length ?? 0) > 0 ||
        input.search !== undefined;
      const { items, endCursor } = await pages(
        input.limit ?? 30,
        input.after,
        async (first, after) => {
          if (!viaSearch)
            return at(
              await gh.graphql(LIST, {
                owner: r.owner,
                name: r.name,
                first,
                after,
                states: state === "all" ? null : [state.toUpperCase()],
                categoryId: category?.id ?? null,
                answered: input.answered ?? null,
                orderBy: {
                  field: sort === "created" ? "CREATED_AT" : "UPDATED_AT",
                  direction: order.toUpperCase(),
                },
              }),
              "repository",
              "discussions",
            );
          const q = [
            `repo:${r.full}`,
            state === "all" ? "" : `is:${state}`,
            input.author === undefined ? "" : `author:${input.author}`,
            ...(input.labels ?? []).map((l) => `label:${quote(l)}`),
            category === undefined ? "" : `category:${quote(category.name)}`,
            input.answered === undefined
              ? ""
              : input.answered
                ? "is:answered"
                : "is:unanswered",
            `sort:${sort}-${order}`,
            input.search ?? "",
          ].filter(Boolean);
          return at(
            await gh.graphql(SEARCH, { q: q.join(" "), first, after }),
            "search",
          );
        },
      );
      return { repo: r.full, items: items.map(discussionSummary), endCursor };
    },
  });
