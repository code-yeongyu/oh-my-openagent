import { json, on, type Seen } from "./fake.ts";

type Handler = readonly [string, (vars: Record<string, unknown>) => unknown];

export const graphql = (handlers: readonly Handler[]) =>
  on("POST", /\/graphql$/, (req) => {
    const query = String(Reflect.get(Object(req.body), "query"));
    const vars = Object(Reflect.get(Object(req.body), "variables"));
    const hit = handlers.find(([marker]) => query.includes(marker));
    return hit === undefined
      ? json({ errors: [{ message: `unrouted ${query.slice(0, 60)}` }] })
      : json({ data: hit[1](vars) });
  });

export const sent = (seen: readonly Seen[]) =>
  seen.map((s) => ({
    query: String(Reflect.get(Object(s.body), "query")),
    vars: Object(Reflect.get(Object(s.body), "variables")),
  }));

export const disc = (number: number) => ({
  id: `D_${number}`,
  number,
  title: `t${number}`,
  url: `https://github.com/acme/widgets/discussions/${number}`,
  closed: false,
  stateReason: null,
  isAnswered: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
  author: { login: "octo" },
  category: { name: "Q&A", slug: "q-a" },
  labels: { nodes: [{ name: "bug" }] },
  comments: { totalCount: 4 },
});

export const page = (from: number, count: number, next: string | null) => ({
  pageInfo: { endCursor: next, hasNextPage: next !== null },
  nodes: Array.from({ length: count }, (_, i) => disc(from + i)),
});

export const categories = {
  discussionCategories: {
    nodes: [
      { id: "C_qa", name: "Q&A", slug: "q-a" },
      { id: "C_ideas", name: "Ideas", slug: "ideas" },
    ],
  },
};
