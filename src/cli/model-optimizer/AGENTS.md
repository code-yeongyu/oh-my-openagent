# MODEL OPTIMIZER KNOWLEDGE BASE

## OVERVIEW
Static model optimizer that uses pre-defined rankings to select optimal models for each agent. Entry: `bunx oh-my-opencode model-config` or `bunx oh-my-opencode model-config --apply`.

**No API calls - completely free!**

## STRUCTURE
```
model-optimizer/
├── types.ts            # Type definitions and Zod schemas (ModelTier, ModelInfo)
├── model-detector.ts   # Parse `opencode models`, tier classification
├── rankings.ts         # Static model rankings by category
└── test-command.ts     # CLI command for showing/applying optimal config
```

## HOW IT WORKS
1. Detects available models via `opencode models`
2. Matches available models against static rankings by category
3. Generates optimal agent→model and category→model configuration
4. Outputs recommended config (or writes it with `--apply`)

## RANKING CATEGORIES
| Category | Purpose | Used By |
|----------|---------|---------|
| orchestrator | Best overall models for complex tasks | Sisyphus, build, plan |
| reasoning | Best reasoning/debugging models | oracle, Metis, Momus |
| fast | Fast + capable models for quick lookups | explore |
| coding | Best coding models | frontend-ui-ux-engineer |
| instruction | Best instruction-following models | librarian, document-writer |
| multimodal | Vision-capable models | multimodal-looker |
| creative | Creative/artistic models | artistry category |
| free | Free/cheap fallback models | Fallback for any agent |

## CLI USAGE
```bash
# Show optimal config
bunx oh-my-opencode model-config

# Show with full rankings
bunx oh-my-opencode model-config --verbose

# Auto-apply config to ~/.config/opencode/oh-my-opencode.json
bunx oh-my-opencode model-config --apply
```

## OUTPUT
The command outputs:
1. List of your available models
2. Optimal agent → model mapping with ranking position
3. Optimal category → model mapping with temperature/variant
4. Recommended config JSON (or confirmation if --apply used)

## HOW TO CONTRIBUTE RANKINGS

### Adding a New Model
1. Find the model ID by running `opencode models`
2. Edit `rankings.ts`
3. Add the model ID to the appropriate category in `MODEL_RANKINGS`
4. Position matters - place it where it belongs relative to other models
5. Test: `bunx oh-my-opencode model-config --verbose`

### Reordering Models
1. Edit `rankings.ts`
2. Move the model ID up (higher priority) or down (lower priority) within its category
3. Test to verify the change

### Adding a New Agent
1. Add entry to `AGENT_RANKING_MAP` mapping agent name → category
2. Optionally set variant in `generateOptimalConfig()` function

### Adding a New Task Category
1. Add entry to `CATEGORY_RANKING_MAP` mapping category → ranking category
2. Add entry to `CATEGORY_TEMPERATURES` (0.1-0.9)
3. Add entry to `CATEGORY_VARIANTS` ("low", "medium", "high", "max")

### Testing Changes
```bash
bun test src/cli/model-optimizer/  # Run unit tests
bunx oh-my-opencode model-config   # See generated config
bunx oh-my-opencode model-config --verbose  # See full rankings with your models
```

## TYPE REFERENCE
Key types in `types.ts`:
- `ModelTier`: "flagship" | "standard" | "lite"
- `ModelInfo`: Model info parsed from `opencode models`

Key types in `rankings.ts`:
- `RankingCategory`: The 8 ranking categories
- `AGENT_RANKING_MAP`: Maps agent names to ranking categories
- `CATEGORY_RANKING_MAP`: Maps task categories to ranking categories

## ANTI-PATTERNS
- Adding models without testing `model-config` command
- Putting paid models before free models in the `free` category
- Skipping TDD (test first!)
