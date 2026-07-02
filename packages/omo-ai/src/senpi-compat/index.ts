import packageManifest from "../../package.json";

export type SenpiPackagePaths = {
  readonly hooks: "./senpi/hooks";
  readonly skills: "./senpi/skills";
  readonly prompts: "./senpi/prompts";
  readonly extensions: "./senpi/extensions";
};

export const OMO_AI_PACKAGE_VERSION = packageManifest.version;

export const SENPI_PACKAGE_PATHS = {
  hooks: "./senpi/hooks",
  skills: "./senpi/skills",
  prompts: "./senpi/prompts",
  extensions: "./senpi/extensions",
} as const satisfies SenpiPackagePaths;
