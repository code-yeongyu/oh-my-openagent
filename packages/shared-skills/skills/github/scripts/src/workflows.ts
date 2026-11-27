// Listing, viewing, enabling and disabling Actions workflows.
import { op, s, SurfaceError } from "../vendor/surface/index.ts";
import { enc, limitField, reads, repoField, writes } from "./fields.ts";
import type { GitHub } from "./http.ts";
import { num, optStr, str } from "./read.ts";
import { runSummary } from "./actions.ts";

const workflowField = s.string({
  description: "Workflow file name (ci.yml), numeric id, or display name.",
});

const workflow = (w: unknown) => ({
  id: num(w, "id"),
  name: str(w, "name"),
  path: str(w, "path"),
  state: str(w, "state"),
  url: str(w, "html_url"),
  updatedAt: optStr(w, "updated_at"),
});

const allWorkflows = async (gh: GitHub, full: string) =>
  (
    await gh.list(`repos/${full}/actions/workflows`, 1000, {
      key: "workflows",
    })
  ).map(workflow);

const resolveWorkflow = async (gh: GitHub, full: string, given: string) => {
  if (/^\d+$/.test(given) || /\.ya?ml$/i.test(given))
    return workflow(
      await gh.rest("GET", `repos/${full}/actions/workflows/${enc(given)}`),
    );
  const matches = (await allWorkflows(gh, full)).filter(
    (w) => w.name.toLowerCase() === given.toLowerCase(),
  );
  const [only, ...rest] = matches;
  if (only === undefined)
    throw new SurfaceError(
      "not_found",
      `no workflow named ${given} in ${full}`,
      "list workflows with `workflow list` (all: true includes disabled ones)",
    );
  if (rest.length > 0)
    throw new SurfaceError(
      "usage",
      `several workflows are named ${given}: ${matches.map((w) => `${w.id} (${w.path})`).join(", ")}`,
      "pass the workflow id or file name instead",
    );
  return only;
};

const toggle = (gh: GitHub, verb: "enable" | "disable", description: string) =>
  op({
    description,
    input: s.object({ repo: repoField, workflow: workflowField }),
    annotations: writes,
    run: async ({ repo, workflow: given }) => {
      const r = await gh.repo(repo);
      const w = await resolveWorkflow(gh, r.full, given);
      await gh.rest("PUT", `repos/${r.full}/actions/workflows/${w.id}/${verb}`);
      return {
        repo: r.full,
        ...workflow(
          await gh.rest("GET", `repos/${r.full}/actions/workflows/${w.id}`),
        ),
      };
    },
  });

export const workflowOps = (gh: GitHub) => ({
  list: op({
    description:
      "Workflows of a repo with their id, file path and state; disabled ones only when all is set. Replaces `gh workflow list`.",
    input: s.object({
      repo: repoField,
      all: s.optional(
        s.boolean({ description: "Include disabled workflows." }),
      ),
      limit: limitField(50),
    }),
    annotations: reads,
    run: async ({ repo, all, limit }) => {
      const r = await gh.repo(repo);
      const items = (await allWorkflows(gh, r.full)).filter(
        (w) => all === true || w.state === "active",
      );
      return { repo: r.full, items: items.slice(0, limit ?? 50) };
    },
  }),
  view: op({
    description:
      "One workflow's state, path and url with its latest runs; yaml: true adds the workflow file content at a ref. Replaces `gh workflow view`.",
    input: s.object({
      repo: repoField,
      workflow: workflowField,
      yaml: s.optional(
        s.boolean({ description: "Include the workflow file content." }),
      ),
      ref: s.optional(
        s.string({
          description:
            "Branch or tag to read the YAML from (default branch when omitted).",
        }),
      ),
      limit: limitField(5),
    }),
    annotations: reads,
    run: async ({ repo, workflow: given, yaml, ref, limit }) => {
      const r = await gh.repo(repo);
      const w = await resolveWorkflow(gh, r.full, given);
      const runs = (
        await gh.list(
          `repos/${r.full}/actions/workflows/${w.id}/runs`,
          limit ?? 5,
          { key: "workflow_runs" },
        )
      ).map(runSummary);
      const file = w.path.split("/").map(enc).join("/");
      const content =
        yaml === true
          ? await gh.text(
              `repos/${r.full}/contents/${file}${ref === undefined ? "" : `?ref=${enc(ref)}`}`,
              "application/vnd.github.raw+json",
            )
          : undefined;
      return {
        repo: r.full,
        ...w,
        runs,
        ...(content === undefined ? {} : { yaml: content }),
      };
    },
  }),
  enable: toggle(
    gh,
    "enable",
    "Enable a disabled workflow; returns its new state. Replaces `gh workflow enable`.",
  ),
  disable: toggle(
    gh,
    "disable",
    "Disable a workflow so it stops triggering; returns its new state. Replaces `gh workflow disable`.",
  ),
});
