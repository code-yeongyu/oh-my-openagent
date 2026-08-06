import {
  buildGeminiDelegationOverride,
  buildGeminiIntentGateEnforcement,
  buildGeminiToolCallExamples,
  buildGeminiToolGuide,
  buildGeminiToolMandate,
  buildGeminiVerificationOverride,
} from "./sisyphus/gemini";
import { isGeminiModel } from "./types";

export function applyGeminiFallbackOverrides(model: string, prompt: string): string {
  if (!isGeminiModel(model)) {
    return prompt;
  }

  const intentGatePrompt = prompt.replace(
    "</intent_verbalization>",
    `</intent_verbalization>\n\n${buildGeminiIntentGateEnforcement()}\n\n${buildGeminiToolMandate()}`,
  );

  const toolGuidePrompt = intentGatePrompt.replace(
    "</tool_usage_rules>",
    `</tool_usage_rules>\n\n${buildGeminiToolGuide()}\n\n${buildGeminiToolCallExamples()}`,
  );

  return toolGuidePrompt.replace(
    "<Constraints>",
    `${buildGeminiDelegationOverride()}\n\n${buildGeminiVerificationOverride()}\n\n<Constraints>`,
  );
}
