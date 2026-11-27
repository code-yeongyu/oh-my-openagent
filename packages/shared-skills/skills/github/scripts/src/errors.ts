// How a failed GitHub response is classified: rate limits (primary and secondary) and the error kind and message.
import { at, optStr } from "./read.ts";

export const rateLimit = (
  res: Response,
  now: number,
): { readonly waitMs: number; readonly when: string } | undefined => {
  const limited =
    res.status === 429 ||
    (res.status === 403 &&
      (res.headers.get("x-ratelimit-remaining") === "0" ||
        res.headers.has("retry-after")));
  if (!limited) return undefined;
  const after = Number(res.headers.get("retry-after") ?? "NaN");
  const reset = Number(res.headers.get("x-ratelimit-reset") ?? "NaN") * 1000;
  const waitMs = Number.isFinite(after)
    ? after * 1000
    : Number.isFinite(reset)
      ? reset - now
      : 60_000;
  const when = Number.isFinite(reset)
    ? new Date(reset).toISOString()
    : `in ${Math.ceil(waitMs / 1000)} s`;
  return { waitMs, when };
};

export const errorMessage = (text: string): string => {
  try {
    const body: unknown = JSON.parse(text);
    const errors = at(body, "errors");
    const detail = Array.isArray(errors)
      ? errors
          .map((e) =>
            typeof e === "string"
              ? e
              : (optStr(e, "message") ?? optStr(e, "code") ?? ""),
          )
          .filter(Boolean)
          .join("; ")
      : "";
    return [optStr(body, "message") ?? "", detail].filter(Boolean).join(": ");
  } catch {
    return text.slice(0, 300);
  }
};

export const kindFor = (status: number, message: string): [string, string] => {
  if (status === 401)
    return [
      "auth",
      "the token is invalid or expired; refresh GH_TOKEN or `gh auth login`",
    ];
  if (status === 404)
    return [
      "not_found",
      "check owner/name and number; a private repo also answers 404 without access",
    ];
  if (status === 403)
    return [
      "forbidden",
      message.includes("Upgrade to GitHub")
        ? "the account's plan does not offer this on a private repository; no token change fixes it"
        : "the token lacks a scope or the repo blocks this action",
    ];
  if (status === 405 || status === 409)
    return [
      "conflict",
      "the target state forbids this (not mergeable, head moved, or already done)",
    ];
  if (status === 422)
    return [
      "invalid",
      message.includes("already exists")
        ? "it already exists"
        : "fix the fields named in the message",
    ];
  if (status >= 500) return ["server", "GitHub failed; retry later"];
  return ["http", "see the message"];
};
