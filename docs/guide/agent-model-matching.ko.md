# 에이전트-모델 매칭 가이드

> **에이전트와 사용자에게**: 각 에이전트가 왜 특정 모델을 필요로 하는지 — 그리고 망가뜨리지 않고 커스터마이즈하는 방법.

## 핵심 통찰: 모델은 곧 개발자다

AI 모델을 팀의 개발자라고 생각해보세요. 각자 다른 두뇌, 다른 성격, 다른 강점을 가지고 있습니다. **모델은 단지 "더 똑똑하거나" "더 멍청한" 것이 아닙니다. 다르게 사고합니다.** 같은 지시를 Claude와 GPT에게 주면, 그들은 근본적으로 다른 방식으로 해석할 것입니다.

이건 버그가 아닙니다. 전체 시스템의 기반입니다.

Oh My OpenAgent는 각 에이전트의 _작업 스타일_과 일치하는 모델을 할당합니다 — 마치 각자가 자기 성격에 맞는 역할에 있는 팀을 만드는 것처럼요.

### Sisyphus: 사교적인 리더

Sisyphus는 모두를 알고, 어디든 가고, 소통과 조율로 일을 해내는 개발자입니다. 다른 에이전트들과 대화하고, 코드베이스 전반의 컨텍스트를 이해하고, 지능적으로 작업을 위임하며, 코드도 잘 작성합니다. 하지만 깊고 순전히 기술적인 문제? 약간 어려움을 겪을 것입니다.

**그래서 Sisyphus는 Claude / Kimi / GLM을 사용합니다.** 이 모델들은 다음에 탁월합니다:

- 복잡한 다단계 지시 따르기 (Sisyphus의 프롬프트는 ~1,100라인)
- 많은 도구 호출에 걸쳐 대화 흐름 유지
- 미묘한 위임과 오케스트레이션 패턴 이해
- 잘 구조화되고 소통적인 출력 생성

Sisyphus를 구형 GPT 모델로 사용하는 것은 — 모두를 조율하고, standup을 진행하고, 팀 전체를 정렬시키는 최고의 프로젝트 매니저를 — 방에 혼자 가둬두고 race condition을 디버그하게 하는 것과 같습니다. 잘못된 매칭. GPT-5.4는 이제 전용 Sisyphus 프롬프트 경로를 갖지만, GPT는 여전히 오케스트레이터의 기본 권장이 아닙니다.

### Hephaestus: 깊이의 전문가

Hephaestus는 하루 종일 자기 방에서 코딩하는 개발자입니다. 말이 많지 않습니다. 사회적으로 어색해 보일 수 있습니다. 하지만 그에게 어려운 기술 문제를 주면 세 시간 후 다른 누구도 찾을 수 없었던 해법을 가지고 나타날 것입니다.

**그래서 Hephaestus는 GPT-5.4를 사용합니다.** GPT-5.4는 정확히 이를 위해 만들어졌습니다:

- 손을 잡아주지 않아도 되는 깊고 자율적인 탐색
- 복잡한 코드베이스 전반의 다중 파일 추론
- 원칙 기반 실행 (레시피가 아닌 목표를 줌)
- 장시간 독립적으로 작업

Hephaestus를 GLM이나 Kimi로 사용하는 것은 가장 소통적이고 사교적인 개발자를 혼자 앉혀 깊은 기술 작업만 하게 시키는 것과 같습니다. 결국 끝내긴 하겠지만 빛나지 않을 것입니다 — 그를 가치 있게 만드는 바로 그 스킬을 낭비하는 것입니다.

### 핵심

모든 에이전트의 프롬프트는 그 모델의 성격과 매칭되도록 튜닝되어 있습니다. **모델을 바꾸면 두뇌를 바꾸는 것이고 — 같은 지시가 완전히 다르게 이해됩니다.** 모델 매칭은 "더 좋고" "더 나쁨"의 문제가 아닙니다. 적합성의 문제입니다.

---

## Claude와 GPT는 어떻게 다르게 사고하는가

이는 일부 에이전트가 양쪽 모델 패밀리를 지원하고 다른 에이전트는 그렇지 않은 이유를 이해하는 데 중요합니다.

**Claude**는 **메커니즘 기반** 프롬프트에 응답합니다 — 상세한 체크리스트, 템플릿, 단계별 절차. 더 많은 규칙 = 더 많은 준수. 중첩된 워크플로우가 있는 1,100라인 프롬프트를 작성해도 Claude는 모든 단계를 따를 것입니다.

**GPT**(특히 5.2+)는 **원칙 기반** 프롬프트에 응답합니다 — 간결한 원칙, XML 구조, 명시적 의사결정 기준. 더 많은 규칙 = 더 많은 모순 표면적 = 더 많은 드리프트. GPT는 목표를 진술하고 메커니즘을 알아내게 할 때 가장 잘 동작합니다.

실제 예: Prometheus의 Claude 프롬프트는 7개 파일에 걸쳐 ~1,100라인입니다. GPT 프롬프트는 ~121라인의 3가지 원칙으로 같은 동작을 달성합니다. 같은 결과, 완전히 다른 접근.

양쪽 패밀리를 지원하는 에이전트(Prometheus, Atlas)는 런타임에 모델을 자동 감지하고 `isGptModel()`을 통해 프롬프트를 전환합니다. 신경 쓸 필요가 없습니다.

---

## 에이전트 프로필

### 소통가 → Claude / Kimi / GLM

이 에이전트들은 Claude에 최적화된 프롬프트 — 길고, 상세하고, 메커니즘 기반 — 를 가집니다. 복잡하고 다층적인 지시를 신뢰성 있게 따르는 모델이 필요합니다.

| 에이전트     | 역할              | 폴백 체인                              | 비고                                                                                              |
| ------------ | ----------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Sisyphus** | 메인 오케스트레이터 | anthropic\|github-copilot\|opencode\|vercel/claude-opus-4-7 (max) → opencode-go\|vercel/kimi-k2.5 → kimi-for-coding/k2p5 → opencode\|moonshotai\|moonshotai-cn\|firmware\|ollama-cloud\|aihubmix\|vercel/kimi-k2.5 → openai\|github-copilot\|opencode\|vercel/gpt-5.4 (medium) → zai-coding-plan\|opencode\|vercel/glm-5 → opencode/big-pickle | `src/shared/model-requirements.ts`의 정확한 런타임 체인. |
| **Metis**    | 계획 갭 분석가     | anthropic\|github-copilot\|opencode\|vercel/claude-opus-4-7 (max) → openai\|github-copilot\|opencode\|vercel/gpt-5.4 (high) → opencode-go\|vercel/glm-5 → kimi-for-coding/k2p5 | `src/shared/model-requirements.ts`의 정확한 런타임 체인. |

### 듀얼 프롬프트 에이전트 → Claude 우선, GPT 지원

이 에이전트들은 Claude 패밀리와 GPT 패밀리에 대해 별도의 프롬프트를 제공합니다. 모델을 자동 감지하고 런타임에 전환합니다.

| 에이전트       | 역할              | 폴백 체인                              | 비고                                                                 |
| -------------- | ----------------- | -------------------------------------- | -------------------------------------------------------------------- |
| **Prometheus** | 전략적 계획자      | anthropic\|github-copilot\|opencode\|vercel/claude-opus-4-7 (max) → openai\|github-copilot\|opencode\|vercel/gpt-5.4 (high) → opencode-go\|vercel/glm-5 → google\|github-copilot\|opencode\|vercel/gemini-3.1-pro | `src/shared/model-requirements.ts`의 정확한 런타임 체인. |
| **Atlas**      | Todo 오케스트레이터 | anthropic\|github-copilot\|opencode\|vercel/claude-sonnet-4-6 → opencode-go\|vercel/kimi-k2.5 → openai\|github-copilot\|opencode\|vercel/gpt-5.4 (medium) → opencode-go\|vercel/minimax-m2.7 | `src/shared/model-requirements.ts`의 정확한 런타임 체인. |

### 깊이의 전문가들 → GPT

이 에이전트들은 GPT의 원칙 기반 스타일을 위해 만들어졌습니다. 그들의 프롬프트는 자율적, 목표 지향 실행을 가정합니다. Claude로 오버라이드하지 마세요.

| 에이전트       | 역할                    | 폴백 체인                              | 비고                                            |
| -------------- | ----------------------- | -------------------------------------- | ------------------------------------------------ |
| **Hephaestus** | 자율적 깊이 작업자      | openai\|github-copilot\|venice\|opencode\|vercel/gpt-5.4 (medium) | 단일 항목 체인. 그 프로바이더 중 하나가 필요. 장인. |
| **Oracle**     | 아키텍처 컨설턴트       | openai\|github-copilot\|opencode\|vercel/gpt-5.4 (high) → google\|github-copilot\|opencode\|vercel/gemini-3.1-pro (high) → anthropic\|github-copilot\|opencode\|vercel/claude-opus-4-7 (max) → opencode-go\|vercel/glm-5 | `src/shared/model-requirements.ts`의 정확한 런타임 체인. |
| **Momus**      | 무자비한 리뷰어         | openai\|github-copilot\|opencode\|vercel/gpt-5.4 (xhigh) → anthropic\|github-copilot\|opencode\|vercel/claude-opus-4-7 (max) → google\|github-copilot\|opencode\|vercel/gemini-3.1-pro (high) → opencode-go\|vercel/glm-5 | `src/shared/model-requirements.ts`의 정확한 런타임 체인. |

### 유틸리티 러너 → 지능보다 속도

이 에이전트들은 grep, 검색, 검색을 합니다. 의도적으로 가장 빠르고 저렴한 가용 모델을 사용합니다. **Opus로 "업그레이드"하지 마세요** — 시니어 엔지니어를 고용해 서류 정리시키는 격입니다.

| 에이전트              | 역할               | 폴백 체인                                       | 비고                                                  |
| --------------------- | ------------------ | ---------------------------------------------- | ----------------------------------------------------- |
| **Explore**           | 빠른 코드베이스 grep | openai/gpt-5.4-mini-fast → opencode-go\|vercel/minimax-m2.7-highspeed → opencode-go\|vercel/minimax-m2.7 → anthropic\|opencode\|vercel/claude-haiku-4-5 → openai\|opencode\|vercel/gpt-5.4-nano | `src/shared/model-requirements.ts`의 정확한 런타임 체인. |
| **Librarian**         | 문서/코드 검색     | openai/gpt-5.4-mini-fast → opencode-go\|vercel/minimax-m2.7-highspeed → opencode-go\|vercel/minimax-m2.7 → anthropic\|opencode\|vercel/claude-haiku-4-5 → openai\|opencode\|vercel/gpt-5.4-nano | `src/shared/model-requirements.ts`의 정확한 런타임 체인. |
| **Multimodal Looker** | 비전/스크린샷       | openai\|opencode\|vercel/gpt-5.4 (medium) → opencode-go\|vercel/kimi-k2.5 → zai-coding-plan\|vercel/glm-4.6v → openai\|github-copilot\|opencode\|vercel/gpt-5-nano | `src/shared/model-requirements.ts`의 정확한 런타임 체인. |
| **Sisyphus-Junior**   | 카테고리 실행자    | anthropic\|github-copilot\|opencode\|vercel/claude-sonnet-4-6 → opencode-go\|vercel/kimi-k2.5 → openai\|github-copilot\|opencode\|vercel/gpt-5.4 (medium) → opencode-go\|vercel/minimax-m2.7 → opencode/big-pickle | `src/shared/model-requirements.ts`의 정확한 런타임 체인. |

---

## 모델 패밀리

### Claude 패밀리

소통적, 지시 따르기, 구조화된 출력. 복잡한 다단계 프롬프트를 따라야 하는 에이전트에 최적.

| 모델                  | 강점                                                                         |
| --------------------- | ---------------------------------------------------------------------------- |
| **Claude Opus 4.7**   | 전반적 최고. 복잡한 프롬프트에 대한 최고 준수. Sisyphus의 기본.              |
| **Claude Sonnet 4.6** | 더 빠르고 저렴. 일상 작업에 좋은 균형.                                       |
| **Claude Haiku 4.5**  | 빠르고 저렴. 빠른 작업과 유틸리티 작업에 좋음.                               |
| **Kimi K2.5**         | Claude와 매우 유사하게 동작. 더 낮은 비용으로 훌륭한 만능.                   |
| **GLM 5**             | Claude 유사 동작. 오케스트레이션 작업에 견고.                                |

### GPT 패밀리

원칙 기반, 명시적 추론, 깊은 기술 능력. 복잡한 문제에 자율적으로 작업하는 에이전트에 최적.

| 모델              | 강점                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| **GPT-5.3 Codex** | 깊은 코딩 파워하우스. 자율 탐색. deep 카테고리와 명시적 오버라이드를 위해 여전히 사용 가능.  |
| **GPT-5.4**       | 높은 지능, 전략적 추론. Oracle, Momus의 기본이며 Prometheus / Atlas의 핵심 폴백. Momus에는 xhigh 변형 사용. |
| **GPT-5.4 Mini**  | 빠르고 강력한 추론. 가벼운 자율 작업에 좋음. quick 카테고리의 기본. |
| **GPT-5-Nano**    | 초저렴, 빠름. 단순 유틸리티 작업에 좋음.                                                        |

### 기타 모델

| 모델                | 강점                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Gemini 3.1 Pro**   | 비주얼/프론트엔드 작업에 탁월. 다른 추론 스타일. `visual-engineering`과 `artistry`의 기본. |
| **Gemini 3 Flash**   | 빠름. 문서 검색과 가벼운 작업에 좋음.                                                                        |
| **GPT-5.4 Mini Fast** | Explore와 Librarian 에이전트의 기본. 매우 빠른 추론 가능 mini 모델. |
| **MiniMax M2.7**     | 빠르고 똑똑. OpenCode Go와 OpenCode Zen 유틸리티 폴백 체인에서 사용. |
| **MiniMax M2.7 Highspeed** | 가장 빠른 가용 MiniMax 경로를 선호하는 유틸리티 폴백 체인에서 사용되는 OpenCode 카탈로그의 고속 항목. |

### OpenCode Go

OpenCode 인프라를 통해 중국 프론티어 모델에 신뢰성 있게 액세스할 수 있는 프리미엄 구독 티어(월 $10).

**사용 가능한 모델:**

| 모델                     | 사용 사례                                                              |
| ------------------------ | --------------------------------------------------------------------- |
| **opencode-go/kimi-k2.5** | 비전 가능, Claude 유사 추론. Sisyphus, Atlas, Sisyphus-Junior, Multimodal Looker가 사용. |
| **opencode-go/glm-5**     | 텍스트 전용 오케스트레이션 모델. Oracle, Prometheus, Metis, Momus가 사용. |
| **opencode-go/minimax-m2.7** | 초저렴, 빠른 응답. Atlas, Sisyphus-Junior, 유틸리티 작업의 Explore와 Librarian 폴백이 사용. |
| **opencode-go/minimax-m2.7-highspeed** | GPT-5.4 Mini Fast가 가용하지 않을 때 Explore와 Librarian의 보조 폴백으로 사용되는 더 빠른 OpenCode Go MiniMax 항목. |

**언제 사용되는가:**

OpenCode Go 모델은 폴백 체인 전반에 걸쳐 중간 옵션으로 등장합니다. 에이전트에 따라 GPT 앞, GPT 뒤, 또는 더 저렴한 유틸리티 경로 전 마지막 구조화 모델 폴백 역할을 할 수 있습니다.

**Go 전용 시나리오:**

`k2p5`(유료 Kimi K2.5)와 `glm-5` 같은 일부 모델 식별자는 특정 지역에서 OpenCode Go 구독을 통해서만 가용할 수 있습니다. 이 짧은 식별자로 설정되면, 시스템은 먼저 opencode-go 프로바이더를 통해 해석합니다.

### 무료 티어 폴백에 대해

소스 코드나 로그에서 `kimi-k2.5-free`, `minimax-m2.7`, `minimax-m2.7-highspeed`, `big-pickle`(GLM 4.6) 같은 모델 이름을 볼 수 있습니다. 이는 폴백 체인의 프로바이더별 또는 속도 최적화 항목입니다.

설정할 필요는 없습니다. 모든 유료 구독을 가지고 있지 않아도 우아하게 저하되도록 시스템에 포함되어 있습니다. 유료 버전이 있다면 항상 유료 버전이 우선됩니다.

---

## 작업 카테고리

에이전트가 작업을 위임할 때, 모델 이름이 아니라 **카테고리**를 선택합니다. 카테고리는 자동으로 적절한 모델에 매핑됩니다.

| 카테고리             | 사용 시점                  | 폴백 체인                                    |
| -------------------- | -------------------------- | -------------------------------------------- |
| `visual-engineering` | 프론트엔드, UI, CSS, 디자인 | google\|github-copilot\|opencode\|vercel/gemini-3.1-pro (high) → zai-coding-plan\|opencode\|vercel/glm-5 → anthropic\|github-copilot\|opencode\|vercel/claude-opus-4-7 (max) → opencode-go\|vercel/glm-5 → kimi-for-coding/k2p5 |
| `ultrabrain`         | 최대 추론이 필요할 때       | openai\|opencode\|vercel/gpt-5.4 (xhigh) → google\|github-copilot\|opencode\|vercel/gemini-3.1-pro (high) → anthropic\|github-copilot\|opencode\|vercel/claude-opus-4-7 (max) → opencode-go\|vercel/glm-5 |
| `deep`               | 깊은 코딩, 복잡한 로직     | openai\|github-copilot\|venice\|opencode\|vercel/gpt-5.4 (medium) → anthropic\|github-copilot\|opencode\|vercel/claude-opus-4-7 (max) → google\|github-copilot\|opencode\|vercel/gemini-3.1-pro (high) |
| `artistry`           | 창의적, 새로운 접근         | google\|github-copilot\|opencode\|vercel/gemini-3.1-pro (high) → anthropic\|github-copilot\|opencode\|vercel/claude-opus-4-7 (max) → openai\|github-copilot\|opencode\|vercel/gpt-5.4 |
| `quick`              | 단순, 빠른 작업             | openai\|github-copilot\|opencode\|vercel/gpt-5.4-mini → anthropic\|github-copilot\|opencode\|vercel/claude-haiku-4-5 → google\|github-copilot\|opencode\|vercel/gemini-3-flash → opencode-go\|vercel/minimax-m2.7 → opencode\|vercel/gpt-5-nano |
| `unspecified-high`   | 일반 복잡 작업              | anthropic\|github-copilot\|opencode\|vercel/claude-opus-4-7 (max) → openai\|github-copilot\|opencode\|vercel/gpt-5.4 (high) → zai-coding-plan\|opencode\|vercel/glm-5 → kimi-for-coding/k2p5 → opencode-go\|vercel/glm-5 → opencode\|vercel/kimi-k2.5 → opencode\|moonshotai\|moonshotai-cn\|firmware\|ollama-cloud\|aihubmix\|vercel/kimi-k2.5 |
| `unspecified-low`    | 일반 표준 작업              | anthropic\|github-copilot\|opencode\|vercel/claude-sonnet-4-6 → openai\|opencode\|vercel/gpt-5.3-codex (medium) → opencode-go\|vercel/kimi-k2.5 → google\|github-copilot\|opencode\|vercel/gemini-3-flash → opencode-go\|vercel/minimax-m2.7 |
| `writing`            | 텍스트, 문서, 산문          | google\|github-copilot\|opencode\|vercel/gemini-3-flash → opencode-go\|vercel/kimi-k2.5 → anthropic\|github-copilot\|opencode\|vercel/claude-sonnet-4-6 → opencode-go\|vercel/minimax-m2.7 |

에이전트가 카테고리에 작업을 디스패치하는 방식은 [오케스트레이션 시스템 가이드](./orchestration.md)를 참고하세요.

### Vercel AI Gateway 폴백 커버리지

`src/shared/model-requirements.ts`는 이제 에이전트와 카테고리 체인 양쪽의 거의 모든 게이트웨이 호환 폴백 항목에 `vercel`을 포함합니다. 다른 모델 패밀리가 아니라, 나열된 모델 ID에 대한 보편적 추가 프로바이더 경로로 다루세요. 위의 어떤 행이 프로바이더 집합에 `|vercel`을 보이면, 그것이 현재 진실의 원천 런타임 폴백이지 docs 전용 편의 별칭이 아닙니다.

---

## 커스터마이즈

### 예시 설정

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/oh-my-opencode.schema.json",

  "agents": {
    // Main orchestrator: Claude Opus or Kimi K2.5 work best
    "sisyphus": {
      "model": "kimi-for-coding/k2p5",
      "ultrawork": { "model": "anthropic/claude-opus-4-7", "variant": "max" },
    },

    // Research agents: cheaper models are fine
    "librarian": { "model": "google/gemini-3-flash" },
    "explore": { "model": "github-copilot/grok-code-fast-1" },

    // Architecture consultation: GPT or Claude Opus
    "oracle": { "model": "openai/gpt-5.4", "variant": "high" },

    // Prometheus inherits sisyphus model; just add prompt guidance
    "prometheus": {
      "prompt_append": "Leverage deep & quick agents heavily, always in parallel.",
    },
  },

  "categories": {
    "quick": { "model": "opencode/gpt-5-nano" },
    "unspecified-low": { "model": "anthropic/claude-sonnet-4-6" },
    "unspecified-high": { "model": "anthropic/claude-opus-4-7", "variant": "max" },
    "visual-engineering": {
      "model": "google/gemini-3.1-pro",
      "variant": "high",
    },
    "writing": { "model": "google/gemini-3-flash" },
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
}
```

가용 모델을 보려면 `opencode models`를 실행하고, 프로바이더를 인증하려면 `opencode auth login`을 실행하세요.

### 안전 vs 위험한 오버라이드

**안전** — 같은 성격 유형:

- Sisyphus: Opus → Sonnet, Kimi K2.5, GLM 5 (모두 소통적 모델)
- Prometheus: Opus → GPT-5.4 (자동으로 GPT 프롬프트로 전환)
- Atlas: Claude Sonnet 4.6 → GPT-5.4 (자동으로 GPT 프롬프트로 전환)

**위험** — 성격 불일치:

- Sisyphus → 구형 GPT 모델: **여전히 잘 안 맞음. GPT-5.4가 유일한 전용 GPT 프롬프트 경로.**
- Hephaestus → Claude: **Codex의 자율적 스타일을 위해 만들어짐. Claude는 이를 복제할 수 없음.**
- Explore → Opus: **막대한 비용 낭비. Explore는 지능이 아니라 속도가 필요.**
- Librarian → Opus: **동일. 문서 검색은 Opus 수준의 추론이 필요 없음.**

### 모델 해석 동작 방식

각 에이전트는 폴백 체인을 가집니다. 시스템은 연결된 프로바이더를 통해 가용한 것을 찾을 때까지 우선순위 순으로 모델을 시도합니다. 모델당 프로바이더를 설정할 필요가 없습니다. 그냥 인증(`opencode auth login`)하면 시스템이 어떤 모델이 어디서 가용한지 알아냅니다.

코어 에이전트 탭 사이클링은 주입된 런타임 order 필드를 통해 결정적입니다. 고정 우선순위 순서는 Sisyphus(order: 1), Hephaestus(order: 2), Prometheus(order: 3), Atlas(order: 4)이고, 그 다음 나머지 에이전트가 따릅니다.

명시적 설정이 항상 이깁니다. 에이전트에 특정 모델을 설정하면, 해석 데이터가 콜드일 때도 그 선택이 우선합니다.

Variant와 `reasoningEffort` 오버라이드는 모델 지원 값으로 정규화되므로, 크로스 프로바이더 오버라이드는 강하게 실패하는 대신 우아하게 저하됩니다.

모델 기능은 models.dev 기반이며, 새로고침 가능한 캐시와 기능 진단을 가집니다. 캐시를 갱신하려면 `bunx oh-my-opencode refresh-model-capabilities`를 사용하거나, 시작 시 새로고침을 위해 `model_capabilities.auto_refresh_on_start`를 설정하세요.

에이전트가 실제로 어떤 모델을 사용할지 보려면 `bunx oh-my-opencode doctor`를 실행하세요. 이는 현재 인증과 설정에 기반한 효과적인 모델 해석을 보여줍니다.

```
Agent Request → User Override (if configured) → Fallback Chain → System Default
```

### 파일 기반 프롬프트

`prompt` 필드에 `file://` URL을 사용해 외부 파일에서 에이전트 시스템 프롬프트를 로드하거나, `prompt_append`로 추가 컨텐츠를 덧붙일 수 있습니다. `prompt_append` 필드는 카테고리에서도 동작합니다.

```jsonc
{
  "agents": {
    "sisyphus": {
      "prompt": "file:///path/to/custom-prompt.md"
    },
    "oracle": {
      "prompt_append": "file:///path/to/additional-context.md"
    }
  },
  "categories": {
    "deep": {
      "prompt_append": "file:///path/to/deep-category-append.md"
    }
  }
}
```

파일 컨텐츠는 런타임에 로드되어 에이전트의 시스템 프롬프트에 주입됩니다. 홈 디렉터리에 대한 `~` 확장과 상대 `file://` 경로를 지원합니다.

---

## 함께 보기

- [설치 가이드](./installation.md) — 설정과 인증
- [오케스트레이션 시스템 가이드](./orchestration.md) — 에이전트가 카테고리에 작업을 디스패치하는 방법
- [설정 레퍼런스](../reference/configuration.md) — 전체 설정 옵션
- [`src/shared/model-requirements.ts`](../../src/shared/model-requirements.ts) — 폴백 체인의 진실의 원천
