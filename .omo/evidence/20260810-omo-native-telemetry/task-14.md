# Task 14: OmO Native telemetry real-surface QA

## Result

PASS. The real Senpi CLI emitted all seven OmO Native events plus the unchanged legacy daily-active event, both opt-out paths emitted zero requests, and cleanup completed.

## Senpi precheck

Resolved executable: `node_modules/.bin/senpi`

`senpi --help` exposed `--print, -p`, confirming a real non-interactive surface. Full output:

```text
senpi - AI coding assistant with read, bash, edit, write tools

Usage:
  senpi [options] [@files...] [messages...]

Commands:
  senpi install <source> [-l]     Install extension source and add to settings
  senpi remove <source> [-l]      Remove extension source from settings
  senpi uninstall <source> [-l]   Alias for remove
  senpi update [source|self|senpi]   Update senpi, extensions, or model catalogs
  senpi list [--approve|--no-approve]
                                 List installed extensions from settings
  senpi config [--no-approve]
                                 Open TUI to enable/disable package resources (Tab switches scope)
  senpi app-server [--listen <url>]
                                 Serve agent sessions over the Codex app-server protocol
  senpi app-server daemon <start|stop|status|restart> [--listen <url>]
                                 Manage the app-server daemon
  senpi <command> --help          Show help for install/remove/uninstall/update/list/config

Options:
  --provider <name>              Provider name (default: google)
  --model <pattern>              Model pattern or ID (supports "provider/id" and optional ":<thinking>")
  --api-key <key>                API key (defaults to env vars)
  --system-prompt <text>         System prompt (default: coding assistant prompt)
  --append-system-prompt <text>  Append text or file contents to the system prompt (can be used multiple times)
  --mode <mode>                  Output mode: text (default), json, or rpc
  --print, -p                    Non-interactive mode: process prompt and exit
  --continue, -c                 Continue previous session
  --resume, -r                   Select a session to resume
  --session <path|id>            Use specific session file or partial UUID
  --session-id <id>              Use exact project session ID, creating it if missing
  --fork <path|id>               Fork specific session file or partial UUID into a new session
  --session-dir <dir>            Directory for session storage and lookup
  --no-session                   Don't save session (ephemeral)
  --name, -n <name>              Set session display name
  --models <patterns>            Comma-separated model patterns for Ctrl+P cycling
                                 Supports globs (anthropic/*, *sonnet*) and fuzzy matching
  --no-tools, -nt                Disable all tools by default (built-in and extension)
  --no-builtin-tools, -nbt       Disable built-in tools by default but keep extension/custom tools enabled
  --tools, -t <tools>            Comma-separated allowlist of tool names to enable
                                 Applies to built-in, extension, and custom tools
  --exclude-tools, -xt <tools>   Comma-separated denylist of tool names to disable
                                 Applies to built-in, extension, and custom tools
  --thinking <level>             Set thinking level: off, minimal, low, medium, high, xhigh, max
  --extension, -e <path>         Load an extension file (can be used multiple times)
  --no-extensions, -ne           Disable extension discovery (explicit -e paths still work)
  --skill <path>                 Load a skill file or directory (can be used multiple times)
  --no-skills, -ns               Disable skills discovery and loading
  --prompt-template <path>       Load a prompt template file or directory (can be used multiple times)
  --no-prompt-templates, -np     Disable prompt template discovery and loading
  --theme <path>                 Register a theme file or directory (can be used multiple times; does not select it)
  --no-themes                    Disable theme discovery and loading
  --no-context-files, -nc        Disable AGENTS.md and CLAUDE.md discovery and loading
  --export <file>                Export session file to HTML and exit
  --list-models [search]         List available models (with optional fuzzy search)
  --list-tips                    List all tips as JSON
  --verbose                      Force verbose startup (overrides quietStartup setting)
  --ui-mode <mode>               UI mode: regular (default) or fullscreen
  --approve, -a                  Trust project-local files for this run
  --no-approve, -na              Ignore project-local files for this run
  --offline                      Disable startup network operations (same as PI_OFFLINE=1)
  --help, -h                     Show this help
  --version, -v                  Show version number

Extensions can register additional flags (e.g., --plan from plan-mode extension).
Extension CLI Flags:
  --permission <value>        Set permission rules (format: tool=action or tool:pattern=action)
  --permission-preset <value> Set permission preset (full-access, workspace, read-only, or ask)
  --no-model-fallback         Disable retry model fallback for this run.
  --no-recommended-models     Disable recommended model selection for this run.
  --no-nested-agents          Disable nested AGENTS.md context injection.
  --pi-rules-disabled         Disable pi-rules hooks.
  --pi-rules-mode <value>     Rule injection mode: static, dynamic, both, or off.
  --ttsr-disabled             Disable TTSR stream-rule detection.
  --ttsr-rules-disabled <value>Comma-separated TTSR rule names to disable.
  --claude-account <value>    Pin Claude SDK OAuth account for this session.


Examples:
  # Print a provider API key for an external client
  senpi auth print-api-key --provider openai --model gpt-5.5

  # Print an OAuth bearer token for an external client (refreshes if expired)
  senpi auth print-bearer-token --provider openai-codex --model gpt-5.5

  # Interactive mode
  senpi

  # Interactive mode with initial prompt
  senpi "List all .ts files in src/"

  # Include files in initial message
  senpi @prompt.md @image.png "What color is the sky?"

  # Non-interactive mode (process and exit)
  senpi -p "List all .ts files in src/"

  # Multiple messages (interactive)
  senpi "Read package.json" "What dependencies do we have?"

  # Continue previous session
  senpi --continue "What did we discuss?"

  # Start a named session
  senpi --name "Refactor auth module"

  # Use different model
  senpi --provider openai --model gpt-4o-mini "Help me refactor this code"

  # Use model with provider prefix (no --provider needed)
  senpi --model openai/gpt-4o "Help me refactor this code"

  # Use model with thinking level shorthand
  senpi --model sonnet:high "Solve this complex problem"

  # Limit model cycling to specific models
  senpi --models claude-sonnet,claude-haiku,gpt-4o

  # Limit to a specific provider with glob pattern
  senpi --models "github-copilot/*"

  # Cycle models with fixed thinking levels
  senpi --models sonnet:high,haiku:low

  # Start with a specific thinking level
  senpi --thinking high "Solve this complex problem"

  # Read-only mode (no file modifications possible)
  senpi --tools read,grep,find,ls -p "Review the code in src/"

  # Disable one tool while keeping the rest available
  senpi --exclude-tools ask_question

  # Export a session file to HTML
  senpi --export ~/.senpi/agent/sessions/--path--/session.jsonl
  senpi --export session.jsonl output.html

  # Start Codex app-server protocol scaffolding
  senpi app-server --listen stdio://
  senpi app-server --listen ws://127.0.0.1:18991

Environment Variables:
  ANTHROPIC_AUTH_TOKEN             - Anthropic bearer auth token
  ANTHROPIC_API_KEY                - Anthropic Claude API key
  ANTHROPIC_OAUTH_TOKEN            - Anthropic OAuth token (alternative to API key)
  ANT_LING_API_KEY                 - Ant Ling API key
  OPENAI_API_KEY                   - OpenAI GPT API key
  OLLAMA_API_KEY                   - Ollama Cloud API key
  AZURE_OPENAI_API_KEY             - Azure OpenAI API key
  AZURE_OPENAI_BASE_URL            - Azure OpenAI/Cognitive Services base URL (e.g. https://{resource}.openai.azure.com)
  AZURE_OPENAI_RESOURCE_NAME       - Azure OpenAI resource name (alternative to base URL)
  AZURE_OPENAI_API_VERSION         - Azure OpenAI API version (default: v1)
  AZURE_OPENAI_DEPLOYMENT_NAME_MAP - Azure OpenAI model=deployment map (comma-separated)
  DEEPSEEK_API_KEY                 - DeepSeek API key
  NVIDIA_API_KEY                   - NVIDIA NIM API key
  GEMINI_API_KEY                   - Google Gemini API key
  GROQ_API_KEY                     - Groq API key
  CEREBRAS_API_KEY                 - Cerebras API key
  XAI_API_KEY                      - xAI Grok API key
  FIREWORKS_API_KEY                - Fireworks API key
  TOGETHER_API_KEY                 - Together AI API key
  OPENROUTER_API_KEY               - OpenRouter API key
  AI_GATEWAY_API_KEY               - Vercel AI Gateway API key
  ZAI_API_KEY                      - ZAI Coding Plan API key (Global)
  ZAI_CODING_CN_API_KEY            - ZAI Coding Plan API key (China)
  MISTRAL_API_KEY                  - Mistral API key
  MINIMAX_API_KEY                  - MiniMax API key
  MOONSHOT_API_KEY                 - Moonshot AI API key
  OPENCODE_API_KEY                 - OpenCode Zen/OpenCode Go API key
  KIMI_API_KEY                     - Kimi For Coding API key
  CLOUDFLARE_API_KEY               - Cloudflare API token (Workers AI and AI Gateway)
  CLOUDFLARE_ACCOUNT_ID            - Cloudflare account id (required for both)
  CLOUDFLARE_GATEWAY_ID            - Cloudflare AI Gateway slug (required for AI Gateway)
  QWEN_TOKEN_PLAN_API_KEY          - Qwen Token Plan API key (international region)
  QWEN_TOKEN_PLAN_CN_API_KEY       - Qwen Token Plan API key (China region)
  XIAOMI_API_KEY                   - Xiaomi MiMo API key (api.xiaomimimo.com billing)
  XIAOMI_TOKEN_PLAN_CN_API_KEY     - Xiaomi MiMo Token Plan API key (China region)
  XIAOMI_TOKEN_PLAN_AMS_API_KEY    - Xiaomi MiMo Token Plan API key (Amsterdam region)
  XIAOMI_TOKEN_PLAN_SGP_API_KEY    - Xiaomi MiMo Token Plan API key (Singapore region)
  ALIBABA_TOKEN_PLAN_API_KEY       - Alibaba Cloud Model Studio Token Plan API key (ap-southeast-1)
  AWS_PROFILE                      - AWS profile for Amazon Bedrock
  AWS_ACCESS_KEY_ID                - AWS access key for Amazon Bedrock
  AWS_SECRET_ACCESS_KEY            - AWS secret key for Amazon Bedrock
  AWS_BEARER_TOKEN_BEDROCK         - Bedrock API key (bearer token)
  AWS_REGION                       - AWS region for Amazon Bedrock (e.g., us-east-1)
  SENPI_CODING_AGENT_DIR           - Config directory (default: ~/.senpi/agent)
  SENPI_CODING_AGENT_SESSION_DIR   - Session storage directory (overridden by --session-dir)
  PI_PACKAGE_DIR                   - Override package directory (for Nix/Guix store paths)
  PI_OFFLINE                       - Disable startup network operations when set to 1/true/yes
  PI_TELEMETRY                     - Override install telemetry when set to 1/true/yes or 0/false/no
  PI_SHARE_VIEWER_URL              - Base URL for /share command (default: https://pi.dev/session/)

Built-in Tool Names:
  read   - Read file contents
  bash   - Execute bash commands
  edit   - Edit files with find/replace
  write  - Write files (creates/overwrites)
  grep   - Search file contents (read-only, off by default)
  find   - Find files by glob pattern (read-only, off by default)
  ls     - List directory contents (read-only, off by default)
```

## Drive mechanism

The enabled and opt-out scenarios used the real Senpi CLI in persistent `--mode rpc` so exactly three prompts ran in one real session and prompt ordinals remained meaningful. The executable's `-p` capability was prechecked first as required. Tool selection used a temporary local provider generated from the repository precedent at `packages/omo-senpi/scripts/qa/mock-provider/index.ts`; it deterministically issued `create_goal`, `task`, and builtin `read` calls. The real built plugin at `packages/omo-senpi/plugin` was loaded through each isolated Senpi `settings.json`, and `packages/pi-goal/src/index.ts` was loaded explicitly for the goal tool.

Isolation for every run used a fresh mktemp root containing its own `SENPI_CODING_AGENT_DIR`, session directory, XDG config directory, project, provider fixture, and omo.json. The developer's real `~/.senpi` was never configured or read by the driver.

## Assertion results

- PASS exactly-three-real-prompts: observed 3; events=omo_senpi_daily_active,daily_active,session_started,prompt_submitted,feature_used,turn_completed,delegation_started,turn_completed,turn_completed,turn_completed,prompt_submitted,skill_loaded,turn_completed,turn_completed,prompt_submitted,turn_completed
- PASS first-prompt-ulw-classification: {"$session_id":"<redacted-session-hash>","input_source":"rpc","invocation_stage":"first_arm","is_effective_ultrawork_invocation":true,"is_real_user_prompt":true,"is_turn_start":true,"keyword_any":true,"keyword_occurrence_bucket":"1","keyword_ultrawork_full":false,"keyword_ulw_abbrev":true,"keyword_variant":"ulw","prompt_length_bucket":"lt_100","queue_mode":"immediate","real_prompt_ordinal_bucket":"1","suppression_reason":"none","$process_person_profile":false,"package_version":"0.0.0","platform":"omo-senpi","product_name":"omo-native","schema_version":1,"$lib":"posthog-node","$lib_version":"5.35.12","$geoip_disable":true}
- PASS two-keyword-negative-controls: {"$session_id":"<redacted-session-hash>","input_source":"rpc","invocation_stage":"none","is_effective_ultrawork_invocation":false,"is_real_user_prompt":true,"is_turn_start":true,"keyword_any":false,"keyword_occurrence_bucket":"1","keyword_ultrawork_full":false,"keyword_ulw_abbrev":false,"keyword_variant":"none","prompt_length_bucket":"lt_100","queue_mode":"immediate","real_prompt_ordinal_bucket":"2_3","suppression_reason":"no_keyword","$process_person_profile":false,"package_version":"0.0.0","platform":"omo-senpi","product_name":"omo-native","schema_version":1,"$lib":"posthog-node","$lib_version":"5.35.12","$geoip_disable":true} | {"$session_id":"<redacted-session-hash>","input_source":"rpc","invocation_stage":"none","is_effective_ultrawork_invocation":false,"is_real_user_prompt":true,"is_turn_start":true,"keyword_any":false,"keyword_occurrence_bucket":"1","keyword_ultrawork_full":false,"keyword_ulw_abbrev":false,"keyword_variant":"none","prompt_length_bucket":"lt_100","queue_mode":"immediate","real_prompt_ordinal_bucket":"2_3","suppression_reason":"no_keyword","$process_person_profile":false,"package_version":"0.0.0","platform":"omo-senpi","product_name":"omo-native","schema_version":1,"$lib":"posthog-node","$lib_version":"5.35.12","$geoip_disable":true}
- PASS event-present-daily_active: captured daily_active
- PASS event-present-session_started: captured session_started
- PASS event-present-prompt_submitted: captured prompt_submitted
- PASS event-present-turn_completed: captured turn_completed
- PASS event-present-skill_loaded: captured skill_loaded
- PASS event-present-delegation_started: captured delegation_started
- PASS event-present-feature_used: captured feature_used
- PASS turn-completed-positive-tokens: at least one turn_completed has total_tokens > 0
- PASS feature-goal-tool: captured feature_used goal_tool
- PASS legacy-dual-emit-presence-only: legacy event present and excluded from all scans
- PASS native-event-property-allowlists: all 15 OmO Native events use documented or SDK-added keys
- PASS native-event-path-privacy: no scanned value contains an absolute/home path pattern; model fields use known-model or custom masking
- PASS native-event-prompt-fragment-privacy: no scanned value contains any 8+ character driven-prompt substring
- PASS legacy-event-scan-exclusion: omo_senpi_daily_active was presence-checked only
- PASS opt-out-do-not-track-zero-requests: 0 requests
- PASS opt-out-config-zero-requests: 0 requests

All privacy, property, and path scans above were scoped strictly to: daily_active, session_started, prompt_submitted, turn_completed, skill_loaded, delegation_started, and feature_used. The legacy `omo_senpi_daily_active` event was asserted for presence only and was not scanned.

## Captured payloads

The complete sanitized parsed-event dump is committed in `captured-payloads.json`. Machine distinct ids are replaced with `<redacted-distinct-id>`; keyed session hashes are replaced with `<redacted-session-hash>`. Raw hostname and identity salt are not present.

```json
[
  {
    "event": "omo_senpi_daily_active",
    "properties": {
      "platform": "omo-senpi",
      "product_name": "omo-senpi",
      "package_name": "@oh-my-opencode/omo-senpi",
      "package_version": "0.0.0",
      "runtime": "bun",
      "runtime_version": "v26.6.0",
      "source": "senpi-extension",
      "$os": "darwin",
      "$os_version": "25.6.0",
      "os_arch": "arm64",
      "os_type": "Darwin",
      "cpu_count": 14,
      "cpu_model": "Apple M4 Pro",
      "total_memory_gb": 64,
      "locale": "en-US",
      "timezone": "Asia/Seoul",
      "shell": "/opt/homebrew/bin/fish",
      "ci": false,
      "$process_person_profile": false,
      "day_utc": "2026-08-10",
      "reason": "session_start",
      "$lib": "posthog-node",
      "$lib_version": "5.35.12"
    },
    "timestamp": "2026-08-10T11:28:37.344Z",
    "distinct_id": "<redacted-distinct-id>",
    "path": "/batch/"
  },
  {
    "event": "daily_active",
    "properties": {
      "$session_id": "<redacted-session-hash>",
      "day_utc": "2026-08-10",
      "reason": "session_start",
      "platform": "omo-senpi",
      "product_name": "omo-native",
      "package_version": "0.0.0",
      "schema_version": 1,
      "$process_person_profile": false,
      "$lib": "posthog-node",
      "$lib_version": "5.35.12",
      "$geoip_disable": true
    },
    "timestamp": "2026-08-10T11:28:37.344Z",
    "distinct_id": "<redacted-distinct-id>",
    "path": "/batch/"
  },
  {
    "event": "session_started",
    "properties": {
      "$session_id": "<redacted-session-hash>",
      "$os": "darwin",
      "$os_version": "25.6.0",
      "arch": "arm64",
      "cpu_count": 14,
      "memory_bucket": "64_plus_gb",
      "provider_count": 1,
      "model_count": 1,
      "providers": "openai",
      "reason": "startup",
      "default_provider": "openai",
      "default_model": "gpt-5.6-sol",
      "platform": "omo-senpi",
      "product_name": "omo-native",
      "package_version": "0.0.0",
      "schema_version": 1,
      "$process_person_profile": false,
      "$lib": "posthog-node",
      "$lib_version": "5.35.12",
      "$geoip_disable": true
    },
    "timestamp": "2026-08-10T11:28:37.344Z",
    "distinct_id": "<redacted-distinct-id>",
    "path": "/batch/"
  },
  {
    "event": "prompt_submitted",
    "properties": {
      "$session_id": "<redacted-session-hash>",
      "input_source": "rpc",
      "invocation_stage": "first_arm",
      "is_effective_ultrawork_invocation": true,
      "is_real_user_prompt": true,
      "is_turn_start": true,
      "keyword_any": true,
      "keyword_occurrence_bucket": "1",
      "keyword_ultrawork_full": false,
      "keyword_ulw_abbrev": true,
      "keyword_variant": "ulw",
      "prompt_length_bucket": "lt_100",
      "queue_mode": "immediate",
      "real_prompt_ordinal_bucket": "1",
      "suppression_reason": "none",
      "$process_person_profile": false,
      "package_version": "0.0.0",
      "platform": "omo-senpi",
      "product_name": "omo-native",
      "schema_version": 1,
      "$lib": "posthog-node",
      "$lib_version": "5.35.12",
      "$geoip_disable": true
    },
    "timestamp": "2026-08-10T11:28:37.453Z",
    "distinct_id": "<redacted-distinct-id>",
    "path": "/batch/"
  },
  {
    "event": "feature_used",
    "properties": {
      "$session_id": "<redacted-session-hash>",
      "feature": "goal_tool",
      "$process_person_profile": false,
      "package_version": "0.0.0",
      "platform": "omo-senpi",
      "product_name": "omo-native",
      "schema_version": 1,
      "$lib": "posthog-node",
      "$lib_version": "5.35.12",
      "$geoip_disable": true
    },
    "timestamp": "2026-08-10T11:28:37.467Z",
    "distinct_id": "<redacted-distinct-id>",
    "path": "/batch/"
  },
  {
    "event": "turn_completed",
    "properties": {
      "$session_id": "<redacted-session-hash>",
      "cache_read_tokens": 0,
      "cache_write_tokens": 0,
      "cost_usd": 0,
      "input_tokens": 12,
      "model_id": "gpt-5.6-sol",
      "output_tokens": 8,
      "provider": "openai",
      "reasoning_tokens": 0,
      "total_tokens": 20,
      "turn_index": 0,
      "$process_person_profile": false,
      "package_version": "0.0.0",
      "platform": "omo-senpi",
      "product_name": "omo-native",
      "schema_version": 1,
      "$lib": "posthog-node",
      "$lib_version": "5.35.12",
      "$geoip_disable": true
    },
    "timestamp": "2026-08-10T11:28:37.534Z",
    "distinct_id": "<redacted-distinct-id>",
    "path": "/batch/"
  },
  {
    "event": "delegation_started",
    "properties": {
      "$session_id": "<redacted-session-hash>",
      "background": true,
      "batch_size_bucket": "1",
      "kind": "category",
      "name": "quick",
      "$process_person_profile": false,
      "package_version": "0.0.0",
      "platform": "omo-senpi",
      "product_name": "omo-native",
      "schema_version": 1,
      "$lib": "posthog-node",
      "$lib_version": "5.35.12",
      "$geoip_disable": true
    },
    "timestamp": "2026-08-10T11:28:37.545Z",
    "distinct_id": "<redacted-distinct-id>",
    "path": "/batch/"
  },
  {
    "event": "turn_completed",
    "properties": {
      "$session_id": "<redacted-session-hash>",
      "cache_read_tokens": 0,
      "cache_write_tokens": 0,
      "cost_usd": 0,
      "input_tokens": 12,
      "model_id": "gpt-5.6-sol",
      "output_tokens": 8,
      "provider": "openai",
      "reasoning_tokens": 0,
      "total_tokens": 20,
      "turn_index": 1,
      "$process_person_profile": false,
      "package_version": "0.0.0",
      "platform": "omo-senpi",
      "product_name": "omo-native",
      "schema_version": 1,
      "$lib": "posthog-node",
      "$lib_version": "5.35.12",
      "$geoip_disable": true
    },
    "timestamp": "2026-08-10T11:28:37.551Z",
    "distinct_id": "<redacted-distinct-id>",
    "path": "/batch/"
  },
  {
    "event": "turn_completed",
    "properties": {
      "$session_id": "<redacted-session-hash>",
      "cache_read_tokens": 0,
      "cache_write_tokens": 0,
      "cost_usd": 0,
      "input_tokens": 12,
      "model_id": "gpt-5.6-sol",
      "output_tokens": 8,
      "provider": "openai",
      "reasoning_tokens": 0,
      "total_tokens": 20,
      "turn_index": 2,
      "$process_person_profile": false,
      "package_version": "0.0.0",
      "platform": "omo-senpi",
      "product_name": "omo-native",
      "schema_version": 1,
      "$lib": "posthog-node",
      "$lib_version": "5.35.12",
      "$geoip_disable": true
    },
    "timestamp": "2026-08-10T11:28:37.620Z",
    "distinct_id": "<redacted-distinct-id>",
    "path": "/batch/"
  },
  {
    "event": "turn_completed",
    "properties": {
      "$session_id": "<redacted-session-hash>",
      "cache_read_tokens": 0,
      "cache_write_tokens": 0,
      "cost_usd": 0,
      "input_tokens": 12,
      "model_id": "gpt-5.6-sol",
      "output_tokens": 8,
      "provider": "openai",
      "reasoning_tokens": 0,
      "total_tokens": 20,
      "turn_index": 3,
      "$process_person_profile": false,
      "package_version": "0.0.0",
      "platform": "omo-senpi",
      "product_name": "omo-native",
      "schema_version": 1,
      "$lib": "posthog-node",
      "$lib_version": "5.35.12",
      "$geoip_disable": true
    },
    "timestamp": "2026-08-10T11:28:37.629Z",
    "distinct_id": "<redacted-distinct-id>",
    "path": "/batch/"
  },
  {
    "event": "prompt_submitted",
    "properties": {
      "$session_id": "<redacted-session-hash>",
      "input_source": "rpc",
      "invocation_stage": "none",
      "is_effective_ultrawork_invocation": false,
      "is_real_user_prompt": true,
      "is_turn_start": true,
      "keyword_any": false,
      "keyword_occurrence_bucket": "1",
      "keyword_ultrawork_full": false,
      "keyword_ulw_abbrev": false,
      "keyword_variant": "none",
      "prompt_length_bucket": "lt_100",
      "queue_mode": "immediate",
      "real_prompt_ordinal_bucket": "2_3",
      "suppression_reason": "no_keyword",
      "$process_person_profile": false,
      "package_version": "0.0.0",
      "platform": "omo-senpi",
      "product_name": "omo-native",
      "schema_version": 1,
      "$lib": "posthog-node",
      "$lib_version": "5.35.12",
      "$geoip_disable": true
    },
    "timestamp": "2026-08-10T11:28:37.726Z",
    "distinct_id": "<redacted-distinct-id>",
    "path": "/batch/"
  },
  {
    "event": "skill_loaded",
    "properties": {
      "$session_id": "<redacted-session-hash>",
      "skill_name": "debugging",
      "$process_person_profile": false,
      "package_version": "0.0.0",
      "platform": "omo-senpi",
      "product_name": "omo-native",
      "schema_version": 1,
      "$lib": "posthog-node",
      "$lib_version": "5.35.12",
      "$geoip_disable": true
    },
    "timestamp": "2026-08-10T11:28:37.741Z",
    "distinct_id": "<redacted-distinct-id>",
    "path": "/batch/"
  },
  {
    "event": "turn_completed",
    "properties": {
      "$session_id": "<redacted-session-hash>",
      "cache_read_tokens": 0,
      "cache_write_tokens": 0,
      "cost_usd": 0,
      "input_tokens": 12,
      "model_id": "gpt-5.6-sol",
      "output_tokens": 8,
      "provider": "openai",
      "reasoning_tokens": 0,
      "total_tokens": 20,
      "turn_index": 0,
      "$process_person_profile": false,
      "package_version": "0.0.0",
      "platform": "omo-senpi",
      "product_name": "omo-native",
      "schema_version": 1,
      "$lib": "posthog-node",
      "$lib_version": "5.35.12",
      "$geoip_disable": true
    },
    "timestamp": "2026-08-10T11:28:37.748Z",
    "distinct_id": "<redacted-distinct-id>",
    "path": "/batch/"
  },
  {
    "event": "turn_completed",
    "properties": {
      "$session_id": "<redacted-session-hash>",
      "cache_read_tokens": 0,
      "cache_write_tokens": 0,
      "cost_usd": 0,
      "input_tokens": 12,
      "model_id": "gpt-5.6-sol",
      "output_tokens": 8,
      "provider": "openai",
      "reasoning_tokens": 0,
      "total_tokens": 20,
      "turn_index": 1,
      "$process_person_profile": false,
      "package_version": "0.0.0",
      "platform": "omo-senpi",
      "product_name": "omo-native",
      "schema_version": 1,
      "$lib": "posthog-node",
      "$lib_version": "5.35.12",
      "$geoip_disable": true
    },
    "timestamp": "2026-08-10T11:28:37.757Z",
    "distinct_id": "<redacted-distinct-id>",
    "path": "/batch/"
  },
  {
    "event": "prompt_submitted",
    "properties": {
      "$session_id": "<redacted-session-hash>",
      "input_source": "rpc",
      "invocation_stage": "none",
      "is_effective_ultrawork_invocation": false,
      "is_real_user_prompt": true,
      "is_turn_start": true,
      "keyword_any": false,
      "keyword_occurrence_bucket": "1",
      "keyword_ultrawork_full": false,
      "keyword_ulw_abbrev": false,
      "keyword_variant": "none",
      "prompt_length_bucket": "lt_100",
      "queue_mode": "immediate",
      "real_prompt_ordinal_bucket": "2_3",
      "suppression_reason": "no_keyword",
      "$process_person_profile": false,
      "package_version": "0.0.0",
      "platform": "omo-senpi",
      "product_name": "omo-native",
      "schema_version": 1,
      "$lib": "posthog-node",
      "$lib_version": "5.35.12",
      "$geoip_disable": true
    },
    "timestamp": "2026-08-10T11:28:37.848Z",
    "distinct_id": "<redacted-distinct-id>",
    "path": "/batch/"
  },
  {
    "event": "turn_completed",
    "properties": {
      "$session_id": "<redacted-session-hash>",
      "cache_read_tokens": 0,
      "cache_write_tokens": 0,
      "cost_usd": 0,
      "input_tokens": 12,
      "model_id": "gpt-5.6-sol",
      "output_tokens": 8,
      "provider": "openai",
      "reasoning_tokens": 0,
      "total_tokens": 20,
      "turn_index": 0,
      "$process_person_profile": false,
      "package_version": "0.0.0",
      "platform": "omo-senpi",
      "product_name": "omo-native",
      "schema_version": 1,
      "$lib": "posthog-node",
      "$lib_version": "5.35.12",
      "$geoip_disable": true
    },
    "timestamp": "2026-08-10T11:28:37.856Z",
    "distinct_id": "<redacted-distinct-id>",
    "path": "/batch/"
  }
]
```

## Opt-out runs

- `DO_NOT_TRACK=1`: replayed the same three real prompts through the same real CLI drive; zero new HTTP requests reached the capture server from either native or legacy telemetry.
- `omo.json telemetry.enabled:false`: replayed the same three real prompts through the same real CLI drive; zero new HTTP requests reached the capture server from either native or legacy telemetry.

## Cleanup receipts

- Capture server process receipt: pid 13104; server listening false: true; kill-zero-equivalent check failed as required: true.
- Port 49319 free after close: true; `lsof -nP -iTCP:49319 -sTCP:LISTEN` output was empty: true.
- Removed <temp-enabled>: true.
- Removed <temp-dnt>: true.
- Removed <temp-config>: true.
- Removed <temp-capture>: true.

## Transcript

A sanitized CLI transcript and stderr summary are committed in `transcript.txt`. Absolute repository and temporary paths are replaced with labels.
