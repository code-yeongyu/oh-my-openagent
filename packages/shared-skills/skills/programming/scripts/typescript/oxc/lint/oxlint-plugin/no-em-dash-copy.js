// Ported from pingdotgg/t3code at d7f3b72 (t3code#23799). MIT; see LICENSE.
const EM_DASH = "\u2014";
const MESSAGE = "No em dashes in product copy. Use a period, comma, colon, or parentheses instead.";

export default {
  meta: {
    type: "suggestion",
    docs: {
      description: "Disallow em dashes in strings and JSX text that users or agents read.",
    },
  },
  create(context) {
    const check = (node, text) => {
      if (text?.includes(EM_DASH)) context.report({ node, message: MESSAGE });
    };
    return {
      Literal(node) {
        if (typeof node.value === "string") check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.cooked);
      },
      JSXText(node) {
        check(node, node.value);
      },
    };
  },
};
