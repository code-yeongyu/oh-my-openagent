import {
  TRUNCATION_NOTICE_PREFIX,
  TRUNCATION_NOTICE_SUFFIX,
} from "./constants";

export function formatAgentsMdContextBlock(input: {
  readonly agentsPath: string;
  readonly content: string;
  readonly truncated: boolean;
}): string {
  const truncationNotice = input.truncated
    ? `${TRUNCATION_NOTICE_PREFIX}${input.agentsPath}${TRUNCATION_NOTICE_SUFFIX}`
    : "";
  return `\n\n[Directory Context: ${input.agentsPath}]\n${input.content}${truncationNotice}`;
}
