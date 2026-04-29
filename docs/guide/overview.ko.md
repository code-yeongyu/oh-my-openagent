# Oh My OpenAgent란?

Oh My OpenAgent는 OpenCode를 위한 멀티 모델 에이전트 오케스트레이션 하네스입니다. 단일 AI 에이전트를 실제로 코드를 출시하는 협업 개발 팀으로 변환합니다.

Claude에 종속되지 않습니다. OpenAI에 종속되지 않습니다. 어느 누구에게도 종속되지 않습니다.

더 나은 결과, 더 저렴한 모델, 진정한 오케스트레이션만 있을 뿐입니다.

---

## 빠른 시작

### 설치

이것을 LLM 에이전트 세션에 붙여넣으세요.

```
Install and configure oh-my-openagent by following the instructions here:
https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/refs/heads/dev/docs/guide/installation.md
```

또는 수동 설정, 프로바이더 인증 및 트러블슈팅을 위해 전체 [설치 가이드](./installation.md)를 읽어보세요.

### 첫 번째 작업

설치되면, 그냥 입력하세요:

```
ultrawork
```

그게 전부입니다. 에이전트가 모든 것을 알아서 처리합니다 — 코드베이스를 탐색하고, 패턴을 리서치하고, 기능을 구현하고, 진단으로 검증합니다. 완료될 때까지 계속 작업합니다.

더 많은 제어를 원하시나요? **Tab**을 눌러 [Prometheus 모드](./orchestration.md)에 진입해 인터뷰 기반 계획을 세운 뒤, 전체 오케스트레이션을 위해 `/start-work`를 실행하세요.

---

## 철학: 자유로워지기

우리는 이것을 "Claude Code on steroids"라고 부르곤 했습니다. 그건 잘못이었습니다.

이건 Claude Code를 더 좋게 만드는 것이 아닙니다. 하나의 모델, 하나의 프로바이더, 하나의 작업 방식만으로 충분하다는 생각으로부터 자유로워지는 것입니다. Anthropic은 당신을 락인하길 원합니다. OpenAI도 락인하길 원합니다. 모두가 락인하길 원합니다.

Oh My OpenAgent는 그 게임을 하지 않습니다. 모델 전반에 걸쳐 오케스트레이션하며, 적합한 작업에 적합한 두뇌를 골라줍니다. 오케스트레이션은 Claude. 깊은 추론은 GPT. 프론트엔드는 Gemini. 빠른 작업은 GPT-5.4 Mini. 모두 자동으로 함께 동작합니다.

---

## 동작 방식: 에이전트 오케스트레이션

하나의 에이전트가 모든 것을 다 하는 대신, Oh My OpenAgent는 작업 유형에 따라 **서로에게 위임하는 전문 에이전트들**을 사용합니다.

**아키텍처:**

```
User Request
    ↓
[Intent Gate] — 실제로 원하는 것을 분류
    ↓
[Sisyphus] — 메인 오케스트레이터, 계획하고 위임
    ↓
    ├─→ [Prometheus] — 전략적 계획 (인터뷰 모드)
    ├─→ [Atlas] — Todo 오케스트레이션 및 실행
    ├─→ [Oracle] — 아키텍처 컨설팅
    ├─→ [Librarian] — 문서/코드 검색
    ├─→ [Explore] — 빠른 코드베이스 grep
    └─→ [Category-based agents] — 작업 유형별 전문 에이전트
```

Sisyphus가 서브에이전트에게 위임할 때, 모델 이름을 고르지 않습니다. **카테고리** — `visual-engineering`, `ultrabrain`, `deep`, `artistry`, `quick`, `unspecified-low`, `unspecified-high`, `writing` — 를 고릅니다. 카테고리는 자동으로 적합한 모델에 매핑됩니다. 당신은 아무것도 만질 필요가 없습니다.

에이전트들이 어떻게 협업하는지 깊이 알아보려면 [오케스트레이션 시스템 가이드](./orchestration.md)를 참고하세요.

---

## 에이전트 소개

### Sisyphus: 규율의 에이전트

그리스 신화의 이름을 따왔습니다. 매일 바위를 굴립니다. 멈추지 않습니다. 포기하지 않습니다.

Sisyphus는 당신의 메인 오케스트레이터입니다. 계획하고, 전문가들에게 위임하고, 공격적인 병렬 실행으로 작업을 완료까지 밀고 갑니다. 중간에 멈추지 않습니다. 산만해지지 않습니다. 끝냅니다.

**권장 모델:**

- **Claude Opus 4.7** — 전반적으로 최고의 경험. Sisyphus는 Claude에 최적화된 프롬프트로 만들어졌습니다.
- **Kimi K2.5** — 훌륭한 Claude 유사 대안. 많은 사용자가 이 조합만 단독으로 사용합니다.
- **GLM 5** — 견고한 옵션, 특히 Z.ai를 통해.

Sisyphus는 Claude Opus 4.7, Kimi K2.5, GLM 5에서 가장 잘 동작합니다. GPT-5.4는 이제 전용 프롬프트 경로를 갖고 있지만, 구형 GPT 모델은 여전히 잘 맞지 않으며 대신 Hephaestus로 라우팅되어야 합니다.

### Hephaestus: 정통한 장인

의도적인 아이러니로 이름이 붙여졌습니다. Anthropic은 이 프로젝트 때문에 OpenCode가 자기네 API를 사용하지 못하도록 차단했습니다. 그래서 팀은 자율적인 GPT 네이티브 에이전트를 대신 만들었습니다.

Hephaestus는 GPT-5.4에서 동작합니다. 그에게는 레시피가 아니라 목표를 주세요. 그는 코드베이스를 탐색하고, 패턴을 리서치하고, 손을 잡아주지 않아도 처음부터 끝까지 실행합니다. 그는 특권이 아니라 필요로부터 태어난 정통한 장인입니다.

깊은 아키텍처 추론, 여러 파일에 걸친 복잡한 디버깅, 또는 도메인 간 지식 합성이 필요할 때 Hephaestus를 사용하세요. 작업이 GPT-5.4의 특정한 강점을 요구할 때 명시적으로 그에게 전환하세요.

**왜 바닐라 Codex CLI를 능가하는가:**

- **멀티 모델 오케스트레이션.** 순수 Codex는 단일 모델입니다. OmO는 다양한 작업을 자동으로 다양한 모델로 라우팅합니다. 깊은 추론은 GPT. 프론트엔드는 Gemini. 속도는 GPT-5.4 Mini. 적합한 작업에 적합한 두뇌.
- **백그라운드 에이전트.** 5개 이상의 에이전트를 병렬로 실행. Codex가 단순히 할 수 없는 일입니다. 한 에이전트가 코드를 작성하는 동안 다른 에이전트는 패턴을 리서치하고, 또 다른 에이전트는 문서를 확인합니다. 진짜 개발 팀처럼.
- **카테고리 시스템.** 작업이 모델 이름이 아닌 의도로 라우팅됩니다. `visual-engineering`은 Gemini로. `ultrabrain`은 GPT-5.4 xhigh로. `deep`은 GPT-5.4로. `artistry`는 Gemini로. `quick`은 GPT-5.4 Mini로. `unspecified-low`는 빠르고 저렴한 모델로. `unspecified-high`는 Claude Opus로. `writing`은 산문에 최적화된 모델로. 수동 저글링이 없습니다.
- **축적된 지혜.** 서브에이전트는 이전 결과로부터 배웁니다. 작업 1에서 발견한 컨벤션이 작업 5로 전달됩니다. 초기에 한 실수가 반복되지 않습니다. 시스템은 일하면서 더 똑똑해집니다.

### Prometheus: 전략적 계획자

Prometheus는 진짜 엔지니어처럼 당신을 인터뷰합니다. 명확화 질문을 합니다. 스코프와 모호함을 식별합니다. 단 한 줄의 코드도 건드리기 전에 상세한 계획을 세웁니다.

Prometheus 모드로 들어가려면 **Tab**을 누르거나, Sisyphus에서 `@plan "your task"`를 입력하세요.

### Atlas: 지휘자

Atlas는 Prometheus의 계획을 실행합니다. 작업을 전문 서브에이전트에 분배합니다. 작업 간 학습을 축적합니다. 완료를 독립적으로 검증합니다.

가장 최신 계획에서 Atlas를 활성화하려면 `/start-work`를 실행하세요.

### Oracle: 컨설턴트

아키텍처 결정과 복잡한 디버깅을 위한 읽기 전용의 고지능 컨설턴트입니다. 익숙하지 않은 패턴, 보안 우려, 다중 시스템 간 트레이드오프에 직면했을 때 Oracle에 자문하세요.

### 조연들

- **Metis** — 갭 분석가. 계획이 확정되기 전에 Prometheus가 놓친 것을 포착합니다.
- **Momus** — 무자비한 리뷰어. 명확성, 검증 가능성, 컨텍스트 기준에 대해 계획을 검증합니다.
- **Explore** — 빠른 코드베이스 grep. 속도 중심 모델을 사용해 패턴을 발견합니다.
- **Librarian** — 문서 및 OSS 코드 검색. 라이브러리 API와 베스트 프랙티스를 최신으로 유지합니다.
- **Multimodal Looker** — 비전 및 스크린샷 분석.

---

## 작업 모드

### Ultrawork 모드: 게으른 사람을 위해

`ultrawork` 또는 그냥 `ulw`를 입력하세요. 그게 전부입니다.

에이전트가 모든 것을 알아서 처리합니다. 코드베이스를 탐색합니다. 패턴을 리서치합니다. 기능을 구현합니다. 진단으로 검증합니다. 완료될 때까지 계속 작업합니다.

이것은 "그냥 해줘" 모드입니다. 완전 자동. 깊이 생각할 필요가 없습니다. 에이전트가 당신을 위해 깊이 생각하니까요.

### Prometheus 모드: 정밀함을 위해

Prometheus 모드로 진입하려면 **Tab**을 누르세요.

Prometheus는 진짜 엔지니어처럼 당신을 인터뷰합니다. 명확화 질문을 합니다. 스코프와 모호함을 식별합니다. 단 한 줄의 코드도 건드리기 전에 상세한 계획을 세웁니다.

그런 다음 `/start-work`를 실행하면 Atlas가 인계받습니다. 작업이 전문 서브에이전트들에 분배됩니다. 각 완료가 독립적으로 검증됩니다. 학습이 작업 간에 축적됩니다. 진행 상황이 세션 간에 추적됩니다.

며칠짜리 프로젝트, 중요한 프로덕션 변경, 복잡한 리팩토링, 또는 문서화된 결정 흔적을 원할 때 Prometheus를 사용하세요.

---

## 에이전트-모델 매칭

서로 다른 에이전트는 서로 다른 모델에서 가장 잘 동작합니다. Oh My OpenAgent는 자동으로 최적의 모델을 할당하지만, 모든 것을 커스터마이즈할 수 있습니다.

### 기본 설정

모델은 설치 시점에 자동으로 설정됩니다. 인터랙티브 인스톨러는 어떤 프로바이더를 가지고 있는지 묻고, 각 에이전트와 카테고리에 대해 최적의 모델 할당을 생성합니다.

런타임에 폴백 체인은 선호하는 프로바이더가 다운되더라도 작업이 계속되도록 보장합니다. 각 에이전트는 프로바이더 우선순위 체인을 가집니다. 시스템은 사용 가능한 모델을 찾을 때까지 순서대로 프로바이더를 시도합니다.

### 사용자 정의 모델 설정

설정에서 특정 에이전트나 카테고리를 오버라이드할 수 있습니다.

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/oh-my-openagent.schema.json",

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
  },

  "categories": {
    // Frontend/UI work: Gemini dominates visual tasks
    "visual-engineering": {
      "model": "google/gemini-3.1-pro",
      "variant": "high",
    },

    // Hard logic and architecture: GPT-5.4 xhigh
    "ultrabrain": { "model": "openai/gpt-5.4", "variant": "xhigh" },

    // Autonomous research and execution
    "deep": { "model": "openai/gpt-5.4", "variant": "high" },

    // Creative and design work
    "artistry": { "model": "google/gemini-3.1-pro", "variant": "high" },

    // Quick tasks: fast and cheap
    "quick": { "model": "openai/gpt-5.4-mini" },

    // Low-effort fallback: cheapest available
    "unspecified-low": { "model": "openai/gpt-5.4-mini" },

    // High-effort fallback: best available
    "unspecified-high": { "model": "anthropic/claude-opus-4-7", "variant": "max" },

    // Prose and documentation
    "writing": { "model": "anthropic/claude-opus-4-7", "variant": "high" },
  },
}
```

### 모델 패밀리

**Claude 계열 모델** (지시 따르기, 구조화된 출력):

- Claude Opus 4.7, Claude Haiku 4.5
- Kimi K2.5 — Claude와 매우 유사하게 동작
- GLM 5 — Claude 유사 동작, 폭넓은 작업에 적합

**GPT 모델** (명시적 추론, 원칙 기반):

- GPT-5.4 — 깊은 코딩 파워하우스, Hephaestus에 필요하며 Oracle의 기본
- GPT-5.4 Mini — 빠르고 저렴한 유틸리티 작업

**다른 동작의 모델**:

- Gemini 3.1 Pro — 비주얼/프론트엔드 작업에 탁월
- MiniMax M2.7 / M2.7-highspeed — 유틸리티 작업을 위한 빠르고 똑똑한 모델
- Grok Code Fast 1 — 코드 grep/검색에 최적화

각 에이전트에 어떤 모델이 가장 잘 맞는지, 안전한 오버라이드와 위험한 오버라이드, 프로바이더 우선순위 체인에 대한 전체 세부 사항은 [에이전트-모델 매칭 가이드](./agent-model-matching.md)를 참고하세요.

---

## 왜 순수 Claude Code보다 더 나은가

Claude Code는 좋습니다. 하지만 그것은 단일 에이전트가 단일 모델을 실행하며 모든 것을 혼자 하는 것입니다.

Oh My OpenAgent는 그것을 협업 팀으로 변환합니다.

**병렬 실행.** Claude Code는 한 번에 한 가지를 처리합니다. OmO는 백그라운드 에이전트를 병렬로 실행합니다 — 리서치, 구현, 검증이 동시에 일어납니다. 1명이 아닌 5명의 엔지니어가 있는 것과 같습니다.

**해시 앵커 편집.** Claude Code의 edit 도구는 모델이 라인을 정확히 재현할 수 없을 때 실패합니다. OmO의 `LINE#ID` 컨텐츠 해싱은 적용 전에 모든 편집을 검증합니다. Grok Code Fast 1은 이 변경만으로 6.7%에서 68.3% 성공률로 올라갔습니다.

**Intent Gate.** Claude Code는 당신의 프롬프트를 그대로 실행합니다. OmO는 먼저 당신의 진짜 의도를 분류합니다 — 리서치, 구현, 조사, 수정 — 그런 다음 그에 따라 라우팅합니다. 오해석 감소, 더 나은 결과.

**LSP + AST 도구.** 워크스페이스 수준의 rename, go-to-definition, find-references, 빌드 전 진단, AST 인식 코드 재작성. 바닐라 Claude Code에는 없는 IDE 정밀도.

**임베디드 MCP가 있는 스킬.** 각 스킬은 작업에 스코프된 자체 MCP 서버를 가져옵니다. 모든 도구로 부풀어 오르는 대신 컨텍스트 윈도우가 깨끗하게 유지됩니다.

**규율 강제.** Todo enforcer는 게으른 에이전트를 다시 일하도록 끌어옵니다. Comment checker는 AI slop을 제거합니다. Ralph Loop는 100% 완료될 때까지 계속합니다. 시스템은 에이전트가 게으름 피우는 것을 허락하지 않습니다.

**근본적인 우위.** 모델마다 기질이 다릅니다. Claude는 깊이 생각합니다. GPT는 아키텍처적으로 추론합니다. Gemini는 시각화합니다. Haiku는 빠르게 움직입니다. 단일 모델 도구는 모든 작업에 대해 하나의 성격을 골라야 하게 만듭니다. Oh My OpenAgent는 모든 모델을 활용해 작업 유형으로 라우팅합니다. 이것은 임시 해결책이 아닙니다 — 모델이 더욱 전문화됨에 따라 의미 있는 유일한 아키텍처입니다. 멀티 모델 오케스트레이션과 단일 모델 한계 사이의 격차는 매월 벌어지고 있습니다. 우리는 그 미래에 베팅하고 있습니다.

---

## Intent Gate

어떤 요청에 대해서든 행동하기 전에, Sisyphus는 당신의 진짜 의도를 분류합니다.

당신은 리서치를 요청하고 있나요? 구현을? 조사를? 수정을? Intent Gate는 단지 입력한 글자가 아닌, 당신이 실제로 원하는 것을 알아냅니다. 이는 에이전트가 컨텍스트, 뉘앙스, 그리고 요청 뒤의 진짜 목표를 이해함을 의미합니다.

Claude Code에는 이것이 없습니다. 당신의 프롬프트를 받아 그대로 실행합니다. Oh My OpenAgent는 먼저 생각하고, 그 다음에 행동합니다.

---

## 다음은?

- **[설치 가이드](./installation.md)** — 완전한 설정 안내, 프로바이더 인증, 트러블슈팅
- **[오케스트레이션 가이드](./orchestration.md)** — 에이전트 협업, Prometheus로 계획, Atlas로 실행에 대한 심층 안내
- **[에이전트-모델 매칭 가이드](./agent-model-matching.md)** — 각 에이전트에 어떤 모델이 가장 잘 맞는지와 커스터마이즈 방법
- **[설정 레퍼런스](../reference/configuration.md)** — 예제와 함께하는 전체 설정 옵션
- **[기능 레퍼런스](../reference/features.md)** — 완전한 기능 문서
- **[매니페스토](../manifesto.md)** — 프로젝트 뒤의 철학

---

**시작할 준비가 되셨나요?** `ultrawork`를 입력하고 협업 AI 팀이 무엇을 할 수 있는지 보세요.
