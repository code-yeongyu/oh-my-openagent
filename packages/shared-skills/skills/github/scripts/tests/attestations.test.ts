import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attestationOps } from "../src/attestations.ts";
import { unsnappy } from "../src/snappy.ts";
import { fakeGitHub, json, on } from "./fake.ts";

const BUNDLE = {
  mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
  dsseEnvelope: { payload: "e30=" },
};

// Snappy block format: varint length, then one literal element (tag = (len-1)<<2, or 60<<2 + 1-byte len-1).
const snappy = (text: string): Uint8Array => {
  const raw = new TextEncoder().encode(text);
  const varint: number[] = [];
  for (let n = raw.length; ; n >>>= 7) {
    if (n < 0x80) {
      varint.push(n);
      break;
    }
    varint.push((n & 0x7f) | 0x80);
  }
  const head =
    raw.length <= 60 ? [(raw.length - 1) << 2] : [60 << 2, raw.length - 1];
  return new Uint8Array([...varint, ...head, ...raw]);
};

const sha256 = (text: string) =>
  `sha256:${new Bun.CryptoHasher("sha256").update(text).digest("hex")}`;
const pathOf = (url: string) => new URL(url).pathname + new URL(url).search;
const kind = (p: Promise<unknown>) =>
  p.then(
    () => "resolved",
    (e: unknown) => String(Reflect.get(Object(e), "kind")),
  );

let dir = "";
afterEach(async () => {
  if (dir !== "") await rm(dir, { recursive: true, force: true });
  dir = "";
});

describe("attestationOps", () => {
  test("a local file is digested here, inline and blob bundles both come back, and dir gets <digest>.jsonl", async () => {
    dir = await mkdtemp(join(tmpdir(), "attest-"));
    const artifact = join(dir, "app.tgz");
    await Bun.write(artifact, "artifact bytes");
    const digest = sha256("artifact bytes");
    const { gh, seen } = fakeGitHub([
      (req) =>
        req.url === "https://blob.example/b.json.sn"
          ? new Response(
              snappy(JSON.stringify({ ...BUNDLE, n: 2 }).padEnd(70, " ")),
            )
          : undefined,
      on("GET", /^\/repos\/acme\/widgets\/attestations\//, () =>
        json({
          attestations: [
            { repository_id: 1, bundle: BUNDLE, bundle_url: null },
            {
              repository_id: 2,
              bundle: null,
              bundle_url: "https://blob.example/b.json.sn",
            },
          ],
        }),
      ),
    ]);
    // ':' is not allowed in a Windows file name, so there the file is named with '-' (src/attestations.ts).
    const written = join(dir, `${process.platform === "win32" ? digest.replace(":", "-") : digest}.jsonl`);
    const out = await attestationOps(gh).list.invoke({
      file: artifact,
      predicateType: "https://slsa.dev/provenance/v1",
      dir,
    });
    expect(pathOf(seen[0]?.url ?? "")).toBe(
      `/repos/acme/widgets/attestations/${encodeURIComponent(digest)}?predicate_type=https%3A%2F%2Fslsa.dev%2Fprovenance%2Fv1&per_page=30`,
    );
    expect(seen[1]).toMatchObject({
      url: "https://blob.example/b.json.sn",
      auth: null,
    });
    expect(out).toMatchObject({
      repo: "acme/widgets",
      digest,
      path: written,
    });
    expect(out.items).toEqual([
      { repositoryId: 1, bundle: BUNDLE },
      { repositoryId: 2, bundle: { ...BUNDLE, n: 2 } },
    ]);
    const lines = (await Bun.file(written).text())
      .trimEnd()
      .split("\n");
    expect(lines.map((l) => JSON.parse(l))).toEqual([
      BUNDLE,
      { ...BUNDLE, n: 2 },
    ]);
  });

  test("sha512 is honoured for a file, and an owner resolves to the org or user endpoint", async () => {
    dir = await mkdtemp(join(tmpdir(), "attest-"));
    const artifact = join(dir, "bin");
    await Bun.write(artifact, "x");
    const { gh, seen } = fakeGitHub([
      on("GET", /^\/users\/acme$/, () => json({ type: "Organization" })),
      on("GET", /^\/users\/octo$/, () => json({ type: "User" })),
      on("GET", /\/attestations\//, () => json({ attestations: [] })),
    ]);
    const ops = attestationOps(gh);
    const org = await ops.list.invoke({
      file: artifact,
      digestAlg: "sha512",
      owner: "acme",
      limit: 5,
    });
    expect(org.digest).toBe(
      `sha512:${new Bun.CryptoHasher("sha512").update("x").digest("hex")}`,
    );
    expect(org).toMatchObject({ owner: "acme", items: [] });
    await ops.list.invoke({ digest: "SHA256:ABCD", owner: "octo" });
    expect(seen.map((s) => new URL(s.url).pathname)).toEqual([
      "/users/acme",
      `/orgs/acme/attestations/${encodeURIComponent(org.digest)}`,
      "/users/octo",
      "/users/octo/attestations/sha256%3Aabcd",
    ]);
  });

  test("bad input combinations fail before any request", async () => {
    const { gh, seen } = fakeGitHub([]);
    const ops = attestationOps(gh);
    expect(
      await Promise.all([
        kind(ops.list.invoke({})),
        kind(ops.list.invoke({ digest: "sha256:ab", file: "/x" })),
        kind(ops.list.invoke({ digest: "sha256:ab", repo: "a/b", owner: "a" })),
        kind(ops.list.invoke({ digest: "md5:ab" })),
        kind(
          ops.list.invoke({
            file: join(tmpdir(), "definitely-missing-artifact-file"),
          }),
        ),
      ]),
    ).toEqual(["usage", "usage", "usage", "usage", "usage"]);
    expect(seen).toHaveLength(0);
  });

  test("the decoder expands an overlapping back-reference", () => {
    const abcd = [12, 12, 97, 98, 99, 100];
    expect(
      new TextDecoder().decode(unsnappy(new Uint8Array([...abcd, 17, 4]))),
    ).toBe("abcdabcdabcd");
    expect(
      new TextDecoder().decode(unsnappy(new Uint8Array([7, 0, 97, 22, 1, 0]))),
    ).toBe("aaaaaaa");
  });

  test("a corrupt blob fails as invalid_response", async () => {
    const { gh } = fakeGitHub([
      (req) =>
        req.url === "https://blob.example/x"
          ? new Response(new Uint8Array([10, 0x7d]))
          : undefined,
      on("GET", /\/attestations\//, () =>
        json({
          attestations: [
            {
              repository_id: 1,
              bundle: null,
              bundle_url: "https://blob.example/x",
            },
          ],
        }),
      ),
    ]);
    expect(
      await kind(attestationOps(gh).list.invoke({ digest: "sha256:ab" })),
    ).toBe("invalid_response");
  });
});
