import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const markerFileName = "senpi-component-hooks.jsonl";

export function runComponentHookShim(component, argv) {
  const pluginData = process.env["PLUGIN_DATA"];
  if (pluginData !== undefined && pluginData.length > 0) {
    mkdirSync(pluginData, { recursive: true });
    appendFileSync(
      join(pluginData, markerFileName),
      `${JSON.stringify({ component, argv })}\n`,
      "utf8",
    );
  }
  return 0;
}
