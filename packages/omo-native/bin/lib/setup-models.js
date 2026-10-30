export const MODEL_GUIDE_LINE = "Model-to-agent guidance: docs/guide/agent-model-matching.md"

// Only printed when setup found nothing to carry over: with a real plan, the stages write the
// providers and model choices themselves, so a placeholder would describe by hand what setup does.
export function formatModelTemplate() {
  return [
    "Ready-to-paste omo.json models catalog template:",
    JSON.stringify({
      models: {
        primary: { model: "<provider>/<model-id>", reasoning: "<off|low|medium|high|max>" },
        "custom-endpoint": { model: "<custom-baseUrl-provider>/<model-id>" },
      },
    }, null, 2),
    "For custom endpoints, define the provider baseUrl in the engine's models.json, then use that provider id above.",
  ]
}
