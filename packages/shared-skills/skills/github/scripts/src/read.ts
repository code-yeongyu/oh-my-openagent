// Narrow GitHub's JSON without type assertions: every field an operation returns is read through one of these,
// so a changed or wrong endpoint fails as `invalid_response` instead of leaking `undefined` downstream.
import { SurfaceError } from "../vendor/surface/index.ts";

export type Json = Readonly<Record<string, unknown>>;

export const isObj = (x: unknown): x is Json =>
  typeof x === "object" && x !== null && !Array.isArray(x);

const bad = (what: string): SurfaceError =>
  new SurfaceError(
    "invalid_response",
    `GitHub response has no ${what}`,
    "inspect the raw body with `api rest`; the endpoint or its shape may differ",
  );

export const obj = (x: unknown, what: string): Json => {
  if (!isObj(x)) throw bad(what);
  return x;
};

export const arr = (x: unknown, what: string): readonly unknown[] => {
  if (!Array.isArray(x)) throw bad(what);
  return x;
};

export const at = (x: unknown, ...keys: readonly string[]): unknown =>
  keys.reduce<unknown>((cur, k) => (isObj(cur) ? cur[k] : undefined), x);

export const str = (x: unknown, ...keys: readonly string[]): string => {
  const v = at(x, ...keys);
  if (typeof v !== "string") throw bad(keys.join("."));
  return v;
};

export const optStr = (
  x: unknown,
  ...keys: readonly string[]
): string | null => {
  const v = at(x, ...keys);
  return typeof v === "string" ? v : null;
};

export const num = (x: unknown, ...keys: readonly string[]): number => {
  const v = at(x, ...keys);
  if (typeof v !== "number") throw bad(keys.join("."));
  return v;
};

export const optNum = (
  x: unknown,
  ...keys: readonly string[]
): number | null => {
  const v = at(x, ...keys);
  return typeof v === "number" ? v : null;
};

export const bool = (x: unknown, ...keys: readonly string[]): boolean =>
  at(x, ...keys) === true;

export const nodes = (
  x: unknown,
  ...keys: readonly string[]
): readonly unknown[] => {
  const v = at(x, ...keys, "nodes");
  return Array.isArray(v) ? v : [];
};

export const names = (
  x: unknown,
  key: string,
  ...keys: readonly string[]
): string[] =>
  nodes(x, ...keys).flatMap((n) => {
    const v = at(n, key);
    return typeof v === "string" ? [v] : [];
  });
