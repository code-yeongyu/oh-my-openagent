import { isRecord } from "@oh-my-opencode/utils"
export { isRecord }

export function normalizeFallbackModelID(modelID: string): string {
  return modelID
    .replace(/-thinking$/i, "")
    .replace(/-max$/i, "")
    .replace(/-high$/i, "");
}

export function extractErrorName(error: unknown): string | undefined {
  if (isRecord(error) && typeof error.name === "string") return error.name;
  if (error instanceof Error) return error.name;
  return undefined;
}

export function extractErrorMessage(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error;

  if (isRecord(error)) {
    const candidates: unknown[] = [
      error.data,
      isRecord(error.data) ? error.data.error : undefined,
      error.error,
      error.cause,
      error,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.length > 0) {
        return candidate;
      }
      if (isRecord(candidate) && typeof candidate.message === "string" && candidate.message.length > 0) {
        return candidate.message;
      }
    }
  }

  if (error instanceof Error) return error.message;

  try {
    return JSON.stringify(error);
  } catch (stringifyError) {
    if (!(stringifyError instanceof Error)) {
      throw stringifyError;
    }

    return String(error);
  }
}

export function extractProviderModelFromErrorMessage(message: string): { providerID?: string; modelID?: string } {
  const lower = message.toLowerCase();

  const providerModel = lower.match(/model\s+not\s+found:\s*([a-z0-9_-]+)\s*\/\s*([a-z0-9._-]+)/i);
  if (providerModel) {
    return {
      providerID: providerModel[1],
      modelID: providerModel[2],
    };
  }

  const modelOnly = lower.match(/unknown\s+provider\s+for\s+model\s+([a-z0-9._-]+)/i);
  if (modelOnly) {
    return {
      modelID: modelOnly[1],
    };
  }

  return {};
}

export function resolveFallbackAgentName(params: {
  currentAgent?: string;
  sessionID: string;
  mainSessionID?: string;
  message: string;
}): string | undefined {
  if (params.currentAgent) return params.currentAgent;
  if (params.sessionID !== params.mainSessionID) return undefined;
  if (params.message.toLowerCase().includes("gpt-5")) return "hephaestus";
  return "sisyphus";
}
