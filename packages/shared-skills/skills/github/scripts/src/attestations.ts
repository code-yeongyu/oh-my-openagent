// Artifact attestations: fetch the Sigstore bundles GitHub stores for an artifact digest (no verification).
import { join } from "node:path";
import { op, s, SurfaceError } from "../vendor/surface/index.ts";
import { enc, limitField, reads } from "./fields.ts";
import type { GitHub } from "./http.ts";
import { at, isObj, num, optStr, str } from "./read.ts";
import { unsnappy } from "./snappy.ts";

const DIGEST = /^(sha256|sha512):[0-9a-f]+$/;

const fileDigest = async (path: string, alg: "sha256" | "sha512") => {
  const file = Bun.file(path);
  if (!(await file.exists()))
    throw new SurfaceError(
      "usage",
      `no such file: ${path}`,
      "pass a local artifact path or digest",
    );
  const hasher = new Bun.CryptoHasher(alg);
  for await (const chunk of file.stream()) hasher.update(chunk);
  return `${alg}:${hasher.digest("hex")}`;
};

export const attestationOps = (gh: GitHub) => ({
  list: op({
    description:
      "Fetch the attestations (Sigstore bundles) stored for an artifact, by a local file whose digest is computed here or by a ready digest, scoped to a repository or an owner; with dir, also write <digest>.jsonl there. This fetches attestations and does NOT verify them. Replaces `gh attestation download`.",
    input: s.object({
      file: s.optional(
        s.string({ description: "Local artifact path to digest." }),
      ),
      digest: s.optional(
        s.string({ description: "sha256:<hex> or sha512:<hex>." }),
      ),
      digestAlg: s.optional(s.enum(["sha256", "sha512"])),
      repo: s.optional(
        s.string({
          description:
            "owner/name; defaults to the git origin when owner is not given.",
        }),
      ),
      owner: s.optional(
        s.string({
          description: "Organization or user login instead of repo.",
        }),
      ),
      predicateType: s.optional(
        s.string({ description: "e.g. https://slsa.dev/provenance/v1" }),
      ),
      limit: limitField(30),
      dir: s.optional(
        s.string({ description: "Directory to write <digest>.jsonl into." }),
      ),
    }),
    annotations: reads,
    run: async (input) => {
      if ((input.file === undefined) === (input.digest === undefined))
        throw new SurfaceError(
          "usage",
          "pass exactly one of file or digest",
          "digest looks like sha256:<hex>",
        );
      if (input.repo !== undefined && input.owner !== undefined)
        throw new SurfaceError(
          "usage",
          "pass repo or owner, not both",
          "owner covers every repository it owns",
        );
      const digest =
        input.file === undefined
          ? (input.digest ?? "").toLowerCase()
          : await fileDigest(input.file, input.digestAlg ?? "sha256");
      if (!DIGEST.test(digest))
        throw new SurfaceError(
          "usage",
          `not a digest: ${digest}`,
          "use sha256:<hex> or sha512:<hex>",
        );
      let scope: { readonly repo: string } | { readonly owner: string };
      let path: string;
      if (input.owner === undefined) {
        const r = await gh.repo(input.repo);
        scope = { repo: r.full };
        path = `repos/${r.full}/attestations/${enc(digest)}`;
      } else {
        const kind = str(
          await gh.rest("GET", `users/${enc(input.owner)}`),
          "type",
        );
        scope = { owner: input.owner };
        path = `${kind === "Organization" ? "orgs" : "users"}/${enc(input.owner)}/attestations/${enc(digest)}`;
      }
      const raw = await gh.list(path, input.limit ?? 30, {
        query: { predicate_type: input.predicateType },
        key: "attestations",
      });
      const items = await Promise.all(
        raw.map(async (a) => {
          const inline = at(a, "bundle");
          const url = optStr(a, "bundle_url");
          const bundle: unknown =
            isObj(inline) || url === null
              ? inline
              : JSON.parse(
                  new TextDecoder().decode(unsnappy(await gh.content(url))),
                );
          if (!isObj(bundle))
            throw new SurfaceError(
              "invalid_response",
              "attestation has no bundle",
              "inspect it with `api rest`",
            );
          return { repositoryId: num(a, "repository_id"), bundle };
        }),
      );
      const out =
        input.dir === undefined
          ? undefined
          : join(
              input.dir,
              `${process.platform === "win32" ? digest.replace(":", "-") : digest}.jsonl`,
            );
      if (out !== undefined)
        await Bun.write(
          out,
          items.map((i) => `${JSON.stringify(i.bundle)}\n`).join(""),
        );
      return {
        ...scope,
        digest,
        items,
        ...(out === undefined ? {} : { path: out }),
      };
    },
  }),
});
