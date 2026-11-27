// Discussion node ids, category and label ids resolved in one GraphQL round trip, and the shared summary shape.
import { s, SurfaceError } from "../vendor/surface/index.ts";
import type { GitHub, Repo } from "./http.ts";
import { at, bool, names, nodes, num, optNum, optStr, str } from "./read.ts";

export const categoryField = s.string({
  description: "Category name or slug.",
});

export const DISCUSSION = `id number title url closed stateReason isAnswered createdAt updatedAt
author{login} category{name slug} labels(first:20){nodes{name}} comments{totalCount}`;

export const discussionSummary = (d: unknown) => ({
  id: str(d, "id"),
  number: num(d, "number"),
  title: str(d, "title"),
  url: str(d, "url"),
  author: optStr(d, "author", "login"),
  category: optStr(d, "category", "name"),
  closed: bool(d, "closed"),
  stateReason: optStr(d, "stateReason"),
  answered: bool(d, "isAnswered"),
  labels: names(d, "name", "labels"),
  comments: optNum(d, "comments", "totalCount") ?? 0,
  createdAt: str(d, "createdAt"),
  updatedAt: str(d, "updatedAt"),
});

export type Category = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
};

type Want = {
  readonly number?: number;
  readonly category?: string;
  readonly labels?: readonly string[];
};

export const lookup = async (gh: GitHub, r: Repo, want: Want) => {
  const labels = want.labels ?? [];
  const vars = labels.map((_, i) => `$l${i}:String!`).join("");
  const query = `query($owner:String!,$name:String!,$number:Int!,$byNumber:Boolean!,$categories:Boolean!${vars}){
repository(owner:$owner,name:$name){id
discussion(number:$number) @include(if:$byNumber){id}
discussionCategories(first:100) @include(if:$categories){nodes{id name slug}}
${labels.map((_, i) => `l${i}:label(name:$l${i}){id}`).join(" ")}}}`;
  const data = await gh.graphql(query, {
    owner: r.owner,
    name: r.name,
    number: want.number ?? 0,
    byNumber: want.number !== undefined,
    categories: want.category !== undefined,
    ...Object.fromEntries(labels.map((l, i) => [`l${i}`, l])),
  });
  const repo = at(data, "repository");
  const discussionId = optStr(repo, "discussion", "id");
  if (want.number !== undefined && discussionId === null)
    throw new SurfaceError(
      "not_found",
      `no discussion #${want.number} in ${r.full}`,
      "check the number",
    );
  const labelIds = labels.map((label, i) => {
    const id = optStr(repo, `l${i}`, "id");
    if (id === null)
      throw new SurfaceError(
        "not_found",
        `no label "${label}" in ${r.full}`,
        "create it first or check the spelling",
      );
    return id;
  });
  return {
    repoId: str(repo, "id"),
    discussionId: discussionId ?? "",
    category:
      want.category === undefined
        ? undefined
        : pickCategory(r, want.category, categoryList(repo)),
    labelIds,
  };
};

const categoryList = (repo: unknown): Category[] =>
  nodes(repo, "discussionCategories").map((c) => ({
    id: str(c, "id"),
    name: str(c, "name"),
    slug: str(c, "slug"),
  }));

export const pickCategory = (
  r: Repo,
  given: string,
  all: readonly Category[],
): Category => {
  const want = given.toLowerCase();
  const hit = all.find(
    (c) => c.name.toLowerCase() === want || c.slug.toLowerCase() === want,
  );
  if (hit === undefined)
    throw new SurfaceError(
      "not_found",
      `no discussion category "${given}" in ${r.full}`,
      `use one of: ${all.map((c) => c.name).join(", ") || "(discussions may be disabled)"}`,
    );
  return hit;
};

export const setLabels = async (
  gh: GitHub,
  id: string,
  add: readonly string[],
  remove: readonly string[],
) => {
  if (add.length > 0)
    await gh.graphql(
      "mutation($id:ID!,$labels:[ID!]!){addLabelsToLabelable(input:{labelableId:$id,labelIds:$labels}){clientMutationId}}",
      { id, labels: add },
    );
  if (remove.length > 0)
    await gh.graphql(
      "mutation($id:ID!,$labels:[ID!]!){removeLabelsFromLabelable(input:{labelableId:$id,labelIds:$labels}){clientMutationId}}",
      { id, labels: remove },
    );
};
