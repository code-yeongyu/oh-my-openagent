export declare const REPORT_ONLY_LIST_PATH: "test-temp-leak-report-only.json"

/** Owner/prefix pairs present in `head` but not in `base`. Both are the parsed list: owner -> prefixes. */
export declare function addedReportOnlyEntries(
  base: Readonly<Record<string, readonly string[]>>,
  head: Readonly<Record<string, readonly string[]>>,
): string[]
