import { validateAgentOrder } from "../shared/agent-ordering";
import { addConfigLoadError } from "../shared/config-errors";

const CONTROL_CHARACTERS_REGEX = /[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g;
const MAX_AGENT_ORDER_WARNING_VALUES = 10;
const MAX_AGENT_ORDER_WARNING_VALUE_LENGTH = 80;

function formatAgentOrderWarningValues(values: readonly string[]): string {
  const displayedValues = values.slice(0, MAX_AGENT_ORDER_WARNING_VALUES).map((value) => {
    const sanitized = value.replace(CONTROL_CHARACTERS_REGEX, "");
    const truncated = sanitized.length > MAX_AGENT_ORDER_WARNING_VALUE_LENGTH
      ? `${sanitized.slice(0, MAX_AGENT_ORDER_WARNING_VALUE_LENGTH)}...`
      : sanitized;
    return JSON.stringify(truncated);
  });

  const remaining = values.length - displayedValues.length;
  if (remaining > 0) {
    displayedValues.push(`(+${remaining} more)`);
  }

  return displayedValues.join(", ");
}

export function addAgentOrderWarnings(configPath: string, agentOrder: string[] | undefined): void {
  if (!agentOrder) return;

  const validation = validateAgentOrder(agentOrder);
  const messages: string[] = [];

  if (validation.invalid.length > 0) {
    messages.push(`unknown agent names ignored: ${formatAgentOrderWarningValues(validation.invalid)}`);
  }

  if (validation.duplicates.length > 0) {
    messages.push(`duplicate agent names ignored: ${formatAgentOrderWarningValues(validation.duplicates)}`);
  }

  if (messages.length === 0) return;

  addConfigLoadError({
    path: configPath,
    error: `agent_order warning - ${messages.join("; ")}`,
  });
}
