import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { log } from "./logger";

type ClaudeCodeCredentials = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes?: unknown;
  source?: string;
};

type RefreshResult = {
  access_token: string;
  refresh_token: string;
  expires_at_ms: number;
};

export class ClaudeCliMissingError extends Error {
  constructor() {
    super("Claude CLI is not installed");
    this.name = "ClaudeCliMissingError";
  }
}

const COMMON_BETAS = [
  "interleaved-thinking-2025-05-14",
  "fine-grained-tool-streaming-2025-05-14",
];

const OAUTH_ONLY_BETAS = ["claude-code-20250219", "oauth-2025-04-20"];

const CLAUDE_CODE_VERSION_FALLBACK = "2.1.119";
const ANTHROPIC_OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const ANTHROPIC_OAUTH_ENDPOINTS = [
  "https://platform.claude.com/v1/oauth/token",
  "https://console.anthropic.com/v1/oauth/token",
];
const DISALLOWED_CUSTOM_HEADER_NAMES = new Set([
  "authorization",
  "x-api-key",
  "user-agent",
  "anthropic-version",
  "x-app",
  "x-claude-code-session-id",
  "x-client-request-id",
]);

let claudeCodeVersionCache: string | null = null;
let claudeCodeVersionCacheExpiresAt = 0;
const CLAUDE_CODE_VERSION_CACHE_TTL_MS = 60_000;

function resolveHomeDir(): string {
  return process.env.HOME?.trim() || homedir();
}

function getClaudeCredentialsPath(): string {
  return join(resolveHomeDir(), ".claude", ".credentials.json");
}

function getClaudeManagedKeyPath(): string {
  return join(resolveHomeDir(), ".claude.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeAnthropicBetaHeader(current: string, extra: string): string {
  const tokens = new Set(
    [...current.split(","), ...extra.split(",")]
      .map((value) => value.trim())
      .filter(Boolean),
  );
  return [...tokens].join(",");
}

function readAnthropicCustomHeaders(): Record<string, string> {
  const raw = process.env.ANTHROPIC_CUSTOM_HEADERS?.trim();
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return {};
    }

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== "string") {
        continue;
      }

      const normalizedKey = key.trim();
      if (!normalizedKey) {
        continue;
      }

      if (DISALLOWED_CUSTOM_HEADER_NAMES.has(normalizedKey.toLowerCase())) {
        continue;
      }

      headers[normalizedKey] = value;
    }

    return headers;
  } catch (error) {
    log(
      "[claude-code-anthropic-auth] failed to parse ANTHROPIC_CUSTOM_HEADERS",
      {
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return {};
  }
}

function applyAnthropicCustomHeaders(
  baseHeaders: Record<string, string>,
): Record<string, string> {
  const customHeaders = readAnthropicCustomHeaders();
  if (Object.keys(customHeaders).length === 0) {
    return baseHeaders;
  }

  const nextHeaders = { ...baseHeaders };
  for (const [key, value] of Object.entries(customHeaders)) {
    if (key.toLowerCase() === "anthropic-beta") {
      nextHeaders[key] = mergeAnthropicBetaHeader(
        nextHeaders[key] ?? "",
        value,
      );
      continue;
    }

    nextHeaders[key] = value;
  }

  return nextHeaders;
}

function detectClaudeCodeVersionFromInstall(): string | null {
  // Claude Code stores installed binaries per-version in ~/.local/share/claude/versions/<ver>
  // (or ~/.claude/versions/<ver>). Prefer the newest directory name that looks like a semver,
  // since spawn-based detection can fail when the host process has a sanitized PATH that does
  // not include ~/.local/bin (observed with the Homebrew OpenCode binary).
  try {
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    const candidateDirs = [
      join(resolveHomeDir(), ".local", "share", "claude", "versions"),
      join(resolveHomeDir(), ".claude", "versions"),
    ];
    const semver = /^\d+\.\d+\.\d+(\.\d+)?$/;
    const all: string[] = [];
    for (const dir of candidateDirs) {
      try {
        for (const name of readdirSync(dir)) {
          if (semver.test(name)) all.push(name);
        }
      } catch {
        continue;
      }
    }
    if (all.length === 0) return null;
    all.sort((a, b) => {
      const pa = a.split(".").map(Number);
      const pb = b.split(".").map(Number);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (diff !== 0) return diff;
      }
      return 0;
    });
    return all[all.length - 1] ?? null;
  } catch {
    return null;
  }
}

function detectClaudeCodeVersion(): string {
  const fromInstall = detectClaudeCodeVersionFromInstall();
  if (fromInstall) return fromInstall;

  for (const command of ["claude", "claude-code"]) {
    try {
      const result = spawnSync(command, ["--version"], {
        encoding: "utf8",
        timeout: 5000,
      });

      if (result.status === 0 && result.stdout.trim()) {
        const version = result.stdout.trim().split(/\s+/, 1)[0];
        if (version && /^\d/.test(version)) {
          return version;
        }
      }
    } catch {
      continue;
    }
  }

  return CLAUDE_CODE_VERSION_FALLBACK;
}

function findClaudeCliPath(): string {
  for (const command of ["claude", "claude-code"]) {
    const result = spawnSync("which", [command], {
      encoding: "utf8",
      timeout: 5000,
    });

    if (result.status === 0) {
      const path = result.stdout.trim();
      if (path) {
        return path;
      }
    }
  }

  throw new ClaudeCliMissingError();
}

export function getClaudeCodeVersion(): string {
  // Re-detect periodically so the auto-updating Claude CLI does not leave us
  // pinned to a stale version. Anthropic's billing gate validates cc_version
  // against the current CLI release; a stale value gets rejected as overage.
  const now = Date.now();
  if (
    claudeCodeVersionCache === null ||
    now >= claudeCodeVersionCacheExpiresAt
  ) {
    claudeCodeVersionCache = detectClaudeCodeVersion();
    claudeCodeVersionCacheExpiresAt = now + CLAUDE_CODE_VERSION_CACHE_TTL_MS;
  }

  return claudeCodeVersionCache;
}

function isOauthToken(token: string): boolean {
  return token.length > 0 && !token.startsWith("sk-ant-api");
}

function readJsonFile(path: string): Record<string, unknown> | null {
  try {
    if (!existsSync(path)) {
      return null;
    }

    const content = readFileSync(path, "utf8");
    const parsed = JSON.parse(content) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch (error) {
    log("[claude-code-anthropic-auth] failed to read JSON file", {
      path,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export function readClaudeCodeCredentials(): ClaudeCodeCredentials | null {
  const data = readJsonFile(getClaudeCredentialsPath());
  if (!data) {
    return null;
  }

  const oauthData = data.claudeAiOauth;
  if (!isRecord(oauthData)) {
    return null;
  }

  const accessToken =
    typeof oauthData.accessToken === "string" ? oauthData.accessToken : "";
  if (!accessToken) {
    return null;
  }

  return {
    accessToken,
    refreshToken:
      typeof oauthData.refreshToken === "string" ? oauthData.refreshToken : "",
    expiresAt:
      typeof oauthData.expiresAt === "number" ? oauthData.expiresAt : 0,
    scopes: oauthData.scopes,
    source: "claude_code_credentials_file",
  };
}

export function readClaudeCodeOauthForAuthStore(): {
  access: string;
  refresh: string;
  expires: number;
} | null {
  const creds = readClaudeCodeCredentials();
  if (!creds?.accessToken) {
    return null;
  }

  const refresh =
    typeof creds.refreshToken === "string" ? creds.refreshToken : "";
  const expires =
    typeof creds.expiresAt === "number" && creds.expiresAt > 0
      ? creds.expiresAt
      : Date.now() + 3600_000;

  if (!isClaudeCodeTokenValid(creds) && !refresh) {
    return null;
  }

  return {
    access: creds.accessToken,
    refresh,
    expires,
  };
}

export function readClaudeManagedKey(): string | null {
  const data = readJsonFile(getClaudeManagedKeyPath());
  if (!data) {
    return null;
  }

  const primaryApiKey =
    typeof data.primaryApiKey === "string" ? data.primaryApiKey.trim() : "";
  return primaryApiKey || null;
}

export function isClaudeCodeTokenValid(
  creds: Pick<ClaudeCodeCredentials, "accessToken" | "expiresAt">,
): boolean {
  const expiresAt = creds.expiresAt ?? 0;
  if (!expiresAt) {
    return Boolean(creds.accessToken);
  }

  return Date.now() < expiresAt - 60_000;
}

export async function refreshAnthropicOauthPure(
  refreshToken: string,
  options: { useJson?: boolean } = {},
): Promise<RefreshResult> {
  if (!refreshToken) {
    throw new Error("refresh_token is required");
  }

  const useJson = options.useJson ?? false;
  const body = useJson
    ? JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: ANTHROPIC_OAUTH_CLIENT_ID,
      })
    : new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: ANTHROPIC_OAUTH_CLIENT_ID,
      }).toString();

  let lastError: Error | null = null;

  for (const endpoint of ANTHROPIC_OAUTH_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": useJson
            ? "application/json"
            : "application/x-www-form-urlencoded",
          "User-Agent": `claude-cli/${getClaudeCodeVersion()} (external, sdk-cli)`,
        },
        body,
      });

      if (!response.ok) {
        throw new Error(
          `Token exchange failed: ${response.status} ${await response.text()}`,
        );
      }

      const result = (await response.json()) as Record<string, unknown>;
      const accessToken =
        typeof result.access_token === "string" ? result.access_token : "";
      if (!accessToken) {
        throw new Error("Anthropic refresh response was missing access_token");
      }

      const nextRefreshToken =
        typeof result.refresh_token === "string" && result.refresh_token
          ? result.refresh_token
          : refreshToken;
      const expiresIn =
        typeof result.expires_in === "number" ? result.expires_in : 3600;

      return {
        access_token: accessToken,
        refresh_token: nextRefreshToken,
        expires_at_ms: Date.now() + expiresIn * 1000,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      log("[claude-code-anthropic-auth] oauth refresh endpoint failed", {
        endpoint,
        error: lastError.message,
      });
    }
  }

  throw lastError ?? new Error("Anthropic token refresh failed");
}

function writeClaudeCodeCredentials(
  accessToken: string,
  refreshToken: string,
  expiresAtMs: number,
  scopes?: unknown,
): void {
  const credentialsPath = getClaudeCredentialsPath();
  const existing = readJsonFile(credentialsPath) ?? {};
  const existingOauth = isRecord(existing.claudeAiOauth)
    ? existing.claudeAiOauth
    : {};

  const oauthData: Record<string, unknown> = {
    accessToken,
    refreshToken,
    expiresAt: expiresAtMs,
  };

  if (scopes !== undefined) {
    oauthData.scopes = scopes;
  } else if (existingOauth.scopes !== undefined) {
    oauthData.scopes = existingOauth.scopes;
  }

  existing.claudeAiOauth = oauthData;

  mkdirSync(join(resolveHomeDir(), ".claude"), { recursive: true });
  writeFileSync(credentialsPath, `${JSON.stringify(existing, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

async function refreshClaudeCodeToken(
  creds: ClaudeCodeCredentials,
): Promise<string | null> {
  const refreshToken =
    typeof creds.refreshToken === "string" ? creds.refreshToken : "";
  if (!refreshToken) {
    return null;
  }

  try {
    const refreshed = await refreshAnthropicOauthPure(refreshToken, {
      useJson: false,
    });
    writeClaudeCodeCredentials(
      refreshed.access_token,
      refreshed.refresh_token,
      refreshed.expires_at_ms,
      creds.scopes,
    );
    return refreshed.access_token;
  } catch (error) {
    log("[claude-code-anthropic-auth] failed to refresh Claude Code token", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function resolveClaudeCodeTokenFromCredentials(
  creds: ClaudeCodeCredentials | null = readClaudeCodeCredentials(),
): Promise<string | null> {
  if (creds && isClaudeCodeTokenValid(creds)) {
    return creds.accessToken;
  }

  if (creds) {
    return await refreshClaudeCodeToken(creds);
  }

  return null;
}

async function preferRefreshableClaudeCodeToken(
  envToken: string,
  creds: ClaudeCodeCredentials | null,
): Promise<string | null> {
  if (!envToken || !isOauthToken(envToken) || !creds?.refreshToken) {
    return null;
  }

  const resolved = await resolveClaudeCodeTokenFromCredentials(creds);
  if (resolved && resolved !== envToken) {
    return resolved;
  }

  return null;
}

export async function resolveAnthropicToken(): Promise<string | null> {
  const creds = readClaudeCodeCredentials();

  const anthropicToken = process.env.ANTHROPIC_TOKEN?.trim() ?? "";
  if (anthropicToken) {
    const preferred = await preferRefreshableClaudeCodeToken(
      anthropicToken,
      creds,
    );
    return preferred ?? anthropicToken;
  }

  const claudeCodeOauthToken =
    process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim() ?? "";
  if (claudeCodeOauthToken) {
    const preferred = await preferRefreshableClaudeCodeToken(
      claudeCodeOauthToken,
      creds,
    );
    return preferred ?? claudeCodeOauthToken;
  }

  const resolvedFromCredentials = await resolveClaudeCodeTokenFromCredentials(
    creds,
  );
  if (resolvedFromCredentials) {
    return resolvedFromCredentials;
  }

  const claudeManagedKey = readClaudeManagedKey();
  if (claudeManagedKey) {
    return claudeManagedKey;
  }

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY?.trim() ?? "";
  if (anthropicApiKey) {
    return anthropicApiKey;
  }

  return null;
}

export function buildHermesAnthropicAuthConfig(token: string): {
  apiKey?: string;
  headers: Record<string, string>;
} {
  if (isOauthToken(token)) {
    return {
      headers: applyAnthropicCustomHeaders({
        Authorization: `Bearer ${token}`,
        "anthropic-beta": [...COMMON_BETAS, ...OAUTH_ONLY_BETAS].join(","),
        "anthropic-version": "2023-06-01",
        "user-agent": `claude-cli/${getClaudeCodeVersion()} (external, sdk-cli)`,
        "x-app": "cli",
      }),
    };
  }

  return {
    apiKey: token,
    headers: applyAnthropicCustomHeaders({
      "anthropic-beta": COMMON_BETAS.join(","),
      "anthropic-version": "2023-06-01",
    }),
  };
}

export function resetClaudeCodeAnthropicAuthForTesting(): void {
  claudeCodeVersionCache = null;
  claudeCodeVersionCacheExpiresAt = 0;
}

export function runClaudeSetupToken(): string | null {
  const claudePath = findClaudeCliPath();

  try {
    spawnSync(claudePath, ["setup-token"], {
      stdio: "inherit",
    });
  } catch {
    return null;
  }

  const oauth = readClaudeCodeOauthForAuthStore();
  if (oauth?.access) {
    return oauth.access;
  }

  for (const envVar of ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_TOKEN"]) {
    const value = process.env[envVar]?.trim();
    if (value) {
      return value;
    }
  }

  return null;
}
