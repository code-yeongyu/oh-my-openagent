export class MobiusError extends Error {
  /** @param {import('./contracts.d.mts').ErrorCode} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = "MobiusError";
    this.code = code;
  }
}

/** @param {unknown} condition @param {string} message @param {import('./contracts.d.mts').ErrorCode} [code] @returns {asserts condition} */
export function requireValue(condition, message, code = "INVALID_INPUT") {
  if (!condition) throw new MobiusError(code, message);
}

/** @param {unknown} value @returns {asserts value is Record<string, unknown>} */
export function object(value) {
  requireValue(typeof value === "object" && value !== null && !Array.isArray(value), "Expected an object");
}

/** @param {unknown} value @param {import('./contracts.d.mts').Field} field @param {string} path */
function check(value, field, path) {
  if (typeof field === "string") {
    if (field === "revision") requireValue(Number.isSafeInteger(value) && Number(value) >= 0, `${path} must be a nonnegative integer`);
    else {
      requireValue(typeof value === "string" && value.trim().length > 0, `${path} must be a nonempty string`);
      if (field !== "string") requireValue(field.split("|").includes(value), `${path} must be one of ${field}`);
    }
  } else if ("optional" in field) {
    if (value !== undefined) check(value, field.optional, path);
  } else if ("array" in field) {
    requireValue(Array.isArray(value), `${path} must be an array`);
    for (const item of value) check(item, field.array, path);
  } else shape(value, field.object, path);
}

/** @param {unknown} value @param {Record<string, import('./contracts.d.mts').Field>} fields @param {string} [path] */
export function shape(value, fields, path = "input") {
  object(value);
  requireValue(Object.keys(value).every(key => Object.hasOwn(fields, key)), `${path} contains unknown fields`);
  for (const [key, field] of Object.entries(fields)) check(value[key], field, `${path}.${key}`);
}

const role = "affected|stakeholder|decider|executor";
const focus = "discover|decide|deliver";
const refs = { array: "string" };
/** @type {Record<string, Record<string, import('./contracts.d.mts').Field>>} */
export const eventContracts = {
  context: { problem: "string", people: { array: { object: { name: "string", role } } }, unknowns: refs },
  outcome: { id: "string", statement: "string", baseline: { optional: "string" }, target: { optional: "string" }, measure: { optional: "string" } },
  option: { id: "string", title: "string", hypothesis: "string", tradeoffs: refs, outcomeIds: refs, supersedes: { optional: "string" } },
  decision: { optionId: "string", rationale: "string", decidedBy: "string", refs },
  experiment: { id: "string", optionId: "string", plan: "string", passCriteria: "string", deliveryRef: { optional: { object: { kind: "ulw-loop", sessionId: "string", goalId: "string" } } } },
  delivery: { experimentId: "string", output: "string", checks: { array: { object: { name: "string", status: "pass|fail|blocked", evidence: refs } } }, refs },
  evidence: { id: "string", experimentId: "string", kind: "measurement|feedback|technical", provenance: "observed|simulated|inferred", source: { object: { actor: "string", role } }, summary: "string", refs, outcomeId: { optional: "string" } },
  assessment: { experimentId: "string", validity: "valid|invalid|unknown", hypothesisSupport: "supported|contradicted|inconclusive", outcomes: { array: { object: { outcomeId: "string", status: "achieved|not_achieved|unmeasured|irrelevant", evidenceIds: refs } } }, learning: "string", nextAction: "string" },
  foundation: { id: "string", area: "culture|collaboration|technical", note: "string", owner: "string", status: "open|done", refs },
  focus: { to: focus, reason: "string", refs },
  pause: { reason: "string" },
  resume: { reason: "string" },
  close: { reason: "string", resolution: "achieved|irrelevant|stopped", evidenceIds: refs },
};
export const methodContracts = {
  start: { title: "string", focus: { optional: focus } },
  status: {},
  record: { expectedRevision: "revision", event: "event" },
  learning: { experimentId: "string" },
  help: {},
};

/** @param {unknown} value @returns {asserts value is import('./contracts.d.mts').Event} */
export function event(value) {
  object(value);
  requireValue(typeof value.type === "string" && Object.hasOwn(eventContracts, value.type), "Unknown event type");
  const fields = eventContracts[value.type];
  requireValue(fields, "Unknown event contract");
  shape(value, { type: value.type, ...fields }, "event");
}
