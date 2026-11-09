import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { copyRepo, runKnip, unusedExports } from "./knip-run.ts";

// Next.js route-segment config exports are read by the framework from the app directory's special files, so knip must
// not report them, while a genuinely unused export of the same file must still be reported. The recognition is scoped
// (script/knip-next-route-segment-exports.ts, configured in knip.jsonc preprocessorOptions.nextRouteSegmentExports), so
// these probes are NEW files added to a repo copy rather than files named in any ignore list.

const KNIP_TIMEOUT_MS = 600_000;
const SOURCE = [
  "export const revalidate = 60;",
  'export const dynamic = "force-dynamic";',
  "export const zzUnusedProbe = 1;",
  "export default function Page() {",
  "  return null;",
  "}",
  "",
].join("\n");

// A page under a private folder ("_components") is not routed by Next.js, so its route-segment names are ordinary
// unused exports and must still be reported.
const PROBES = [
  { file: "packages/web/app/design/zz-knip-route-segment-probe/page.tsx", recognised: true },
  { file: "packages/web/app/_components/zz-knip-private-probe/page.tsx", recognised: false },
] as const;

describe("knip recognises Next.js route-segment config exports", () => {
  test(
    "a routed page's revalidate is not reported; an unrelated export, and a private folder's page, still are",
    async () => {
      const copy = await copyRepo();
      try {
        for (const { file } of PROBES) {
          mkdirSync(dirname(join(copy, file)), { recursive: true });
          await Bun.write(join(copy, file), SOURCE);
        }
        const { stdout, stderr } = await runKnip(copy, ["--reporter", "json"]);
        const unused = unusedExports(copy, stdout, stderr);
        for (const { file, recognised } of PROBES) {
          expect(unused.has(`${file}#zzUnusedProbe`)).toBe(true);
          expect([...unused].filter((row) => row === `${file}#revalidate` || row === `${file}#dynamic`)).toEqual(
            recognised ? [] : [`${file}#revalidate`, `${file}#dynamic`],
          );
        }
      } finally {
        rmSync(copy, { recursive: true, force: true });
      }
    },
    KNIP_TIMEOUT_MS,
  );
});
