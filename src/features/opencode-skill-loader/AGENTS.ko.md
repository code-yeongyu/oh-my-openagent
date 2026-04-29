# src/features/opencode-skill-loader/ — 4-스코프 스킬 디스커버리

**생성일:** 2026-04-11

## 개요

28개 파일 (약 3.2k LOC). 4개 스코프에서 SKILL.md 파일을 우선순위 중복 제거와 함께 디스커버리, 파싱, 머지, 해석.

## 4-스코프 우선순위 (높음 → 낮음)

```
1. Project (.opencode/skills/)
2. OpenCode 설정 (~/.config/opencode/skills/)
3. User (~/.config/opencode/oh-my-opencode/skills/)
4. Global (빌트인 스킬)
```

상위 스코프의 동일 이름 스킬이 하위를 오버라이드.

## 주요 파일

| 파일 | 목적 |
|------|---------|
| `loader.ts` | 메인 `loadSkills()` — 디스커버리 → 파싱 → 머지 오케스트레이션 |
| `async-loader.ts` | 논블로킹 스킬 로딩용 비동기 변형 |
| `blocking.ts` | 초기 로드용 동기 변형 |
| `merger.ts` | 스코프 간 우선순위 기반 중복 제거 |
| `skill-content.ts` | SKILL.md 의 YAML frontmatter 파싱 |
| `skill-discovery.ts` | 디렉토리 트리에서 SKILL.md 파일 찾기 |
| `skill-directory-loader.ts` | 단일 디렉토리에서 모든 스킬 로드 |
| `config-source-discovery.ts` | 설정에서 스코프 디렉토리 디스커버리 |
| `skill-template-resolver.ts` | 스킬 템플릿의 변수 치환 |
| `skill-mcp-config.ts` | 스킬 YAML 에서 MCP 설정 추출 |
| `types.ts` | `LoadedSkill`, `SkillScope`, `SkillDiscoveryResult` |

## 스킬 포맷 (SKILL.md)

```markdown
---
name: my-skill
description: 이 스킬이 하는 일
tools: [Bash, Read, Write]
mcp:
  - name: my-mcp
    type: stdio
    command: npx
    args: [-y, my-mcp-server]
---

스킬 내용 (에이전트를 위한 지시 사항)...
```

## MERGER 서브디렉토리

여러 스코프의 스킬이 이름 또는 MCP 설정에서 겹칠 때의 복잡한 머지 로직 처리.

## 템플릿 해석

`{{directory}}`, `{{agent}}` 같은 변수는 현재 컨텍스트를 기반으로 로드 시점에 해석됨.
