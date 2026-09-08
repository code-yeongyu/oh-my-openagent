import { readFileSync } from "node:fs";

import { findMissingPayloadPaths, requiredCodexInstallPaths } from "./script/npm-payload-required-paths.mjs";

const raw = JSON.parse(readFileSync("pack.json", "utf8"));
const entry = Array.isArray(raw) ? raw[0] : Object.values(raw)[0];
const packed = entry.files.map((file) => file.path);

const manifest = JSON.parse(readFileSync("packages/shared-skills/package.json", "utf8"));
const sharedTargets = Object.values(manifest.exports ?? {}).flatMap((exportEntry) =>
  typeof exportEntry === "string"
    ? [exportEntry]
    : [exportEntry?.import, exportEntry?.default].filter((target) => typeof target === "string"),
);
const sharedRequired = [...new Set(sharedTargets.map((target) => `packages/shared-skills/${target.replace(/^\.\//, "")}`))];

console.log("packed paths:", packed.length);
console.log("shipped gate (shared-skills only) missing:", JSON.stringify(findMissingPayloadPaths(packed, sharedRequired)));
console.log("new gate required:", JSON.stringify(requiredCodexInstallPaths()));
console.log("new gate missing:", JSON.stringify(findMissingPayloadPaths(packed, requiredCodexInstallPaths())));
