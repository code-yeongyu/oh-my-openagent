// Branches linked to an issue: listing them and creating one on GitHub.
import { op, s, SurfaceError } from "../vendor/surface/index.ts";
import { numberField, repoField, writes } from "./fields.ts";
import type { GitHub, Repo } from "./http.ts";
import { at, nodes, str } from "./read.ts";

const LINKED = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){issue(number:$number){
linkedBranches(first:100){nodes{ref{name target{oid} repository{nameWithOwner}}}}}}}`;

const TARGET = `query($owner:String!,$name:String!,$number:Int!,$bOwner:String!,$bName:String!,$base:String!,$hasBase:Boolean!){
repository(owner:$owner,name:$name){issue(number:$number){id}}
target:repository(owner:$bOwner,name:$bName){id defaultBranchRef{name target{oid}} ref(qualifiedName:$base) @include(if:$hasBase){name target{oid}}}}`;

const CREATE = `mutation($issue:ID!,$oid:GitObjectID!,$name:String,$repo:ID!){createLinkedBranch(input:{issueId:$issue,oid:$oid,name:$name,repositoryId:$repo}){
linkedBranch{ref{name target{oid} repository{nameWithOwner}}}}}`;

const branchOf = (ref: unknown) => {
  const repo = str(ref, "repository", "nameWithOwner");
  const name = str(ref, "name");
  return {
    name,
    repo,
    headSha: str(ref, "target", "oid"),
    url: `https://github.com/${repo}/tree/${name}`,
  };
};

const issueMissing = (r: Repo, number: number) =>
  new SurfaceError(
    "not_found",
    `no issue #${number} in ${r.full}`,
    "check the number",
  );

export const developOp = (gh: GitHub) =>
  op({
    description:
      "With list, the branches linked to an issue; otherwise create a branch on GitHub linked to the issue, from `base` (default: the branch repo's default branch) in `branchRepo` (default: the issue's repo). Nothing is checked out locally; use git or `pr checkout` for that. Replaces `gh issue develop`.",
    input: s.object({
      repo: repoField,
      number: numberField,
      list: s.optional(s.boolean()),
      name: s.optional(
        s.string({ description: "Branch name (GitHub picks one if omitted)." }),
      ),
      base: s.optional(s.string({ description: "Branch to start from." })),
      branchRepo: s.optional(
        s.string({ description: "owner/name to create the branch in." }),
      ),
    }),
    annotations: writes,
    run: async ({ repo, number, list, name, base, branchRepo }) => {
      if (
        list === true &&
        (name !== undefined || base !== undefined || branchRepo !== undefined)
      )
        throw new SurfaceError(
          "usage",
          "list cannot be combined with name, base or branchRepo",
          "drop list to create a branch",
        );
      const r = await gh.repo(repo);
      if (list === true) {
        const data = await gh.graphql(LINKED, {
          owner: r.owner,
          name: r.name,
          number,
        });
        const issue = at(data, "repository", "issue");
        if (issue === null || issue === undefined)
          throw issueMissing(r, number);
        return {
          repo: r.full,
          number,
          items: nodes(issue, "linkedBranches").map((n) =>
            branchOf(at(n, "ref")),
          ),
        };
      }
      const b = branchRepo === undefined ? r : await gh.repo(branchRepo);
      const data = await gh.graphql(TARGET, {
        owner: r.owner,
        name: r.name,
        number,
        bOwner: b.owner,
        bName: b.name,
        base: `refs/heads/${base ?? ""}`,
        hasBase: base !== undefined,
      });
      const issueId = at(data, "repository", "issue", "id");
      if (typeof issueId !== "string") throw issueMissing(r, number);
      const from = at(
        data,
        "target",
        base === undefined ? "defaultBranchRef" : "ref",
      );
      if (from === null || from === undefined)
        throw new SurfaceError(
          "not_found",
          `no branch ${base ?? "(default)"} in ${b.full}`,
          "check base and branchRepo",
        );
      const created = await gh.graphql(CREATE, {
        issue: issueId,
        oid: str(from, "target", "oid"),
        repo: str(data, "target", "id"),
        ...(name === undefined ? {} : { name }),
      });
      return {
        repo: r.full,
        number,
        base: str(from, "name"),
        branch: branchOf(
          at(created, "createLinkedBranch", "linkedBranch", "ref"),
        ),
      };
    },
  });
