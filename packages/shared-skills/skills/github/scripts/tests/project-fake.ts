import { at } from "../src/read.ts";
import { json, on, type Route } from "./fake.ts";

/** One GraphQL endpoint answering the first [pattern, data] whose pattern matches the query text. */
export const gql = (
  replies: ReadonlyArray<readonly [RegExp, unknown]>,
): Route =>
  on("POST", /\/graphql$/, (req) => {
    const query = String(at(req.body, "query"));
    const hit = replies.find(([re]) => re.test(query));
    return json(
      hit === undefined
        ? { errors: [{ message: `unrouted ${query}` }] }
        : { data: hit[1] },
    );
  });

export const proj = (n: number, closed = false) => ({
  id: `PVT_${n}`,
  number: n,
  title: `Roadmap ${n}`,
  shortDescription: null,
  public: false,
  closed,
  template: false,
  url: `https://github.com/orgs/acme/projects/${n}`,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
});

export const lookup: [RegExp, unknown] = [
  /^query.*projectV2\(number/s,
  { owner: { login: "acme", projectV2: proj(5) } },
];

export const vars = (body: unknown) => at(body, "variables");
export const input = (body: unknown) => at(body, "variables", "input");
export const query = (body: unknown) => String(at(body, "query"));
export const isMutation = (body: unknown) => query(body).startsWith("mutation");

export const failure = (p: Promise<unknown>) =>
  p.then(
    () => ({ kind: "resolved", hint: "" }),
    (e: unknown) => ({
      kind: String(Reflect.get(Object(e), "kind")),
      hint: String(Reflect.get(Object(e), "hint")),
    }),
  );
