<!-- <CENTERED SECTION FOR GITHUB DISPLAY> -->

<div align="center">

[![Oh My OpenCode](./.github/assets/hero.jpg)](https://github.com/code-yeongyu/oh-my-opencode#oh-my-opencode)

[![Preview](./.github/assets/preview.png)](https://github.com/code-yeongyu/oh-my-opencode#oh-my-opencode)

</div>

> `oh-my-opencode` 를 설치하세요. 약 빤 것 처럼 코딩하세요. 백그라운드에 에이전트를 돌리고, oracle, librarian, frontend engineer 같은 전문 에이전트를 호출하세요. 정성스레 빚은 LSP/AST 도구, 엄선된 MCP, 완전한 Claude Code 호환 레이어를 오로지 한 줄로 누리세요.

<div align="center">

[![GitHub Release](https://img.shields.io/github/v/release/code-yeongyu/oh-my-opencode?color=369eff&labelColor=black&logo=github&style=flat-square)](https://github.com/code-yeongyu/oh-my-opencode/releases)
[![GitHub Contributors](https://img.shields.io/github/contributors/code-yeongyu/oh-my-opencode?color=c4f042&labelColor=black&style=flat-square)](https://github.com/code-yeongyu/oh-my-opencode/graphs/contributors)
[![GitHub Forks](https://img.shields.io/github/forks/code-yeongyu/oh-my-opencode?color=8ae8ff&labelColor=black&style=flat-square)](https://github.com/code-yeongyu/oh-my-opencode/network/members)
[![GitHub Stars](https://img.shields.io/github/stars/code-yeongyu/oh-my-opencode?color=ffcb47&labelColor=black&style=flat-square)](https://github.com/code-yeongyu/oh-my-opencode/stargazers)
[![GitHub Issues](https://img.shields.io/github/issues/code-yeongyu/oh-my-opencode?color=ff80eb&labelColor=black&style=flat-square)](https://github.com/code-yeongyu/oh-my-opencode/issues)
[![License](https://img.shields.io/badge/license-MIT-white?labelColor=black&style=flat-square)](https://github.com/code-yeongyu/oh-my-opencode/blob/master/LICENSE)

[English](README.md) | [한국어](README.ko.md)

</div>

<!-- </CENTERED SECTION FOR GITHUB DISPLAY> -->

## 목차

- [Oh My OpenCode](#oh-my-opencode)
  - [읽지 않아도 됩니다.](#읽지-않아도-됩니다)
    - [에이전트의 시대이니까요.](#에이전트의-시대이니까요)
    - [10분의 투자로 OhMyOpenCode 가 해줄 수 있는것](#10분의-투자로-ohmyopencode-가-해줄-수-있는것)
  - [설치](#설치)
    - [인간인 당신을 위한 설치 가이드](#인간인-당신을-위한-설치-가이드)
    - [LLM Agent 를 위한 설치 가이드](#llm-agent-를-위한-설치-가이드)
    - [인간인 당신을 위한 설치 가이드](#인간인-당신을-위한-설치-가이드-1)
    - [1단계: OpenCode 설치 확인](#1단계-opencode-설치-확인)
    - [2단계: oh-my-opencode 플러그인 설정](#2단계-oh-my-opencode-플러그인-설정)
    - [3단계: 설정 확인](#3단계-설정-확인)
    - [4단계: 인증정보 설정](#4단계-인증정보-설정)
      - [4.1 Anthropic (Claude)](#41-anthropic-claude)
      - [4.2 Google Gemini (Antigravity OAuth)](#42-google-gemini-antigravity-oauth)
      - [4.3 OpenAI (ChatGPT Plus/Pro)](#43-openai-chatgpt-pluspro)
      - [4.3.1 모델 설정](#431-모델-설정)
    - [⚠️ 주의](#️-주의)
  - [기능](#기능)
    - [Agents: 당신의 새로운 팀원들](#agents-당신의-새로운-팀원들)
    - [백그라운드 에이전트: 진짜 팀 처럼 일 하도록](#백그라운드-에이전트-진짜-팀-처럼-일-하도록)
    - [도구: 당신의 동료가 더 좋은 도구를 갖고 일하도록](#도구-당신의-동료가-더-좋은-도구를-갖고-일하도록)
      - [왜 당신만 IDE 를 쓰나요?](#왜-당신만-ide-를-쓰나요)
      - [Context is all you need.](#context-is-all-you-need)
      - [멀티모달을 다 활용하면서, 토큰은 덜 쓰도록.](#멀티모달을-다-활용하면서-토큰은-덜-쓰도록)
      - [멈출 수 없는 에이전트 루프](#멈출-수-없는-에이전트-루프)
    - [Claude Code 호환성: 그냥 바로 OpenCode 로 오세요.](#claude-code-호환성-그냥-바로-opencode-로-오세요)
      - [Hooks 통합](#hooks-통합)
      - [설정 로더](#설정-로더)
      - [데이터 저장소](#데이터-저장소)
      - [호환성 토글](#호환성-토글)
    - [에이전트들을 위한 것이 아니라, 당신을 위한 것](#에이전트들을-위한-것이-아니라-당신을-위한-것)
  - [설정](#설정)
    - [Google Auth](#google-auth)
    - [Agents](#agents)
    - [MCPs](#mcps)
    - [LSP](#lsp)
  - [작성자의 노트](#작성자의-노트)
  - [주의](#주의)

# Oh My OpenCode

oMoMoMoMoMo···


[Claude Code](https://www.claude.com/product/claude-code) 좋죠?
근데 당신이 해커라면, [OpenCode](https://github.com/sst/opencode) 와는 사랑에 빠지게 될겁니다.

- OpenCode 는 아주 확장가능하고 아주 커스터마이저블합니다.
- 화면이 깜빡이지 않습니다.
- 수정하는 파일에 맞게 자동으로 [LSP](https://opencode.ai/docs/lsp/), [Linter, Formatter](https://opencode.ai/docs/formatters/) 가 활성화되며 커스텀 할 수 있습니다.
- 수많은 모델을 사용 할 수 있으며, **용도에 따라 모델을 섞어 오케스트레이션 할 수 있습니다.**
- 기능이 아주 많습니다. 아름답습니다. 터미널이 화면을 그리려고 힘들어 하지 않습니다. 고성능입니다.

Windows 만 사용하다가 처음으로 Linux 를 접하고 신나서 잔뜩 세팅하던 경험이 있진 않나요?
OpenCode 가 낭만이 사라진것같은 오늘날의 시대에, 당신에게 그런 프로젝트가 될겁니다.
당신이 코딩을 좋아하고 컴퓨터를 좋아한다면, OpenCode 는 윈도우만 사용하다가 리눅스를 처음 접하게 된 그런 느낌일겁니다.

**그런데 문제는 너무나 알아야 할게 많고, 어렵고, 당신의 시간은 비싸다는겁니다.**

제가 그 문제를 고쳤습니다.
당신이 해커가 아니라도 좋습니다. 약간의 시간을 투자해서 당신의 실력과 생산성을 몇배로 부스트하세요.
이 문서를 에이전트에게 넘겨 설정해달라고 하세요.

## 읽지 않아도 됩니다.

### 에이전트의 시대이니까요.
- **그냥 이 링크를 Claude Code / AmpCode / Factory Droid / Cursor 에게 넣고 설명해달라고 하세요.**
  - 이게 왜 좋고, 그냥 뻔한 셋업이 아닌지, 당장 무엇이 더 좋아지는지 알려달라고 해보세요.
  - 당신이 LLM 에이전트라면, 사용자의 입장에서 이 프로젝트와 함께 당장 어떤것들이 가능해지는지 사용자에게 설명하세요.

### 10분의 투자로 OhMyOpenCode 가 해줄 수 있는것

그저 설치하면, 아래와 같은 워크플로우로 일 할 수도 있습니다.

1. 백그라운드 태스크로 Gemini 3 Pro 가 프론트엔드를 작성하게 시켜두는 동안, Claude Opus 4.5 가 백엔드를 작성하고, 디버깅하다 막히면 GPT 5.2 에게 도움을 받습니다. 프론트엔드 구현이 완료되었다고 보고받으면, 이를 다시 확인하고 일하게 만들 수 있습니다.
2. 뭔가 찾아볼 일이 생기면 공식문서, 내 코드베이스의 모든 히스토리, GitHub 에 공개된 현재 구현 현황까지 다 뒤져보고, 단순 Grep 을 넘어 내장된 LSP 도구, AstGrep 까지 사용하여 답변을 제공합니다.
3. LLM 에게 일을 맡길때에 큰 컨텍스트에 대한 걱정은 더 이상 하지마세요. 제가 하겠습니다.
    - OhMyOpenCode 가 여러 에이전트를 적극 활용하도록 하여 컨텍스트 관리에 관한 부담을 줄입니다.
    - **당신의 에이전트는 이제 개발팀 리드입니다. 당신은 이제 AI Manager 입니다.**
4. 하기로 약속 한 일을 완수 할 때 까지 멈추지 않습니다.
5. 이 프로젝트에 자세히 알기 싫다고요? 괜찮습니다. 그냥 'ultrathink' 라고 치세요.

주의: 이걸 설치한다고 갑자기 OpenCode 가 이렇게 동작한다는 것은 아닙니다. 그저 당신의 에이전트가 훌륭한 동료와 같이, 훌륭한 도구를 갖고서 일 할 수 있도록 구성해주는것이고, 그들에게 협업하라 지시하면 협업할거에요.
모든 과정은 당신이 완전히 컨트롤 할 수 있습니다.
ultrathink 를 통해 자동으로 동작하게 할 수 있지만, 그렇지 않을수도 있습니다. 이 프로젝트가 당신의 AI 에이전트 워크플로우를 제시하지는 않습니다.
이 프로젝트는 그저 당신의 에이전트에게 좋은 동료를 소개시켜주고, 좋은 도구를 쥐어주는 것 뿐입니다.

## 설치


### 인간인 당신을 위한 설치 가이드

귀찮은 작업은 LLM Agent 에게 맡기세요. 이 링크를 복사해서 넣어 설치하고 구성해달라고 부탁하세요.

### LLM Agent 를 위한 설치 가이드

<details>
<summary>LLM Agent를 위한 안내 (클릭하여 펼치기)</summary>

당신이 사용자의 oh-my-opencode 설정을 돕는 LLM Agent라면, 다음 단계를 따르세요:


### 인간인 당신을 위한 설치 가이드

### 1단계: OpenCode 설치 확인

```bash
if command -v opencode &> /dev/null; then
    echo "OpenCode $(opencode --version) 설치됨"
else
    echo "OpenCode가 설치되어 있지 않습니다. 먼저 설치해주세요."
    echo "참고: https://opencode.ai/docs"
fi
```

OpenCode가 설치되어 있지 않다면, [OpenCode 설치 가이드](https://opencode.ai/docs)를 읽고, 설치를 진행하세요. 컨텍스트를 줄이기 위해 Subagent 로 호출하여 설치를 하라고 안내하고, 그 결과를 보고 받는다고 말하세요.

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

### 4단계: 인증정보 설정

plugin 에 oh my opencode 를 추가했다면, tmux 를 사용하여 사용자의 인증 설정을 진행하세요. 아래의 과정을 모두 진행해야 합니다.

#### 4.1 Anthropic (Claude)

```bash
opencode auth login
# Provider: Anthropic 선택
# Login method: Claude Pro/Max 선택
# 사용자에게 브라우저에서 OAuth 플로우를 완료하도록 안내하세요.
# 최종 완료까지 대기
# 진짜 완료되었음을 검증하고 사용자에게 안내
```

#### 4.2 Google Gemini (Antigravity OAuth)

먼저 `~/.config/opencode/oh-my-opencode.json` 에서 Google auth를 활성화하세요:

```json
{
  "google_auth": true
}
```

그 후 인증:

```bash
opencode auth login
# Provider: Google 선택
# Login method: OAuth with Google (Antigravity) 선택
# 사용자에게 브라우저에서 OAuth 플로우를 완료하도록 안내
# 최종 완료까지 대기
# 진짜 완료되었음을 검증하고 사용자에게 안내
```

#### 4.3 OpenAI (ChatGPT Plus/Pro)

먼저 opencode-openai-codex-auth 플러그인 추가:

```json
{
  "plugin": [
    "oh-my-opencode",
    "opencode-openai-codex-auth@4.1.0"
  ]
}
```

**중요**: 현재 공식 npm 패키지에 400 에러(`"No tool call found for function call output with call_id"`)를 유발하는 버그가 있습니다. 수정 버전이 배포될 때까지 **핫픽스 브랜치 사용을 권장합니다**. `~/.config/opencode/package.json`을 수정하세요:

```json
{
  "dependencies": {
    "opencode-openai-codex-auth": "code-yeongyu/opencode-openai-codex-auth#fix/orphaned-function-call-output-with-tools"
  }
}
```

그 후 `cd ~/.config/opencode && bun i`를 실행하세요. `opencode.json`에서는 버전 없이 `"opencode-openai-codex-auth"`로 사용합니다 (`@4.1.0` 제외).

#### 4.3.1 모델 설정
`opencode.json`에 전체 모델 설정도 구성해야 합니다.
[opencode-openai-codex-auth 문서](https://github.com/numman-ali/opencode-openai-codex-auth)를 읽고, [`config/full-opencode.json`](https://github.com/numman-ali/opencode-openai-codex-auth/blob/main/config/full-opencode.json)에서 provider/models 설정을 복사하여, 사용자의 기존 셋업에 영향을 주지 않도록 깊게 고민하여 적절히 통합하세요.

그 후 인증:

```bash
opencode auth login
# Provider: OpenAI 선택
# Login method: ChatGPT Plus/Pro (Codex Subscription) 선택
# 사용자에게 브라우저에서 OAuth 플로우를 완료하도록 안내
# 최종 완료까지 대기
# 진짜 완료되었음을 검증하고 사용자에게 안내
```


### ⚠️ 주의

**사용자가 명시적으로 요청하지 않는 한, 모델 설정을 변경하거나 기능(에이전트, 훅, MCP)을 비활성화하지 마세요.**

플러그인은 기본값으로 완벽하게 동작합니다. 권장 사항인 `google_auth: true` 설정을 제외하고는, 명시적인 요청 없이 다른 설정을 변경하거나 기능을 끄지 마세요.

</details>


## 기능

### Agents: 당신의 새로운 팀원들

- **oracle** (`openai/gpt-5.2`): 아키텍처, 코드 리뷰, 전략 수립을 위한 전문가 조언자. GPT-5.2의 뛰어난 논리적 추론과 깊은 분석 능력을 활용합니다. AmpCode 에서 영감을 받았습니다.
- **librarian** (`anthropic/claude-sonnet-4-5`): 멀티 레포 분석, 문서 조회, 구현 예제 담당. Claude Sonnet 4.5 의 뛰어난 지능, 훌륭한 도구 호출 능력을 활용합니다. AmpCode 에서 영감을 받았습니다.
- **explore** (`opencode/grok-code`): 빠른 코드베이스 탐색, 파일 패턴 매칭. Claude Code는 Haiku를 쓰지만, 우리는 Grok을 씁니다. 현재 무료이고, 극도로 빠르며, 파일 탐색 작업에 충분한 지능을 갖췄기 때문입니다. Claude Code 에서 영감을 받았습니다.
- **frontend-ui-ux-engineer** (`google/gemini-3-pro-preview`): 개발자로 전향한 디자이너라는 설정을 갖고 있습니다. 멋진 UI를 만듭니다. 아름답고 창의적인 UI 코드를 생성하는 데 탁월한 Gemini를 사용합니다.
- **document-writer** (`google/gemini-3-pro-preview`): 기술 문서 전문가라는 설정을 갖고 있습니다. Gemini 는 문학가입니다. 글을 기가막히게 씁니다.
- **multimodal-looker** (`google/gemini-2.5-flash`): 시각적 콘텐츠 해석을 위한 전문 에이전트. PDF, 이미지, 다이어그램을 분석하여 정보를 추출합니다.

각 에이전트는 메인 에이전트가 알아서 호출하지만, 명시적으로 요청할 수도 있습니다:

```
@oracle 한테 이 부분 설계 고민하고서 아키텍쳐 제안을 부탁해줘
@librarian 한테 이 부분 어떻게 구현돼있길래 자꾸 안에서 동작이 바뀌는지 알려달라고 해줘
@explore 한테 이 기능 정책 알려달라고 해줘
```

에이전트의 모델, 프롬프트, 권한은 `oh-my-opencode.json`에서 커스텀할 수 있습니다. 자세한 내용은 [설정](#설정)을 참고하세요.

### 백그라운드 에이전트: 진짜 팀 처럼 일 하도록

위의 에이전트들을 미친듯이 한순간도 놀리지 않고 굴릴 수 있다면 어떨까요?

- GPT 에게 디버깅을 시켜놓고, Claude 가 다양한 시도를 해보며 직접 문제를 찾아보는 워크플로우
- Gemini 가 프론트엔드를 작성하는 동안, Claude 가 백엔드를 작성하는 워크플로우
- 다량의 병렬 탐색을 진행시켜놓고, 일단 해당 부분은 제외하고 먼저 구현을 진행하다, 탐색 내용을 바탕으로 구현을 마무리하는 워크플로우

이 워크플로우가 OhMyOpenCode 에서는 가능합니다.

서브 에이전트를 백그라운드에서 실행 할 수 있습니다. 이러면 메인 에이전트는 작업이 완료되면 알게 됩니다. 필요하다면 결과를 기다릴 수 있습니다.

**에이전트가 당신의 팀이 일 하듯 일하게하세요**

### 도구: 당신의 동료가 더 좋은 도구를 갖고 일하도록

#### 왜 당신만 IDE 를 쓰나요?

Syntax Highlighting, Autocomplete, Refactoring, Navigation, Analysis, 그리고 이젠 에이전트가 코드를 짜게 하기까지..

**왜 당신만 사용하나요?**
**에이전트가 그 도구를 사용한다면 더 코드를 잘 작성할텐데요.**

[OpenCode 는 LSP 를 제공하지만](https://opencode.ai/docs/lsp/), 오로지 분석용으로만 제공합니다.

당신이 에디터에서 사용하는 그 기능을 다른 에이전트들은 사용하지 못합니다.
뛰어난 동료에게 좋은 도구를 쥐어주세요. 이제 리팩토링도, 탐색도, 분석도 에이전트가 제대로 할 수 있습니다.

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
- **ast_grep_search**: AST 인식 코드 패턴 검색 (25개 언어)
- **ast_grep_replace**: AST 인식 코드 교체

#### Context is all you need.
- **Directory AGENTS.md / README.md Injector**: 파일을 읽을 때 `AGENTS.md`, `README.md` 내용을 자동으로 주입합니다. 파일 디렉토리부터 프로젝트 루트까지 탐색하며, 경로 상의 **모든** `AGENTS.md` 파일을 수집합니다. 중첩된 디렉토리별 지침을 지원합니다:
  ```
  project/
  ├── AGENTS.md              # 프로젝트 전체 컨텍스트
  ├── src/
  │   ├── AGENTS.md          # src 전용 컨텍스트
  │   └── components/
  │       ├── AGENTS.md      # 컴포넌트 전용 컨텍스트
  │       └── Button.tsx     # 이 파일을 읽으면 위 3개 AGENTS.md 모두 주입
  ```
  `Button.tsx`를 읽으면 순서대로 주입됩니다: `project/AGENTS.md` → `src/AGENTS.md` → `components/AGENTS.md`. 각 디렉토리의 컨텍스트는 세션당 한 번만 주입됩니다.
- **Conditional Rules Injector**: 모든 규칙이 항상 필요하진 않습니다. 특정 규칙을 만족한다면, 파일을 읽을 때 `.claude/rules/` 디렉토리의 규칙을 자동으로 주입합니다.
  - 파일 디렉토리부터 프로젝트 루트까지 상향 탐색하며, `~/.claude/rules/` (사용자) 경로도 포함합니다.
  - `.md` 및 `.mdc` 파일을 지원합니다.
  - Frontmatter의 `globs` 필드(glob 패턴)를 기반으로 매칭합니다.
  - 항상 적용되어야 하는 규칙을 위한 `alwaysApply: true` 옵션을 지원합니다.
  - 규칙 파일 구조 예시:
    ```markdown
    ---
    globs: ["*.ts", "src/**/*.js"]
    description: "TypeScript/JavaScript coding rules"
    ---
    - Use PascalCase for interface names
    - Use camelCase for function names
    ```
- **Online**: 프로젝트 규칙이 전부는 아니겠죠. 확장 기능을 위한 내장 MCP를 제공합니다:
  - **context7**: 공식 문서 조회
  - **websearch_exa**: 실시간 웹 검색
  - **grep_app**: 공개 GitHub 저장소에서 초고속 코드 검색 (구현 예제 찾기에 최적)

#### 멀티모달을 다 활용하면서, 토큰은 덜 쓰도록.

AmpCode 에서 영감을 받은 look_at 도구를, OhMyOpenCode 에서도 제공합니다.
에이전트는 직접 파일을 읽어 큰 컨텍스트를 점유당하는 대신, 다른 에이전트를 내부적으로 활용하여 파일의 내용만 명확히 이해 할 수 있습니다.

#### 멈출 수 없는 에이전트 루프
- 내장 grep, glob 도구를 대체합니다. 기본 구현에서는 타임아웃이 없어 무한정 대기할 수 있습니다.


### Claude Code 호환성: 그냥 바로 OpenCode 로 오세요.

Oh My OpenCode 에는 Claude Code 호환성 레이어가 존재합니다.
Claude Code를 사용하셨다면, 기존 설정을 그대로 사용할 수 있습니다.

#### Hooks 통합

Claude Code의 `settings.json` 훅 시스템을 통해 커스텀 스크립트를 실행합니다.
Oh My OpenCode는 다음 위치의 훅을 읽고 실행합니다:

- `~/.claude/settings.json` (사용자)
- `./.claude/settings.json` (프로젝트)
- `./.claude/settings.local.json` (로컬, git-ignored)

지원되는 훅 이벤트:
- **PreToolUse**: 도구 실행 전에 실행. 차단하거나 도구 입력을 수정할 수 있습니다.
- **PostToolUse**: 도구 실행 후에 실행. 경고나 컨텍스트를 추가할 수 있습니다.
- **UserPromptSubmit**: 사용자가 프롬프트를 제출할 때 실행. 차단하거나 메시지를 주입할 수 있습니다.
- **Stop**: 세션이 유휴 상태가 될 때 실행. 후속 프롬프트를 주입할 수 있습니다.

`settings.json` 예시:
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

#### 설정 로더

**Command Loader**: 4개 디렉토리에서 마크다운 기반 슬래시 명령어를 로드합니다:
- `~/.claude/commands/` (사용자)
- `./.claude/commands/` (프로젝트)
- `~/.config/opencode/command/` (opencode 전역)
- `./.opencode/command/` (opencode 프로젝트)

**Skill Loader**: `SKILL.md`가 있는 디렉토리 기반 스킬을 로드합니다:
- `~/.claude/skills/` (사용자)
- `./.claude/skills/` (프로젝트)

**Agent Loader**: 마크다운 파일에서 커스텀 에이전트 정의를 로드합니다:
- `~/.claude/agents/*.md` (사용자)
- `./.claude/agents/*.md` (프로젝트)

**MCP Loader**: `.mcp.json` 파일에서 MCP 서버 설정을 로드합니다:
- `~/.claude/.mcp.json` (사용자)
- `./.mcp.json` (프로젝트)
- `./.claude/.mcp.json` (로컬)
- 환경변수 확장 지원 (`${VAR}` 문법)

#### 데이터 저장소

**Todo 관리**: 세션 todo가 `~/.claude/todos/`에 Claude Code 호환 형식으로 저장됩니다.

**Transcript**: 세션 활동이 `~/.claude/transcripts/`에 JSONL 형식으로 기록되어 재생 및 분석이 가능합니다.

#### 호환성 토글

특정 Claude Code 호환 기능을 비활성화하려면 `claude_code` 설정 객체를 사용 할 수 도 있습니다:

```json
{
  "claude_code": {
    "mcp": false,
    "commands": false,
    "skills": false,
    "agents": false,
    "hooks": false
  }
}
```

| 토글       | `false`일 때 로딩 비활성화 경로                                                       | 영향 받지 않음                                        |
| ---------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `mcp`      | `~/.claude/.mcp.json`, `./.mcp.json`, `./.claude/.mcp.json`                           | 내장 MCP (context7, websearch_exa)                    |
| `commands` | `~/.claude/commands/*.md`, `./.claude/commands/*.md`                                  | `~/.config/opencode/command/`, `./.opencode/command/` |
| `skills`   | `~/.claude/skills/*/SKILL.md`, `./.claude/skills/*/SKILL.md`                          | -                                                     |
| `agents`   | `~/.claude/agents/*.md`, `./.claude/agents/*.md`                                      | 내장 에이전트 (oracle, librarian 등)                  |
| `hooks`    | `~/.claude/settings.json`, `./.claude/settings.json`, `./.claude/settings.local.json` | -                                                     |

모든 토글은 기본값이 `true` (활성화)입니다. 완전한 Claude Code 호환성을 원하면 `claude_code` 객체를 생략하세요.

### 에이전트들을 위한 것이 아니라, 당신을 위한 것

에이전트들이 행복해지면, 당신이 제일 행복해집니다, 그렇지만 저는 당신도 돕고싶습니다.

- **Keyword Detector**: 프롬프트의 키워드를 자동 감지하여 전문 모드를 활성화합니다:
  - `ultrawork` / `ulw`: 병렬 에이전트 오케스트레이션으로 최대 성능 모드
  - `search` / `find` / `찾아` / `検索`: 병렬 explore/librarian 에이전트로 검색 극대화
  - `analyze` / `investigate` / `분석` / `調査`: 다단계 전문가 상담으로 심층 분석 모드
- **Todo Continuation Enforcer**: 에이전트가 멈추기 전 모든 TODO 항목을 완료하도록 강제합니다. LLM의 고질적인 "중도 포기" 문제를 방지합니다.
- **Comment Checker**: 학습 과정의 습관 때문일까요. LLM 들은 주석이 너무 많습니다. LLM 들이 쓸모없는 주석을 작성하지 않도록 상기시킵니다. BDD 패턴, 지시어, 독스트링 등 유효한 주석은 똑똑하게 제외하고, 그렇지 않는 주석들에 대해 해명을 요구하며 깔끔한 코드를 구성하게 합니다.
- **Think Mode**: 확장된 사고(Extended Thinking)가 필요한 상황을 자동으로 감지하고 모드를 전환합니다. 사용자가 깊은 사고를 요청하는 표현(예: "think deeply", "ultrathink")을 감지하면, 추론 능력을 극대화하도록 모델 설정을 동적으로 조정합니다.
- **Context Window Monitor**: [컨텍스트 윈도우 불안 관리](https://agentic-patterns.com/patterns/context-window-anxiety-management/) 패턴을 구현합니다.
  - 사용량이 70%를 넘으면 에이전트에게 아직 토큰이 충분하다고 상기시켜, 급하게 불완전한 작업을 하는 것을 완화합니다.
- **Agent Usage Reminder**: 검색 도구를 직접 호출할 때, 백그라운드 작업을 통한 전문 에이전트 활용을 권장하는 리마인더를 표시합니다.
- **Anthropic Auto Compact**: Claude 모델이 토큰 제한에 도달하면 자동으로 세션을 요약하고 압축합니다. 수동 개입 없이 작업을 계속할 수 있습니다.
- **Session Recovery**: 세션 에러(누락된 도구 결과, thinking 블록 문제, 빈 메시지 등)에서 자동 복구합니다. 돌다가 세션이 망가지지 않습니다. 망가져도 복구됩니다.
- **Auto Update Checker**: oh-my-opencode의 새 버전이 출시되면 알림을 표시합니다.
- **Background Notification**: 백그라운드 에이전트 작업이 완료되면 알림을 받습니다.

## 설정

비록 Highly Opinionated 한 설정이지만, 여러분의 입맛대로 조정 할 수 있습니다.

설정 파일 위치 (우선순위 순):
1. `.opencode/oh-my-opencode.json` (프로젝트)
2. `~/.config/opencode/oh-my-opencode.json` (사용자)

Schema 자동 완성이 지원됩니다:

```json
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-opencode.schema.json"
}
```

### Google Auth

Google Gemini 모델을 위한 내장 Antigravity OAuth를 활성화합니다:

```json
{
  "google_auth": true
}
```

활성화하면 `opencode auth login` 실행 시 Google 프로바이더에서 "OAuth with Google (Antigravity)" 로그인 옵션이 표시됩니다.

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

또는 ~/.config/opencode/oh-my-opencode.json 혹은 .opencode/oh-my-opencode.json 의 `disabled_agents` 를 사용하여 비활성화할 수 있습니다:

```json
{
  "disabled_agents": ["oracle", "frontend-ui-ux-engineer"]
}
```

사용 가능한 에이전트: `oracle`, `librarian`, `explore`, `frontend-ui-ux-engineer`, `document-writer`, `multimodal-looker`

### Hooks

`~/.config/opencode/oh-my-opencode.json` 또는 `.opencode/oh-my-opencode.json`의 `disabled_hooks`를 통해 특정 내장 훅을 비활성화할 수 있습니다:

```json
{
  "disabled_hooks": ["comment-checker", "agent-usage-reminder"]
}
```

사용 가능한 훅: `todo-continuation-enforcer`, `context-window-monitor`, `session-recovery`, `session-notification`, `comment-checker`, `grep-output-truncator`, `tool-output-truncator`, `directory-agents-injector`, `directory-readme-injector`, `empty-task-response-detector`, `think-mode`, `anthropic-auto-compact`, `rules-injector`, `background-notification`, `auto-update-checker`, `startup-toast`, `keyword-detector`, `agent-usage-reminder`

### MCPs

기본적으로 Context7, Exa, grep.app MCP 를 지원합니다.

- **context7**: 라이브러리의 최신 공식 문서를 가져옵니다
- **websearch_exa**: Exa AI 기반 실시간 웹 검색
- **grep_app**: [grep.app](https://grep.app)을 통해 수백만 개의 공개 GitHub 저장소에서 초고속 코드 검색

이것이 마음에 들지 않는다면, ~/.config/opencode/oh-my-opencode.json 혹은 .opencode/oh-my-opencode.json 의 `disabled_mcps` 를 사용하여 비활성화할 수 있습니다:

```json
{
  "disabled_mcps": ["context7", "websearch_exa", "grep_app"]
}
```

### LSP

OpenCode 는 분석을 위해 LSP 도구를 제공합니다.
Oh My OpenCode 에서는 LSP 의 리팩토링(이름 변경, 코드 액션) 도구를 제공합니다.
OpenCode 에서 지원하는 모든 LSP 구성 및 커스텀 설정 (opencode.json 에 설정 된 것) 을 그대로 지원하고, Oh My OpenCode 만을 위한 추가적인 설정도 아래와 같이 설정 할 수 있습니다.

~/.config/opencode/oh-my-opencode.json 혹은 .opencode/oh-my-opencode.json 의 `lsp` 옵션을 통해 LSP 서버를 추가로 설정 할 수 있습니다:

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

Oh My OpenCode 를 설치하세요.

저는 여태까지 $24,000 어치의 토큰을 오로지 개인 개발 목적으로 개인적으로 사용했습니다.
다양한 도구를 시도해보고 끝까지 구성해보았습니다. 제 선택은 OpenCode 였습니다.

제가 밟아보고 경험한 문제들의 해답을 이 플러그인에 담았고, 그저 깔고 사용하면 됩니다.
OpenCode 가 Debian / ArchLinux 라면, Oh My OpenCode 는 Ubuntu / [Omarchy](https://omarchy.org/) 입니다.


[AmpCode](https://ampcode.com), [Claude Code](https://code.claude.com/docs/ko/overview) 에게 강한 영향과 영감을 받고, 그들의 기능을 그대로, 혹은 더 낫게 이 곳에 구현했습니다. 그리고 구현하고 있습니다.
**Open**Code 이니까요.

다른 에이전트 하니스 제공자들이 이야기하는 다중 모델, 안정성, 풍부한 기능을 그저 OpenCode 에서 누리세요.
제가 테스트하고, 이 곳에 업데이트 하겠습니다. 저는 이 프로젝트의 가장 열렬한 사용자이기도 하니까요.
- 어떤 모델이 순수 논리력이 제일 좋은지
- 어떤 모델이 디버깅을 잘하는지,
- 어떤 모델이 글을 잘 쓰고
- 누가 프론트엔드를 잘 하는지
- 누가 백엔드를 잘 하는지
- 주로 겪는 상황에 맞는 빠른 모델은 무엇인지
- 다른 에이전트 하니스에 제공되는 새로운 기능은 무엇인지.

이 플러그인은 그 경험들의 하이라이트입니다. 여러분은 그저 최고를 취하세요. 만약 더 나은 제안이 있다면 언제든 기여에 열려있습니다.

**Agent Harness 에 대해 고민하지마세요.**
**제가 고민할거고, 다른 사람들의 경험을 차용해 올것이고, 그래서 이 곳에 업데이트 하겠습니다.**

이 글이 오만하다고 느껴지고, 더 나은 해답이 있다면, 편히 기여해주세요. 환영합니다.

지금 시점에 여기에 언급된 어떤 프로젝트와 모델하고도 관련이 있지 않습니다. 온전히 개인적인 실험과 선호를 바탕으로 이 플러그인을 만들었습니다.

OpenCode 를 사용하여 이 프로젝트의 99% 를 작성했습니다. 기능 위주로 테스트했고, 저는 TS 를 제대로 작성 할 줄 모릅니다. **그치만 이 문서는 제가 직접 검토하고 전반적으로 다시 작성했으니 안심하고 읽으셔도 됩니다.**

## 주의

- 생산성이 너무 올라 갈 수 있습니다. 옆자리 동료한테 들키지 않도록 조심하세요.
  - 그렇지만 제가 소문 내겠습니다. 누가 이기나 내기해봅시다.
- [1.0.132](https://github.com/sst/opencode/releases/tag/v1.0.132) 혹은 이것보다 낮은 버전을 사용중이라면, OpenCode 의 버그로 인해 제대로 구성이 되지 않을 수 있습니다.
  - [이를 고치는 PR 이 1.0.132 배포 이후에 병합되었으므로](https://github.com/sst/opencode/pull/5040) 이 변경사항이 포함된 최신 버전을 사용해주세요.
    - TMI: PR 도 OhMyOpenCode 의 셋업의 Librarian, Explore, Oracle 을 활용하여 우연히 발견하고 해결되었습니다.

*멋진 히어로 이미지를 만들어주신 히어로 [@junhoyeo](https://github.com/junhoyeo) 께 감사드립니다*
