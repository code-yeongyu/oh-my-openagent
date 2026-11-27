// Downloading a workflow run's artifacts and extracting each zip into a directory.
import { op, s, SurfaceError } from "../vendor/surface/index.ts";
import { repoField, writes } from "./fields.ts";
import type { GitHub } from "./http.ts";
import { bool, num, str } from "./read.ts";
import { safeJoin, unzip } from "./zip.ts";

export const runDownloadOp = (gh: GitHub) =>
  op({
    description:
      "Download a run's unexpired artifacts (all, or those matching names or glob patterns) and extract them: into dir itself when exactly one name is given, else into dir/<artifact name>/. An existing file fails as `conflict` before anything is written. Replaces `gh run download`.",
    input: s.object({
      repo: repoField,
      runId: s.integer({
        description:
          "Workflow run id (databaseId; the number in .../actions/runs/<id>).",
      }),
      names: s.optional(
        s.array(s.string(), { description: "Artifact names to download." }),
      ),
      patterns: s.optional(
        s.array(s.string(), {
          description: "Glob patterns over artifact names.",
        }),
      ),
      dir: s.optional(
        s.string({ description: "Target directory (default: cwd)." }),
      ),
    }),
    annotations: writes,
    run: async ({ repo, runId, names, patterns, dir }) => {
      const r = await gh.repo(repo);
      const globs = (patterns ?? []).map((p) => new Bun.Glob(p));
      const filtered = names !== undefined || patterns !== undefined;
      const chosen = (
        await gh.list(`repos/${r.full}/actions/runs/${runId}/artifacts`, 1000, {
          key: "artifacts",
        })
      )
        .filter((a) => !bool(a, "expired"))
        .map((a) => ({ id: num(a, "id"), name: str(a, "name") }))
        .filter(
          (a) =>
            !filtered ||
            (names ?? []).includes(a.name) ||
            globs.some((g) => g.match(a.name)),
        );
      if (chosen.length === 0)
        throw new SurfaceError(
          "not_found",
          `run ${runId} has no unexpired artifacts${filtered ? " matching the filter" : ""}`,
          "artifacts expire after the retention window; check names with `api rest`",
        );
      const flat = names?.length === 1 && patterns === undefined;
      const root = dir ?? ".";
      const planned = [];
      for (const a of chosen) {
        const base = flat ? root : safeJoin(root, a.name);
        const zip = await gh.bytes(
          `repos/${r.full}/actions/artifacts/${a.id}/zip`,
        );
        const entries = unzip(zip).map((e) => ({
          target: safeJoin(base, e.path),
          data: e.data,
        }));
        planned.push({ ...a, dir: base, entries });
      }
      for (const e of planned.flatMap((a) => a.entries))
        if (await Bun.file(e.target).exists())
          throw new SurfaceError(
            "conflict",
            `${e.target} already exists`,
            "download into an empty dir or remove the file",
          );
      for (const e of planned.flatMap((a) => a.entries))
        await Bun.write(e.target, e.data);
      return {
        repo: r.full,
        runId,
        artifacts: planned.map((a) => ({
          id: a.id,
          name: a.name,
          dir: a.dir,
          files: a.entries.map((e) => e.target),
        })),
      };
    },
  });
