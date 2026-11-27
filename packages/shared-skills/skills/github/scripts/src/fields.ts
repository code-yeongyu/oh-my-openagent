import { s, type Annotations } from "../vendor/surface/index.ts";

export const repoField = s.optional(
  s.string({
    description:
      "owner/name (a github.com URL works too). Defaults to the git origin of the current directory.",
  }),
);
export const numberField = s.integer({
  description: "Pull request or issue number.",
});
export const limitField = (fallback: number) =>
  s.optional(
    s.integer({
      description: `Maximum items to return (default ${fallback}).`,
    }),
  );

export const reads: Annotations = {
  readOnly: true,
  idempotent: true,
  openWorld: true,
};
export const writes: Annotations = { destructive: false, openWorld: true };
export const irreversible: Annotations = { destructive: true, openWorld: true };

export const enc = encodeURIComponent;
