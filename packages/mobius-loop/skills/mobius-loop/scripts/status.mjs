import { derive } from "./records.mjs";
import { resolutions } from "./assessment.mjs";

/** @param {import('./contracts.d.mts').Snapshot} snapshot @returns {import('./contracts.d.mts').Status} */
export function statusResult(snapshot) {
  const records = derive(snapshot);
  const gaps = [];
  if (!records.context) gaps.push("Describe the problem and existing context.");
  if (!records.context?.people.some(person => person.role === "affected")) gaps.push("Identify affected people.");
  for (const question of records.context?.unknowns ?? []) gaps.push(`Unknown: ${question}`);
  if (!records.outcomes.length) gaps.push("Declare the intended outcome; delivered outputs alone do not define impact.");
  const current = resolutions(snapshot);
  for (const outcome of records.outcomes) {
    if (!outcome.baseline) gaps.push(`Establish a baseline for outcome ${outcome.id}.`);
    if (!outcome.target) gaps.push(`Define a target for outcome ${outcome.id}.`);
    if (!outcome.measure) gaps.push(`Define a measure for outcome ${outcome.id}.`);
    const resolution = current.get(outcome.id);
    if (!resolution || resolution.status === "unmeasured") gaps.push(`Measure or obtain observed feedback on outcome ${outcome.id}; impact is unverified.`);
    if (resolution?.status === "not_achieved") gaps.push(`Review the unmet outcome ${outcome.id} and choose another evidence action.`);
  }
  const nextActions = records.lifecycle === "closed" ? []
    : records.lifecycle === "paused" ? ["Resume the initiative or close it with a reason."]
      : [...gaps];
  if (records.lifecycle === "active") {
    if (records.outcomes.length && !records.options.length) nextActions.push("Compare options linked to the declared outcomes.");
    if (records.options.length && !records.selectedOptionId) nextActions.push("Select an option and record the decision rationale.");
    if (records.selectedOptionId && !records.experiments.some(item => item.optionId === records.selectedOptionId))
      nextActions.push("Plan an experiment for the selected option.");
    for (const experiment of records.experiments) {
      const assessment = records.assessments.findLast(item => item.experimentId === experiment.id);
      if (!assessment) nextActions.push(`Collect evidence and assess experiment ${experiment.id}.`);
      else nextActions.push(assessment.nextAction);
    }
    for (const item of records.foundation.filter(candidate => candidate.status === "open"))
      nextActions.push(`Foundation ${item.id}: ${item.owner} - ${item.note}`);
  }
  return { snapshot, records, gaps, nextActions: [...new Set(nextActions)] };
}
