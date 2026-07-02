import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const markerFileName = "senpi-component-hooks.jsonl";

export function runComponentHookShim(component, argv) {
  recordComponentHookMarker(component, argv);
  return 0;
}

export function recordComponentHookMarker(component, argv) {
  const pluginData = process.env["PLUGIN_DATA"];
  if (pluginData !== undefined && pluginData.length > 0) {
    mkdirSync(pluginData, { recursive: true });
    appendFileSync(
      join(pluginData, markerFileName),
      `${JSON.stringify({ component, argv })}\n`,
      "utf8",
    );
  }
}
