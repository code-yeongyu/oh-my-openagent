import { describe, expect, test } from "bun:test";
import { gistOps } from "../src/gists.ts";
import { fakeGitHub, json, on, TOKEN, type Seen } from "./fake.ts";

const ID = "aa5a315d61ae9438b18d";
const kindOf = async (p: Promise<unknown>) =>
  p.then(
    () => "resolved",
    (e: unknown) => String(Reflect.get(Object(e), "kind")),
  );
const vars = (req: Seen | undefined) =>
  Reflect.get(Object(req?.body), "variables");

const restGist = (files: Record<string, object>) => ({
  id: ID,
  description: "notes",
  public: false,
  html_url: `https://gist.github.com/octo/${ID}`,
  updated_at: "2026-11-01T00:00:00Z",
  files,
});
const file = (name: string, extra: object = {}) => ({
  filename: name,
  size: 5,
  content: "hello",
  truncated: false,
  raw_url: `https://gist.githubusercontent.com/octo/${ID}/raw/${name}`,
  ...extra,
});
const node = (name: string, description: string, files: object[]) => ({
  name,
  description,
  isPublic: true,
  updatedAt: "2026-11-01T00:00:00Z",
  url: `https://gist.github.com/${name}`,
  files,
});
const page = (nodes: object[], endCursor: string | null) =>
  json({
    data: {
      viewer: {
        gists: {
          nodes,
          pageInfo: { hasNextPage: endCursor !== null, endCursor },
        },
      },
    },
  });

describe("gist reads", () => {
  test("list asks GraphQL for the chosen privacy and trims each gist", async () => {
    const { gh, seen } = fakeGitHub([
      on("POST", /\/graphql$/, () =>
        page([node("g1", "one", [{ name: "a.md" }])], null),
      ),
    ]);
    const out = await gistOps(gh).list.invoke({
      visibility: "secret",
      limit: 5,
    });
    expect(vars(seen[0])).toEqual({
      n: 5,
      after: null,
      privacy: "SECRET",
      content: false,
    });
    expect(out).toEqual({
      items: [
        {
          id: "g1",
          description: "one",
          public: true,
          files: ["a.md"],
          updatedAt: "2026-11-01T00:00:00Z",
          url: "https://gist.github.com/g1",
        },
      ],
    });
  });

  test("a filter pages on until enough gists match, and includeContent also matches file text", async () => {
    const { gh, seen } = fakeGitHub([
      on("POST", /\/graphql$/, (req) =>
        Reflect.get(Object(vars(req)), "after") === null
          ? page(
              [node("g1", "misc", [{ name: "a.md", text: "nothing" }])],
              "c1",
            )
          : page(
              [
                node("g2", "misc", [{ name: "b.md", text: "deploy steps" }]),
                node("g3", "deploy notes", [{ name: "c.md", text: "" }]),
              ],
              "c2",
            ),
      ),
    ]);
    const out = await gistOps(gh).list.invoke({
      filter: "deploy",
      includeContent: true,
      limit: 2,
    });
    expect(out.items.map((i) => i.id)).toEqual(["g2", "g3"]);
    expect(seen).toHaveLength(2);
    expect(vars(seen[1])).toEqual({
      n: 100,
      after: "c1",
      privacy: "ALL",
      content: true,
    });
  });

  test("without includeContent the filter ignores file text", async () => {
    const { gh } = fakeGitHub([
      on("POST", /\/graphql$/, () =>
        page([node("g1", "misc", [{ name: "a.md", text: "deploy" }])], null),
      ),
    ]);
    expect((await gistOps(gh).list.invoke({ filter: "deploy" })).items).toEqual(
      [],
    );
  });

  test("view takes a URL and fetches a truncated file in full from its raw URL, without the token", async () => {
    const { gh, seen } = fakeGitHub([
      (req) =>
        req.url === `https://gist.githubusercontent.com/octo/${ID}/raw/big.log`
          ? new Response("partial and the rest")
          : undefined,
      on("GET", new RegExp(`/gists/${ID}$`), () =>
        json(
          restGist({
            "a.md": file("a.md"),
            "big.log": file("big.log", { truncated: true, content: "par" }),
          }),
        ),
      ),
    ]);
    const out = await gistOps(gh).view.invoke({
      id: `https://gist.github.com/octo/${ID}`,
    });
    expect(new URL(seen[0]?.url ?? "").pathname).toBe(`/gists/${ID}`);
    expect(out.public).toBe(false);
    expect(out.files).toEqual([
      {
        name: "a.md",
        size: 5,
        content: "hello",
        rawUrl: `https://gist.githubusercontent.com/octo/${ID}/raw/a.md`,
      },
      {
        name: "big.log",
        size: 5,
        content: "partial and the rest",
        rawUrl: `https://gist.githubusercontent.com/octo/${ID}/raw/big.log`,
      },
    ]);
    expect(seen.map((r) => r.auth)).toEqual([`Bearer ${TOKEN}`, null]);
  });

  test("view narrows to one file or to names only, and a missing file is not_found", async () => {
    const { gh } = fakeGitHub([
      on("GET", /\/gists\//, () =>
        json(restGist({ "a.md": file("a.md"), "b.md": file("b.md") })),
      ),
    ]);
    const ops = gistOps(gh);
    expect(
      (await ops.view.invoke({ id: ID, filename: "b.md", files: true })).files,
    ).toEqual([{ name: "b.md", size: 5 }]);
    expect(await kindOf(ops.view.invoke({ id: ID, filename: "zz" }))).toBe(
      "not_found",
    );
  });
});
