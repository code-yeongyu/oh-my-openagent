# src/hooks/claude-code-hooks/ — Claude Code 호환성

**생성일:** 2026-04-18

## 개요

19개 파일에 걸쳐 ~2110 LOC. Claude Code settings.json 호환성 레이어를 제공. CC 권한 규칙을 파싱하고 CC 훅(PreToolUse, PostToolUse)을 OpenCode 훅에 매핑.

## 역할

1. Claude Code `settings.json` 권한 형식 파싱
2. CC 훅 타입을 OpenCode 이벤트 타입에 매핑
3. CC 권한 규칙 강제 (도구별 allow/deny)
4. CC `.claude/settings.json` 및 `.claude/settings.local.json` 지원

## CC → OPENCODE 훅 매핑

| CC Hook | OpenCode Event |
|---------|---------------|
| PreToolUse | tool.execute.before |
| PostToolUse | tool.execute.after |
| Notification | event (session.idle) |
| Stop | event (session.idle) |

## 권한 시스템

CC 권한 형식:
```json
{
  "permissions": {
    "allow": ["Edit", "Write"],
    "deny": ["Bash(rm:*)"]
  }
}
```

shared/의 permission-compat을 통해 OpenCode 도구 제약으로 번역됨.

## 파일

주요 파일: `settings-loader.ts` (CC settings 파싱), `hook-mapper.ts` (CC→OC 매핑), `permission-handler.ts` (규칙 강제), `types.ts` (CC 타입 정의).
