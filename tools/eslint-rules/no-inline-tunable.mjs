// yakfeed/no-inline-tunable: numbers typed inline where a tunable belongs. It catches the
// commonest shapes:
//   - a literal limit on a schema: `.max(200)`, `.min(3)`, `.length(6)`, `.lte(50)` (0 and 1 are
//     structure, not limits: "not empty", "not negative");
//   - a literal timeout or interval: `AbortSignal.timeout(10_000)`, `setTimeout(f, 5 * 1000)`;
//   - a literal cache lifetime in a header: "max-age=3600".
// What may stay in code (column sizes, someone else's API limits) takes a disable comment with
// the reason: `// eslint-disable-next-line yakfeed/no-inline-tunable -- varchar(40) column`.
// Occurrences from before the rule sit in eslint-suppressions.json, which may only shrink.

const LIMITS = new Set(["max", "min", "length", "lt", "lte", "gt", "gte"]);
const TIMERS = new Set(["setTimeout", "setInterval"]);
const CACHE_LIFETIME = /\b(s-maxage|max-age)=[1-9]/;

// The value of an expression made only of number literals (`10 * 1000`, `-1`), else undefined.
function literalNumber(node) {
  if (!node) return undefined;
  if (node.type === "Literal" && typeof node.value === "number") return node.value;
  if (node.type === "UnaryExpression" && node.operator === "-") {
    const v = literalNumber(node.argument);
    return v === undefined ? undefined : -v;
  }
  if (node.type === "BinaryExpression" && ["*", "+", "-", "/"].includes(node.operator)) {
    const l = literalNumber(node.left);
    const r = literalNumber(node.right);
    if (l === undefined || r === undefined) return undefined;
    return { "*": l * r, "+": l + r, "-": l - r, "/": l / r }[node.operator];
  }
  return undefined;
}

const calleeName = (callee) =>
  callee.type === "Identifier" ? callee.name : callee.type === "MemberExpression" && !callee.computed ? callee.property.name : undefined;

export default {
  meta: {
    type: "problem",
    docs: { description: "Thresholds, limits, lifetimes and timeouts come from settings, not numbers typed inline." },
    schema: [],
    messages: {
      limit: "Inline limit {{value}}: add a key to config/defaults.yaml and the settings schema, and read settings.KEY. A column size or someone else's API limit can stay, with a disable comment saying which.",
      timer: "Inline timeout or interval {{value}}: read it from settings.",
      cache: "Inline cache lifetime: build the header from a setting.",
    },
  },
  create(context) {
    const checkText = (node, text) => {
      if (CACHE_LIFETIME.test(text)) context.report({ node, messageId: "cache" });
    };
    return {
      CallExpression(node) {
        const { callee } = node;
        const name = calleeName(callee);
        if (callee.type === "MemberExpression" && LIMITS.has(name)) {
          if (callee.object.type === "Identifier" && callee.object.name === "Math") return;
          const value = literalNumber(node.arguments[0]);
          if (value !== undefined && Math.abs(value) > 1) context.report({ node: node.arguments[0], messageId: "limit", data: { value } });
          return;
        }
        const isAbortTimeout =
          name === "timeout" && callee.type === "MemberExpression" && callee.object.type === "Identifier" && callee.object.name === "AbortSignal";
        const delay = isAbortTimeout ? node.arguments[0] : TIMERS.has(name) ? node.arguments[1] : undefined;
        const value = literalNumber(delay);
        if (value !== undefined && value > 0) context.report({ node: delay, messageId: "timer", data: { value } });
      },
      Literal(node) {
        if (typeof node.value === "string") checkText(node, node.value);
      },
      TemplateElement(node) {
        checkText(node, node.value.cooked ?? node.value.raw);
      },
    };
  },
};
