import { requireValue } from "./validation.mjs";

/** @param {import('./contracts.d.mts').Records} records @param {import('./contracts.d.mts').Assessment} assessment */
export function validateAssessment(records, assessment) {
  const experiment = records.experiments.find(item => item.id === assessment.experimentId);
  requireValue(experiment, "Assessment requires an existing experiment", "INVALID_TRANSITION");
  const option = records.options.find(item => item.id === experiment.optionId);
  requireValue(option, "Experiment option is missing", "INVALID_TRANSITION");
  const seen = new Set();
  for (const resolution of assessment.outcomes) {
    requireValue(!seen.has(resolution.outcomeId), "Duplicate outcome assessment", "INVALID_TRANSITION");
    seen.add(resolution.outcomeId);
    requireValue(option.outcomeIds.includes(resolution.outcomeId), "Assessment outcome must belong to the experiment option", "INVALID_TRANSITION");
    const evidence = resolution.evidenceIds.map(id => {
      const item = records.evidence.find(candidate => candidate.id === id);
      requireValue(item && item.experimentId === experiment.id && item.outcomeId === resolution.outcomeId,
        "Assessment evidence must belong to this experiment and outcome", "INVALID_TRANSITION");
      return item;
    });
    if (resolution.status === "achieved" || resolution.status === "irrelevant") {
      requireValue(assessment.validity === "valid", "Resolved outcomes require a valid experiment", "INVALID_TRANSITION");
      requireValue(evidence.some(supportsImpact), "Resolved outcomes require observed measurement or feedback with references", "INVALID_TRANSITION");
    }
  }
}

/** @param {import('./contracts.d.mts').Evidence} evidence */
function supportsImpact(evidence) {
  return evidence.provenance === "observed" && evidence.refs.length > 0
    && (evidence.kind === "measurement" || (evidence.kind === "feedback"
      && (evidence.source.role === "affected" || evidence.source.role === "stakeholder")));
}

/** @param {import('./contracts.d.mts').Snapshot} snapshot @returns {Map<string, import('./contracts.d.mts').Resolution>} */
export function resolutions(snapshot) {
  /** @type {Map<string, import('./contracts.d.mts').Resolution>} */
  const current = new Map();
  /** @type {Map<string, string>} */
  const owners = new Map();
  for (const { event } of snapshot.events) {
    if (event.type === "outcome") current.delete(event.id);
    if (event.type === "assessment") {
      for (const [outcomeId, experimentId] of owners) {
        if (experimentId === event.experimentId) current.delete(outcomeId);
      }
      for (const resolution of event.outcomes) {
        current.set(resolution.outcomeId, resolution);
        owners.set(resolution.outcomeId, event.experimentId);
      }
    }
  }
  return current;
}

/** @param {import('./contracts.d.mts').Snapshot} snapshot @param {import('./contracts.d.mts').Records} records @param {import('./contracts.d.mts').Closure} closure */
export function validateClosure(snapshot, records, closure) {
  requireValue(closure.evidenceIds.every(id => records.evidence.some(item => item.id === id)),
    "Closure references unknown evidence", "INVALID_TRANSITION");
  if (closure.resolution === "stopped") return;
  const current = resolutions(snapshot);
  requireValue(records.outcomes.length > 0, "Closure needs declared outcomes", "INVALID_TRANSITION");
  for (const outcome of records.outcomes) {
    const resolution = current.get(outcome.id);
    requireValue(resolution && (resolution.status === "irrelevant"
      || (closure.resolution === "achieved" && resolution.status === "achieved")),
    `Outcome ${outcome.id} has no current supported resolution`, "INVALID_TRANSITION");
    requireValue(resolution.evidenceIds.some(id => closure.evidenceIds.includes(id)),
      `Closure must cite supporting evidence for ${outcome.id}`, "INVALID_TRANSITION");
  }
}
