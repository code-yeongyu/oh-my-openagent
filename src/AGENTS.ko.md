# src/ — 플러그인 소스

**생성일:** 2026-04-18

## 개요

진입점 `index.ts`는 5단계 초기화를 조율합니다: loadConfig → createManagers → createTools → createHooks → createPluginInterface.

## 주요 파일

| 파일 | 목적 |
|------|---------|
| `index.ts` | 플러그인 진입점, `pluginModule: PluginModule`을 `{ id, server }` 형태로 default-export |
| `plugin-config.ts` | JSONC 파싱, 다단계 병합, Zod v4 검증 |
| `create-managers.ts` | TmuxSessionManager, BackgroundManager, SkillMcpManager, ConfigHandler |
| `create-tools.ts` | SkillContext + AvailableCategories + ToolRegistry (26개 도구) |
| `create-hooks.ts` | 3계층 구조: Core(43) + Continuation(7) + Skill(2) = 52 hooks |
| `plugin-interface.ts` | 10개 OpenCode 훅 핸들러: config, tool, chat.message, chat.params, chat.headers, event, tool.execute.before, tool.execute.after, experimental.chat.messages.transform, experimental.session.compacting |

## 설정 로딩

```
loadPluginConfig(directory, ctx)
  1. User: ~/.config/opencode/oh-my-opencode.jsonc
  2. Project: .opencode/oh-my-opencode.jsonc
  3. mergeConfigs(user, project) → agents/categories는 deepMerge, disabled_*는 Set union
  4. Zod safeParse → 누락 필드는 기본값 적용
  5. migrateConfigFile() → 레거시 키 변환
```

## 훅 구성

```
createHooks()
  ├─→ createCoreHooks()           # 43 hooks
  │   ├─ createSessionHooks()     # 24: contextWindowMonitor, thinkMode, ralphLoop, modelFallback, runtimeFallback, noSisyphusGpt, noHephaestusNonGpt, anthropicEffort, intentGate, legacyPluginToast...
  │   ├─ createToolGuardHooks()   # 14: commentChecker, rulesInjector, writeExistingFileGuard, jsonErrorRecovery, hashlineReadEnhancer, bashFileReadGuard, readImageResizer, todoDescriptionOverride, webfetchRedirectGuard...
  │   └─ createTransformHooks()   # 5: claudeCodeHooks, keywordDetector, contextInjector, thinkingBlockValidator, toolPairValidator
  ├─→ createContinuationHooks()   # 7: todoContinuationEnforcer, atlas, stopContinuationGuard, compactionContextInjector...
  └─→ createSkillHooks()          # 2: categorySkillReminder, autoSlashCommand
```
