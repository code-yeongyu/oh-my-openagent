import { describe, expect, test } from "bun:test";
import { fakeGitHub, json, on, TOKEN } from "./fake.ts";

const kindOf = async (p: Promise<unknown>) =>
  p.then(
    () => "resolved",
    (e: unknown) => String(Reflect.get(Object(e), "kind")),
  );

describe("transfers and git", () => {
  test("a binary download follows the redirect without the token", async () => {
    const { gh, seen } = fakeGitHub([
      on(
        "GET",
        /\/releases\/assets\/7$/,
        () =>
          new Response(null, {
            status: 302,
            headers: { location: "https://blob.example/asset" },
          }),
      ),
      (req) =>
        req.url === "https://blob.example/asset"
          ? new Response(new Uint8Array([0, 255, 7]))
          : undefined,
    ]);
    const bytes = await gh.bytes(
      "repos/acme/widgets/releases/assets/7",
      "application/octet-stream",
    );
    expect([...bytes]).toEqual([0, 255, 7]);
    expect(seen[0]?.auth).toBe(`Bearer ${TOKEN}`);
    expect(seen[1]?.auth).toBeNull();
  });

  test("an upload sends the raw bytes with their content type, and only to the upload host", async () => {
    const { gh, seen } = fakeGitHub([
      on("POST", /\/releases\/1\/assets\?name=a\.bin$/, () =>
        json({ id: 9, name: "a.bin" }, 201),
      ),
    ]);
    const body = new Uint8Array([1, 2, 3]);
    await gh.upload(
      "https://uploads.github.com/repos/acme/widgets/releases/1/assets?name=a.bin",
      body,
      "application/zip",
    );
    expect(seen[0]?.bytes).toEqual(body);
    expect(seen[0]?.contentType).toBe("application/zip");
    expect(
      await kindOf(gh.upload("https://evil.example/assets", body, "text/x")),
    ).toBe("usage");
    expect(seen).toHaveLength(1);
  });

  test("a returned content URL is fetched without the token, and only over https", async () => {
    const { gh, seen } = fakeGitHub([
      (req) =>
        req.url === "https://gist.githubusercontent.com/o/1/raw/a"
          ? new Response("whole file")
          : undefined,
    ]);
    const bytes = await gh.content(
      "https://gist.githubusercontent.com/o/1/raw/a",
    );
    expect(new TextDecoder().decode(bytes)).toBe("whole file");
    expect(seen[0]?.auth).toBeNull();
    expect(
      await kindOf(gh.content("http://gist.githubusercontent.com/o/1/raw/a")),
    ).toBe("usage");
    expect(seen).toHaveLength(1);
  });

  test("headers come back for a successful GET", async () => {
    const { gh } = fakeGitHub([
      on("GET", /^\/user$/, () =>
        json({ login: "octo" }, 200, { "x-oauth-scopes": "repo, gist" }),
      ),
    ]);
    expect((await gh.headers("user")).get("x-oauth-scopes")).toBe("repo, gist");
  });

  test("only a git command that talks to the remote gets the token, and only through its environment", async () => {
    const ok = fakeGitHub([], undefined, () => ({ stdout: "abc\n" }));
    expect(await ok.gh.git(["fetch", "origin"], "/work")).toBe("abc\n");
    await ok.gh.git(
      ["clone", "--", "https://github.com/a/b.git", "d"],
      "/work",
    );
    for (const local of [
      ["checkout", "main"],
      ["merge", "--ff-only", "FETCH_HEAD"],
      ["remote", "add", "upstream", "https://github.com/a/b.git"],
      ["config", "remote.upstream.gh-resolved", "base"],
      ["rev-parse", "HEAD"],
    ])
      await ok.gh.git(local, "/work");
    expect(ok.gitCalls[0]).toEqual({ args: ["fetch", "origin"], cwd: "/work" });
    const [fetched = {}, cloned = {}, ...locals] = ok.gitEnvs;
    for (const env of [fetched, cloned]) {
      expect(Object.values(env).filter((v) => v.includes(TOKEN))).toEqual([
        TOKEN,
      ]);
      expect(env["GIT_CONFIG_KEY_0"]).toBe(
        "credential.https://github.com.helper",
      );
      expect(env["GIT_CONFIG_VALUE_0"]).toBe("");
      expect(env["GIT_CONFIG_COUNT"]).toBe("4");
    }
    const inherited = { PATH: "/usr/bin", HOME: "/home/u" };
    expect(locals).toEqual([
      inherited,
      inherited,
      inherited,
      inherited,
      inherited,
    ]);
    for (const env of [fetched, cloned]) {
      expect(env).toMatchObject(inherited);
      expect(env["GH_TOKEN"]).toBeUndefined();
      expect(env["GITHUB_TOKEN"]).toBeUndefined();
    }

    const bad = fakeGitHub([], undefined, () => ({
      code: 128,
      stderr: `fatal: could not read from https://x:${TOKEN}@github.com/a/b`,
    }));
    const error = await bad.gh.git(["fetch"], "/work").then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(Reflect.get(Object(error), "kind")).toBe("git");
    expect(String(Reflect.get(Object(error), "message"))).not.toContain(TOKEN);
  });
});
