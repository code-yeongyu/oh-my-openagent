import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { releaseWriteOps } from "../src/release-write.ts";
import { fakeGitHub, json, on, type Seen } from "./fake.ts";

const UPLOAD =
  "https://uploads.github.com/repos/acme/widgets/releases/1/assets{?name,label}";
const rel = (extra: Record<string, unknown> = {}) => ({
  id: 1,
  tag_name: "v1.0.0",
  html_url: "https://github.com/acme/widgets/releases/tag/v1.0.0",
  draft: false,
  prerelease: false,
  upload_url: UPLOAD,
  assets: [{ id: 5, name: "old.bin" }],
  ...extra,
});
const uploaded = (req: Seen) =>
  json({ id: 9, name: new URL(req.url).searchParams.get("name") }, 201);
const kindOf = async (p: Promise<unknown>) =>
  p.then(
    () => "resolved",
    (e: unknown) => String(Reflect.get(Object(e), "kind")),
  );
const pathOf = (req: Seen | undefined) =>
  req === undefined ? "" : new URL(req.url).pathname + new URL(req.url).search;

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "release-write-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("release writes", () => {
  test("create sends the release fields, then uploads each file to the upload host", async () => {
    await Bun.write(join(dir, "app.zip"), "zipdata");
    const { gh, seen } = fakeGitHub([
      on("POST", /\/repos\/acme\/widgets\/releases$/, () => json(rel(), 201)),
      on("POST", /\/releases\/1\/assets\?/, uploaded),
    ]);
    const out = await releaseWriteOps(gh).create.invoke({
      tag: "v1.0.0",
      title: "One",
      notes: "hi",
      target: "main",
      prerelease: true,
      latest: false,
      generateNotes: true,
      files: [{ path: join(dir, "app.zip"), label: "App" }],
    });
    expect(seen[0]?.body).toEqual({
      tag_name: "v1.0.0",
      target_commitish: "main",
      name: "One",
      body: "hi",
      prerelease: true,
      make_latest: "false",
      generate_release_notes: true,
    });
    expect(seen[1]?.url).toBe(
      "https://uploads.github.com/repos/acme/widgets/releases/1/assets?name=app.zip&label=App",
    );
    expect(seen[1]?.contentType).toBe("application/zip");
    expect(new TextDecoder().decode(seen[1]?.bytes)).toBe("zipdata");
    expect(out).toMatchObject({ tag: "v1.0.0", id: 1, assets: ["app.zip"] });
  });

  test("notesStartTag generates notes first; verifyTag stops on a missing tag; a missing file sends nothing", async () => {
    const { gh, seen } = fakeGitHub([
      on("POST", /\/releases\/generate-notes$/, () =>
        json({ name: "Gen title", body: "gen body" }),
      ),
      on("POST", /\/repos\/acme\/widgets\/releases$/, () => json(rel(), 201)),
      on("GET", /\/git\/ref\/tags\/nope$/, () => json({}, 404)),
    ]);
    const ops = releaseWriteOps(gh);
    await ops.create.invoke({
      tag: "v1.0.0",
      notes: "mine",
      notesStartTag: "v0.9.0",
    });
    expect(seen[0]?.body).toEqual({
      tag_name: "v1.0.0",
      previous_tag_name: "v0.9.0",
    });
    expect(seen[1]?.body).toEqual({
      tag_name: "v1.0.0",
      name: "Gen title",
      body: "mine\n\ngen body",
    });
    expect(
      await kindOf(ops.create.invoke({ tag: "nope", verifyTag: true })),
    ).toBe("not_found");
    const before = seen.length;
    expect(
      await kindOf(
        ops.create.invoke({
          tag: "v2",
          files: [{ path: join(dir, "missing") }],
        }),
      ),
    ).toBe("usage");
    expect(seen).toHaveLength(before);
  });

  test("edit finds a draft through the release list and patches only given fields", async () => {
    const { gh, seen } = fakeGitHub([
      on("GET", /\/releases\/tags\/v2$/, () => json({}, 404)),
      on("GET", /\/repos\/acme\/widgets\/releases\?/, () =>
        json([rel(), rel({ id: 2, tag_name: "v2", draft: true })]),
      ),
      on("PATCH", /\/releases\/2$/, () =>
        json(rel({ id: 2, tag_name: "v2.0.0" })),
      ),
    ]);
    const ops = releaseWriteOps(gh);
    const out = await ops.edit.invoke({
      tag: "v2",
      newTag: "v2.0.0",
      draft: false,
      latest: true,
    });
    expect(seen.at(-1)?.body).toEqual({
      tag_name: "v2.0.0",
      draft: false,
      make_latest: "true",
    });
    expect(out).toMatchObject({ id: 2, tag: "v2.0.0", draft: false });
    const before = seen.length;
    expect(await kindOf(ops.edit.invoke({ tag: "v2" }))).toBe("usage");
    expect(seen).toHaveLength(before);
  });

  test("delete removes the release and, with cleanupTag, its tag ref (an absent tag is tolerated)", async () => {
    const { gh, seen } = fakeGitHub([
      on("GET", /\/releases\/tags\/v1\.0\.0$/, () => json(rel())),
      on("DELETE", /\/releases\/1$/, () => new Response(null, { status: 204 })),
      on("DELETE", /\/git\/refs\/tags\/v1\.0\.0$/, () => json({}, 422)),
    ]);
    const ops = releaseWriteOps(gh);
    expect(
      await kindOf(ops.delete.invoke({ tag: "v1.0.0", cleanupTag: true })),
    ).toBe("invalid");
    expect(pathOf(seen.at(-1))).toBe(
      "/repos/acme/widgets/git/refs/tags/v1.0.0",
    );

    const gone = fakeGitHub([
      on("GET", /\/releases\/tags\//, () => json(rel())),
      on("DELETE", /\/releases\/1$/, () => new Response(null, { status: 204 })),
      on("DELETE", /\/git\/refs\/tags\//, () => json({}, 404)),
    ]);
    expect(
      await releaseWriteOps(gone.gh).delete.invoke({
        tag: "v1.0.0",
        cleanupTag: true,
      }),
    ).toEqual({
      repo: "acme/widgets",
      tag: "v1.0.0",
      id: 1,
      deleted: true,
      tagDeleted: false,
    });
  });

  test("deleteAsset deletes the named asset and fails as not_found for an unknown name", async () => {
    const { gh, seen } = fakeGitHub([
      on("GET", /\/releases\/tags\/v1\.0\.0$/, () => json(rel())),
      on(
        "DELETE",
        /\/releases\/assets\/5$/,
        () => new Response(null, { status: 204 }),
      ),
    ]);
    const ops = releaseWriteOps(gh);
    expect(
      await ops.deleteAsset.invoke({ tag: "v1.0.0", name: "old.bin" }),
    ).toMatchObject({
      id: 5,
      deleted: true,
    });
    expect(seen.at(-1)?.method).toBe("DELETE");
    expect(
      await kindOf(ops.deleteAsset.invoke({ tag: "v1.0.0", name: "x" })),
    ).toBe("not_found");
  });

  test("upload refuses a same-named asset before uploading, and clobber replaces it", async () => {
    await Bun.write(join(dir, "old.bin"), "new");
    const { gh, seen } = fakeGitHub([
      on("GET", /\/releases\/tags\/v1\.0\.0$/, () => json(rel())),
      on(
        "DELETE",
        /\/releases\/assets\/5$/,
        () => new Response(null, { status: 204 }),
      ),
      on("POST", /\/releases\/1\/assets\?/, uploaded),
    ]);
    const ops = releaseWriteOps(gh);
    const files = [{ path: join(dir, "old.bin"), contentType: "text/plain" }];
    expect(await kindOf(ops.upload.invoke({ tag: "v1.0.0", files }))).toBe(
      "conflict",
    );
    expect(seen.map((r) => r.method)).toEqual(["GET"]);
    const out = await ops.upload.invoke({
      tag: "v1.0.0",
      files,
      clobber: true,
    });
    expect(seen.slice(1).map((r) => r.method)).toEqual([
      "GET",
      "DELETE",
      "POST",
    ]);
    expect(seen.at(-1)?.contentType).toBe("text/plain");
    expect(out).toEqual({
      repo: "acme/widgets",
      tag: "v1.0.0",
      assets: ["old.bin"],
      replaced: ["old.bin"],
    });
  });
});
