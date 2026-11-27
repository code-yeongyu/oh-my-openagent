import { describe, expect, test } from "bun:test";
import { pullExtraOps } from "../src/pulls-extra.ts";
import { fakeGitHub, json, on, type GitCall } from "./fake.ts";

const kindOf = async (p: Promise<unknown>) =>
  p.then(
    () => "resolved",
    (e: unknown) => String(Reflect.get(Object(e), "kind")),
  );
const pull = on("GET", /\/repos\/acme\/widgets\/pulls\/5$/, () =>
  json({ node_id: "PR_5", head: { ref: "feat", repo: null } }),
);

describe("pr checkout", () => {
  const git =
    (branches: string) =>
    ({ args }: GitCall) => {
      if (args[0] === "remote")
        return {
          stdout:
            "fork\tgit@github.com:me/widgets.git (fetch)\nup\tgit@github.com:Acme/widgets.git (fetch)\n",
        };
      if (args[0] === "branch") return { stdout: branches };
      if (args[0] === "rev-parse") return { stdout: "deadbeef\n" };
      return undefined;
    };

  test("a new branch is created from the PR head fetched from the base repo's remote", async () => {
    const { gh, gitCalls } = fakeGitHub([pull], undefined, git(""));
    const res = await pullExtraOps(gh).checkout.invoke({
      number: 5,
      dir: "/w",
    });
    expect(gitCalls.map((c) => c.args)).toEqual([
      ["remote", "-v"],
      ["fetch", "up", "refs/pull/5/head"],
      ["branch", "--list", "feat"],
      ["checkout", "-B", "feat", "FETCH_HEAD"],
      ["rev-parse", "HEAD"],
    ]);
    expect(gitCalls.every((c) => c.cwd === "/w")).toBe(true);
    expect(res).toEqual({
      repo: "acme/widgets",
      number: 5,
      dir: "/w",
      branch: "feat",
      headSha: "deadbeef",
    });
  });

  test("an existing branch is fast-forwarded, not reset", async () => {
    const { gh, gitCalls } = fakeGitHub([], undefined, git("  mine\n"));
    await pullExtraOps(gh).checkout.invoke({
      number: 5,
      dir: "/w",
      branch: "mine",
    });
    expect(gitCalls.slice(3).map((c) => c.args)).toEqual([
      ["checkout", "mine"],
      ["merge", "--ff-only", "FETCH_HEAD"],
      ["rev-parse", "HEAD"],
    ]);
  });

  test("detach checks out FETCH_HEAD and falls back to the https url without a matching remote", async () => {
    const { gh, gitCalls } = fakeGitHub([], undefined, ({ args }) =>
      args[0] === "rev-parse" ? { stdout: "abc\n" } : undefined,
    );
    const res = await pullExtraOps(gh).checkout.invoke({
      number: 5,
      dir: "/w",
      detach: true,
    });
    expect(gitCalls.map((c) => c.args)).toContainEqual([
      "fetch",
      "https://github.com/acme/widgets.git",
      "refs/pull/5/head",
    ]);
    expect(gitCalls.map((c) => c.args)).toContainEqual([
      "checkout",
      "--detach",
      "FETCH_HEAD",
    ]);
    expect(res.branch).toBeNull();
  });

  test("detach with a branch, or an option-like branch, runs nothing", async () => {
    const { gh, gitCalls, seen } = fakeGitHub([]);
    const ops = pullExtraOps(gh);
    expect(
      await kindOf(
        ops.checkout.invoke({
          number: 5,
          dir: "/w",
          detach: true,
          branch: "x",
        }),
      ),
    ).toBe("usage");
    expect(
      await kindOf(ops.checkout.invoke({ number: 5, dir: "/w", branch: "-f" })),
    ).toBe("usage");
    expect(gitCalls).toHaveLength(0);
    expect(seen).toHaveLength(0);
  });
});
