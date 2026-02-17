import type { FileOverlap } from "../validation/overlap-detector";

export function buildConflictResolutionPrompt(
  overlaps: FileOverlap[],
  cycles: string[][]
): string {
  if (overlaps.length === 0 && cycles.length === 0) {
    return "";
  }

  const sections: string[] = [
    "## Conflicts Detected — Resolution Required",
    "",
    "The following conflicts were detected between sub-plans and must be resolved:",
    "",
  ];

  if (overlaps.length > 0) {
    sections.push("### File Overlaps");
    for (const overlap of overlaps) {
      sections.push(
        `- \`${overlap.file}\` is modified by sub-plans: ${overlap.sub_plans.join(", ")}`
      );
    }
    sections.push("");
  }

  if (cycles.length > 0) {
    sections.push("### Dependency Cycles");
    for (const cycle of cycles) {
      const cycleStr = [...cycle, cycle[0]].join(" → ");
      sections.push(`- Cycle: ${cycleStr}`);
    }
    sections.push("");
  }

  sections.push("### Resolution Instructions");
  sections.push("For each conflict, provide:");
  sections.push("1. Which sub-plan should own each overlapping file");
  sections.push("2. How to break each dependency cycle (which edge to remove)");
  sections.push("3. Any task reordering needed");
  sections.push("");
  sections.push("Respond with a JSON array of resolution actions.");

  return sections.join("\n");
}
