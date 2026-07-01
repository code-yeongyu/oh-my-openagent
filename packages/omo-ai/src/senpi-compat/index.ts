export type SenpiPackagePaths = {
  readonly hooks: "./senpi/hooks";
  readonly skills: "./senpi/skills";
  readonly prompts: "./senpi/prompts";
  readonly extensions: "./senpi/extensions";
};

export const OMO_AI_PACKAGE_VERSION = "4.15.0";

export const SENPI_PACKAGE_PATHS = {
  hooks: "./senpi/hooks",
  skills: "./senpi/skills",
  prompts: "./senpi/prompts",
  extensions: "./senpi/extensions",
} as const satisfies SenpiPackagePaths;
