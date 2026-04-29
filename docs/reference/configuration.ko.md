# 설정 레퍼런스

Oh My OpenCode 플러그인 설정에 대한 완전한 레퍼런스입니다. 리네임 전환 기간 동안, 런타임은 `oh-my-openagent.json[c]`와 레거시 `oh-my-opencode.json[c]` 파일 둘 다 인식합니다.

---

## 목차

- [시작하기](#시작하기)
  - [파일 위치](#파일-위치)
  - [빠른 시작 예시](#빠른-시작-예시)
- [핵심 개념](#핵심-개념)
  - [에이전트](#에이전트)
  - [카테고리](#카테고리)
  - [모델 해석](#모델-해석)
- [작업 시스템](#작업-시스템)
  - [백그라운드 작업](#백그라운드-작업)
  - [Sisyphus 에이전트](#sisyphus-에이전트)
  - [Sisyphus Tasks](#sisyphus-tasks)
- [기능](#기능)
  - [Skills](#skills)
  - [Hooks](#hooks)
  - [Commands](#commands)
  - [Browser Automation](#browser-automation)
  - [Tmux Integration](#tmux-integration)
  - [Git Master](#git-master)
  - [Comment Checker](#comment-checker)
  - [Notification](#notification)
  - [MCPs](#mcps)
  - [LSP](#lsp)
- [고급](#고급)
  - [Runtime Fallback](#runtime-fallback)
  - [Model Capabilities](#model-capabilities)
  - [Hashline Edit](#hashline-edit)
  - [Experimental](#experimental)
- [레퍼런스](#레퍼런스)
  - [환경 변수](#환경-변수)
  - [프로바이더별](#프로바이더별)

---

## 시작하기

### 파일 위치

사용자 설정이 먼저 로드되고, 프로젝트 설정이 그것을 오버라이드합니다. 각 디렉터리에서 호환성 레이어는 리네임된 베이스네임과 레거시 베이스네임 둘 다 인식합니다.

1. 프로젝트 설정: `.opencode/oh-my-openagent.json[c]` 또는 `.opencode/oh-my-opencode.json[c]`
2. 사용자 설정 (`.json`보다 `.jsonc` 우선):

| 플랫폼      | 경로 후보 |
| ----------- | --------------- |
| macOS/Linux | `~/.config/opencode/oh-my-openagent.json[c]`, `~/.config/opencode/oh-my-opencode.json[c]` |
| Windows     | `%APPDATA%\opencode\oh-my-openagent.json[c]`, `%APPDATA%\opencode\oh-my-opencode.json[c]` |

**리네임 호환성:** 배포된 패키지와 CLI 바이너리는 여전히 `oh-my-opencode`입니다. OpenCode 플러그인 등록은 `oh-my-openagent`를 우선하고, 레거시 `oh-my-opencode` 항목과 설정 베이스네임도 전환 기간 동안 여전히 로드됩니다. 설정 감지는 `oh-my-openagent` 전에 `oh-my-opencode`를 점검하므로, 같은 디렉터리에 두 플러그인 설정 베이스네임이 모두 존재하면 현재는 레거시 `oh-my-opencode.*` 파일이 이깁니다.
JSONC는 `// 라인 주석`, `/* 블록 주석 */`, 그리고 후행 콤마를 지원합니다.

스키마 자동완성 활성화:

```json
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/oh-my-opencode.schema.json"
}
```

가이드 설정을 위해 `bunx oh-my-opencode install`을 실행하세요. 가용 모델을 나열하려면 `opencode models`를 실행하세요.

### 빠른 시작 예시

다음은 실용적인 시작 설정입니다:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/oh-my-opencode.schema.json",

  "agents": {
    // Main orchestrator: Claude Opus or Kimi K2.5 work best
    "sisyphus": {
      "model": "kimi-for-coding/k2p5",
      "ultrawork": { "model": "anthropic/claude-opus-4-7", "variant": "max" },
    },

    // Research agents: cheap fast models are fine
    "librarian": { "model": "google/gemini-3-flash" },
    "explore": { "model": "github-copilot/grok-code-fast-1" },

    // Architecture consultation: GPT-5.4 or Claude Opus
    "oracle": { "model": "openai/gpt-5.4", "variant": "high" },

    // Prometheus inherits sisyphus model; just add prompt guidance
    "prometheus": {
      "prompt_append": "Leverage deep & quick agents heavily, always in parallel.",
    },
  },

  "categories": {
    // quick - trivial tasks
    "quick": { "model": "opencode/gpt-5-nano" },

    // unspecified-low - moderate tasks
    "unspecified-low": { "model": "anthropic/claude-sonnet-4-6" },

    // unspecified-high - complex work
    "unspecified-high": { "model": "anthropic/claude-opus-4-7", "variant": "max" },

    // writing - docs/prose
    "writing": { "model": "google/gemini-3-flash" },

    // visual-engineering - Gemini dominates visual tasks
    "visual-engineering": {
      "model": "google/gemini-3.1-pro",
      "variant": "high",
    },

    // Custom category for git operations
    "git": {
      "model": "opencode/gpt-5-nano",
      "description": "All git operations",
      "prompt_append": "Focus on atomic commits, clear messages, and safe operations.",
    },
  },

  // Limit expensive providers; let cheap ones run freely
  "background_task": {
    "providerConcurrency": {
      "anthropic": 3,
      "openai": 3,
      "opencode": 10,
      "zai-coding-plan": 10,
    },
    "modelConcurrency": {
      "anthropic/claude-opus-4-7": 2,
      "opencode/gpt-5-nano": 20,
    },
  },

  "experimental": { "aggressive_truncation": true, "task_system": true },
  "tmux": { "enabled": false },
}
```

---

## 핵심 개념

### 에이전트

빌트인 에이전트 설정을 오버라이드합니다. 가용 에이전트: `sisyphus`, `hephaestus`, `prometheus`, `oracle`, `librarian`, `explore`, `multimodal-looker`, `metis`, `momus`, `atlas`, `sisyphus-junior`.

```json
{
  "agents": {
    "explore": { "model": "anthropic/claude-haiku-4-5", "temperature": 0.5 },
    "multimodal-looker": { "disable": true }
  }
}
```

에이전트를 완전히 비활성화: `{ "disabled_agents": ["oracle", "multimodal-looker"] }`

코어 에이전트는 UI에서 결정적 Tab 사이클링을 위해 주입된 런타임 `order` 필드를 받습니다: Sisyphus = 1, Hephaestus = 2, Prometheus = 3, Atlas = 4. 이는 사용자 설정 가능한 설정 키가 아닙니다.

#### 에이전트 옵션

| 옵션              | 타입           | 설명                                                            |
| ----------------- | -------------- | --------------------------------------------------------------- |
| `model`           | string         | 모델 오버라이드 (`provider/model`)                              |
| `fallback_models` | string\|array  | API 에러 시 폴백 모델. 문자열, 또는 모델별 설정이 있는 객체와 문자열의 혼합 배열 지원 |
| `temperature`     | number         | 샘플링 온도                                                     |
| `top_p`           | number         | Top-p 샘플링                                                    |
| `prompt`          | string         | 시스템 프롬프트 교체. `file://` URI 지원                         |
| `prompt_append`   | string         | 시스템 프롬프트에 덧붙임. `file://` URI 지원                     |
| `tools`           | array         | 허용된 도구 목록                                       |
| `disable`         | boolean       | 이 에이전트 비활성화                                    |
| `mode`            | string        | 에이전트 모드                                          |
| `color`           | string        | UI 색상                                                |
| `permission`      | object        | 도구별 권한 (아래 참조)                                |
| `category`        | string        | 카테고리에서 모델 상속                                  |
| `variant`         | string        | 모델 변형: `max`, `high`, `medium`, `low`, `xhigh`. 지원 값으로 정규화 |
| `maxTokens`       | number        | 최대 응답 토큰                                          |
| `thinking`        | object        | Anthropic 확장 thinking                                |
| `reasoningEffort` | string        | OpenAI reasoning: `none`, `minimal`, `low`, `medium`, `high`, `xhigh`. 지원 값으로 정규화 |
| `textVerbosity`   | string        | 텍스트 장황함: `low`, `medium`, `high`                  |
| `providerOptions` | object        | 프로바이더별 옵션                                       |

#### Anthropic 확장 Thinking

```json
{
  "agents": {
    "oracle": { "thinking": { "type": "enabled", "budgetTokens": 200000 } }
  }
}
```

#### 에이전트 권한

에이전트가 사용할 수 있는 도구를 제어:

```json
{
  "agents": {
    "explore": {
      "permission": {
        "edit": "deny",
        "bash": "ask",
        "webfetch": "allow"
      }
    }
  }
}
```

| 권한                 | 값                                                                          |
| -------------------- | --------------------------------------------------------------------------- |
| `edit`               | `ask` / `allow` / `deny`                                                    |
| `bash`               | `ask` / `allow` / `deny` 또는 명령별: `{ "git": "allow", "rm": "deny" }` |
| `webfetch`           | `ask` / `allow` / `deny`                                                    |
| `doom_loop`          | `ask` / `allow` / `deny`                                                    |
| `external_directory` | `ask` / `allow` / `deny`                                                    |


#### 모델별 설정이 있는 폴백 모델

`fallback_models`는 단일 모델 문자열이나 배열을 받습니다. 배열 항목은 일반 문자열이거나 개별 모델 설정이 있는 객체일 수 있습니다:

```jsonc
{
  "agents": {
    "sisyphus": {
      "model": "anthropic/claude-opus-4-7",
      "fallback_models": [
        // Simple string fallback
        "openai/gpt-5.4",
        // Object with per-model settings
        {
          "model": "google/gemini-3.1-pro",
          "variant": "high",
          "temperature": 0.2
        },
        {
          "model": "anthropic/claude-sonnet-4-6",
          "thinking": { "type": "enabled", "budgetTokens": 64000 }
        }
      ]
    }
  }
}
```

객체 항목은 다음을 지원: `model`, `variant`, `reasoningEffort`, `temperature`, `top_p`, `maxTokens`, `thinking`.

#### 프롬프트용 파일 URI

`prompt`와 `prompt_append` 둘 다 `file://` URI를 통해 파일에서 컨텐츠 로딩을 지원합니다. 카테고리 레벨의 `prompt_append`도 동일한 URI 형식을 지원합니다.

```jsonc
{
  "agents": {
    "sisyphus": {
      "prompt_append": "file:///absolute/path/to/prompt.txt"
    },
    "oracle": {
      "prompt": "file://./relative/to/project/prompt.md"
    },
    "explore": {
      "prompt_append": "file://~/home/dir/prompt.txt"
    }
  },
  "categories": {
    "custom": {
      "model": "anthropic/claude-sonnet-4-6",
      "prompt_append": "file://./category-context.md"
    }
  }
}
```

경로는 절대(`file:///abs/path`), 프로젝트 루트 상대(`file://./rel/path`), 또는 홈 상대(`file://~/home/path`)일 수 있습니다. 파일 URI를 디코드, 해석, 또는 읽을 수 없으면 OmO는 강하게 실패하는 대신 프롬프트에 경고 플레이스홀더를 삽입합니다.

### 카테고리

`task()` 도구가 사용하는 도메인별 모델 위임. Sisyphus가 작업을 위임할 때, 모델 이름이 아니라 카테고리를 선택합니다.

#### 빌트인 카테고리

| 카테고리             | 기본 모델                       | 설명                                            |
| -------------------- | ------------------------------- | ---------------------------------------------- |
| `visual-engineering` | `google/gemini-3.1-pro` (high)  | 프론트엔드, UI/UX, 디자인, 애니메이션             |
| `ultrabrain`         | `openai/gpt-5.4` (xhigh)        | 깊은 논리 추론, 복잡한 아키텍처                   |
| `deep`               | `openai/gpt-5.4` (medium)       | 자율 문제 해결, 철저한 리서치                     |
| `artistry`           | `google/gemini-3.1-pro` (high)  | 창의적/비관습적 접근                              |
| `quick`              | `openai/gpt-5.4-mini`           | 사소한 작업, 오타 수정, 단일 파일 변경            |
| `unspecified-low`    | `anthropic/claude-sonnet-4-6`   | 일반 작업, 낮은 노력                              |
| `unspecified-high`   | `anthropic/claude-opus-4-7` (max) | 일반 작업, 높은 노력                            |
| `writing`            | `google/gemini-3-flash`         | 문서, 산문, 기술 문서                             |

> **참고**: 빌트인 기본값은 카테고리가 설정에 존재할 때만 적용됩니다. 그렇지 않으면 시스템 기본 모델이 사용됩니다.

#### 카테고리 옵션

| 옵션                | 타입          | 기본값  | 설명                                                                |
| ------------------- | ------------- | ------- | ------------------------------------------------------------------- |
| `model`             | string        | -       | 모델 오버라이드                                                     |
| `fallback_models`   | string\|array | -       | API 에러 시 폴백 모델. 문자열, 또는 모델별 설정이 있는 객체와 문자열의 혼합 배열 지원 |
| `temperature`       | number        | -       | 샘플링 온도                                                         |
| `top_p`             | number        | -       | Top-p 샘플링                                                        |
| `maxTokens`         | number        | -       | 최대 응답 토큰                                                      |
| `thinking`          | object        | -       | Anthropic 확장 thinking                                             |
| `reasoningEffort`   | string        | -       | OpenAI reasoning effort. 미지원 값은 정규화                         |
| `textVerbosity`     | string        | -       | 텍스트 장황함                                                       |
| `tools`             | array         | -       | 허용된 도구                                                         |
| `prompt_append`     | string        | -       | 시스템 프롬프트에 덧붙임                                            |
| `variant`           | string        | -       | 모델 변형. 미지원 값은 정규화                                       |
| `description`       | string        | -       | `task()` 도구 프롬프트에 표시                                       |
| `is_unstable_agent` | boolean       | `false` | 백그라운드 모드 + 모니터링 강제. Gemini 모델에 자동 활성화. |

카테고리 비활성화: `{ "disabled_categories": ["ultrabrain"] }`

### 모델 해석

런타임 우선순위:

1. **UI 선택 모델** - 주 에이전트의 경우, OpenCode UI에서 선택된 모델
2. **사용자 오버라이드** - 설정에서 설정된 모델 → 그대로 사용. 콜드 캐시에서도, 명시적 사용자 설정이 하드코딩된 폴백 체인보다 우선
3. **카테고리 기본** - 할당된 카테고리 설정에서 상속된 모델
4. **사용자 `fallback_models`** - 사용자 설정 폴백 목록이 빌트인 폴백 체인 전에 시도됨
5. **프로바이더 폴백 체인** - OmO 소스의 빌트인 프로바이더/모델 체인
6. **시스템 기본** - OpenCode가 설정한 기본 모델

#### 모델 설정 호환성

모델 설정은 강하게 실패하는 대신 모델 기능에 대해 호환성 정규화됩니다.

정규화 필드:

- `variant` - 가장 가까운 지원 값으로 다운그레이드
- `reasoningEffort` - 가장 가까운 지원 값으로 다운그레이드, 또는 미지원이면 제거
- `temperature` - 모델 메타데이터가 미지원이면 제거
- `top_p` - 모델 메타데이터가 미지원이면 제거
- `maxTokens` - 모델이 보고한 max output 한도로 제한
- `thinking` - 타깃 모델이 thinking을 지원하지 않으면 제거

예시:
- Claude 모델은 `reasoningEffort`를 지원하지 않음 - 자동 제거
- GPT-4.1은 reasoning을 지원하지 않음 - `reasoningEffort` 제거
- o-시리즈 모델은 `none`부터 `high`를 지원 - `xhigh`는 `high`로 다운그레이드
- GPT-5는 `none`, `minimal`, `low`, `medium`, `high`, `xhigh`를 지원 - 모두 통과

기능 데이터는 먼저 프로바이더 런타임 메타데이터에서 옵니다. OmO는 또한 번들된 models.dev 기반 기능 데이터를 배포하고, 새로고침 가능한 로컬 models.dev 캐시를 지원하며, 정확한 메타데이터가 가용하지 않을 때 휴리스틱 패밀리 감지와 별칭 규칙으로 폴백합니다. `bunx oh-my-opencode doctor`는 기능 진단을 표면화하고 설정된 모델이 호환성 폴백에 의존할 때 경고합니다.


#### 에이전트 프로바이더 체인

| 에이전트              | 기본 모델           | 프로바이더 우선순위                                                          |
| --------------------- | ------------------- | ---------------------------------------------------------------------------- |
| **Sisyphus**          | `claude-opus-4-7`   | `anthropic\|github-copilot\|opencode/claude-opus-4-7 (max)` → `opencode-go/kimi-k2.5` → `kimi-for-coding/k2p5` → `opencode\|moonshotai\|moonshotai-cn\|firmware\|ollama-cloud\|aihubmix/kimi-k2.5` → `openai\|github-copilot\|opencode/gpt-5.4 (medium)` → `zai-coding-plan\|opencode/glm-5` → `opencode/big-pickle` |
| **Hephaestus**        | `gpt-5.4`           | `gpt-5.4 (medium)`                                                           |
| **oracle**            | `gpt-5.4`           | `openai\|github-copilot\|opencode/gpt-5.4 (high)` → `google\|github-copilot\|opencode/gemini-3.1-pro (high)` → `anthropic\|github-copilot\|opencode/claude-opus-4-7 (max)` → `opencode-go/glm-5` |
| **librarian**         | `gpt-5.4-mini-fast` | `openai/gpt-5.4-mini-fast` → `opencode-go\|vercel/minimax-m2.7-highspeed` → `opencode-go\|vercel/minimax-m2.7` → `anthropic\|opencode\|vercel/claude-haiku-4-5` → `openai\|opencode\|vercel/gpt-5.4-nano` |
| **explore**           | `gpt-5.4-mini-fast` | `openai/gpt-5.4-mini-fast` → `opencode-go\|vercel/minimax-m2.7-highspeed` → `opencode-go\|vercel/minimax-m2.7` → `anthropic\|opencode\|vercel/claude-haiku-4-5` → `openai\|opencode\|vercel/gpt-5.4-nano` |
| **multimodal-looker** | `gpt-5.4`           | `openai\|opencode/gpt-5.4 (medium)` → `opencode-go/kimi-k2.5` → `zai-coding-plan/glm-4.6v` → `openai\|github-copilot\|opencode/gpt-5-nano` |
| **Prometheus**        | `claude-opus-4-7`   | `anthropic\|github-copilot\|opencode/claude-opus-4-7 (max)` → `openai\|github-copilot\|opencode/gpt-5.4 (high)` → `opencode-go/glm-5` → `google\|github-copilot\|opencode/gemini-3.1-pro` |
| **Metis**             | `claude-opus-4-7`   | `anthropic\|github-copilot\|opencode/claude-opus-4-7 (max)` → `openai\|github-copilot\|opencode/gpt-5.4 (high)` → `opencode-go/glm-5` → `kimi-for-coding/k2p5` |
| **Momus**             | `gpt-5.4`           | `openai\|github-copilot\|opencode/gpt-5.4 (xhigh)` → `anthropic\|github-copilot\|opencode/claude-opus-4-7 (max)` → `google\|github-copilot\|opencode/gemini-3.1-pro (high)` → `opencode-go/glm-5` |
| **Atlas**             | `claude-sonnet-4-6` | `anthropic\|github-copilot\|opencode/claude-sonnet-4-6` → `opencode-go/kimi-k2.5` → `openai\|github-copilot\|opencode/gpt-5.4 (medium)` → `opencode-go/minimax-m2.7` |

#### 카테고리 프로바이더 체인

| 카테고리                | 기본 모델           | 프로바이더 우선순위                                            |
| ---------------------- | ------------------- | -------------------------------------------------------------- |
| **visual-engineering** | `gemini-3.1-pro`    | `google\|github-copilot\|opencode/gemini-3.1-pro (high)` → `zai-coding-plan\|opencode/glm-5` → `anthropic\|github-copilot\|opencode/claude-opus-4-7 (max)` → `opencode-go/glm-5` → `kimi-for-coding/k2p5` |
| **ultrabrain**         | `gpt-5.4`           | `openai\|opencode/gpt-5.4 (xhigh)` → `google\|github-copilot\|opencode/gemini-3.1-pro (high)` → `anthropic\|github-copilot\|opencode/claude-opus-4-7 (max)` → `opencode-go/glm-5` |
| **deep**               | `gpt-5.4`           | `openai\|github-copilot\|venice\|opencode/gpt-5.4 (medium)` → `anthropic\|github-copilot\|opencode/claude-opus-4-7 (max)` → `google\|github-copilot\|opencode/gemini-3.1-pro (high)` |
| **artistry**           | `gemini-3.1-pro`    | `google\|github-copilot\|opencode/gemini-3.1-pro (high)` → `anthropic\|github-copilot\|opencode/claude-opus-4-7 (max)` → `openai\|github-copilot\|opencode/gpt-5.4` |
| **quick**              | `gpt-5.4-mini`      | `openai\|github-copilot\|opencode/gpt-5.4-mini` → `anthropic\|github-copilot\|opencode/claude-haiku-4-5` → `google\|github-copilot\|opencode/gemini-3-flash` → `opencode-go/minimax-m2.7` → `opencode/gpt-5-nano` |
| **unspecified-low**    | `claude-sonnet-4-6` | `anthropic\|github-copilot\|opencode/claude-sonnet-4-6` → `openai\|opencode/gpt-5.3-codex (medium)` → `opencode-go/kimi-k2.5` → `google\|github-copilot\|opencode/gemini-3-flash` → `opencode-go/minimax-m2.7` |
| **unspecified-high**   | `claude-opus-4-7`   | `anthropic\|github-copilot\|opencode/claude-opus-4-7 (max)` → `openai\|github-copilot\|opencode/gpt-5.4 (high)` → `zai-coding-plan\|opencode/glm-5` → `kimi-for-coding/k2p5` → `opencode-go/glm-5` → `opencode/kimi-k2.5` → `opencode\|moonshotai\|moonshotai-cn\|firmware\|ollama-cloud\|aihubmix/kimi-k2.5` |
| **writing**            | `gemini-3-flash`    | `google\|github-copilot\|opencode/gemini-3-flash` → `opencode-go/kimi-k2.5` → `anthropic\|github-copilot\|opencode/claude-sonnet-4-6` → `opencode-go/minimax-m2.7` |

설정에 대한 효과적 모델 해석을 보려면 `bunx oh-my-opencode doctor --verbose`를 실행하세요.

---

## 작업 시스템

### 백그라운드 작업

병렬 에이전트 실행과 동시성 한도를 제어합니다.

```json
{
  "background_task": {
    "defaultConcurrency": 5,
    "staleTimeoutMs": 180000,
    "providerConcurrency": { "anthropic": 3, "openai": 5, "google": 10 },
    "modelConcurrency": { "anthropic/claude-opus-4-7": 2 }
  }
}
```

| 옵션                  | 기본값   | 설명                                                                  |
| --------------------- | -------- | --------------------------------------------------------------------- |
| `defaultConcurrency`  | -        | 최대 동시 작업(모든 프로바이더)                                       |
| `staleTimeoutMs`      | `180000` | 활동 없는 작업 인터럽트 (최소: 60000)                                  |
| `providerConcurrency` | -        | 프로바이더별 한도(키 = 프로바이더 이름)                                |
| `modelConcurrency`    | -        | 모델별 한도(키 = `provider/model`). 프로바이더 한도를 오버라이드. |

우선순위: `modelConcurrency` > `providerConcurrency` > `defaultConcurrency`

### Sisyphus 에이전트

메인 오케스트레이션 시스템을 설정합니다.

```json
{
  "sisyphus_agent": {
    "disabled": false,
    "default_builder_enabled": false,
    "planner_enabled": true,
    "replace_plan": true
  }
}
```

| 옵션                      | 기본값  | 설명                                                            |
| ------------------------- | ------- | --------------------------------------------------------------- |
| `disabled`                | `false` | 모든 Sisyphus 오케스트레이션 비활성화, 원래 build/plan 복원       |
| `default_builder_enabled` | `false` | OpenCode-Builder 에이전트 활성화 (기본 off)                      |
| `planner_enabled`         | `true`  | Prometheus(Planner) 에이전트 활성화                              |
| `replace_plan`            | `true`  | 기본 plan 에이전트를 서브에이전트 모드로 강등                    |

Sisyphus 에이전트는 이름으로 `agents` 아래에서 커스터마이즈할 수도 있습니다: `Sisyphus`, `OpenCode-Builder`, `Prometheus (Planner)`, `Metis (Plan Consultant)`.

### Sisyphus Tasks

세션 간 작업 추적을 위한 Sisyphus Tasks 시스템을 활성화합니다.

```json
{
  "sisyphus": {
    "tasks": {
      "enabled": false,
      "storage_path": ".sisyphus/tasks",
      "claude_code_compat": false
    }
  }
}
```

| 옵션                 | 기본값            | 설명                                       |
| -------------------- | ----------------- | ------------------------------------------ |
| `enabled`            | `false`           | Sisyphus Tasks 시스템 활성화                |
| `storage_path`       | `.sisyphus/tasks` | 저장 경로 (프로젝트 루트 상대)              |
| `claude_code_compat` | `false`           | Claude Code 경로 호환 모드 활성화           |

---

## 기능

### Skills

스킬은 도메인별 전문성과 임베디드 MCP를 가져옵니다.

빌트인 스킬: `playwright`, `playwright-cli`, `agent-browser`, `dev-browser`, `git-master`, `frontend-ui-ux`

빌트인 스킬 비활성화: `{ "disabled_skills": ["playwright"] }`

#### 스킬 설정

```json
{
  "skills": {
    "sources": [
      { "path": "./my-skills", "recursive": true },
      "https://example.com/skill.yaml"
    ],
    "enable": ["my-skill"],
    "disable": ["other-skill"],
    "my-skill": {
      "description": "What it does",
      "template": "Custom prompt template",
      "from": "source-file.ts",
      "model": "custom/model",
      "agent": "custom-agent",
      "subtask": true,
      "argument-hint": "usage hint",
      "license": "MIT",
      "compatibility": ">= 3.0.0",
      "metadata": { "author": "Your Name" },
      "allowed-tools": ["read", "bash"]
    }
  }
}
```

| `sources` 옵션   | 기본값  | 설명                            |
| ---------------- | ------- | ------------------------------- |
| `path`           | -       | 로컬 경로 또는 원격 URL          |
| `recursive`      | `false` | 하위 디렉터리로 재귀             |
| `glob`           | -       | 파일 선택을 위한 glob 패턴       |

### Hooks

`disabled_hooks`로 빌트인 훅을 비활성화:

```json
{ "disabled_hooks": ["comment-checker"] }
```

가용 훅: `todo-continuation-enforcer`, `context-window-monitor`, `session-recovery`, `session-notification`, `comment-checker`, `grep-output-truncator`, `tool-output-truncator`, `directory-agents-injector`, `directory-readme-injector`, `empty-task-response-detector`, `think-mode`, `anthropic-context-window-limit-recovery`, `rules-injector`, `background-notification`, `auto-update-checker`, `startup-toast`, `keyword-detector`, `agent-usage-reminder`, `non-interactive-env`, `interactive-bash-session`, `compaction-context-injector`, `thinking-block-validator`, `claude-code-hooks`, `ralph-loop`, `preemptive-compaction`, `auto-slash-command`, `sisyphus-junior-notepad`, `no-sisyphus-gpt`, `start-work`, `runtime-fallback`

**참고:**

- `directory-agents-injector` - OpenCode 1.1.37+에서 자동 비활성화 (네이티브 AGENTS.md 지원)
- `no-sisyphus-gpt` - **비활성화하지 마세요**. Sisyphus에 대한 비호환 GPT 모델을 차단하면서 전용 GPT-5.4 프롬프트 경로를 허용합니다.
- `startup-toast`는 `auto-update-checker`의 하위 기능입니다. `disabled_hooks`에 `startup-toast`를 추가해 토스트만 비활성화하세요.
- `session-recovery` - 복구 가능한 세션 에러(누락된 도구 결과, 미가용 도구, thinking 블록 위반)에서 자동 복구. 복구 동안 토스트 알림 표시. 복구 후 자동 재시도를 위해 `experimental.auto_resume`을 활성화하세요.

### Commands

`disabled_commands`로 빌트인 명령을 비활성화:

```json
{ "disabled_commands": ["init-deep", "start-work"] }
```

가용 명령: `init-deep`, `ralph-loop`, `ulw-loop`, `cancel-ralph`, `refactor`, `start-work`, `stop-continuation`, `handoff`

### Browser Automation

| 프로바이더             | 인터페이스 | 설치                                                |
| ---------------------- | --------- | --------------------------------------------------- |
| `playwright` (default) | MCP tools | npx로 자동 설치                                      |
| `agent-browser`        | Bash CLI  | `bun add -g agent-browser && agent-browser install` |

프로바이더 전환:

```json
{ "browser_automation_engine": { "provider": "agent-browser" } }
```

### Tmux Integration

별도 tmux 페인에서 백그라운드 서브에이전트 실행. tmux 안에서 `opencode --port <port>`로 실행 필요.

```json
{
  "tmux": {
    "enabled": true,
    "layout": "main-vertical",
    "main_pane_size": 60,
    "main_pane_min_width": 120,
    "agent_pane_min_width": 40
  }
}
```

| 옵션                   | 기본값          | 설명                                                                                |
| ---------------------- | --------------- | ----------------------------------------------------------------------------------- |
| `enabled`              | `false`         | tmux 페인 스폰 활성화                                                                |
| `layout`               | `main-vertical` | `main-vertical` / `main-horizontal` / `tiled` / `even-horizontal` / `even-vertical` |
| `main_pane_size`       | `60`            | 메인 페인 % (20~80)                                                                  |
| `main_pane_min_width`  | `120`           | 최소 메인 페인 컬럼                                                                  |
| `agent_pane_min_width` | `40`            | 최소 에이전트 페인 컬럼                                                              |

### Git Master

git 커밋 동작 설정:

```json
{ "git_master": { "commit_footer": true, "include_co_authored_by": true } }
```

### Comment Checker

주석 품질 검사기 커스터마이즈:

```json
{
  "comment_checker": {
    "custom_prompt": "Your message. Use {{comments}} placeholder."
  }
}
```

### Notification

세션 알림 강제 활성화:

```json
{ "notification": { "force_enable": true } }
```

`force_enable` (`false`) - 외부 알림 플러그인이 감지되어도 session-notification 강제 활성화.

### MCPs

빌트인 MCP(기본 활성화): `websearch` (Exa AI), `context7` (라이브러리 문서), `grep_app` (GitHub 코드 검색).

```json
{ "disabled_mcps": ["websearch", "context7", "grep_app"] }
```

### LSP

Language Server Protocol 통합 설정:

```json
{
  "lsp": {
    "typescript-language-server": {
      "command": ["typescript-language-server", "--stdio"],
      "extensions": [".ts", ".tsx"],
      "priority": 10,
      "env": { "NODE_OPTIONS": "--max-old-space-size=4096" },
      "initialization": {
        "preferences": { "includeInlayParameterNameHints": "all" }
      }
    },
    "pylsp": { "disabled": true }
  }
}
```

| 옵션             | 타입    | 설명                                  |
| ---------------- | ------- | ------------------------------------ |
| `command`        | array   | LSP 서버 시작 명령                    |
| `extensions`     | array   | 파일 확장자 (예: `[".ts"]`)            |
| `priority`       | number  | 여러 서버가 매칭될 때 우선순위         |
| `env`            | object  | 환경 변수                             |
| `initialization` | object  | 서버에 전달되는 init 옵션              |
| `disabled`       | boolean | 이 서버 비활성화                       |

---

## 고급

### Runtime Fallback

API 에러 시 백업 모델로 자동 전환.

**단순 설정** (기본값으로 활성/비활성):

```json
{ "runtime_fallback": true }
{ "runtime_fallback": false }
```

**고급 설정** (전체 제어):

```json
{
  "runtime_fallback": {
    "enabled": true,
    "retry_on_errors": [400, 429, 503, 529],
    "max_fallback_attempts": 3,
    "cooldown_seconds": 60,
    "timeout_seconds": 30,
    "notify_on_fallback": true
  }
}
```

| 옵션                    | 기본값              | 설명                                                                                                                           |
| ----------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `enabled`               | `false`             | 런타임 폴백 활성화                                                                                                              |
| `retry_on_errors`       | `[400,429,503,529]` | 폴백을 트리거하는 HTTP 코드. 분류된 프로바이더 키 에러도 처리.                                                                  |
| `max_fallback_attempts` | `3`                 | 세션당 최대 폴백 시도 (1~20)                                                                                                    |
| `cooldown_seconds`      | `60`                | 실패한 모델 재시도 전 초                                                                                                        |
| `timeout_seconds`       | `30`                | 다음 폴백 강제 전 초. **타임아웃 기반 에스컬레이션과 프로바이더 재시도 메시지 감지를 비활성화하려면 `0`으로 설정.** |
| `notify_on_fallback`    | `true`              | 모델 전환 시 토스트 알림                                                                                                        |

에이전트 또는 카테고리당 `fallback_models` 정의:

```json
{
  "agents": {
    "sisyphus": {
      "model": "anthropic/claude-opus-4-7",
      "fallback_models": [
        "openai/gpt-5.4",
        {
          "model": "google/gemini-3.1-pro",
          "variant": "high"
        }
      ]
    }
  }
}
```

`fallback_models`는 객체 스타일 항목도 지원해 특정 폴백 모델에 설정을 붙일 수 있습니다:

```json
{
  "agents": {
    "sisyphus": {
      "model": "anthropic/claude-opus-4-7",
      "fallback_models": [
        "openai/gpt-5.4",
        {
          "model": "anthropic/claude-sonnet-4-6",
          "variant": "high",
          "thinking": { "type": "enabled", "budgetTokens": 12000 }
        },
        {
          "model": "openai/gpt-5.3-codex",
          "reasoningEffort": "high",
          "temperature": 0.2,
          "top_p": 0.95,
          "maxTokens": 8192
        }
      ]
    }
  }
}
```

혼합 배열이 허용되므로, 문자열 항목과 객체 항목이 같은 폴백 체인에 함께 등장할 수 있습니다.

#### 객체 스타일 `fallback_models`

객체 항목은 다음 모양을 사용합니다:

| 필드 | 타입 | 설명 |
| ----- | ---- | ----------- |
| `model` | string | 폴백 모델 ID. OmO가 현재/기본 프로바이더를 상속할 수 있을 때 프로바이더 접두사는 선택. |
| `variant` | string | 이 폴백 항목에 대한 명시적 변형 오버라이드. |
| `reasoningEffort` | string | 이 폴백 항목에 대한 OpenAI reasoning effort 오버라이드. |
| `temperature` | number | 이 폴백 모델이 활성화되면 적용되는 temperature. |
| `top_p` | number | 이 폴백 모델이 활성화되면 적용되는 top-p. |
| `maxTokens` | number | 이 폴백 모델이 활성화되면 적용되는 최대 응답 토큰. |
| `thinking` | object | 이 폴백 모델이 활성화되면 적용되는 Anthropic thinking 설정. |

모델별 설정은 **폴백 전용**입니다. 그 특정 폴백 모델이 실제로 선택될 때만 승격되므로, 주 모델이 성공적으로 해석될 때 주 모델 설정을 오버라이드하지 않습니다.

`thinking`은 일반 에이전트/카테고리 옵션과 같은 모양을 사용합니다:

| 필드 | 타입 | 설명 |
| ----- | ---- | ----------- |
| `type` | string | `enabled` 또는 `disabled` |
| `budgetTokens` | number | 선택 Anthropic thinking 예산 |

객체 항목은 OmO가 현재/기본 프로바이더에서 추론할 수 있을 때 프로바이더 접두사를 생략할 수도 있습니다. `model`에 인라인 변형 구문과 명시적 `variant` 필드를 둘 다 제공하면 명시적 `variant` 필드가 이깁니다.

#### 전체 예시

**1. 단순 문자열 체인**

순서가 있는 폴백 체인만 필요할 때 문자열 사용:

```json
{
  "agents": {
    "atlas": {
      "model": "anthropic/claude-sonnet-4-6",
      "fallback_models": [
        "anthropic/claude-haiku-4-5",
        "openai/gpt-5.4",
        "google/gemini-3.1-pro"
      ]
    }
  }
}
```

**2. 동일 프로바이더 단축**

주 모델이 이미 프로바이더를 확립하면 폴백 항목은 접두사를 생략할 수 있습니다:

```json
{
  "agents": {
    "atlas": {
      "model": "openai/gpt-5.4",
      "fallback_models": [
        "gpt-5.4-mini",
        {
          "model": "gpt-5.3-codex",
          "reasoningEffort": "medium",
          "maxTokens": 4096
        }
      ]
    }
  }
}
```

이 예시에서 OmO는 현재/기본 프로바이더가 이미 `openai`이므로 `gpt-5.4-mini`와 `gpt-5.3-codex`를 OpenAI 폴백 항목으로 다룹니다.

**3. 혼합 크로스 프로바이더 체인**

일부 폴백 모델만 특별 설정이 필요할 때 문자열 항목과 객체 항목 혼합:

```json
{
  "agents": {
    "sisyphus": {
      "model": "anthropic/claude-opus-4-7",
      "fallback_models": [
        "openai/gpt-5.4",
        {
          "model": "anthropic/claude-sonnet-4-6",
          "variant": "high",
          "thinking": { "type": "enabled", "budgetTokens": 12000 }
        },
        {
          "model": "google/gemini-3.1-pro",
          "variant": "high"
        }
      ]
    }
  }
}
```

**4. 카테고리 레벨 폴백 체인**

`fallback_models`는 `categories` 아래에서 같은 방식으로 동작합니다:

```json
{
  "categories": {
    "deep": {
      "model": "openai/gpt-5.3-codex",
      "fallback_models": [
        {
          "model": "openai/gpt-5.4",
          "reasoningEffort": "xhigh",
          "maxTokens": 12000
        },
        {
          "model": "anthropic/claude-opus-4-7",
          "variant": "max",
          "temperature": 0.2
        },
        "google/gemini-3.1-pro(high)"
      ]
    }
  }
}
```

**5. 모든 지원 필드를 가진 전체 객체 항목**

모든 지원 객체 스타일 매개변수를 한 곳에서 보여줍니다:

```json
{
  "agents": {
    "oracle": {
      "model": "openai/gpt-5.4",
      "fallback_models": [
        {
          "model": "openai/gpt-5.3-codex(low)",
          "variant": "xhigh",
          "reasoningEffort": "high",
          "temperature": 0.3,
          "top_p": 0.9,
          "maxTokens": 8192,
          "thinking": {
            "type": "disabled"
          }
        }
      ]
    }
  }
}
```

이 예시에서 명시적 `"variant": "xhigh"`는 `"model"`의 인라인 `(low)` 접미사를 오버라이드합니다.

이 마지막 예시는 **완전한 모양 레퍼런스**입니다. 실제 설정에서는 프로바이더에 적합한 설정을 선호하세요:

- OpenAI reasoning 모델에는 `reasoningEffort` 사용
- Anthropic thinking 가능 모델에는 `thinking` 사용
- 그 폴백 모델이 지원할 때만 `variant`, `temperature`, `top_p`, `maxTokens` 사용

### Model Capabilities

OmO는 시작 시 로컬 models.dev 기능 스냅샷을 새로고침할 수 있습니다. 이 캐시는 `model_capabilities`로 제어됩니다.

```jsonc
{
  "model_capabilities": {
    "enabled": true,
    "auto_refresh_on_start": true,
    "refresh_timeout_ms": 5000,
    "source_url": "https://models.dev/api.json"
  }
}
```

| 옵션 | 기본 동작 | 설명 |
| ------ | ---------------- | ----------- |
| `enabled` | 명시적으로 `false`로 설정되지 않는 한 활성화 | 모델 기능 새로고침 동작의 마스터 스위치 |
| `auto_refresh_on_start` | 명시적으로 `false`로 설정되지 않는 한 시작 시 새로고침 | 시작 점검 동안 로컬 models.dev 캐시 새로고침 |
| `refresh_timeout_ms` | `5000` | 시작 새로고침 시도의 타임아웃 |
| `source_url` | `https://models.dev/api.json` | models.dev 소스 URL 오버라이드 |

참고:

- 시작 새로고침은 auto-update checker 훅을 통해 실행됩니다.
- 수동 새로고침은 `bunx oh-my-opencode refresh-model-capabilities`로 가능합니다.
- 호환성 점검을 위해 OmO가 기능을 해석할 때 프로바이더 런타임 메타데이터가 여전히 우선합니다.

### Hashline Edit

빌트인 `Edit` 도구를 stale-line 편집을 방지하기 위해 `LINE#ID` 참조를 사용하는 해시 앵커 버전으로 교체합니다. 기본 비활성화.

```json
{ "hashline_edit": true }
```

활성화되면, 두 동반 훅이 활성화됩니다: `hashline-read-enhancer`(Read 출력 주석)와 `hashline-edit-diff-enhancer`(diff 표시). `hashline_edit: true`로 설정해 옵트인하세요. 필요하면 `disabled_hooks`로 동반 훅을 개별 비활성화하세요.

### Experimental

```json
{
  "experimental": {
    "truncate_all_tool_outputs": false,
    "aggressive_truncation": false,
    "auto_resume": false,
    "disable_omo_env": false,
    "task_system": true,
    "dynamic_context_pruning": {
      "enabled": false,
      "notification": "detailed",
      "turn_protection": { "enabled": true, "turns": 3 },
      "protected_tools": [
        "task",
        "todowrite",
        "todoread",
        "lsp_rename",
        "session_read",
        "session_write",
        "session_search"
      ],
      "strategies": {
        "deduplication": { "enabled": true },
        "supersede_writes": { "enabled": true, "aggressive": false },
        "purge_errors": { "enabled": true, "turns": 5 }
      }
    }
  }
}
```

| 옵션                                     | 기본값     | 설명                                                                                  |
| ---------------------------------------- | ---------- | ------------------------------------------------------------------------------------ |
| `truncate_all_tool_outputs`              | `false`    | 모든 도구 출력 절단 (화이트리스트만이 아님)                                          |
| `aggressive_truncation`                  | `false`    | 토큰 한도 초과 시 공격적 절단                                                         |
| `auto_resume`                            | `false`    | thinking 블록 복구 후 자동 재개                                                       |
| `disable_omo_env`                        | `false`    | 자동 주입 `<omo-env>` 블록(date/time/locale) 비활성화. 캐시 히트율 향상.              |
| `task_system`                            | `false`    | Sisyphus task 시스템 활성화                                                           |
| `dynamic_context_pruning.enabled`        | `false`    | 컨텍스트 윈도우 관리를 위해 오래된 도구 출력 자동 정리                                |
| `dynamic_context_pruning.notification`   | `detailed` | 정리 알림: `off` / `minimal` / `detailed`                                             |
| `turn_protection.turns`                  | `3`        | 정리에서 보호되는 최근 턴 (1~10)                                                      |
| `strategies.deduplication`               | `true`     | 중복 도구 호출 제거                                                                   |
| `strategies.supersede_writes`            | `true`     | 파일이 나중에 읽힐 때 write 입력 정리                                                 |
| `strategies.supersede_writes.aggressive` | `false`    | 후속 read가 있다면 어떤 write든 정리                                                  |
| `strategies.purge_errors.turns`          | `5`        | errored 도구 입력 정리 전 턴                                                          |

---

## 레퍼런스

### 환경 변수

| 변수                  | 설명                                                              |
| --------------------- | ----------------------------------------------------------------- |
| `OPENCODE_CONFIG_DIR` | OpenCode 설정 디렉터리 오버라이드 (프로파일 격리에 유용)           |
| `OMO_SEND_ANONYMOUS_TELEMETRY` | 익명 텔레메트리 비활성화: `0`, `false`, 또는 `no`         |
| `OMO_DISABLE_POSTHOG` | 레거시 텔레메트리 옵트아웃 플래그. PostHog 비활성화: `1` 또는 `true` |
| `POSTHOG_API_KEY` | 빌트인 PostHog 프로젝트 API 키 선택 오버라이드 |
| `POSTHOG_HOST` | PostHog ingestion 호스트 오버라이드. 기본 `https://us.i.posthog.com` |

### 프로바이더별

#### Google Auth

Google Gemini용으로 [`opencode-antigravity-auth`](https://github.com/NoeFabris/opencode-antigravity-auth)를 설치하세요. 다중 계정 부하 분산, 듀얼 쿼터, 변형 기반 thinking을 제공합니다.

#### Ollama

JSON 파싱 오류를 피하려면 스트리밍을 **반드시** 비활성화해야 합니다:

```json
{
  "agents": {
    "explore": { "model": "ollama/qwen3-coder", "stream": false }
  }
}
```

흔한 모델: `ollama/qwen3-coder`, `ollama/ministral-3:14b`, `ollama/lfm2.5-thinking`

`JSON Parse error: Unexpected EOF` 이슈는 [Ollama 트러블슈팅](../troubleshooting/ollama.md)을 참고하세요.
