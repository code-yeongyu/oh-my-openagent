// Shared fixtures for the repository operation tests: a REST repository body and an error-kind probe.
import { SurfaceError } from "../vendor/surface/index.ts";

export const repoJson = (over: Readonly<Record<string, unknown>> = {}) => ({
  full_name: "acme/widgets",
  default_branch: "main",
  visibility: "public",
  private: false,
  archived: false,
  fork: false,
  topics: [],
  html_url: "https://github.com/acme/widgets",
  allow_squash_merge: true,
  ...over,
});

export const kindOf = (p: Promise<unknown>) =>
  p.then(
    () => "resolved",
    (e: unknown) => (e instanceof SurfaceError ? e.kind : "other"),
  );

export const calls = (seen: readonly { method: string; url: string }[]) =>
  seen.map((r) => {
    const u = new URL(r.url);
    return `${r.method} ${u.pathname}${u.search}`;
  });
