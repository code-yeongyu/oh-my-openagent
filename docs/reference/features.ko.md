# Oh-My-OpenAgent 기능 레퍼런스

## 에이전트(Agents)

Oh-My-OpenAgent는 11개의 특화된 AI 에이전트를 제공합니다. 각 에이전트는 고유한 전문성, 최적화된 모델, 그리고 도구 권한을 가집니다.

### 코어 에이전트(Core Agents)

코어 에이전트 탭 순환은 주입된 런타임 order 필드를 통해 결정론적으로 동작합니다. 고정된 우선순위는 Sisyphus (order: 1), Hephaestus (order: 2), Prometheus (order: 3), Atlas (order: 4)입니다. 나머지 에이전트는 이 안정적인 코어 순서 뒤에 위치합니다.

| 에이전트              | 모델               | 목적                                                                                                                                                                                                                                                                                                                                                              |
| --------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sisyphus**          | `claude-opus-4-7`  | 기본 오케스트레이터(orchestrator). 공격적인 병렬 실행으로 특화된 서브에이전트를 활용해 복잡한 작업을 계획·위임·실행합니다. Todo 기반 워크플로우와 확장 사고(extended thinking, 32k 예산)를 사용합니다. Fallback: `opencode-go/kimi-k2.5` → `kimi-for-coding/k2p5` → `opencode\|moonshotai\|moonshotai-cn\|firmware\|ollama-cloud\|aihubmix/kimi-k2.5` → `openai\|github-copilot\|opencode/gpt-5.4 (medium)` → `zai-coding-plan\|opencode/glm-5` → `opencode/big-pickle`. |
| **Hephaestus**        | `gpt-5.4`          | 정통 장인(The Legitimate Craftsman). AmpCode의 deep 모드에서 영감을 받은 자율 심층 작업자. 행동에 앞서 철저히 조사하는 목표 지향 실행. 코드베이스 패턴을 탐색하고, 조기 종료 없이 끝까지 작업을 완수합니다. 그리스 신화의 대장장이·공예의 신에서 이름을 따왔습니다. GPT 호환 프로바이더가 필요합니다. |
| **Oracle**            | `gpt-5.4`          | 아키텍처 결정, 코드 리뷰, 디버깅. 뛰어난 논리적 추론과 깊이 있는 분석을 갖춘 읽기 전용 컨설턴트. AmpCode에서 영감을 받았습니다. Fallback: `google\|github-copilot\|opencode/gemini-3.1-pro (high)` → `anthropic\|github-copilot\|opencode/claude-opus-4-7 (max)` → `opencode-go/glm-5`. |
| **Librarian**         | `gpt-5.4-mini-fast` | 다중 레포 분석, 문서 조회, OSS 구현 예시. 깊은 코드베이스 이해를 바탕으로 한 근거 기반 답변. Fallback: `opencode-go/minimax-m2.7-highspeed` → `opencode-go/minimax-m2.7` → `anthropic\|opencode/claude-haiku-4-5` → `openai\|opencode/gpt-5.4-nano`. |
| **Explore**           | `gpt-5.4-mini-fast` | 빠른 코드베이스 탐색 및 문맥 기반 grep. Fallback: `opencode-go/minimax-m2.7-highspeed` → `opencode-go/minimax-m2.7` → `anthropic\|opencode/claude-haiku-4-5` → `openai\|opencode/gpt-5.4-nano`. |
| **Multimodal-Looker** | `gpt-5.4`          | 시각 콘텐츠 전문가. PDF, 이미지, 다이어그램을 분석해 정보를 추출합니다. Fallback: `opencode-go/kimi-k2.5` → `zai-coding-plan/glm-4.6v` → `openai\|github-copilot\|opencode/gpt-5-nano`. |

### 기획 에이전트(Planning Agents)

| 에이전트       | 모델              | 목적                                                                                                                                            |
| -------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Prometheus** | `claude-opus-4-7` | 인터뷰 모드를 갖춘 전략 기획자. 반복적 질문을 통해 상세한 작업 계획을 수립합니다. Fallback: `openai\|github-copilot\|opencode/gpt-5.4 (high)` → `opencode-go/glm-5` → `google\|github-copilot\|opencode/gemini-3.1-pro`. |
| **Metis**      | `claude-opus-4-7` | 계획 컨설턴트 — 사전 기획 분석. 숨겨진 의도, 모호함, AI 실패 지점을 식별합니다. Fallback: `openai\|github-copilot\|opencode/gpt-5.4 (high)` → `opencode-go/glm-5` → `kimi-for-coding/k2p5`. |
| **Momus**      | `gpt-5.4`         | 계획 리뷰어 — 명확성, 검증 가능성, 완결성 기준에 부합하는지 계획을 검증합니다. Fallback: `anthropic\|github-copilot\|opencode/claude-opus-4-7 (max)` → `google\|github-copilot\|opencode/gemini-3.1-pro (high)` → `opencode-go/glm-5`. |

### 오케스트레이션 에이전트(Orchestration Agents)

| 에이전트            | 모델                   | 목적                                                                                                                                                                                       |
| ------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Atlas**           | `claude-sonnet-4-6`    | Todo 리스트 오케스트레이터. todo 항목을 관리하고 작업을 조율하면서 계획된 작업을 체계적으로 실행합니다. Fallback: `opencode-go/kimi-k2.5` → `openai\|github-copilot\|opencode/gpt-5.4 (medium)` → `opencode-go/minimax-m2.7`. |
| **Sisyphus-Junior** | _(카테고리 의존)_      | 카테고리에 의해 스폰되는 실행자. 작업 카테고리(visual-engineering, quick, deep 등)에 따라 모델이 자동 선택됩니다. 내장 일반 fallback 체인은 `anthropic\|github-copilot\|opencode/claude-sonnet-4-6` → `opencode-go/kimi-k2.5` → `openai\|github-copilot\|opencode/gpt-5.4 (medium)` → `opencode-go/minimax-m2.7` → `opencode/big-pickle`. |

### 에이전트 호출하기

메인 에이전트가 자동으로 이들을 호출하지만, 명시적으로 지정해 호출할 수도 있습니다.

```
Ask @oracle to review this design and propose an architecture
Ask @librarian how this is implemented - why does the behavior keep changing?
Ask @explore for the policy on this feature
```

### 도구 제한

| 에이전트          | 제한 사항                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------- |
| oracle            | 읽기 전용: 쓰기·편집·위임 불가 (차단: write, edit, task, call_omo_agent)                 |
| librarian         | 쓰기·편집·위임 불가 (차단: write, edit, task, call_omo_agent)                            |
| explore           | 쓰기·편집·위임 불가 (차단: write, edit, task, call_omo_agent)                            |
| multimodal-looker | 허용 목록: `read` 만 가능                                                                |
| atlas             | 위임 불가 (차단: task, call_omo_agent)                                                   |
| momus             | 쓰기·편집·위임 불가 (차단: write, edit, task)                                            |

### 백그라운드 에이전트(Background Agents)

에이전트를 백그라운드로 돌리며 작업을 계속 진행할 수 있습니다.

- GPT가 디버깅하는 동안 Claude는 다른 접근을 시도
- Gemini가 프론트엔드를 작성하는 동안 Claude는 백엔드 처리
- 대규모 병렬 검색을 던져두고 구현을 계속하다가, 결과가 준비되면 사용

```
# 백그라운드로 실행
task(subagent_type="explore", load_skills=[], prompt="Find auth implementations", run_in_background=true)

# 작업 계속...
# 완료 시 시스템이 알림

# 필요할 때 결과 가져오기
background_output(task_id="bg_abc123")
```

#### Tmux를 활용한 시각적 멀티 에이전트

`tmux.enabled`를 활성화하면 백그라운드 에이전트를 분리된 tmux 창(pane)에서 볼 수 있습니다.

```json
{
  "tmux": {
    "enabled": true,
    "layout": "main-vertical"
  }
}
```

tmux 안에서 실행될 때:

- 백그라운드 에이전트가 새 창에서 스폰됨
- 여러 에이전트의 작업을 실시간으로 관찰
- 각 창에 에이전트 출력이 라이브로 표시
- 에이전트 완료 시 자동 정리
- **안정적인 에이전트 순서**: 코어 에이전트 탭 순환은 주입된 런타임 order 필드(Sisyphus: 1, Hephaestus: 2, Prometheus: 3, Atlas: 4)로 결정론적으로 동작

`oh-my-opencode.jsonc`에서 에이전트의 모델, 프롬프트, 권한을 커스터마이즈하세요.

## 카테고리 시스템(Category System)

카테고리는 특정 도메인에 최적화된 에이전트 설정 프리셋입니다. 모든 작업을 단일 AI 에이전트에 위임하기보다는, 작업의 성격에 맞춘 전문가를 호출하는 편이 훨씬 효율적입니다.

### 카테고리란 무엇이며 왜 중요한가

- **카테고리(Category)**: "어떤 종류의 일인가?" (모델, temperature, 프롬프트 마인드셋을 결정)
- **스킬(Skill)**: "어떤 도구와 지식이 필요한가?" (특화된 지식, MCP 도구, 워크플로우를 주입)

이 두 개념을 결합해 `task`를 통해 최적의 에이전트를 생성할 수 있습니다.

### 내장 카테고리

| 카테고리             | 기본 모델                       | 용도                                                                                                                          |
| -------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `visual-engineering` | `google/gemini-3.1-pro`         | 프론트엔드, UI/UX, 디자인, 스타일링, 애니메이션                                                                               |
| `ultrabrain`         | `openai/gpt-5.4` (xhigh)        | 깊이 있는 논리적 추론, 광범위한 분석이 필요한 복잡한 아키텍처 결정                                                            |
| `deep`               | `openai/gpt-5.4` (medium)       | 목표 지향 자율 문제 해결. 행동 전 철저한 조사. 깊은 이해가 필요한 까다로운 문제용.                                            |
| `artistry`           | `google/gemini-3.1-pro` (high)  | 매우 창의적·예술적인 작업, 새로운 아이디어                                                                                    |
| `quick`              | `openai/gpt-5.4-mini`           | 사소한 작업 — 단일 파일 변경, 오타 수정, 간단한 수정                                                                          |
| `unspecified-low`    | `anthropic/claude-sonnet-4-6`   | 다른 카테고리에 맞지 않으며 낮은 노력이 필요한 작업                                                                           |
| `unspecified-high`   | `anthropic/claude-opus-4-7` (max) | 다른 카테고리에 맞지 않으며 높은 노력이 필요한 작업                                                                         |
| `writing`            | `google/gemini-3-flash`         | 문서화, 산문, 기술 문서 작성                                                                                                  |

### 사용법

`task` 도구를 호출할 때 `category` 파라미터를 지정합니다.

```typescript
task({
  category: "visual-engineering",
  prompt: "Add a responsive chart component to the dashboard page",
});
```

### 커스텀 카테고리

플러그인 설정 파일에서 커스텀 카테고리를 정의할 수 있습니다. 이름 변경 전환 기간 동안 `oh-my-openagent.json[c]`와 레거시 `oh-my-opencode.json[c]` 베이스네임이 모두 인식됩니다.

#### 카테고리 설정 스키마

| 필드                | 타입    | 설명                                                                       |
| ------------------- | ------- | -------------------------------------------------------------------------- |
| `description`       | string  | 카테고리 목적의 사람이 읽기 좋은 설명. task 프롬프트에 표시됩니다.         |
| `model`             | string  | 사용할 AI 모델 ID (예: `anthropic/claude-opus-4-7`)                        |
| `variant`           | string  | 모델 변형 (예: `max`, `xhigh`)                                             |
| `temperature`       | number  | 창의성 수준 (0.0 ~ 2.0). 낮을수록 결정론적.                                |
| `top_p`             | number  | 뉴클리어스 샘플링 파라미터 (0.0 ~ 1.0)                                     |
| `prompt_append`     | string  | 이 카테고리가 선택될 때 시스템 프롬프트에 덧붙일 내용                      |
| `thinking`          | object  | Thinking 모델 설정 (`{ type: "enabled", budgetTokens: 16000 }`)            |
| `reasoningEffort`   | string  | 추론 노력 수준 (`low`, `medium`, `high`)                                   |
| `textVerbosity`     | string  | 텍스트 상세도 수준 (`low`, `medium`, `high`)                               |
| `tools`             | object  | 도구 사용 제어 (`{ "tool_name": false }`로 비활성화)                       |
| `maxTokens`         | number  | 최대 응답 토큰 수                                                          |
| `is_unstable_agent` | boolean | 에이전트를 불안정으로 표시 — 모니터링을 위해 백그라운드 모드를 강제       |

#### 설정 예시

```jsonc
{
  "categories": {
    // 1. 새로운 커스텀 카테고리 정의
    "korean-writer": {
      "model": "google/gemini-3-flash",
      "temperature": 0.5,
      "prompt_append": "You are a Korean technical writer. Maintain a friendly and clear tone.",
    },

    // 2. 기존 카테고리 재정의 (모델 변경)
    "visual-engineering": {
      "model": "openai/gpt-5.4",
      "temperature": 0.8,
    },

    // 3. Thinking 모델 설정 및 도구 제한
    "deep-reasoning": {
      "model": "anthropic/claude-opus-4-7",
      "thinking": {
        "type": "enabled",
        "budgetTokens": 32000,
      },
      "tools": {
        "websearch_web_search_exa": false,
      },
    },
  },
}
```

### 위임 실행자로서의 Sisyphus-Junior

카테고리를 사용할 때, **Sisyphus-Junior**라는 특별한 에이전트가 작업을 수행합니다.

- **특징**: 다른 에이전트로 작업을 **재위임**할 수 없습니다.
- **목적**: 무한 위임 루프를 방지하고 할당된 작업에 집중하도록 합니다.

## 고급 설정

### 이름 변경 호환성

발행되는 패키지와 바이너리는 그대로 `oh-my-opencode`입니다. `opencode.json` 내부에서는 호환성 레이어가 이제 `oh-my-openagent` 플러그인 항목을 우선 사용하며, 레거시 `oh-my-opencode` 항목은 경고와 함께 여전히 로드됩니다. 플러그인 설정 파일(`oh-my-openagent.json[c]` 또는 레거시 `oh-my-opencode.json[c]`)은 전환 기간 동안 인식됩니다. 레거시 패키지명 경고를 확인하려면 `bunx oh-my-opencode doctor`를 실행하세요.

### Fallback 모델

평범한 모델 문자열과 모델별 객체를 혼합한 배열로 에이전트별 fallback 체인을 설정합니다.

```jsonc
{
  "agents": {
    "sisyphus": {
      "fallback_models": [
        "opencode/glm-5",
        { "model": "openai/gpt-5.4", "variant": "high" },
        { "model": "anthropic/claude-sonnet-4-6", "thinking": { "type": "enabled", "budgetTokens": 64000 } }
      ]
    }
  }
}
```

모델에 오류가 발생하면 런타임은 설정된 fallback 배열을 따라 이동할 수 있습니다. 객체 항목을 사용하면 모델 이름만 바꾸는 대신 백업 모델 자체를 튜닝할 수 있습니다.

### 파일 기반 프롬프트

`prompt` 필드에 `file://` URL을 사용해 외부 파일에서 에이전트 시스템 프롬프트를 로드하거나, `prompt_append`로 추가 내용을 덧붙일 수 있습니다. `prompt_append` 필드는 카테고리에서도 동작합니다.

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

홈 디렉토리에 대한 `~` 확장과 상대 `file://` 경로를 지원합니다.

유용한 활용처:
- 설정과 별도로 프롬프트를 버전 관리
- 프로젝트 간 프롬프트 공유
- 설정 파일을 간결하게 유지
- 기본 프롬프트를 중복하지 않고 카테고리별 컨텍스트 추가

파일 내용은 런타임에 로드되어 에이전트의 시스템 프롬프트에 주입됩니다.

### 세션 복구(Session Recovery)

시스템은 사용자 개입 없이 일반적인 세션 실패에서 자동으로 복구합니다.

- **누락된 도구 결과**: 복구 가능한 도구 상태를 재구성하고, 잘못된 tool-part ID는 전체 복구 패스를 실패시키는 대신 건너뜁니다
- **Thinking 블록 위반**: API thinking 블록 불일치에서 복구
- **빈 메시지**: 내용이 누락되었을 때 메시지 히스토리를 재구성
- **컨텍스트 윈도우 한계**: Claude 컨텍스트 윈도우 초과 오류를 지능적인 압축으로 우아하게 처리
- **JSON 파싱 오류**: 잘못된 형식의 도구 출력에서 복구

복구는 에이전트 실행 중 투명하게 일어납니다. 사용자에게는 실패가 아닌 결과만 보입니다.

## 스킬(Skills)

스킬은 임베디드 MCP 서버와 상세한 지침을 갖춘 특화 워크플로우를 제공합니다. 스킬은 특정 도메인에 대한 **전문 지식(Context)**과 **도구(MCP)**를 에이전트에 주입하는 메커니즘입니다.

### 내장 스킬

| 스킬               | 트리거                                                  | 설명                                                                                                                                                                                                                                                                                                                                            |
| ------------------ | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **git-master**     | commit, rebase, squash, "who wrote", "when was X added" | Git 전문가. 커밋 스타일을 감지하고, 원자적 커밋으로 분할하며, rebase 전략을 수립합니다. 세 가지 전문 역할: Commit Architect (원자적 커밋, 의존성 정렬, 스타일 감지), Rebase Surgeon (히스토리 재작성, 충돌 해결, 브랜치 정리), History Archaeologist (특정 변경이 언제·어디서 도입됐는지 찾기). |
| **playwright**     | 브라우저 작업, 테스트, 스크린샷                         | Playwright MCP를 통한 브라우저 자동화. 브라우저 검증, 브라우징, 웹 스크래핑, 테스트, 스크린샷에는 반드시 사용해야 합니다.                                                                                                                                                                                                                       |
| **agent-browser**  | agent-browser에서의 브라우저 작업                       | `agent-browser` CLI를 통한 브라우저 자동화. 내비게이션, 스냅샷, 스크린샷, 네트워크 검사, 스크립트 기반 상호작용을 다룹니다.                                                                                                                                                                                                                     |
| **dev-browser**    | 상태 유지(stateful) 브라우저 스크립팅                   | 반복적 워크플로우와 인증된 세션을 위해 페이지 상태를 지속하는 브라우저 자동화.                                                                                                                                                                                                                                                                  |
| **frontend-ui-ux** | UI/UX 작업, 스타일링                                    | 디자이너 출신 개발자 페르소나. 디자인 목업이 없어도 멋진 UI/UX를 만들어 냅니다. 대담한 미적 방향, 차별화된 타이포그래피, 일관성 있는 컬러 팔레트를 강조합니다.                                                                                                                                                                                  |
| **review-work**    | "review work", "review my work", "QA my work"          | 구현 후 리뷰 오케스트레이터. 종합적 리뷰를 위해 5개의 병렬 백그라운드 서브에이전트를 실행합니다: 목표 검증, 코드 품질, 보안, 직접 QA, 컨텍스트 마이닝. 모두 통과해야 리뷰가 통과됩니다.                                                                                                                                                          |
| **ai-slop-remover**| "remove AI slop", "de-AI", "humanize"                  | 기능을 보존하면서 파일에서 AI 생성 코드 냄새를 제거합니다. 장황한 주석, 중복된 오류 처리, 과도하게 설계된 패턴, 일반적인 AI 어투를 식별해 제거합니다.                                                                                                                                                                                            |

#### git-master 핵심 원칙

**기본은 다중 커밋(Multiple Commits by Default)**:

```
3+ files -> MUST be 2+ commits
5+ files -> MUST be 3+ commits
10+ files -> MUST be 5+ commits
```

**자동 스타일 감지**:

- 마지막 30개 커밋을 분석해 언어(한국어/영어)와 스타일(semantic/plain/short)을 파악
- 레포의 커밋 컨벤션에 자동으로 맞춤

**사용법**:

```
/git-master commit these changes
/git-master rebase onto main
/git-master who wrote this authentication code?
```

#### frontend-ui-ux 디자인 프로세스

- **디자인 프로세스**: 목적, 톤, 제약, 차별화
- **미적 방향**: 극단을 선택 — brutalist, maximalist, retro-futuristic, luxury, playful
- **타이포그래피**: 차별화된 폰트, 일반적인 것(Inter, Roboto, Arial) 회피
- **컬러**: 선명한 액센트가 있는 일관된 팔레트, 흰 배경에 보라 같은 AI 슬롭(slop) 회피
- **모션**: 임팩트 있는 스태거드 등장, 스크롤 트리거, 의외의 호버 상태
- **안티 패턴**: 일반적인 폰트, 예측 가능한 레이아웃, 천편일률적인 디자인

### 브라우저 자동화 옵션

Oh-My-OpenAgent는 두 가지 브라우저 자동화 프로바이더를 제공하며, `browser_automation_engine.provider`로 설정합니다.

#### 옵션 1: Playwright MCP (기본값)

```yaml
mcp:
  playwright:
    command: npx
    args: ["@playwright/mcp@latest"]
```

**사용법**:

```
/playwright Navigate to example.com and take a screenshot
```

#### 옵션 2: Agent Browser CLI (Vercel)

```json
{
  "browser_automation_engine": {
    "provider": "agent-browser"
  }
}
```

**설치 필요**:

```bash
bun add -g agent-browser
```

**사용법**:

```
Use agent-browser to navigate to example.com and extract the main heading
```

**기능 (두 프로바이더 공통)**:

- 웹 페이지 탐색 및 상호작용
- 스크린샷 및 PDF 캡처
- 폼 입력 및 요소 클릭
- 네트워크 요청 대기
- 콘텐츠 스크래핑

### 커스텀 스킬 만들기 (SKILL.md)

프로젝트 루트의 `.opencode/skills/` 또는 홈 디렉토리의 `~/.claude/skills/`에 커스텀 스킬을 직접 추가할 수 있습니다.

**예시: `.opencode/skills/my-skill/SKILL.md`**

```markdown
---
name: my-skill
description: My special custom skill
mcp:
  my-mcp:
    command: npx
    args: ["-y", "my-mcp-server"]
---

# My Skill Prompt

This content will be injected into the agent's system prompt.
...
```

**스킬 로드 위치** (우선순위 순, 높은 것부터):

- `.opencode/skills/*/SKILL.md` (프로젝트, OpenCode 네이티브)
- `~/.config/opencode/skills/*/SKILL.md` (사용자, OpenCode 네이티브)
- `.claude/skills/*/SKILL.md` (프로젝트, Claude Code 호환)
- `.agents/skills/*/SKILL.md` (프로젝트, Agents 컨벤션)
- `~/.agents/skills/*/SKILL.md` (사용자, Agents 컨벤션)

같은 이름의 스킬이 더 높은 우선순위에 있으면 낮은 쪽을 덮어씁니다.

내장 스킬은 설정의 `disabled_skills: ["playwright"]`로 비활성화하세요.

### 카테고리 + 스킬 조합 전략

카테고리와 스킬을 결합해 강력한 특화 에이전트를 만들 수 있습니다.

#### 디자이너 (UI 구현)

- **카테고리**: `visual-engineering`
- **load_skills**: `["frontend-ui-ux", "playwright"]`
- **효과**: 미적인 UI를 구현하고 브라우저에서 직접 렌더링 결과를 검증.

#### 아키텍트 (디자인 리뷰)

- **카테고리**: `ultrabrain`
- **load_skills**: `[]` (순수 추론)
- **효과**: GPT-5.4 xhigh 추론을 활용해 시스템 아키텍처를 심층 분석.

#### 메인테이너 (빠른 수정)

- **카테고리**: `quick`
- **load_skills**: `["git-master"]`
- **효과**: 비용 효율적인 모델로 코드를 빠르게 수정하고 깔끔한 커밋을 생성.

### task 프롬프트 가이드

위임 시 **명확하고 구체적인** 프롬프트가 필수입니다. 다음 7가지 요소를 포함하세요.

1. **TASK**: 무엇을 해야 하는가? (단일 목표)
2. **EXPECTED OUTCOME**: 산출물은 무엇인가?
3. **REQUIRED SKILLS**: `load_skills`로 어떤 스킬을 로드해야 하는가?
4. **REQUIRED TOOLS**: 어떤 도구를 사용해야 하는가? (화이트리스트)
5. **MUST DO**: 반드시 해야 할 것 (제약)
6. **MUST NOT DO**: 절대 하면 안 되는 것
7. **CONTEXT**: 파일 경로, 기존 패턴, 참조 자료

**나쁜 예**:

> "Fix this"

**좋은 예**:

> **TASK**: Fix mobile layout breaking issue in `LoginButton.tsx`
> **CONTEXT**: `src/components/LoginButton.tsx`, using Tailwind CSS
> **MUST DO**: Change flex-direction at `md:` breakpoint
> **MUST NOT DO**: Modify existing desktop layout
> **EXPECTED**: Buttons align vertically on mobile

## 명령어(Commands)

명령어는 슬래시로 트리거되며 사전 정의된 템플릿을 실행하는 워크플로우입니다.

### 내장 명령어

| 명령어               | 설명                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| `/init-deep`         | 계층적 AGENTS.md 지식 베이스 초기화                                                              |
| `/ralph-loop`        | 완료 시까지 자기 참조형 개발 루프 시작                                                           |
| `/ulw-loop`          | ultrawork 루프 시작 — ultrawork 모드로 지속                                                      |
| `/cancel-ralph`      | 활성화된 Ralph Loop 취소                                                                        |
| `/refactor`          | LSP, AST-grep, 아키텍처 분석, TDD 검증을 활용한 지능형 리팩토링                                 |
| `/start-work`        | Prometheus 계획으로부터 Sisyphus 작업 세션 시작                                                  |
| `/stop-continuation` | 이 세션의 모든 지속 메커니즘(ralph loop, todo continuation, boulder) 중지                        |
| `/handoff`           | 새 세션에서 작업을 이어가기 위한 상세한 컨텍스트 요약 생성                                       |

### /init-deep

**목적**: 프로젝트 전반에 계층적 AGENTS.md 파일 생성

**사용법**:

```
/init-deep [--create-new] [--max-depth=N]
```

에이전트가 자동으로 읽는 디렉토리별 컨텍스트 파일을 생성합니다.

```
project/
├── AGENTS.md              # Project-wide context
├── src/
│   ├── AGENTS.md          # src-specific context
│   └── components/
│       └── AGENTS.md      # Component-specific context
```

### /ralph-loop

**목적**: 작업 완료까지 실행되는 자기 참조형 개발 루프

**이름 유래**: Anthropic의 Ralph Wiggum 플러그인

**사용법**:

```
/ralph-loop "Build a REST API with authentication"
/ralph-loop "Refactor the payment module" --max-iterations=50
```

**동작**:

- 에이전트가 목표를 향해 지속적으로 작업
- `<promise>DONE</promise>`을 감지해 완료 시점 인식
- 완료 없이 멈추면 자동으로 계속 진행
- 완료 감지, 최대 반복 횟수 도달(기본 100), 또는 `/cancel-ralph` 시 종료

**설정**: `{ "ralph_loop": { "enabled": true, "default_max_iterations": 100 } }`

### /ulw-loop

**목적**: ralph-loop와 동일하지만 ultrawork 모드 활성화 상태

병렬 에이전트, 백그라운드 작업, 공격적 탐색 등 모든 것이 최대 강도로 실행됩니다.

### /refactor

**목적**: 풀 툴체인을 활용한 지능형 리팩토링

**사용법**:

```
/refactor <target> [--scope=<file|module|project>] [--strategy=<safe|aggressive>]
```

**기능**:

- LSP 기반 이름 변경 및 내비게이션
- AST-grep 패턴 매칭
- 변경 전 아키텍처 분석
- 변경 후 TDD 검증
- 코드맵(codemap) 생성

### /start-work

**목적**: Prometheus가 생성한 계획으로부터 실행 시작

**사용법**:

```
/start-work [plan-name]
```

atlas 에이전트를 사용해 계획된 작업을 체계적으로 실행합니다.

### /stop-continuation

**목적**: 이 세션의 모든 지속 메커니즘 중지

ralph loop, todo 지속, boulder 상태를 중지합니다. 에이전트가 현재 진행 중인 다단계 워크플로우를 멈추길 원할 때 사용합니다.

### /handoff

**목적**: 새 세션에서 작업을 이어가기 위한 상세한 컨텍스트 요약 생성

현재 상태, 수행한 작업, 남은 작업, 관련 파일 경로를 담은 구조화된 핸드오프 문서를 생성하여 새 세션에서의 매끄러운 연결을 가능하게 합니다.

### 커스텀 명령어

다음 위치에서 커스텀 명령어를 로드합니다.

- `.opencode/command/*.md` (프로젝트, OpenCode 네이티브)
- `~/.config/opencode/command/*.md` (사용자, OpenCode 네이티브)
- `.claude/commands/*.md` (프로젝트, Claude Code 호환)
- `~/.config/opencode/commands/*.md` (사용자, Claude Code 호환)

## 도구(Tools)

### 코드 검색 도구

| 도구     | 설명                                                                |
| -------- | ------------------------------------------------------------------- |
| **grep** | 정규 표현식 기반 콘텐츠 검색. 파일 패턴으로 필터링.                 |
| **glob** | 빠른 파일 패턴 매칭. 이름 패턴으로 파일을 찾습니다.                 |

### 편집 도구

| 도구     | 설명                                                                                                                                                       |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **edit** | 해시 앵커 편집 도구. 정확하고 안전한 수정을 위해 `LINE#ID` 포맷을 사용합니다. 변경 적용 전 콘텐츠 해시를 검증해 stale-line 오류가 0건입니다.               |

### LSP 도구 (에이전트를 위한 IDE 기능)

| 도구                    | 설명                                          |
| ----------------------- | --------------------------------------------- |
| **lsp_diagnostics**     | 빌드 전에 오류/경고 가져오기                  |
| **lsp_prepare_rename**  | 이름 변경 작업 검증                           |
| **lsp_rename**          | 워크스페이스 전체에서 심볼 이름 변경          |
| **lsp_goto_definition** | 심볼 정의로 이동                              |
| **lsp_find_references** | 워크스페이스 전체의 모든 사용처 찾기          |
| **lsp_symbols**         | 파일 아웃라인 또는 워크스페이스 심볼 검색     |

### AST-Grep 도구

| 도구                 | 설명                                          |
| -------------------- | --------------------------------------------- |
| **ast_grep_search**  | AST 기반 코드 패턴 검색 (25개 언어)           |
| **ast_grep_replace** | AST 기반 코드 치환                            |

### 위임 도구

| 도구                  | 설명                                                                                                                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **call_omo_agent**    | explore/librarian 에이전트 스폰. `run_in_background` 지원.                                                                                                                                                                            |
| **task**              | 카테고리 기반 작업 위임. `visual-engineering`, `ultrabrain`, `deep`, `artistry`, `quick`, `unspecified-low`, `unspecified-high`, `writing` 같은 내장 카테고리, 또는 `subagent_type`을 통한 직접 에이전트 지정을 지원합니다. |
| **background_output** | 백그라운드 작업 결과 가져오기                                                                                                                                                                                                        |
| **background_cancel** | 실행 중인 백그라운드 작업 취소                                                                                                                                                                                                        |

### 시각 분석 도구

| 도구        | 설명                                                                                                                                                              |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **look_at** | Multimodal-Looker 에이전트를 통해 미디어 파일(PDF, 이미지, 다이어그램)을 분석. 문서에서 특정 정보·요약을 추출하고, 시각적 콘텐츠를 설명합니다.                  |

### 스킬 도구

| 도구          | 설명                                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------------------- |
| **skill**     | 이름으로 스킬이나 슬래시 명령어를 로드·실행. 컨텍스트가 적용된 상세 지침을 반환합니다.                     |
| **skill_mcp** | 스킬에 임베디드된 MCP의 MCP 서버 작업을 호출.                                                              |

### 세션 도구

| 도구               | 설명                                              |
| ------------------ | ------------------------------------------------- |
| **session_list**   | 모든 OpenCode 세션 목록 표시                       |
| **session_read**   | 세션의 메시지와 히스토리 읽기                      |
| **session_search** | 세션 메시지 전체에 대한 전문 검색                  |
| **session_info**   | 세션 메타데이터와 통계 가져오기                    |

### 작업 관리 도구

설정에 `experimental.task_system: true`가 필요합니다.

| 도구            | 설명                                              |
| --------------- | ------------------------------------------------- |
| **task_create** | 자동 생성된 ID로 새 작업 생성                     |
| **task_get**    | ID로 작업 조회                                    |
| **task_list**   | 모든 활성 작업 목록 표시                          |
| **task_update** | 기존 작업 업데이트                                |

#### 작업 시스템 상세

**Claude Code와의 정합성에 관한 노트**: 이 구현은 Claude Code 내부 Task 도구의 시그니처(`TaskCreate`, `TaskUpdate`, `TaskList`, `TaskGet`)와 필드 명명 규칙(`subject`, `blockedBy`, `blocks` 등)을 따릅니다. 다만 Anthropic은 이 도구들에 대한 공식 문서를 발표하지 않았습니다. 이는 관찰된 Claude Code 동작과 내부 명세를 바탕으로 한 Oh My OpenAgent의 자체 구현입니다.

**Task 스키마**:

```ts
interface Task {
  id: string; // T-{uuid}
  subject: string; // Imperative: "Run tests"
  description: string;
  status: "pending" | "in_progress" | "completed" | "deleted";
  activeForm?: string; // Present continuous: "Running tests"
  blocks: string[]; // Tasks this blocks
  blockedBy: string[]; // Tasks blocking this
  owner?: string; // Agent name
  metadata?: Record<string, unknown>;
  threadID: string; // Session ID (auto-set)
}
```

**의존성과 병렬 실행**:

```
[Build Frontend]    ──┐
                      ├──→ [Integration Tests] ──→ [Deploy]
[Build Backend]     ──┘
```

- `blockedBy`가 비어 있는 작업은 병렬로 실행됨
- 의존하는 작업은 차단 작업이 완료될 때까지 대기

**워크플로우 예시**:

```ts
TaskCreate({ subject: "Build frontend" }); // T-001
TaskCreate({ subject: "Build backend" }); // T-002
TaskCreate({ subject: "Run integration tests", blockedBy: ["T-001", "T-002"] }); // T-003

TaskList();
// T-001 [pending] Build frontend        blockedBy: []
// T-002 [pending] Build backend         blockedBy: []
// T-003 [pending] Integration tests     blockedBy: [T-001, T-002]

TaskUpdate({ id: "T-001", status: "completed" });
TaskUpdate({ id: "T-002", status: "completed" });
// T-003 now unblocked
```

**저장소**: 작업은 `.sisyphus/tasks/`에 JSON 파일로 저장됩니다.

**TodoWrite와의 차이**:

| 기능               | TodoWrite       | Task System                |
| ------------------ | --------------- | -------------------------- |
| 저장소             | 세션 메모리     | 파일 시스템                |
| 영속성             | 종료 시 손실    | 재시작 후에도 유지         |
| 의존성             | 없음            | 완전 지원 (`blockedBy`)    |
| 병렬 실행          | 수동            | 자동 최적화                |

**언제 사용하나**: 의존성이 있는 다단계 작업, 여러 서브에이전트 협업, 세션 간 진행 상태 유지가 필요할 때 Task를 사용하세요.

### 인터랙티브 터미널 도구

| 도구                 | 설명                                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------- |
| **interactive_bash** | TUI 앱(vim, htop, pudb)을 위한 tmux 기반 터미널. 접두사 없이 tmux 서브커맨드를 그대로 전달합니다.    |

**사용 예시**:

```bash
# Create a new session
interactive_bash(tmux_command="new-session -d -s dev-app")

# Send keystrokes to a session
interactive_bash(tmux_command="send-keys -t dev-app 'vim main.py' Enter")

# Capture pane output
interactive_bash(tmux_command="capture-pane -p -t dev-app")
```

**핵심 포인트**:

- 명령은 tmux 서브커맨드입니다 (`tmux` 접두사 없음)
- 지속적인 세션이 필요한 인터랙티브 앱에 사용
- 단발성 명령은 일반 `Bash` 도구에 `&`를 붙여 사용

## 훅(Hooks)

훅은 전체 세션·메시지·도구·파라미터 파이프라인 곳곳의 에이전트 라이프사이클 핵심 지점에서 동작을 가로채고 변경합니다.

### 훅 이벤트

| 이벤트          | 시점                          | 가능한 작업                                          |
| --------------- | ----------------------------- | ---------------------------------------------------- |
| **PreToolUse**  | 도구 실행 전                  | 차단, 입력 수정, 컨텍스트 주입                       |
| **PostToolUse** | 도구 실행 후                  | 경고 추가, 출력 수정, 메시지 주입                    |
| **Message**     | 메시지 처리 중                | 콘텐츠 변환, 키워드 감지, 모드 활성화                |
| **Event**       | 세션 라이프사이클 변화 시     | 복구, 폴백, 알림                                     |
| **Transform**   | 컨텍스트 변환 중              | 컨텍스트 주입, 블록 검증                             |
| **Params**      | API 파라미터 설정 시          | 모델 설정·노력 수준 조정                             |

### 내장 훅

#### 컨텍스트 & 주입

| 훅                              | 이벤트                   | 설명                                                                                                                                                                                                            |
| ------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **directory-agents-injector**   | PreToolUse + PostToolUse | 파일을 읽을 때 AGENTS.md를 자동 주입. 파일에서 프로젝트 루트까지 거슬러 올라가며 모든 AGENTS.md를 수집합니다. OpenCode 1.1.37+에서는 deprecated — 네이티브 AGENTS.md 주입이 제공되면 자동 비활성화됩니다. |
| **directory-readme-injector**   | PreToolUse + PostToolUse | 디렉토리 컨텍스트를 위해 README.md를 자동 주입.                                                                                                                                                                  |
| **rules-injector**              | PreToolUse + PostToolUse | 조건이 맞을 때 `.claude/rules/`의 룰을 주입. 글롭과 alwaysApply를 지원.                                                                                                                                          |
| **compaction-context-injector** | Event                    | 세션 압축 중 핵심 컨텍스트를 보존.                                                                                                                                                                              |
| **context-window-monitor**      | Event                    | 컨텍스트 윈도우 사용량을 모니터링하고 토큰 소비를 추적.                                                                                                                                                          |
| **preemptive-compaction**       | Event                    | 토큰 한도에 도달하기 전에 사전 압축을 수행.                                                                                                                                                                      |

#### 생산성 & 제어

| 훅                          | 이벤트              | 설명                                                                                                                                                          |
| --------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **keyword-detector**        | Message + Transform | 키워드를 감지해 모드를 활성화: `ultrawork`/`ulw` (최대 성능), `search`/`find` (병렬 탐색), `analyze`/`investigate` (심층 분석).                              |
| **think-mode**              | Params              | 확장 사고가 필요한 경우를 자동 감지. "think deeply", "ultrathink"을 포착해 모델 설정을 조정.                                                                  |
| **ralph-loop**              | Event + Message     | 자기 참조형 루프 지속을 관리.                                                                                                                                |
| **start-work**              | Message             | /start-work 명령 실행을 처리.                                                                                                                                 |
| **auto-slash-command**      | Message             | 프롬프트에서 슬래시 명령을 자동 실행.                                                                                                                        |
| **stop-continuation-guard** | Event + Message     | stop-continuation 메커니즘을 보호.                                                                                                                            |
| **category-skill-reminder** | Event + PostToolUse | 위임에 사용할 수 있는 카테고리 스킬을 에이전트에 상기시킴.                                                                                                  |
| **anthropic-effort**        | Params              | 컨텍스트에 따라 Anthropic API 노력 수준을 조정.                                                                                                              |

#### 품질 & 안전

| 훅                              | 이벤트                   | 설명                                                                                            |
| ------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------- |
| **comment-checker**             | PostToolUse              | 과도한 주석을 줄이도록 에이전트에 상기시킴. BDD, 디렉티브, docstring은 영리하게 무시.           |
| **thinking-block-validator**    | Transform                | API 오류를 방지하기 위해 thinking 블록을 검증.                                                  |
| **edit-error-recovery**         | PostToolUse + Event      | edit 도구 실패에서 복구.                                                                        |
| **write-existing-file-guard**   | PreToolUse               | 먼저 읽지 않은 기존 파일의 우발적 덮어쓰기를 방지.                                              |
| **hashline-read-enhancer**      | PostToolUse              | hashline edit 도구를 위한 해시 앵커 라인 마커로 read 출력을 보강.                              |
| **hashline-edit-diff-enhancer** | PreToolUse + PostToolUse | hashline edit 도구의 편집 작업을 diff 마커로 보강.                                              |

#### 복구 & 안정성

| 훅                                          | 이벤트          | 설명                                                                                                                                                                                                                                              |
| ------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **session-recovery**                        | Event           | 세션 오류 — 누락된 도구 결과, thinking 블록 문제, 빈 메시지 — 에서 복구.                                                                                                                                                                          |
| **anthropic-context-window-limit-recovery** | Event           | Claude 컨텍스트 윈도우 한계를 우아하게 처리.                                                                                                                                                                                                      |
| **runtime-fallback**                        | Event + Message | 재시도 가능한 API 오류(예: 429, 503, 529), 프로바이더 키 설정 오류(예: API 키 누락), 자동 재시도 시그널(`timeout_seconds > 0`)에서 자동으로 백업 모델로 전환. 모델별 쿨다운이 있는 설정 가능한 재시도 로직. |
| **model-fallback**                          | Event + Message | 기본 모델을 사용할 수 없을 때 모델 fallback 체인을 관리.                                                                                                                                                                                          |
| **json-error-recovery**                     | PostToolUse     | 도구 출력의 JSON 파싱 오류에서 복구.                                                                                                                                                                                                              |

#### 절단 & 컨텍스트 관리

| 훅                        | 이벤트      | 설명                                                                                                  |
| ------------------------- | ----------- | ----------------------------------------------------------------------------------------------------- |
| **tool-output-truncator** | PostToolUse | Grep, Glob, LSP, AST-grep 도구의 출력을 절단. 컨텍스트 윈도우에 따라 동적으로 조정.                  |

#### 알림 & UX

| 훅                           | 이벤트              | 설명                                                                                                |
| ---------------------------- | ------------------- | --------------------------------------------------------------------------------------------------- |
| **auto-update-checker**      | Event               | 세션 생성 시 새 버전을 확인하고, 버전과 Sisyphus 상태가 담긴 시작 토스트를 표시.                    |
| **background-notification**  | Event               | 백그라운드 에이전트 작업 완료 시 알림.                                                              |
| **session-notification**     | Event               | 에이전트가 유휴 상태가 되면 OS 알림. macOS, Linux, Windows에서 동작.                                |
| **agent-usage-reminder**     | PostToolUse + Event | 더 나은 결과를 위해 특화된 에이전트를 활용하라고 상기시킴.                                          |
| **question-label-truncator** | PreToolUse          | Question 도구 UI에서 긴 질문 라벨을 절단.                                                            |

#### 작업 관리

| 훅                               | 이벤트              | 설명                                                |
| -------------------------------- | ------------------- | --------------------------------------------------- |
| **task-resume-info**             | PostToolUse         | 연속성을 위한 작업 재개 정보를 제공.                |
| **delegate-task-retry**          | PostToolUse + Event | 실패한 작업 위임 호출을 재시도.                     |
| **empty-task-response-detector** | PostToolUse         | 위임된 작업의 빈 응답을 감지.                       |
| **tasks-todowrite-disabler**     | PreToolUse          | 작업 시스템이 활성화되면 TodoWrite 도구를 비활성화. |

#### 지속(Continuation)

| 훅                             | 이벤트 | 설명                                                              |
| ------------------------------ | ------ | ----------------------------------------------------------------- |
| **todo-continuation-enforcer** | Event  | todo 완료를 강제 — 유휴 상태의 에이전트를 다시 작업으로 끌어옴.   |
| **compaction-todo-preserver**  | Event  | 세션 압축 중 todo 상태를 보존.                                    |
| **unstable-agent-babysitter**  | Event  | 불안정한 에이전트 동작을 복구 전략으로 처리.                      |

#### 통합

| 훅                           | 이벤트              | 설명                                                       |
| ---------------------------- | ------------------- | ---------------------------------------------------------- |
| **claude-code-hooks**        | All                 | Claude Code의 settings.json 훅을 실행.                     |
| **atlas**                    | Multiple            | todo 기반 작업 세션의 메인 오케스트레이션 로직.            |
| **interactive-bash-session** | PostToolUse + Event | 인터랙티브 CLI를 위한 tmux 세션을 관리.                    |
| **non-interactive-env**      | PreToolUse          | 비인터랙티브 환경 제약을 처리.                             |

#### 특화

| 훅                          | 이벤트     | 설명                                                            |
| --------------------------- | ---------- | --------------------------------------------------------------- |
| **prometheus-md-only**      | PreToolUse | Prometheus 기획자에 대해 마크다운 전용 출력을 강제.             |
| **no-sisyphus-gpt**         | Message    | 호환되지 않는 GPT 모델에서 Sisyphus가 실행되는 것을 방지.       |
| **no-hephaestus-non-gpt**   | Message    | 비-GPT 모델에서 Hephaestus가 실행되는 것을 방지.                |
| **sisyphus-junior-notepad** | PreToolUse | Sisyphus-Junior 에이전트의 노트패드 상태를 관리.                |

### Claude Code 훅 통합

Claude Code의 `settings.json`을 통해 커스텀 스크립트를 실행합니다.

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [{ "type": "command", "command": "eslint --fix $FILE" }]
      }
    ]
  }
}
```

**훅 위치**:

- `~/.claude/settings.json` (사용자)
- `./.claude/settings.json` (프로젝트)
- `./.claude/settings.local.json` (로컬, git-ignored)

### 훅 비활성화

설정에서 특정 훅을 비활성화합니다.

```json
{
  "disabled_hooks": ["comment-checker"]
}
```

## MCP

### 내장 MCP

| MCP           | 설명                                                                                            |
| ------------- | ----------------------------------------------------------------------------------------------- |
| **websearch** | Exa AI 기반의 실시간 웹 검색                                                                    |
| **context7**  | 모든 라이브러리/프레임워크에 대한 공식 문서 조회                                                |
| **grep_app**  | 공개 GitHub 레포 전체에 대한 초고속 코드 검색. 구현 예시를 찾을 때 유용.                        |

### 스킬 임베디드 MCP

스킬은 자체 MCP 서버를 함께 가져올 수 있습니다.

```yaml
---
description: Browser automation skill
mcp:
  playwright:
    command: npx
    args: ["-y", "@anthropic-ai/mcp-playwright"]
---
```

`skill_mcp` 도구는 스키마 자동 발견과 함께 이 작업들을 호출합니다.

#### OAuth 지원 MCP

스킬은 OAuth로 보호되는 원격 MCP 서버를 정의할 수 있습니다. RFC 9728, 8414, 8707, 7591 풀 컴플라이언스 OAuth 2.1이 지원됩니다.

```yaml
---
description: My API skill
mcp:
  my-api:
    url: https://api.example.com/mcp
    oauth:
      clientId: ${CLIENT_ID}
      scopes: ["read", "write"]
---
```

스킬 MCP에 `oauth`가 설정되면:

- **자동 발견**: `/.well-known/oauth-protected-resource` (RFC 9728)을 조회하고, `/.well-known/oauth-authorization-server` (RFC 8414)로 폴백
- **동적 클라이언트 등록**: RFC 7591을 지원하는 서버에 자동 등록 (clientId 선택 사항이 됨)
- **PKCE**: 모든 플로우에서 필수
- **리소스 인디케이터**: RFC 8707에 따라 MCP URL에서 자동 생성
- **토큰 저장소**: `~/.config/opencode/mcp-oauth.json` (chmod 0600)에 영속화
- **자동 갱신**: 401에서 토큰 갱신; `WWW-Authenticate`가 있는 403에서 step-up 인증
- **동적 포트**: OAuth 콜백 서버는 자동 발견된 가용 포트를 사용

CLI로 사전 인증:

```bash
bunx oh-my-opencode mcp oauth login <server-name> --server-url https://api.example.com
```

## 모델 능력(Model Capabilities)

모델 능력은 models.dev 기반이며, 새로 고침 가능한 캐시와 호환성 진단을 갖추고 있습니다. 시스템은 번들된 models.dev 스냅샷 데이터, 선택적으로 새로 고친 캐시 데이터, 프로바이더 런타임 메타데이터, 그리고 정확한 메타데이터가 없을 때의 휴리스틱을 결합합니다.

### 능력 새로 고침

로컬 캐시를 최신 모델 정보로 업데이트합니다.

```bash
bunx oh-my-opencode refresh-model-capabilities
```

시작 시 자동 새로 고침을 설정합니다.

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

### 능력 진단

`bunx oh-my-opencode doctor`를 실행하면 다음을 포함한 능력 진단을 볼 수 있습니다.
- 에이전트와 카테고리에 대한 effective 모델 해석
- 설정된 모델이 호환성 폴백에 의존할 때의 경고
- 모델 해석 출력과 함께 표시되는 오버라이드 호환성 상세

## 컨텍스트 주입

### 디렉토리 AGENTS.md

파일 읽기 시 AGENTS.md를 자동 주입합니다. 파일 디렉토리에서 프로젝트 루트까지 거슬러 올라갑니다.

```
project/
├── AGENTS.md              # Injected first
├── src/
│   ├── AGENTS.md          # Injected second
│   └── components/
│       ├── AGENTS.md      # Injected third
│       └── Button.tsx     # Reading this injects all 3
```

### 조건부 룰

조건이 맞을 때 `.claude/rules/`의 룰을 주입합니다.

```markdown
---
globs: ["*.ts", "src/**/*.js"]
description: "TypeScript/JavaScript coding rules"
---

- Use PascalCase for interface names
- Use camelCase for function names
```

지원 사항:

- `.md` 및 `.mdc` 파일
- 패턴 매칭을 위한 `globs` 필드
- 무조건 적용을 위한 `alwaysApply: true`
- 파일에서 프로젝트 루트까지 거슬러 올라가며, `~/.claude/rules/`도 포함

## Claude Code 호환성

Claude Code 설정에 대한 풀 호환성 레이어.

### 설정 로더

| 타입         | 위치                                                                                |
| ------------ | ----------------------------------------------------------------------------------- |
| **Commands** | `~/.config/opencode/commands/`, `.claude/commands/`                                 |
| **Skills**   | `~/.config/opencode/skills/*/SKILL.md`, `.claude/skills/*/SKILL.md`                 |
| **Agents**   | `~/.config/opencode/agents/*.md`, `.claude/agents/*.md`                             |
| **MCPs**     | `~/.claude.json`, `~/.config/opencode/.mcp.json`, `.mcp.json`, `.claude/.mcp.json`  |

MCP 설정은 환경 변수 확장(`${VAR}`)을 지원합니다.

### 호환성 토글

특정 기능을 비활성화합니다.

```json
{
  "claude_code": {
    "mcp": false,
    "commands": false,
    "skills": false,
    "agents": false,
    "hooks": false,
    "plugins": false
  }
}
```

| 토글       | 비활성화 대상                                                  |
| ---------- | -------------------------------------------------------------- |
| `mcp`      | `.mcp.json` 파일 (내장 MCP는 유지)                             |
| `commands` | Claude Code 경로의 명령어 로딩                                 |
| `skills`   | Claude Code 경로의 스킬 로딩                                   |
| `agents`   | Claude Code 경로의 에이전트 로딩 (내장 에이전트는 유지)        |
| `hooks`    | settings.json 훅                                               |
| `plugins`  | Claude Code 마켓플레이스 플러그인                              |

특정 플러그인 비활성화:

```json
{
  "claude_code": {
    "plugins_override": {
      "claude-mem@thedotmack": false
    }
  }
}
```
