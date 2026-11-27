import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gistOps } from "../src/gists.ts";
import { fakeGitHub, json, on } from "./fake.ts";

const ID = "aa5a315d61ae9438b18d";
const kindOf = async (p: Promise<unknown>) =>
  p.then(
    () => "resolved",
    (e: unknown) => String(Reflect.get(Object(e), "kind")),
  );

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

let dir: string | undefined;
afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("gist writes", () => {
  test("create sends inline files and local paths, secret by default", async () => {
    dir = await mkdtemp(join(tmpdir(), "gist-create-"));
    const local = join(dir, "local.txt");
    await writeFile(local, "from disk");
    const { gh, seen } = fakeGitHub([
      on("POST", /\/gists$/, () =>
        json(restGist({ "a.md": file("a.md") }), 201),
      ),
    ]);
    const out = await gistOps(gh).create.invoke({
      files: { "a.md": "hello" },
      paths: [local],
      description: "notes",
    });
    expect(seen[0]?.body).toEqual({
      files: {
        "a.md": { content: "hello" },
        "local.txt": { content: "from disk" },
      },
      public: false,
      description: "notes",
    });
    expect(out).toMatchObject({ id: ID, files: ["a.md"] });
  });

  test("create with no files is a usage error and sends nothing", async () => {
    const { gh, seen } = fakeGitHub([]);
    expect(await kindOf(gistOps(gh).create.invoke({ public: true }))).toBe(
      "usage",
    );
    expect(seen).toHaveLength(0);
  });

  test("edit sets, adds and removes files in one PATCH", async () => {
    dir = await mkdtemp(join(tmpdir(), "gist-edit-"));
    const added = join(dir, "new.sh");
    await writeFile(added, "echo hi");
    const { gh, seen } = fakeGitHub([
      on("PATCH", new RegExp(`/gists/${ID}$`), () =>
        json(restGist({ "a.md": file("a.md") })),
      ),
    ]);
    await gistOps(gh).edit.invoke({
      id: ID,
      description: "renamed",
      set: { "a.md": "changed" },
      add: [added],
      remove: ["old.txt"],
    });
    expect(seen[0]?.body).toEqual({
      description: "renamed",
      files: {
        "a.md": { content: "changed" },
        "new.sh": { content: "echo hi" },
        "old.txt": null,
      },
    });
  });

  test("edit with nothing to change and a malformed id both send nothing", async () => {
    const { gh, seen } = fakeGitHub([]);
    const ops = gistOps(gh);
    expect(await kindOf(ops.edit.invoke({ id: ID }))).toBe("usage");
    expect(await kindOf(ops.delete.invoke({ id: "../user" }))).toBe("usage");
    expect(seen).toHaveLength(0);
  });

  test("rename sends only the new filename for the old one", async () => {
    const { gh, seen } = fakeGitHub([
      on("PATCH", /\/gists\//, () => json(restGist({ "b.md": file("b.md") }))),
    ]);
    const out = await gistOps(gh).rename.invoke({
      id: ID,
      from: "a.md",
      to: "b.md",
    });
    expect(seen[0]?.body).toEqual({ files: { "a.md": { filename: "b.md" } } });
    expect(out.files).toEqual(["b.md"]);
  });

  test("delete sends DELETE for the id", async () => {
    const { gh, seen } = fakeGitHub([
      on(
        "DELETE",
        new RegExp(`/gists/${ID}$`),
        () => new Response(null, { status: 204 }),
      ),
    ]);
    expect(await gistOps(gh).delete.invoke({ id: `${ID}.git` })).toEqual({
      id: ID,
      deleted: true,
    });
    expect(seen[0]?.method).toBe("DELETE");
  });

  test("clone runs git clone of the gist repository into dir", async () => {
    const { gh, gitCalls } = fakeGitHub([]);
    expect(await gistOps(gh).clone.invoke({ id: ID, dir: "/work/g" })).toEqual({
      id: ID,
      dir: "/work/g",
    });
    expect(gitCalls).toEqual([
      {
        args: ["clone", `https://gist.github.com/${ID}.git`, "/work/g"],
        cwd: ".",
      },
    ]);
  });
});
