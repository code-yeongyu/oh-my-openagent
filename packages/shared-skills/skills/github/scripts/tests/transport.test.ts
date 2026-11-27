import { describe, expect, test } from "bun:test";
import { createClient, parseRepo } from "../sdk.ts";
import { surfaceWith } from "../surface.ts";
import { fakeDeps, json, on, TOKEN } from "./fake.ts";

const errorOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (error) {
    return error instanceof Error
      ? { kind: String(Reflect.get(error, "kind")), message: error.message }
      : undefined;
  }
  throw new Error("expected a rejection");
};

describe("transport", () => {
  test("parseRepo reads owner/name, https and ssh remotes", () => {
    expect(parseRepo("acme/widgets")?.full).toBe("acme/widgets");
    expect(parseRepo("https://github.com/acme/widgets.git")?.full).toBe(
      "acme/widgets",
    );
    expect(parseRepo("git@github.com:acme/wid.gets.git")?.full).toBe(
      "acme/wid.gets",
    );
    expect(parseRepo("https://gitlab.com/acme/widgets")).toBeUndefined();
  });

  test("repo defaults to the git origin and the token is sent as a bearer", async () => {
    const { deps, seen } = fakeDeps([
      on("GET", /^\/repos\/acme\/widgets$/, () =>
        json({
          full_name: "acme/widgets",
          default_branch: "main",
          html_url: "u",
        }),
      ),
    ]);
    const repo = await createClient(deps).repo.view({});
    expect(repo.defaultBranch).toBe("main");
    expect(seen[0]?.auth).toBe(`Bearer ${TOKEN}`);
  });

  test("a renamed repo's redirect inside the API is followed, keeping the method and body", async () => {
    const { deps, seen } = fakeDeps([
      on(
        "PATCH",
        /^\/repos\/acme\/widgets$/,
        () =>
          new Response(null, {
            status: 307,
            headers: { location: "https://api.github.com/repositories/42" },
          }),
      ),
      on("PATCH", /^\/repositories\/42$/, () => json({ ok: true })),
    ]);
    const res = await createClient(deps).api.rest({
      path: "repos/acme/widgets",
      method: "PATCH",
      body: { archived: true },
    });
    expect(res).toEqual({ ok: true });
    expect(seen.map((r) => [new URL(r.url).pathname, r.auth, r.body])).toEqual([
      ["/repos/acme/widgets", `Bearer ${TOKEN}`, { archived: true }],
      ["/repositories/42", `Bearer ${TOKEN}`, { archived: true }],
    ]);
  });

  test("a next page outside the API is refused before the token goes there", async () => {
    for (const elsewhere of [
      "https://evil.example/repos/acme/widgets/pulls?page=2",
      "https://api.github.com.evil.example/repos/acme/widgets/pulls?page=2",
      "http://api.github.com/repos/acme/widgets/pulls?page=2",
    ]) {
      const { deps, seen } = fakeDeps([
        on("GET", /\/pulls\?/, () =>
          json([{ number: 1, title: "t", state: "open", html_url: "u" }], 200, {
            link: `<${elsewhere}>; rel="next"`,
          }),
        ),
      ]);
      const err = await errorOf(createClient(deps).pr.list({ limit: 150 }));
      expect(err?.kind).toBe("invalid_response");
      expect(seen.map((r) => new URL(r.url).origin)).toEqual([
        "https://api.github.com",
      ]);
    }
  });

  test("an API base without a trailing slash still pins the token to that origin", async () => {
    const { deps, seen } = fakeDeps([
      on("GET", /\/pulls\?/, () =>
        json([{ number: 1, title: "t", state: "open", html_url: "u" }], 200, {
          link: '<https://api.github.com.evil.example/page2>; rel="next"',
        }),
      ),
    ]);
    const client = createClient({ ...deps, apiUrl: "https://api.github.com" });
    const err = await errorOf(client.pr.list({ limit: 150 }));
    expect(err?.kind).toBe("invalid_response");
    expect(seen.map((r) => new URL(r.url).origin)).toEqual([
      "https://api.github.com",
    ]);
    expect(new URL(seen[0]?.url ?? "").pathname).toBe(
      "/repos/acme/widgets/pulls",
    );
  });

  test("pagination follows Link rel=next and stops at limit", async () => {
    const page = (from: number, next?: string) =>
      json(
        Array.from({ length: 100 }, (_, i) => ({
          number: from + i,
          title: "t",
          state: "open",
          html_url: "u",
        })),
        200,
        next ? { link: `<https://api.github.com${next}>; rel="next"` } : {},
      );
    const { deps, seen } = fakeDeps([
      on("GET", /\/pulls\?.*page=2/, () => page(101)),
      on("GET", /\/pulls\?/, () =>
        page(1, "/repos/acme/widgets/pulls?per_page=100&page=2"),
      ),
    ]);
    const { items } = await createClient(deps).pr.list({ limit: 150 });
    expect(items).toHaveLength(150);
    expect(items[149]?.number).toBe(150);
    expect(seen).toHaveLength(2);
  });

  test("a short secondary rate limit is waited out, a long one fails as rate_limited", async () => {
    let calls = 0;
    const short = fakeDeps([
      on("GET", /\/rate_limit/, () =>
        ++calls === 1
          ? json({ message: "secondary" }, 403, { "retry-after": "2" })
          : json({ resources: {} }),
      ),
    ]);
    await createClient(short.deps).api.rate({});
    expect(short.slept).toEqual([2000]);

    const long = fakeDeps([
      on("GET", /\/rate_limit/, () =>
        json({ message: "API rate limit exceeded" }, 403, {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "1700003600",
        }),
      ),
    ]);
    expect((await errorOf(createClient(long.deps).api.rate({})))?.kind).toBe(
      "rate_limited",
    );
    expect(long.slept).toEqual([]);
  });

  test("error messages never carry the token", async () => {
    const { deps } = fakeDeps([
      on("GET", /\/repos\/acme\/widgets$/, () =>
        json({ message: `Bad credentials ${TOKEN}` }, 401),
      ),
    ]);
    const err = await errorOf(createClient(deps).repo.view({}));
    expect(err?.kind).toBe("auth");
    expect(err?.message).not.toContain(TOKEN);
  });

  test("GraphQL NOT_FOUND becomes kind not_found", async () => {
    const { deps } = fakeDeps([
      on("POST", /\/graphql/, () =>
        json({
          data: null,
          errors: [{ type: "NOT_FOUND", message: "Could not resolve" }],
        }),
      ),
    ]);
    expect(
      (await errorOf(createClient(deps).pr.view({ number: 9 })))?.kind,
    ).toBe("not_found");
  });

  test("a bad input is a usage error before any request", async () => {
    const { deps, seen } = fakeDeps([]);
    expect(
      (
        await errorOf(
          surfaceWith(deps).ops.pr.view.invoke({
            repo: "acme/widgets",
            number: "nine",
          }),
        )
      )?.kind,
    ).toBe("usage");
    expect(seen).toHaveLength(0);
  });
});
