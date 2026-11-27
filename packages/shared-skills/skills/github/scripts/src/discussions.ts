// GitHub Discussions over GraphQL: view, create, edit and comment; list lives in discussion-list.ts.
import { op, s, SurfaceError } from "../vendor/surface/index.ts";
import { discussionListOp } from "./discussion-list.ts";
import {
  categoryField,
  DISCUSSION,
  discussionSummary,
  lookup,
  setLabels,
} from "./discussion-lookup.ts";
import { reads, repoField, writes } from "./fields.ts";
import type { GitHub, Repo } from "./http.ts";
import { at, bool, nodes, num, optNum, optStr, str } from "./read.ts";

const numberField = s.integer({ description: "Discussion number." });

const VIEW = `query($owner:String!,$name:String!,$number:Int!,$comments:Int!){repository(owner:$owner,name:$name){discussion(number:$number){
${DISCUSSION} body answer{id url} latest:comments(last:$comments){nodes{id databaseId url body createdAt isAnswer upvoteCount author{login} replies{totalCount}}}}}}`;
const SUMMARY = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){discussion(number:$number){${DISCUSSION}}}}`;

const read = async (gh: GitHub, r: Repo, number: number) => {
  const d = at(
    await gh.graphql(SUMMARY, { owner: r.owner, name: r.name, number }),
    "repository",
    "discussion",
  );
  return { repo: r.full, ...discussionSummary(d) };
};

export const discussionOps = (gh: GitHub) => ({
  list: discussionListOp(gh),
  view: op({
    description:
      "One discussion with its body, answer and optionally its latest N top-level comments (each with its reply count). Replaces `gh discussion view`.",
    input: s.object({
      repo: repoField,
      number: numberField,
      comments: s.optional(
        s.integer({
          description:
            "Latest top-level comments to include (default 0, max 100).",
        }),
      ),
    }),
    annotations: reads,
    run: async ({ repo, number, comments }) => {
      const r = await gh.repo(repo);
      const d = at(
        await gh.graphql(VIEW, {
          owner: r.owner,
          name: r.name,
          number,
          comments: Math.min(comments ?? 0, 100),
        }),
        "repository",
        "discussion",
      );
      if (d === null || d === undefined)
        throw new SurfaceError(
          "not_found",
          `no discussion #${number} in ${r.full}`,
          "check the number",
        );
      return {
        repo: r.full,
        ...discussionSummary(d),
        body: optStr(d, "body") ?? "",
        answer: optStr(d, "answer", "url"),
        latestComments: nodes(d, "latest").map((c) => ({
          id: str(c, "id"),
          databaseId: optNum(c, "databaseId"),
          author: optStr(c, "author", "login"),
          createdAt: str(c, "createdAt"),
          isAnswer: bool(c, "isAnswer"),
          upvotes: optNum(c, "upvoteCount") ?? 0,
          replies: optNum(c, "replies", "totalCount") ?? 0,
          url: str(c, "url"),
          body: str(c, "body"),
        })),
      };
    },
  }),
  create: op({
    description:
      "Open a discussion in a category (name or slug), optionally labelled. Replaces `gh discussion create`.",
    input: s.object({
      repo: repoField,
      title: s.string(),
      body: s.optional(s.string()),
      category: categoryField,
      labels: s.optional(s.array(s.string())),
    }),
    annotations: writes,
    run: async ({ repo, title, body, category, labels }) => {
      const r = await gh.repo(repo);
      const ids = await lookup(gh, r, { category, labels: labels ?? [] });
      const d = at(
        await gh.graphql(
          "mutation($input:CreateDiscussionInput!){createDiscussion(input:$input){discussion{id number url}}}",
          {
            input: {
              repositoryId: ids.repoId,
              categoryId: ids.category?.id ?? "",
              title,
              body: body ?? "",
            },
          },
        ),
        "createDiscussion",
        "discussion",
      );
      await setLabels(gh, str(d, "id"), ids.labelIds, []);
      return {
        repo: r.full,
        id: str(d, "id"),
        number: num(d, "number"),
        url: str(d, "url"),
        labels: labels ?? [],
      };
    },
  }),
  edit: op({
    description:
      "Change a discussion's title, body or category, and add or remove labels. Returns the discussion as it stands afterwards. Replaces `gh discussion edit`.",
    input: s.object({
      repo: repoField,
      number: numberField,
      title: s.optional(s.string()),
      body: s.optional(s.string()),
      category: s.optional(categoryField),
      addLabels: s.optional(s.array(s.string())),
      removeLabels: s.optional(s.array(s.string())),
    }),
    annotations: writes,
    run: async (input) => {
      const add = input.addLabels ?? [];
      const remove = input.removeLabels ?? [];
      const update = { title: input.title, body: input.body };
      if (
        Object.values(update).every((v) => v === undefined) &&
        input.category === undefined &&
        add.length + remove.length === 0
      )
        throw new SurfaceError(
          "usage",
          "nothing to change",
          "pass title, body, category, addLabels or removeLabels",
        );
      const r = await gh.repo(input.repo);
      const ids = await lookup(gh, r, {
        number: input.number,
        ...(input.category === undefined ? {} : { category: input.category }),
        labels: [...add, ...remove],
      });
      const fields = Object.fromEntries(
        Object.entries({ ...update, categoryId: ids.category?.id }).filter(
          ([, v]) => v !== undefined,
        ),
      );
      if (Object.keys(fields).length > 0)
        await gh.graphql(
          "mutation($input:UpdateDiscussionInput!){updateDiscussion(input:$input){discussion{id}}}",
          { input: { discussionId: ids.discussionId, ...fields } },
        );
      await setLabels(
        gh,
        ids.discussionId,
        ids.labelIds.slice(0, add.length),
        ids.labelIds.slice(add.length),
      );
      return read(gh, r, input.number);
    },
  }),
  comment: op({
    description:
      "Comment on a discussion, reply in a comment's thread (replyTo), or replace an existing comment's body (editId). Replaces `gh discussion comment`.",
    input: s.object({
      repo: repoField,
      number: s.optional(numberField),
      body: s.string(),
      replyTo: s.optional(
        s.string({
          description: "Node id of the top-level comment to reply under.",
        }),
      ),
      editId: s.optional(
        s.string({ description: "Node id of an existing comment to replace." }),
      ),
    }),
    annotations: writes,
    run: async ({ repo, number, body, replyTo, editId }) => {
      if (editId !== undefined) {
        if (replyTo !== undefined)
          throw new SurfaceError(
            "usage",
            "pass replyTo or editId, not both",
            "editId replaces a comment; replyTo adds one",
          );
        const c = at(
          await gh.graphql(
            "mutation($input:UpdateDiscussionCommentInput!){updateDiscussionComment(input:$input){comment{id url}}}",
            { input: { commentId: editId, body } },
          ),
          "updateDiscussionComment",
          "comment",
        );
        return { id: str(c, "id"), url: str(c, "url") };
      }
      if (number === undefined)
        throw new SurfaceError(
          "usage",
          "pass the discussion number",
          "number is optional only together with editId",
        );
      const r = await gh.repo(repo);
      const { discussionId } = await lookup(gh, r, { number });
      const c = at(
        await gh.graphql(
          "mutation($input:AddDiscussionCommentInput!){addDiscussionComment(input:$input){comment{id url}}}",
          {
            input: {
              discussionId,
              body,
              ...(replyTo === undefined ? {} : { replyToId: replyTo }),
            },
          },
        ),
        "addDiscussionComment",
        "comment",
      );
      return { repo: r.full, id: str(c, "id"), url: str(c, "url") };
    },
  }),
});
