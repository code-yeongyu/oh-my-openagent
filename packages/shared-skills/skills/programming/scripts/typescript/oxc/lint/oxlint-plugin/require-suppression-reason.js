// Ported from pingdotgg/t3code at d7f3b72 (t3code#16294). MIT; see LICENSE.
// Plain-JS port via sisyphuslabs/omo-relay; TypeScript types and defineRule removed.
const DIRECTIVE_PATTERN =
  /^\s*\*?\s*(?:(?:oxlint|eslint)-(?:disable|enable)|@ts-(?:expect-error|ignore|nocheck)|@effect-diagnostics)/u;
const TS_DIRECTIVE_PATTERN = /^\s*\*?\s*@ts-(?:expect-error|ignore|nocheck)(?![\w-])(.*)$/su;
const EMPTY_COMMENT_PATTERN = /^[\s*]*$/u;

export default {
  meta: {
    type: "suggestion",
    docs: {
      description: "Require every lint or type-checker suppression to say why.",
    },
  },
  create(context) {
    const { sourceCode } = context;
    return {
      Program() {
        const comments = sourceCode.getAllComments();
        const ownLineCommentsByEndLine = new Map();
        for (const comment of comments) {
          const { line, column } = comment.loc.start;
          if ((sourceCode.lines[line - 1] ?? "").slice(0, column).trim() === "") {
            ownLineCommentsByEndLine.set(comment.loc.end.line, comment);
          }
        }

        const explainedAbove = (directive) => {
          let above = ownLineCommentsByEndLine.get(directive.loc.start.line - 1);
          while (
            above &&
            (DIRECTIVE_PATTERN.test(above.value) || EMPTY_COMMENT_PATTERN.test(above.value))
          ) {
            above = ownLineCommentsByEndLine.get(above.loc.start.line - 1);
          }
          return above !== undefined;
        };

        for (const directive of sourceCode.getDisableDirectives().directives) {
          if (directive.type === "enable" || directive.justification?.trim()) continue;
          if (explainedAbove(directive.node)) continue;
          context.report({
            loc: directive.node.loc,
            message:
              "Say why: end the directive with `-- reason` or put a comment on the line above.",
          });
        }

        for (const comment of comments) {
          const after = TS_DIRECTIVE_PATTERN.exec(comment.value)?.[1];
          if (after === undefined || after.replace(/^[\s:-]+/u, "").trim()) continue;
          if (explainedAbove(comment)) continue;
          context.report({
            loc: comment.loc,
            message:
              "Say why: write the reason after the directive or in a comment on the line above.",
          });
        }
      },
    };
  },
};
