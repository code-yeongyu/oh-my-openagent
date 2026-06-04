import type { NumberingInfo } from "../../features/claude-tasks/tree-numbering";

const INDENT = "  ";

export function buildTodoContent(subject: string, numbering: NumberingInfo): string {
  const indent = INDENT.repeat(numbering.depth);
  const numberingStr = numbering.numberingPath.join(".");
  return `${indent}${numberingStr}. ${subject}`;
}
