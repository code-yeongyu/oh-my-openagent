#!/usr/bin/env bun

import { OMO_AI_PACKAGE_VERSION } from "../senpi-compat/index.ts";

export function main(): void {
  console.log(`omo-ai ${OMO_AI_PACKAGE_VERSION}`);
}

if (import.meta.main) {
  main();
}
