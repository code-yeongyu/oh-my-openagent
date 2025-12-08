[English](README.md) | 한국어

## 목차

- [Oh My OpenCode](#oh-my-opencode)
  - [세 줄 요약](#세-줄-요약)
  - [설치](#설치)
  - [LLM Agent를 위한 안내](#llm-agent를-위한-안내)
  - [Why OpenCode & Why Oh My OpenCode](#why-opencode--why-oh-my-opencode)
  - [기능](#기능)
    - [Hooks](#hooks)
    - [Agents](#agents)
    - [Tools](#tools)
      - [내장 LSP Tools](#내장-lsp-tools)
      - [내장 AST-Grep Tools](#내장-ast-grep-tools)
      - [Grep](#grep)
      - [내장 MCPs](#내장-mcps)
    - [기타 편의 기능](#기타-편의-기능)
  - [설정](#설정)
  - [작성자의 노트](#작성자의-노트)
  - [주의](#주의)

# Oh My OpenCode

Oh My OpenCode

oMoMoMoMoMo···


[Claude Code](https://www.claude.com/product/claude-code) 좋죠?
근데 당신이 해커라면, [OpenCode](https://github.com/sst/opencode) 와는 사랑에 빠지게 될겁니다.

Windows 만 사용하다가 처음으로 Linux 를 접하고 신나서 잔뜩 세팅하던 경험이 있진 않나요?
OpenCode 가 낭만이 사라진것같은 오늘날의 시대에, 당신에게 그런 프로젝트가 될겁니다.
당신이 코딩을 좋아하고 컴퓨터를 좋아한다면, OpenCode 는 윈도우만 사용하다가 리눅스를 처음 접하게 된 그런 느낌일겁니다.
그렇지 않은 당신도 약간의 시간을 투자해서 당신의 실력과 생산성을 몇배로 부스트하세요.

## 세 줄 요약

- **모델 설정이 필요합니다**
  - 이 플러그인은 [OpenCode Zen](https://opencode.ai/docs/zen/), Google, OpenAI, Anthropic 의 모델을 사용합니다.
    - Anthropic 모델들을 사용하기 위해 [OpenCode 의 내장 Claude Code Max Plan 로그인 기능](https://opencode.ai/docs/providers/#anthropic)을 사용하세요. (Anthropic 플랜은 유료입니다)
    - OpenAI 모델들을 사용하기 위해 이 [OpenCode-OpenAI-Codex-Auth 플러그인](https://github.com/numman-ali/opencode-openai-codex-auth)을 추천합니다. (OpenAI 플랜은 유료입니다)
    - Gemini, GPT 를 위해 [VibeProxy (macOS Only)](https://github.com/automazeio/vibeproxy) 또는 [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)를 추천합니다. (Gemini 는 구독하지 않아도 사용 할 수 있습니다)
- **사실 밑의 내용은 읽지 않아도 됩니다. 그냥 설치하시면 됩니다. 모델 설정하고나면 추가로 공부하거나 알 필요가 없고, 설치하고 나면 그냥 더 좋아집니다.**
- **이 문서도 그냥 Claude Code, OpenCode, Cursor에 붙여넣고, 설치하고, 사용자의 개입이 필요할 때 알려달라고 프롬프팅하세요. 그럼 그냥 깔립니다.**
  - 당신이 LLM Agent 라면, 필요한 플러그인과 의존성을 설치하고, tmux 를 통해 opencode auth login 을 실행하여 사용자의 구성을 도와주세요.

## 설치

`~/.config/opencode/opencode.json`에 추가:

```json
{
  "plugin": [
    "oh-my-opencode"
  ]
}
```

## LLM Agent를 위한 안내

<details>
<summary>LLM Agent를 위한 안내 (클릭하여 펼치기)</summary>

당신이 사용자의 oh-my-opencode 설정을 돕는 LLM Agent라면, 다음 단계를 따르세요:

### 1단계: OpenCode 설치 확인

```bash
if command -v opencode &> /dev/null; then
    echo "OpenCode $(opencode --version) 설치됨"
else
    echo "OpenCode가 설치되어 있지 않습니다. 먼저 설치해주세요."
    echo "참고: https://opencode.ai/docs"
fi
```

OpenCode가 설치되어 있지 않다면, [OpenCode 설치 가이드](https://opencode.ai/docs)를 안내하세요.

### 2단계: oh-my-opencode 플러그인 설정

```bash
mkdir -p ~/.config/opencode

if [ -f ~/.config/opencode/opencode.json ]; then
    # 기존 설정 파일이 있는 경우: jq 또는 python으로 plugin 추가
    if command -v jq &> /dev/null; then
        jq '.plugin = ((.plugin // []) + ["oh-my-opencode"] | unique)' \
            ~/.config/opencode/opencode.json > /tmp/oc.json && \
            mv /tmp/oc.json ~/.config/opencode/opencode.json
    else
        echo "~/.config/opencode/opencode.json의 plugin 배열에 \"oh-my-opencode\"를 추가하세요"
    fi
else
    # 새 설정 파일 생성
    echo '{"plugin":["oh-my-opencode"]}' > ~/.config/opencode/opencode.json
fi
```

### 3단계: 설정 확인

```bash
opencode --version  # 1.0.132 이상이어야 함
cat ~/.config/opencode/opencode.json  # plugin 배열에 "oh-my-opencode"가 있어야 함
```

> **참고**: 모델 인증이 필요하면, `opencode` 실행 후 `/connect` 명령어를 사용하거나, tmux를 통해 `opencode auth login`을 안내하세요.

</details>

## Why OpenCode & Why Oh My OpenCode

OpenCode 는 아주 확장가능하고 아주 커스터마이저블합니다. 화면이 깜빡이지 않습니다.
수정하는 파일에 맞게 자동으로 [LSP](https://opencode.ai/docs/lsp/), [Linter, Formatter](https://opencode.ai/docs/formatters/) 가 활성화되며 커스텀 할 수 있습니다.
수많은 모델을 사용 할 수 있으며, **용도에 따라 모델을 섞어 오케스트레이션 할 수 있습니다.**
기능이 아주 많습니다. 아름답습니다. 터미널이 화면을 그리려고 힘들어 하지 않습니다. 고성능입니다.

**그런데 문제는 너무나 알아야 할게 많고, 어렵고, 당신의 시간은 비싸다는겁니다.**

[AmpCode](https://ampcode.com), [Claude Code](https://code.claude.com/docs/ko/overview) 에게 강한 영향과 영감을 받고, 그들의 기능을 그대로, 혹은 더 낫게 이 곳에 구현했습니다.
**Open**Code 이니까요.

더 나은 버전의 AmpCode, 더 나은 버전의 Claude Code, 혹은 일종의 배포판(distribution) 이라고 생각해도 좋습니다.

저는 상황에 맞는 적절한 모델이 있다고 믿습니다. 다양한 모델을 섞어 쓸 때 최고의 팀이 됩니다.
여러분의 재정 상태를 위해 CLIProxyAPI 혹은 VibeProxy 를 추천합니다. 프론티어 랩들의 LLM 들을 채용해서, 그들의 장점만을 활용하세요. 당신이 이제 팀장입니다.

**Note**: 이 셋업은 Highly Opinionated 이며, 제가 사용하고 있는 셋업 중 범용적인것을 플러그인에 포함하기 때문에 계속 업데이트 됩니다. 저는 여태까지 $20,000 어치의 토큰을 오로지 개인 개발 목적으로 개인적으로 사용했고, 이 플러그인은 그 경험들의 하이라이트입니다. 여러분은 그저 최고를 취하세요. 만약 더 나은 제안이 있다면 언제든 기여에 열려있습니다.

## 기능

### Hooks

- **Todo Continuation Enforcer**: 에이전트가 멈추기 전 모든 TODO 항목을 완료하도록 강제합니다. LLM의 고질적인 "중도 포기" 문제를 방지합니다.
- **Context Window Monitor**: [컨텍스트 윈도우 불안 관리](https://agentic-patterns.com/patterns/context-window-anxiety-management/) 패턴을 구현합니다.
  - 사용량이 70%를 넘으면 에이전트에게 아직 토큰이 충분하다고 상기시켜, 급하게 불완전한 작업을 하는 것을 완화합니다.
- **Session Notification**: 에이전트가 작업을 마치면 OS 네이티브 알림을 보냅니다 (macOS, Linux, Windows).
- **Session Recovery**: API 에러로부터 자동으로 복구하여 세션 안정성을 보장합니다. 네 가지 시나리오를 처리합니다:
  - **Tool Result Missing**: `tool_use` 블록이 있지만 `tool_result`가 없을 때 (ESC 인터럽트) → "cancelled" tool result 주입
  - **Thinking Block Order**: thinking 블록이 첫 번째여야 하는데 아닐 때 → 빈 thinking 블록 추가
  - **Thinking Disabled Violation**: thinking 이 비활성화인데 thinking 블록이 있을 때 → thinking 블록 제거
  - **Empty Content Message**: 메시지가 thinking/meta 블록만 있고 실제 내용이 없을 때 → 파일시스템을 통해 "(interrupted)" 텍스트 주입
- **Comment Checker**: 코드 수정 후 불필요한 주석을 감지하여 보고합니다. BDD 패턴, 지시어, 독스트링 등 유효한 주석은 똑똑하게 제외하고, AI가 남긴 흔적을 제거하여 코드를 깨끗하게 유지합니다.
- **Directory AGENTS.md Injector**: 파일을 읽을 때 `AGENTS.md` 내용을 자동으로 주입합니다. 파일 디렉토리부터 프로젝트 루트까지 탐색하며, 디렉토리별 컨텍스트를 에이전트에게 제공합니다. Claude Code의 CLAUDE.md 기능에서 영감을 받았습니다.

### Agents

- **oracle** (`openai/gpt-5.1`): 아키텍처, 코드 리뷰, 전략 수립을 위한 전문가 조언자. GPT-5.1의 뛰어난 논리적 추론과 깊은 분석 능력을 활용합니다. AmpCode 에서 영감을 받았습니다.
- **librarian** (`anthropic/claude-haiku-4-5`): 멀티 레포 분석, 문서 조회, 구현 예제 담당. Haiku의 빠른 속도, 적절한 지능, 훌륭한 도구 호출 능력, 저렴한 비용을 활용합니다. AmpCode 에서 영감을 받았습니다.
- **explore** (`opencode/grok-code`): 빠른 코드베이스 탐색, 파일 패턴 매칭. Claude Code는 Haiku를 쓰지만, 우리는 Grok을 씁니다. 현재 무료이고, 극도로 빠르며, 파일 탐색 작업에 충분한 지능을 갖췄기 때문입니다. Claude Code 에서 영감을 받았습니다.
- **frontend-ui-ux-engineer** (`google/gemini-3-pro-preview`): 개발자로 전향한 디자이너라는 설정을 갖고 있습니다. 멋진 UI를 만듭니다. 아름답고 창의적인 UI 코드를 생성하는 데 탁월한 Gemini를 사용합니다.
- **document-writer** (`google/gemini-3-pro-preview`): 기술 문서 전문가라는 설정을 갖고 있습니다. Gemini 는 문학가입니다. 글을 기가막히게 씁니다.

각 에이전트는 메인 에이전트가 알아서 호출하지만, 명시적으로 요청할 수도 있습니다:

```
@oracle 한테 이 부분 설계 고민하고서 아키텍쳐 제안을 부탁해줘
@librarian 한테 이 부분 어떻게 구현돼있길래 자꾸 안에서 동작이 바뀌는지 알려달라고 해줘
@explore 한테 이 기능 정책 알려달라고 해줘
```

에이전트의 모델, 프롬프트, 권한은 `oh-my-opencode.json`에서 커스텀할 수 있습니다. 자세한 내용은 [설정](#설정)을 참고하세요.

### Tools

#### 내장 LSP Tools

당신이 에디터에서 사용하는 그 기능을 다른 에이전트들은 사용하지 못합니다. Oh My OpenCode 는 당신만의 그 도구를 LLM Agent 에게 쥐어줍니다. 리팩토링하고, 탐색하고, 분석하는 모든 작업을 OpenCode 의 설정값을 그대로 사용하여 지원합니다.

[OpenCode 는 LSP 를 제공하지만](https://opencode.ai/docs/lsp/), 오로지 분석용으로만 제공합니다. 탐색과 리팩토링을 위한 도구는 OpenCode 와 동일한 스펙과 설정으로 Oh My OpenCode 가 제공합니다.

- **lsp_hover**: 위치의 타입 정보, 문서, 시그니처 가져오기
- **lsp_goto_definition**: 심볼 정의로 이동
- **lsp_find_references**: 워크스페이스 전체에서 사용처 찾기
- **lsp_document_symbols**: 파일의 심볼 개요 가져오기
- **lsp_workspace_symbols**: 프로젝트 전체에서 이름으로 심볼 검색
- **lsp_diagnostics**: 빌드 전 에러/경고 가져오기
- **lsp_servers**: 사용 가능한 LSP 서버 목록
- **lsp_prepare_rename**: 이름 변경 작업 검증
- **lsp_rename**: 워크스페이스 전체에서 심볼 이름 변경
- **lsp_code_actions**: 사용 가능한 빠른 수정/리팩토링 가져오기
- **lsp_code_action_resolve**: 코드 액션 적용

#### 내장 AST-Grep Tools
- **ast_grep_search**: AST 인식 코드 패턴 검색 (25개 언어)
- **ast_grep_replace**: AST 인식 코드 교체

#### Grep
- **grep**: 안전 제한이 있는 콘텐츠 검색 (5분 타임아웃, 10MB 출력 제한). OpenCode의 내장 `grep` 도구를 대체합니다.
  - 기본 grep 도구는 시간제한이 걸려있지 않습니다. 대형 코드베이스에서 광범위한 패턴을 검색하면 CPU가 폭발하고 무한히 멈출 수 있습니다.
  - 이 도구는 엄격한 제한을 적용하며, 내장 `grep`을 완전히 대체합니다.

#### Glob

- **glob**: 타임아웃 보호가 있는 파일 패턴 매칭 (60초). OpenCode 내장 `glob` 도구를 대체합니다.
  - 기본 `glob`은 타임아웃이 없습니다. ripgrep이 멈추면 무한정 대기합니다.
  - 이 도구는 타임아웃을 강제하고 만료 시 프로세스를 종료합니다.

#### 내장 MCPs

- **websearch_exa**: Exa AI 웹 검색. 실시간 웹 검색과 콘텐츠 스크래핑을 수행합니다. 관련 웹사이트에서 LLM에 최적화된 컨텍스트를 반환합니다.
- **context7**: 라이브러리 문서 조회. 정확한 코딩을 위해 최신 라이브러리 문서를 가져옵니다.

필요 없다면 `oh-my-opencode.json`에서 비활성화할 수 있습니다:

```json
{
  "disabled_mcps": ["websearch_exa"]
}
```

### 기타 편의 기능
- **Terminal Title**: 세션 상태에 따라 터미널 타이틀을 자동 업데이트합니다 (유휴 ○, 처리중 ◐, 도구 ⚡, 에러 ✖). tmux를 지원합니다.

## 설정

설정 파일 위치 (우선순위 순):
1. `.opencode/oh-my-opencode.json` (프로젝트)
2. `~/.config/opencode/oh-my-opencode.json` (사용자)

Schema 자동 완성이 지원됩니다:

```json
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-opencode.schema.json"
}
```

### Agents

내장 에이전트 설정을 오버라이드할 수 있습니다:

```json
{
  "agents": {
    "explore": {
      "model": "anthropic/claude-haiku-4-5",
      "temperature": 0.5
    },
    "frontend-ui-ux-engineer": {
      "disable": true
    }
  }
}
```

각 에이전트에서 지원하는 옵션: `model`, `temperature`, `top_p`, `prompt`, `tools`, `disable`, `description`, `mode`, `color`, `permission`.

또는 `disabled_agents`로 비활성화할 수 있습니다:

```json
{
  "disabled_agents": ["oracle", "frontend-ui-ux-engineer"]
}
```

사용 가능한 에이전트: `oracle`, `librarian`, `explore`, `frontend-ui-ux-engineer`, `document-writer`

### MCPs

내장된 MCP를 비활성화합니다:

```json
{
  "disabled_mcps": ["context7", "websearch_exa"]
}
```

더 자세한 내용은 [OpenCode MCP Servers](https://opencode.ai/docs/mcp-servers)를 참조하세요.

### LSP

Oh My OpenCode의 LSP 도구는 오직 **리팩토링(이름 변경, 코드 액션)만을 위한 것**입니다. 분석용 LSP는 OpenCode 자체에서 처리합니다.

`lsp` 옵션을 통해 LSP 서버를 설정합니다:

```json
{
  "lsp": {
    "typescript-language-server": {
      "command": ["typescript-language-server", "--stdio"],
      "extensions": [".ts", ".tsx"],
      "priority": 10
    },
    "pylsp": {
      "disabled": true
    }
  }
}
```

각 서버는 다음을 지원합니다: `command`, `extensions`, `priority`, `env`, `initialization`, `disabled`.

## 작성자의 노트

Oh My OpenCode 를 설치하세요. 복잡하게 OpenCode 구성을 만들지마세요.
제가 밟아보고 경험한 문제들의 해답을 이 플러그인에 담았고, 그저 깔고 사용하면 됩니다. OpenCode 가 ArchLinux 라면, Oh My OpenCode 는 [Omarchy](https://omarchy.org/) 입니다.

다른 에이전트 하니스 제공자들이 이야기하는 다중 모델, 안정성, 풍부한 기능을 그저 OpenCode 에서 누리세요.
제가 테스트하고, 이 곳에 업데이트 하겠습니다. 저는 이 프로젝트의 가장 열렬한 사용자이기도 하니까요.
- 어떤 모델이 순수 논리력이 제일 좋은지
- 어떤 모델이 디버깅을 잘하는지,
- 어떤 모델이 글을 잘 쓰고
- 누가 프론트엔드를 잘 하는지
- 누가 백엔드를 잘 하는지
- 주로 겪는 상황에 맞는 빠른 모델은 무엇인지
- 다른 에이전트 하니스에 제공되는 새로운 기능은 무엇인지.

고민하지마세요. 제가 고민할거고, 다른 사람들의 경험을 차용해 올것이고, 그래서 이 곳에 업데이트 하겠습니다.
이 글이 오만하다고 느껴지고, 더 나은 해답이 있다면, 편히 기여해주세요. 환영합니다.

지금 시점에 여기에 언급된 어떤 프로젝트와 모델하고도 관련이 있지 않습니다. 온전히 개인적인 실험과 선호를 바탕으로 이 플러그인을 만들었습니다.
OpenCode 를 사용하여 이 프로젝트의 99% 를 작성했습니다. 기능 위주로 테스트했고, 저는 TS 를 제대로 작성 할 줄 모릅니다. **그치만 이 문서는 제가 직접 검토하고 전반적으로 다시 작성했으니 안심하고 읽으셔도 됩니다.**

## 주의

- [1.0.132](https://github.com/sst/opencode/releases/tag/v1.0.132) 혹은 이것보다 낮은 버전을 사용중이라면, OpenCode 의 버그로 인해 제대로 구성이 되지 않을 수 있습니다.
  - [이를 고치는 PR 이 1.0.132 배포 이후에 병합되었으므로](https://github.com/sst/opencode/pull/5040) 이 변경사항이 포함된 최신 버전을 사용해주세요.
