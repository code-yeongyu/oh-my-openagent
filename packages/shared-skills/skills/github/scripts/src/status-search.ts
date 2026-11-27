// The `status` views: several @me searches in one GraphQL call, merged by number with the reasons each item matched.
import type { GitHub } from "./http.ts";
import { at, nodes, str, type Json } from "./read.ts";

export type Hit = { readonly reason: string; readonly node: unknown };

export type StatusQuery = {
  /** Search alias (the reason reported on each item) -> GitHub search query. */
  readonly groups: Readonly<Record<string, string>>;
  readonly select: string;
  readonly limit: number;
  readonly declare?: string;
  readonly extra?: string;
  readonly fragments?: string;
  readonly variables?: Json;
};

export const statusSearch = async (gh: GitHub, q: StatusQuery) => {
  const groups = Object.entries(q.groups);
  const vars = groups.map((_, i) => `,$q${i}:String!`).join("");
  const searches = groups
    .map(
      ([reason], i) =>
        `${reason}:search(query:$q${i},type:ISSUE,first:$limit){nodes{${q.select}}}`,
    )
    .join(" ");
  const data = await gh.graphql(
    `query($limit:Int!${vars}${q.declare ?? ""}){viewer{login} ${searches} ${q.extra ?? ""}} ${q.fragments ?? ""}`,
    {
      ...q.variables,
      limit: Math.min(Math.max(q.limit, 1), 100),
      ...Object.fromEntries(groups.map(([, query], i) => [`q${i}`, query])),
    },
  );
  const hits: Hit[] = groups.flatMap(([reason]) =>
    nodes(data, reason).map((node) => ({ reason, node })),
  );
  return { data, user: str(data, "viewer", "login"), hits };
};

export const byNumber = <T extends { readonly number: number }>(
  hits: readonly Hit[],
  parse: (node: unknown) => T,
) => {
  const seen = new Map<number, { item: T; reasons: string[] }>();
  for (const { reason, node } of hits) {
    // A search node of another type comes back as an empty object.
    if (typeof at(node, "number") !== "number") continue;
    const item = parse(node);
    const prior = seen.get(item.number);
    if (prior === undefined) seen.set(item.number, { item, reasons: [reason] });
    else prior.reasons.push(reason);
  }
  return [...seen.values()].map(({ item, reasons }) => ({ ...item, reasons }));
};
