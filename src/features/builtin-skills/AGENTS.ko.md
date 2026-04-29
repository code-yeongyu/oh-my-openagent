# src/features/builtin-skills/ -- 8개 빌트인 스킬

**생성일:** 2026-04-11

## 개요

24개 파일. `createBuiltinSkills()` 를 통해 등록된 8개 빌트인 스킬. 각 스킬은 name, description, content, 그리고 선택적 MCP 설정을 갖는 `BuiltinSkill` 인터페이스를 구현.

## 구조

```
builtin-skills/
├── index.ts              # Barrel exports
├── skills.ts             # createBuiltinSkills() 팩토리
├── types.ts              # BuiltinSkill 인터페이스
├── git-master/           # SKILL.md + 리소스
├── frontend-ui-ux/       # SKILL.md
├── agent-browser/        # SKILL.md
├── dev-browser/          # SKILL.md
└── skills/               # .ts 파일로 된 스킬 구현
    ├── git-master-sections/  # Git master 프롬프트 섹션
    ├── playwright.ts         # Playwright + agent-browser + playwright-cli + dev-browser
    ├── frontend-ui-ux.ts     # Frontend UI/UX 스킬
    ├── review-work.ts        # 5-에이전트 병렬 리뷰 오케스트레이터
    └── ai-slop-remover.ts    # AI 코드 스멜 제거기
```

## 스킬 카탈로그

| 스킬 | LOC | MCP | 목적 |
|-------|-----|-----|---------|
| **git-master** | 1111 | -- | 원자적 커밋, 리베이스, 히스토리 검색 |
| **playwright** | 312 | @playwright/mcp | MCP를 통한 브라우저 자동화 |
| **playwright-cli** | 268 | -- | CLI를 통한 브라우저 자동화 |
| **agent-browser** | (playwright.ts 내) | -- | agent-browser 도구를 통한 브라우저 |
| **dev-browser** | 221 | -- | 영속 페이지 상태 브라우저 |
| **frontend-ui-ux** | 79 | -- | 디자인 우선 UI 개발 |
| **review-work** | ~500 | -- | 5-에이전트 사후 구현 리뷰 |
| **ai-slop-remover** | ~300 | -- | AI 코드 패턴 제거 |

## 브라우저 변형 선택

`browser_automation_engine` 설정이 어떤 브라우저 스킬이 로드될지 선택:
- `"playwright"` (기본) -> @playwright/mcp 가 포함된 playwright
- `"playwright-cli"` -> CLI 기반 playwright
- `"agent-browser"` -> agent-browser 도구

## 스킬 로딩

스킬은 우선순위에 따라 `opencode-skill-loader` 가 로드: project > opencode > user > builtin. 동일 이름의 사용자 설치 스킬은 빌트인을 오버라이드.
