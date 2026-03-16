import type { SubPlan } from "../schemas/sub-plan-schema";

export interface FileOverlap {
  file: string;
  sub_plans: string[];
}

function collectFilesPerDomain(
  subPlans: SubPlan[]
): Map<string, Set<string>> {
  const fileTodomains = new Map<string, Set<string>>();

  for (const plan of subPlans) {
    const domainFiles = new Set<string>();
    for (const task of plan.tasks) {
      for (const file of task.files_touched) {
        domainFiles.add(file);
      }
    }

    for (const file of domainFiles) {
      const domains = fileTodomains.get(file);
      if (domains) {
        domains.add(plan.domain);
      } else {
        fileTodomains.set(file, new Set([plan.domain]));
      }
    }
  }

  return fileTodomains;
}

export function detectOverlaps(subPlans: SubPlan[]): FileOverlap[] {
  if (subPlans.length < 2) return [];

  const fileToDomains = collectFilesPerDomain(subPlans);
  const overlaps: FileOverlap[] = [];

  for (const [file, domains] of fileToDomains) {
    if (domains.size >= 2) {
      overlaps.push({
        file,
        sub_plans: Array.from(domains).sort(),
      });
    }
  }

  return overlaps.sort((a, b) => a.file.localeCompare(b.file));
}
