export const APPLIED_TYPE = "omo-model-profile:applied"
export const UNKNOWN_TYPE = "omo-model-profile:unknown"
export const UNAVAILABLE_TYPE = "omo-model-profile:unavailable"
export const PROFILE_TYPES = [APPLIED_TYPE, UNKNOWN_TYPE, UNAVAILABLE_TYPE]

// Fixtures use a private stream implementation, optionally registered under real provider ids.
// `mock-1` keeps the recommended-models builtin inert except in its precedence scenario.
export const KNOWN_PROFILES = "daily-heavy, daily-normal, geeky-heavy, geeky-normal, recommended"

// The refresh token the fixture OAuth lane in model-profile-e2e-mock-provider.ts refuses to
// exchange (kept literal on both sides: the mock runs inside the senpi process, this file in node).
export const REJECTED_REFRESH_TOKEN = "rejected-refresh"

export const SCENARIOS = {
  "geeky-normal-api-sol": {
    omoConfig: { model_profile: "geeky-normal" },
    mockModels: ["mock-1", "gpt-5.6-sol"],
    registerProviders: ["openai"],
    expect: { model: "gpt-5.6-sol", provider: "openai", notice: APPLIED_TYPE, thinking: "medium" },
  },
  "geeky-normal-copilot-sol": {
    omoConfig: { model_profile: "geeky-normal" },
    mockModels: ["mock-1", "gpt-5.6-sol"],
    registerProviders: ["github-copilot"],
    expect: { model: "gpt-5.6-sol", provider: "github-copilot", notice: APPLIED_TYPE, thinking: "medium" },
  },
  "geeky-heavy-subscription-first": {
    omoConfig: { model_profile: "geeky-heavy" },
    mockModels: ["mock-1", "gpt-6-astra"],
    registerProviders: ["openai", "chatgpt-subscription"],
    expect: { model: "gpt-6-astra", provider: "chatgpt-subscription", notice: APPLIED_TYPE, thinking: "xhigh" },
  },
  "daily-normal-opus": {
    omoConfig: { model_profile: "daily-normal" },
    mockModels: ["mock-1", "claude-opus-5-5"],
    cliModel: undefined,
    expect: { model: "claude-opus-5-5", notice: APPLIED_TYPE, thinking: "medium" },
  },
  "daily-heavy-fable": {
    omoConfig: { model_profile: "daily-heavy" },
    mockModels: ["mock-1", "claude-fable-5-1"],
    cliModel: undefined,
    expect: { model: "claude-fable-5-1", notice: APPLIED_TYPE, thinking: "xhigh" },
  },
  "geeky-normal-sol": {
    omoConfig: { model_profile: "geeky-normal" },
    mockModels: ["mock-1", "gpt-5.6-sol"],
    cliModel: undefined,
    expect: { model: "gpt-5.6-sol", notice: APPLIED_TYPE, thinking: "medium" },
  },
  "geeky-heavy-astra": {
    omoConfig: { model_profile: "geeky-heavy" },
    mockModels: ["mock-1", "gpt-6-astra"],
    cliModel: undefined,
    expect: { model: "gpt-6-astra", notice: APPLIED_TYPE, thinking: "xhigh" },
  },
  "daily-normal-kimi": {
    omoConfig: { model_profile: "daily-normal" },
    mockModels: ["mock-1", "kimi-k3"],
    cliModel: undefined,
    expect: { model: "kimi-k3", notice: APPLIED_TYPE, thinking: "max" },
  },
  "daily-normal-glm": {
    omoConfig: { model_profile: "daily-normal" },
    mockModels: ["mock-1", "glm-5.3"],
    cliModel: undefined,
    expect: { model: "glm-5.3", notice: APPLIED_TYPE, thinking: "max" },
  },
  "geeky-normal-gpt6-only-unavailable": {
    omoConfig: { model_profile: "geeky-normal" },
    mockModels: ["mock-1", "gpt-6-sol-fast", "gpt-6-sol"],
    cliModel: undefined,
    expect: { model: "mock-1", notice: UNAVAILABLE_TYPE },
  },
  unset: {
    omoConfig: {},
    mockModels: ["mock-1", "kimi-k3"],
    cliModel: undefined,
    registerProviders: ["kimi-coding"],
    expect: { model: "kimi-k3", provider: "kimi-coding", notice: APPLIED_TYPE, thinking: "max" },
  },
  "unset-skips-gateway": {
    omoConfig: {},
    mockModels: ["mock-1", "anthropic/claude-opus-5-5", "kimi-k3"],
    cliModel: undefined,
    registerProviders: ["opengateway", "kimi-coding"],
    expect: { model: "kimi-k3", provider: "kimi-coding", notice: APPLIED_TYPE, thinking: "max" },
  },
  "empty-registry": {
    omoConfig: { model_profile: "daily-normal" },
    mockModels: ["mock-1"],
    cliModel: undefined,
    expect: { model: "mock-1", notice: UNAVAILABLE_TYPE },
  },
  "literal-pin": {
    omoConfig: { model_profile: "anthropic/claude-opus-5" },
    mockModels: ["mock-1", "claude-opus-5"],
    cliModel: undefined,
    expect: { model: "claude-opus-5", notice: APPLIED_TYPE },
  },
  "unknown-profile": {
    omoConfig: { model_profile: "nope" },
    mockModels: ["mock-1", "kimi-k3"],
    cliModel: undefined,
    expect: { model: "mock-1", notice: UNKNOWN_TYPE },
  },
  "capable-removed": {
    omoConfig: { model_profile: "capable" },
    mockModels: ["mock-1", "kimi-k3"],
    cliModel: undefined,
    expect: { model: "mock-1", notice: UNKNOWN_TYPE },
  },
  "deep-work-removed": {
    omoConfig: { model_profile: "deep-work" },
    mockModels: ["mock-1", "gpt-6-sol"],
    cliModel: undefined,
    expect: { model: "mock-1", notice: UNKNOWN_TYPE },
  },
  "simple-work-removed": {
    omoConfig: { model_profile: "simple-work" },
    mockModels: ["mock-1", "gpt-6-luna-fast"],
    cliModel: undefined,
    expect: { model: "mock-1", notice: UNKNOWN_TYPE },
  },
  "custom-profile": {
    omoConfig: {
      model_profile: "night-shift",
      model_profiles: { "night-shift": { display_name: "Night shift", models: ["mock-1"] } },
    },
    mockModels: ["mock-1", "kimi-k3"],
    cliModel: undefined,
    expect: { model: "mock-1", notice: APPLIED_TYPE },
  },
  "scoped-custom-openai-missing": {
    omoConfig: {
      model_profile: "geeky-normal",
      model_profiles: {
        "geeky-normal": {
          display_name: "Office GPT",
          models: [{ model: "openai/gpt-6-sol", reasoning: "high" }],
        },
      },
    },
    mockModels: ["mock-1", "gpt-6-sol", "gpt-6-sol-fast"],
    cliModel: undefined,
    expect: { model: "mock-1", notice: UNAVAILABLE_TYPE },
  },
  "custom-geeky-openai-reasoning": {
    omoConfig: {
      model_profile: "geeky-normal",
      model_profiles: {
        "geeky-normal": {
          display_name: "Office GPT",
          models: [{ model: "openai/gpt-6-sol", reasoning: "high" }],
        },
      },
    },
    mockModels: ["mock-1", "gpt-6-sol-fast", "gpt-6-sol"],
    cliModel: undefined,
    registerProviders: ["openai"],
    expect: { model: "gpt-6-sol", provider: "openai", notice: APPLIED_TYPE, thinking: "high" },
  },
  "resume-keeps-session-model": {
    omoConfig: { model_profile: "daily-normal" },
    mockModels: ["mock-1", "claude-opus-5-5"],
    cliModel: "mock-1",
    resumeRun: true,
    expect: { model: "mock-1", notice: null },
  },
  // The exact chain the desktop Settings editor saved after removing Daily · Normal's Claude
  // candidates: Opus is served (Claude connected) but must not run, and the lane keeps its name.
  "custom-daily-normal-desktop-chain": {
    omoConfig: { model_profile: "daily-normal", model_profiles: { "daily-normal": { models: [{"model":"kimi-coding/kimi-k3","reasoning":"max"},{"model":"kimi-for-coding/kimi-k3","reasoning":"max"},{"model":"moonshotai/kimi-k3","reasoning":"max"},{"model":"opencode-go/kimi-k3","reasoning":"max"},{"model":"zai-coding-plan/glm-5.3","reasoning":"max"},{"model":"opencode-go/glm-5.3","reasoning":"max"}] } } },
    mockModels: ["mock-1", "claude-opus-5-5", "kimi-k3"],
    registerProviders: ["anthropic-subscription", "kimi-coding"],
    expect: { model: "kimi-k3", provider: "kimi-coding", notice: APPLIED_TYPE, thinking: "max", label: "(Daily · Normal)" },
  },
  "cli-model-wins": {
    omoConfig: { model_profile: "daily-normal" },
    mockModels: ["mock-1", "claude-opus-5-5"],
    cliModel: "mock-1",
    cliThinking: "low",
    expect: { model: "mock-1", notice: null, thinking: "low" },
  },
  "lane-beats-recommended-models": {
    omoConfig: { model_profile: "daily-normal" },
    mockModels: ["mock-1", "glm-5.3", "gpt-6-sol"],
    cliModel: undefined,
    recommendedModels: undefined,
    registerProviders: ["chatgpt-subscription", "zai"],
    expect: { model: "glm-5.3", provider: "zai", notice: APPLIED_TYPE, thinking: "max" },
  },
  // A stored Claude login whose refresh token the (offline) fixture exchange rejects, the way a
  // revoked subscription login is: Recommended must not pin it, and the turn must run on the next
  // connected rung. `oauthProviders` gives the fixture lane an OAuth block; `authJson` is the
  // sandbox's stored credential, expired so the engine has to refresh it.
  "unset-rejected-login-falls-back": {
    omoConfig: {},
    mockModels: ["mock-1", "claude-opus-5-5", "glm-5.3"],
    registerProviders: ["anthropic", "zai"],
    oauthProviders: ["anthropic"],
    authJson: { anthropic: { type: "oauth", access: "stale-access", refresh: REJECTED_REFRESH_TOKEN, expires: 0 } },
    expect: {
      model: "glm-5.3",
      provider: "zai",
      notice: APPLIED_TYPE,
      thinking: "max",
      authFailed: [{ provider: "anthropic", model: "claude-opus-5-5", reason: "refresh" }],
    },
  },
  // A credential pool whose flat (default) account is rejected but whose sibling account is valid:
  // the provider stays selected, and the engine's first turn rotates onto the sibling (the fixture
  // rejection reads as a credential-scoped failure to senpi's pool classifier, like a revoked key).
  "unset-pooled-login-sibling-account": {
    omoConfig: {},
    mockModels: ["mock-1", "claude-opus-5-5", "glm-5.3"],
    registerProviders: ["anthropic", "zai"],
    oauthProviders: ["anthropic"],
    authJson: {
      anthropic: {
        type: "oauth",
        access: "stale-access",
        refresh: REJECTED_REFRESH_TOKEN,
        expires: 0,
        accounts: [
          { name: "stale", source: "login", access: "stale-access", refresh: REJECTED_REFRESH_TOKEN, expires: 0 },
          { name: "valid", source: "login", access: "valid-access", refresh: "valid-refresh", expires: 4102444800000 },
        ],
      },
    },
    expect: { model: "claude-opus-5-5", provider: "anthropic", notice: APPLIED_TYPE, thinking: "medium", authFailedAbsent: true },
  },
}
