# Design: 修复未注册钩子 + 实现缺失的高级功能

## Goal

修复验证测试中发现的所有问题，使 50-enhancements 和 implement-missing-features 的功能完整度达到 100%。

## Architecture

### 现有架构分析

```
src/
├── hooks/                    # 钩子目录
│   ├── secret-scanner/       # ✅ 存在但未注册
│   ├── skill-auto-injector/  # ✅ 存在但未注册
│   ├── behavior-anchor/      # ❌ 缺失
│   ├── pr-context-injector/  # ❌ 缺失
│   ├── verbosity-controller/ # ❌ 缺失
│   ├── rules-injector/
│   │   ├── phase-rules.ts    # ❌ 缺失
│   │   └── phase-detector.ts # ❌ 缺失
│   ├── tdd-guard/
│   │   ├── ast-coverage-checker.ts  # ❌ 缺失
│   │   └── isolation-checker.ts     # ❌ 缺失
│   └── compaction-context-injector/
│       ├── anti-pattern-tracker.ts  # ❌ 缺失
│       └── knowledge-extractor.ts   # ❌ 缺失
├── features/
│   ├── project-detector/     # ❌ 缺失
│   ├── verification/         # ❌ 缺失
│   ├── backtrack/            # ❌ 缺失
│   └── context-injector/
│       └── relevance-scorer.ts  # ❌ 缺失
└── index.ts                  # 需要添加钩子注册
```

### 设计原则

1. **遵循现有模式**: 参考已注册钩子的模式实现
2. **最小化侵入**: 新增文件不修改现有逻辑
3. **TDD 驱动**: 每个新功能先写测试
4. **独立可测**: 每个功能可独立验证

## Key Decisions

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 钩子注册位置 | 现有钩子注册区域附近 | 保持代码组织一致性 |
| 新功能优先级 | 按依赖关系排序 | 避免前置依赖缺失 |
| 测试策略 | 单元测试 + 集成测试 | 确保功能正确且不回归 |

## Component Design

### Phase 1: 钩子注册 (2 项)

#### 1.1 secret-scanner 注册
```typescript
// src/index.ts 添加
import { createSecretScannerHook } from "./hooks/secret-scanner";

const secretScanner = isHookEnabled("secret-scanner")
  ? createSecretScannerHook()
  : undefined;
```

#### 1.2 skill-auto-injector 注册
```typescript
// src/index.ts 添加
import { createSkillAutoInjectorHook } from "./hooks/skill-auto-injector";

const skillAutoInjector = isHookEnabled("skill-auto-injector")
  ? createSkillAutoInjectorHook()
  : undefined;
```

### Phase 2: 缺失功能实现 (13 项)

#### Wave 1: 高优先级 (5 项)
| 功能 | 路径 | 依赖 |
|------|------|------|
| 项目探测 | `src/features/project-detector/` | 无 |
| 阶段检测 | `src/hooks/rules-injector/phase-detector.ts` | 无 |
| 阶段规则 | `src/hooks/rules-injector/phase-rules.ts` | phase-detector |
| 行为锚定 | `src/hooks/behavior-anchor/` | 无 |
| Verbosity 控制 | `src/hooks/verbosity-controller/` | 无 |

#### Wave 2: 中优先级 (5 项)
| 功能 | 路径 | 依赖 |
|------|------|------|
| 相关性评分 | `src/features/context-injector/relevance-scorer.ts` | 无 |
| 反模式追踪 | `src/hooks/compaction-context-injector/anti-pattern-tracker.ts` | 无 |
| 知识提取 | `src/hooks/compaction-context-injector/knowledge-extractor.ts` | 无 |
| AST 覆盖检查 | `src/hooks/tdd-guard/ast-coverage-checker.ts` | 无 |
| 测试隔离检查 | `src/hooks/tdd-guard/isolation-checker.ts` | 无 |

#### Wave 3: 低优先级 (3 项)
| 功能 | 路径 | 依赖 |
|------|------|------|
| PR 上下文注入 | `src/hooks/pr-context-injector/` | 无 |
| 验证循环 | `src/features/verification/` | 无 |
| 回溯机制 | `src/features/backtrack/` | verification |

## Data Flow

```
用户输入
    │
    ▼
┌─────────────────────────────────────┐
│ PreToolUse Hooks                    │
│  ├─ secret-scanner (新注册)         │
│  ├─ skill-auto-injector (新注册)    │
│  ├─ behavior-anchor (新实现)        │
│  └─ verbosity-controller (新实现)   │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│ Tool Execution                      │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│ PostToolUse Hooks                   │
│  ├─ anti-pattern-tracker (新实现)   │
│  └─ knowledge-extractor (新实现)    │
└─────────────────────────────────────┘
```

## Testing Strategy

| 类型 | 覆盖范围 | 工具 |
|------|----------|------|
| 单元测试 | 每个新函数 | bun test |
| 集成测试 | 钩子触发流程 | bun test |
| 类型检查 | 全项目 | tsc --noEmit |

## Rollback Plan

1. 每个功能独立 commit
2. 如发现问题，可单独 revert 对应 commit
3. 钩子通过 `isHookEnabled()` 可动态禁用
