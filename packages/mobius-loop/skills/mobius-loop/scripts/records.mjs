import { requireValue } from "./validation.mjs";
import { validateAssessment, validateClosure } from "./assessment.mjs";

/** @param {import('./contracts.d.mts').Focus} focus @returns {import('./contracts.d.mts').Records} */
function emptyRecords(focus) {
  return { context: null, outcomes: [], options: [], decisions: [], experiments: [], deliveries: [],
    evidence: [], assessments: [], foundation: [], selectedOptionId: null, focus, lifecycle: "active", closure: null };
}

/** @template {{id: string}} T @param {T[]} items @param {T} item */
function upsert(items, item) {
  const index = items.findIndex(old => old.id === item.id);
  if (index < 0) items.push(item);
  else items[index] = item;
}

/** @param {{id: string}[]} items @param {string} id */
function exists(items, id) {
  requireValue(items.some(item => item.id === id), `Unknown reference: ${id}`, "INVALID_TRANSITION");
}

/** @param {{id: string}[]} items @param {string} id */
function unique(items, id) {
  requireValue(!items.some(item => item.id === id), `Duplicate identifier: ${id}`, "INVALID_TRANSITION");
}

/** @param {import('./contracts.d.mts').Snapshot} snapshot @param {import('./contracts.d.mts').Records} records @param {import('./contracts.d.mts').Event} event */
export function apply(snapshot, records, event) {
  requireValue(records.lifecycle !== "closed", "Initiative is closed", "INVALID_TRANSITION");
  requireValue(records.lifecycle !== "paused" || event.type === "resume" || event.type === "close",
    "Resume the paused initiative before recording work", "INVALID_TRANSITION");
  switch (event.type) {
    case "context": records.context = event; break;
    case "outcome": upsert(records.outcomes, event); break;
    case "option":
      unique(records.options, event.id);
      requireValue(event.outcomeIds.length > 0, "Options need declared outcomes", "INVALID_TRANSITION");
      for (const id of event.outcomeIds) exists(records.outcomes, id);
      if (event.supersedes) exists(records.options, event.supersedes);
      records.options.push(event);
      break;
    case "decision":
      exists(records.options, event.optionId);
      records.selectedOptionId = event.optionId;
      records.decisions.push(event);
      break;
    case "experiment":
      unique(records.experiments, event.id);
      exists(records.options, event.optionId);
      requireValue(records.selectedOptionId === event.optionId, "Experiment requires the selected option", "INVALID_TRANSITION");
      records.experiments.push(event);
      break;
    case "delivery":
      exists(records.experiments, event.experimentId);
      records.deliveries.push(event);
      break;
    case "evidence": {
      unique(records.evidence, event.id);
      const experiment = records.experiments.find(item => item.id === event.experimentId);
      requireValue(experiment, "Evidence requires an experiment", "INVALID_TRANSITION");
      if (event.outcomeId) {
        const option = records.options.find(item => item.id === experiment.optionId);
        requireValue(option?.outcomeIds.includes(event.outcomeId), "Evidence outcome must belong to the experiment option", "INVALID_TRANSITION");
      }
      records.evidence.push(event);
      break;
    }
    case "assessment":
      validateAssessment(records, event);
      records.assessments.push(event);
      break;
    case "foundation": upsert(records.foundation, event); break;
    case "focus": records.focus = event.to; break;
    case "pause":
      records.lifecycle = "paused";
      break;
    case "resume":
      requireValue(records.lifecycle === "paused", "Only paused initiatives can resume", "INVALID_TRANSITION");
      records.lifecycle = "active";
      break;
    case "close":
      validateClosure(snapshot, records, event);
      records.closure = event;
      records.lifecycle = "closed";
      break;
    default: {
      /** @type {never} */
      const unreachable = event;
      return unreachable;
    }
  }
}

/** @param {import('./contracts.d.mts').Snapshot} snapshot */
export function derive(snapshot) {
  const records = emptyRecords(snapshot.initialFocus);
  /** @type {import('./contracts.d.mts').Snapshot} */
  const previous = { ...snapshot, revision: 0, events: [] };
  for (const entry of snapshot.events) {
    apply(previous, records, entry.event);
    previous.events.push(entry);
    previous.revision = entry.revision;
  }
  return records;
}
