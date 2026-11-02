import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { BIOME, oxlintLines, PORTS, verdictsPath } from "./biome-parity";

const root = join(import.meta.dir, "../..");
const verdicts: { biome: string; rules: Record<string, number[]> } = await Bun.file(verdictsPath).json();

describe("rules ported to oxlint flag exactly what Biome 2.5.14 flags", () => {
  test("records a Biome verdict for every ported rule", () => {
    expect(verdicts.biome).toBe(BIOME);
    expect(Object.keys(verdicts.rules).sort()).toEqual(Object.keys(PORTS).sort());
  });

  for (const [rule, port] of Object.entries(PORTS)) {
    test(`${rule} flags the same corpus lines as Biome`, () => {
      expect(oxlintLines(rule, port.corpus)).toEqual(verdicts.rules[rule] ?? []);
    });
  }
});

describe("oxlint configuration", () => {
  const oxlint = (args: string[]): unknown => {
    const result = Bun.spawnSync([join(root, "node_modules/.bin/oxlint"), ...args], { cwd: root });
    expect(result.exitCode).toBe(0);
    return JSON.parse(result.stdout.toString());
  };
  const typeAware = new Set(
    (oxlint(["--rules", "-f", "json"]) as { scope: string; value: string; type_aware: boolean }[])
      .filter((rule) => rule.type_aware)
      .map((rule) => `${rule.scope}/${rule.value}`),
  );

  for (const config of [".oxlintrc.json", "packages/web/.oxlintrc.json"]) {
    test(`${config} enables no type-aware rule, because lint runs without --type-aware and would skip it silently`, () => {
      expect(typeAware.size).toBeGreaterThan(0);
      const level = (setting: unknown): unknown => (Array.isArray(setting) ? setting[0] : setting);
      const printed = oxlint(["-c", config, "--print-config"]) as { rules: Record<string, unknown> };
      const enabled = Object.entries(printed.rules)
        .filter(([name, setting]) => typeAware.has(name) && !["off", "allow", 0].includes(level(setting) as string))
        .map(([name]) => name);
      expect(enabled).toEqual([]);
    });
  }
});
