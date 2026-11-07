export const mobiusDiscoveryEvents = [
  {
    type: "context", problem: "Installers cannot identify a missing prerequisite",
    people: [
      { name: "Pilot installers", role: "affected" },
      { name: "QA facilitator", role: "executor" },
    ],
    unknowns: ["Will the improvement generalize beyond this controlled pilot?"],
  },
  {
    type: "outcome", id: "time", statement: "Installers diagnose the prerequisite sooner",
    baseline: "Twelve minutes in the controlled baseline", target: "At most four minutes",
    measure: "Controlled time-to-diagnosis observation",
  },
  {
    type: "option", id: "guide", title: "Write a troubleshooting guide",
    hypothesis: "A written decision tree shortens diagnosis",
    tradeoffs: ["Requires manual navigation"], outcomeIds: ["time"],
  },
  {
    type: "option", id: "diagnostic", title: "Report the missing prerequisite",
    hypothesis: "A direct diagnostic shortens diagnosis",
    tradeoffs: ["Requires a maintained diagnostic"], outcomeIds: ["time"],
  },
  {
    type: "decision", optionId: "diagnostic",
    rationale: "Test the shorter feedback path against the same outcome",
    decidedBy: "QA facilitator", refs: ["controlled baseline"],
  },
]

export function mobiusOutcomeEvidence(id, provenance) {
  return {
    type: "evidence", id, experimentId: "pilot", outcomeId: "time",
    kind: "measurement", provenance,
    source: { actor: "Controlled QA observation fixture", role: "executor" },
    summary: "The controlled pilot measured three minutes to correct diagnosis",
    refs: ["controlled-pilot-observation"],
  }
}
