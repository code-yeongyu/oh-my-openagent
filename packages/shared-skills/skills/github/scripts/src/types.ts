import type { Json } from "./read.ts";

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;
export type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
export type GitResult = {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
};
export type Deps = {
  readonly fetch: Fetch;
  /** Runs git with exactly `env` as its environment. */
  readonly git: (
    args: readonly string[],
    cwd: string,
    env: Readonly<Record<string, string>>,
  ) => Promise<GitResult>;
  /** The environment child processes start from. */
  readonly env: () => Readonly<Record<string, string | undefined>>;
  readonly token: () => Promise<string>;
  readonly originRepo: () => Promise<string | undefined>;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
  readonly apiUrl: string;
};
export type Repo = {
  readonly owner: string;
  readonly name: string;
  readonly full: string;
};
export type Request = {
  readonly query?: Readonly<
    Record<string, string | number | boolean | undefined>
  >;
  readonly body?: unknown;
  readonly accept?: string;
  readonly raw?: {
    readonly bytes: Uint8Array;
    readonly contentType: string;
  };
};
export type GitHub = {
  readonly rest: (
    method: Method,
    path: string,
    req?: Request,
  ) => Promise<unknown>;
  readonly list: (
    path: string,
    limit: number,
    req?: Request & { readonly key?: string },
  ) => Promise<unknown[]>;
  readonly text: (path: string, accept: string) => Promise<string>;
  readonly logs: (path: string) => Promise<string>;
  /** A binary download (release asset, artifact zip, raw file); a redirect is followed without the token. */
  readonly bytes: (path: string, accept?: string) => Promise<Uint8Array>;
  /** GET an https URL GitHub returned in a response (`raw_url`, `bundle_url`); the token is never sent there. */
  readonly content: (url: string) => Promise<Uint8Array>;
  /** POST raw bytes to an `upload_url` GitHub returned (uploads.github.com only). */
  readonly upload: (
    url: string,
    body: Uint8Array,
    contentType: string,
  ) => Promise<unknown>;
  /** Response headers of a GET, for facts GitHub reports only there (token scopes). */
  readonly headers: (path: string) => Promise<Headers>;
  /** Run git in `cwd` and return stdout; `clone` and `fetch` authenticate to github.com with this SDK's token; no git child inherits GH_TOKEN or GITHUB_TOKEN. A non-zero exit fails as kind `git`. */
  readonly git: (args: readonly string[], cwd: string) => Promise<string>;
  readonly graphql: (query: string, variables: Json) => Promise<Json>;
  readonly repo: (given: string | undefined) => Promise<Repo>;
  /** The text with the token removed. */
  readonly redact: (text: string) => Promise<string>;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
};
