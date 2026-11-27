import { describe, expect, test } from "bun:test";
import { repoAdminOps } from "../src/repo-admin.ts";
import { fakeGitHub, json, on } from "./fake.ts";
import { kindOf, repoJson } from "./repo-fixture.ts";

const B = "https://github.com/acme/widgets";

describe("repo url", () => {
  test("repository, issue, page, commit and branch URLs need no request", async () => {
    const { gh, seen } = fakeGitHub([]);
    const url = repoAdminOps(gh).url;
    const of = async (input: Parameters<typeof url.invoke>[0]) =>
      (await url.invoke(input)).url;
    expect(await of({})).toBe(B);
    expect(await of({ number: 12 })).toBe(`${B}/issues/12`);
    expect(await of({ page: "settings" })).toBe(`${B}/settings`);
    expect(await of({ commit: "abc123" })).toBe(`${B}/commit/abc123`);
    expect(await of({ branch: "feat/a b" })).toBe(`${B}/tree/feat/a%20b`);
    expect(await of({ path: "src/x.ts", branch: "dev", line: 4 })).toBe(
      `${B}/blob/dev/src/x.ts#L4`,
    );
    expect(await of({ path: "a.ts", commit: "abc", blame: true })).toBe(
      `${B}/blame/abc/a.ts`,
    );
    expect(seen).toHaveLength(0);
  });

  test("a path without a ref resolves the default branch; markdown lines use the plain view", async () => {
    const { gh, seen } = fakeGitHub([
      on("GET", /^\/repos\/acme\/widgets$/, () =>
        json(repoJson({ default_branch: "trunk" })),
      ),
    ]);
    const out = await repoAdminOps(gh).url.invoke({
      path: "/docs/README.md",
      line: 3,
      endLine: 9,
    });
    expect(out).toEqual({
      repo: "acme/widgets",
      url: `${B}/blob/trunk/docs/README.md?plain=1#L3-L9`,
    });
    expect(seen).toHaveLength(1);
  });

  test("conflicting or dangling arguments are refused without a request", async () => {
    const { gh, seen } = fakeGitHub([]);
    const url = repoAdminOps(gh).url;
    for (const input of [
      { number: 1, page: "wiki" as const },
      { number: 1, path: "a" },
      { branch: "a", commit: "b" },
      { line: 3 },
      { path: "a", endLine: 3 },
    ])
      expect(await kindOf(url.invoke(input))).toBe("usage");
    expect(seen).toHaveLength(0);
  });
});
