// The typed SDK: `const { client } = await import(".../github/scripts/sdk.ts"); await client.pr.view({ repo, number })`.
import { bind } from "./vendor/surface/index.ts";
import type { Deps } from "./src/http.ts";
import { surface, surfaceWith } from "./surface.ts";

export { surface };
export { parseRepo } from "./src/env.ts";
export type { Deps } from "./src/http.ts";
export const client = bind(surface.ops);
export const createClient = (inject: Partial<Deps> = {}) =>
  bind(surfaceWith(inject).ops);
