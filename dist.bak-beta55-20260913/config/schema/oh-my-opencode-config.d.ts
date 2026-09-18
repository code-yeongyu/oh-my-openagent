import { z } from "zod";
export declare const OhMyOpenCodeConfigSchema: z.ZodObject<{
    $schema: z.ZodOptional<z.ZodString>;
    new_task_system_enabled: z.ZodOptional<z.ZodBoolean>;
    default_run_agent: z.ZodOptional<z.ZodString>;
    agent_order: z.ZodOptional<z.ZodArray<z.ZodString>>;
    agent_definitions: z.ZodOptional<z.ZodArray<z.ZodString>>;
    disabled_mcps: z.ZodOptional<z.ZodArray<z.ZodString>>;
    disabled_agents: z.ZodOptional<z.ZodArray<z.ZodString>>;
    disabled_skills: z.ZodOptional<z.ZodArray<z.ZodString>>;
    disabled_hooks: z.ZodOptional<z.ZodArray<z.ZodString>>;
    disabled_commands: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        goal: "goal";
        hyperplan: "hyperplan";
        refactor: "refactor";
        "remove-ai-slops": "remove-ai-slops";
        "stop-continuation": "stop-continuation";
        "ulw-execute": "ulw-execute";
    }>>>;
    disabled_tools: z.ZodOptional<z.ZodArray<z.ZodString>>;
    disabled_providers: z.ZodOptional<z.ZodArray<z.ZodString>>;
    mcp_env_allowlist: z.ZodOptional<z.ZodArray<z.ZodString>>;
    hashline_edit: z.ZodOptional<z.ZodBoolean>;
    telemetry: z.ZodOptional<z.ZodBoolean>;
    model_fallback: z.ZodOptional<z.ZodBoolean>;
    agents: z.ZodOptional<z.ZodObject<{
        build: z.ZodOptional<z.ZodObject<{
            model: z.ZodOptional<z.ZodString>;
            models: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
                model: z.ZodString;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    none: "none";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        disabled: "disabled";
                        enabled: "enabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>]>>>;
            fallback_models: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>, z.ZodArray<z.ZodObject<{
                model: z.ZodString;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    none: "none";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        disabled: "disabled";
                        enabled: "enabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>>, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
                model: z.ZodString;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    none: "none";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        disabled: "disabled";
                        enabled: "enabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>]>>]>>;
            reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                auto: "auto";
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                minimal: "minimal";
                off: "off";
                xhigh: "xhigh";
            }>, z.ZodString]>>;
            variant: z.ZodOptional<z.ZodString>;
            category: z.ZodOptional<z.ZodString>;
            skills: z.ZodOptional<z.ZodArray<z.ZodString>>;
            temperature: z.ZodOptional<z.ZodNumber>;
            top_p: z.ZodOptional<z.ZodNumber>;
            prompt: z.ZodOptional<z.ZodString>;
            prompt_append: z.ZodOptional<z.ZodString>;
            tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
            disable: z.ZodOptional<z.ZodBoolean>;
            description: z.ZodOptional<z.ZodString>;
            mode: z.ZodOptional<z.ZodEnum<{
                all: "all";
                primary: "primary";
                subagent: "subagent";
            }>>;
            color: z.ZodOptional<z.ZodString>;
            displayName: z.ZodOptional<z.ZodString>;
            permission: z.ZodOptional<z.ZodObject<{
                edit: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                bash: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>]>>;
                webfetch: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                task: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                doom_loop: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                external_directory: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
            }, z.core.$catchall<z.ZodOptional<z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>>>>;
            maxTokens: z.ZodOptional<z.ZodNumber>;
            thinking: z.ZodOptional<z.ZodObject<{
                type: z.ZodEnum<{
                    disabled: "disabled";
                    enabled: "enabled";
                }>;
                budgetTokens: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
            reasoningEffort: z.ZodOptional<z.ZodEnum<{
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                minimal: "minimal";
                none: "none";
                xhigh: "xhigh";
            }>>;
            textVerbosity: z.ZodOptional<z.ZodEnum<{
                high: "high";
                low: "low";
                medium: "medium";
            }>>;
            providerOptions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            ultrawork: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            compaction: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        plan: z.ZodOptional<z.ZodObject<{
            model: z.ZodOptional<z.ZodString>;
            models: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
                model: z.ZodString;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    none: "none";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        disabled: "disabled";
                        enabled: "enabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>]>>>;
            fallback_models: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>, z.ZodArray<z.ZodObject<{
                model: z.ZodString;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    none: "none";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        disabled: "disabled";
                        enabled: "enabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>>, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
                model: z.ZodString;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    none: "none";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        disabled: "disabled";
                        enabled: "enabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>]>>]>>;
            reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                auto: "auto";
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                minimal: "minimal";
                off: "off";
                xhigh: "xhigh";
            }>, z.ZodString]>>;
            variant: z.ZodOptional<z.ZodString>;
            category: z.ZodOptional<z.ZodString>;
            skills: z.ZodOptional<z.ZodArray<z.ZodString>>;
            temperature: z.ZodOptional<z.ZodNumber>;
            top_p: z.ZodOptional<z.ZodNumber>;
            prompt: z.ZodOptional<z.ZodString>;
            prompt_append: z.ZodOptional<z.ZodString>;
            tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
            disable: z.ZodOptional<z.ZodBoolean>;
            description: z.ZodOptional<z.ZodString>;
            mode: z.ZodOptional<z.ZodEnum<{
                all: "all";
                primary: "primary";
                subagent: "subagent";
            }>>;
            color: z.ZodOptional<z.ZodString>;
            displayName: z.ZodOptional<z.ZodString>;
            permission: z.ZodOptional<z.ZodObject<{
                edit: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                bash: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>]>>;
                webfetch: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                task: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                doom_loop: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                external_directory: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
            }, z.core.$catchall<z.ZodOptional<z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>>>>;
            maxTokens: z.ZodOptional<z.ZodNumber>;
            thinking: z.ZodOptional<z.ZodObject<{
                type: z.ZodEnum<{
                    disabled: "disabled";
                    enabled: "enabled";
                }>;
                budgetTokens: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
            reasoningEffort: z.ZodOptional<z.ZodEnum<{
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                minimal: "minimal";
                none: "none";
                xhigh: "xhigh";
            }>>;
            textVerbosity: z.ZodOptional<z.ZodEnum<{
                high: "high";
                low: "low";
                medium: "medium";
            }>>;
            providerOptions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            ultrawork: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            compaction: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        sisyphus: z.ZodOptional<z.ZodObject<{
            model: z.ZodOptional<z.ZodString>;
            models: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
                model: z.ZodString;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    none: "none";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        disabled: "disabled";
                        enabled: "enabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>]>>>;
            fallback_models: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>, z.ZodArray<z.ZodObject<{
                model: z.ZodString;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    none: "none";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        disabled: "disabled";
                        enabled: "enabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>>, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
                model: z.ZodString;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    none: "none";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        disabled: "disabled";
                        enabled: "enabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>]>>]>>;
            reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                auto: "auto";
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                minimal: "minimal";
                off: "off";
                xhigh: "xhigh";
            }>, z.ZodString]>>;
            variant: z.ZodOptional<z.ZodString>;
            category: z.ZodOptional<z.ZodString>;
            skills: z.ZodOptional<z.ZodArray<z.ZodString>>;
            temperature: z.ZodOptional<z.ZodNumber>;
            top_p: z.ZodOptional<z.ZodNumber>;
            prompt: z.ZodOptional<z.ZodString>;
            prompt_append: z.ZodOptional<z.ZodString>;
            tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
            disable: z.ZodOptional<z.ZodBoolean>;
            description: z.ZodOptional<z.ZodString>;
            mode: z.ZodOptional<z.ZodEnum<{
                all: "all";
                primary: "primary";
                subagent: "subagent";
            }>>;
            color: z.ZodOptional<z.ZodString>;
            displayName: z.ZodOptional<z.ZodString>;
            permission: z.ZodOptional<z.ZodObject<{
                edit: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                bash: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>]>>;
                webfetch: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                task: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                doom_loop: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                external_directory: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
            }, z.core.$catchall<z.ZodOptional<z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>>>>;
            maxTokens: z.ZodOptional<z.ZodNumber>;
            thinking: z.ZodOptional<z.ZodObject<{
                type: z.ZodEnum<{
                    disabled: "disabled";
                    enabled: "enabled";
                }>;
                budgetTokens: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
            reasoningEffort: z.ZodOptional<z.ZodEnum<{
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                minimal: "minimal";
                none: "none";
                xhigh: "xhigh";
            }>>;
            textVerbosity: z.ZodOptional<z.ZodEnum<{
                high: "high";
                low: "low";
                medium: "medium";
            }>>;
            providerOptions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            ultrawork: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            compaction: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        hephaestus: z.ZodOptional<z.ZodObject<{
            model: z.ZodOptional<z.ZodString>;
            models: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
                model: z.ZodString;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    none: "none";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        disabled: "disabled";
                        enabled: "enabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>]>>>;
            fallback_models: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>, z.ZodArray<z.ZodObject<{
                model: z.ZodString;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    none: "none";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        disabled: "disabled";
                        enabled: "enabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>>, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
                model: z.ZodString;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    none: "none";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        disabled: "disabled";
                        enabled: "enabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>]>>]>>;
            reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                auto: "auto";
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                minimal: "minimal";
                off: "off";
                xhigh: "xhigh";
            }>, z.ZodString]>>;
            variant: z.ZodOptional<z.ZodString>;
            category: z.ZodOptional<z.ZodString>;
            skills: z.ZodOptional<z.ZodArray<z.ZodString>>;
            temperature: z.ZodOptional<z.ZodNumber>;
            top_p: z.ZodOptional<z.ZodNumber>;
            prompt: z.ZodOptional<z.ZodString>;
            prompt_append: z.ZodOptional<z.ZodString>;
            tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
            disable: z.ZodOptional<z.ZodBoolean>;
            description: z.ZodOptional<z.ZodString>;
            mode: z.ZodOptional<z.ZodEnum<{
                all: "all";
                primary: "primary";
                subagent: "subagent";
            }>>;
            color: z.ZodOptional<z.ZodString>;
            displayName: z.ZodOptional<z.ZodString>;
            permission: z.ZodOptional<z.ZodObject<{
                edit: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                bash: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>]>>;
                webfetch: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                task: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                doom_loop: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                external_directory: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
            }, z.core.$catchall<z.ZodOptional<z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>>>>;
            maxTokens: z.ZodOptional<z.ZodNumber>;
            thinking: z.ZodOptional<z.ZodObject<{
                type: z.ZodEnum<{
                    disabled: "disabled";
                    enabled: "enabled";
                }>;
                budgetTokens: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
            reasoningEffort: z.ZodOptional<z.ZodEnum<{
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                minimal: "minimal";
                none: "none";
                xhigh: "xhigh";
            }>>;
            textVerbosity: z.ZodOptional<z.ZodEnum<{
                high: "high";
                low: "low";
                medium: "medium";
            }>>;
            providerOptions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            ultrawork: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            compaction: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            allow_non_gpt_model: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strip>>;
        "sisyphus-junior": z.ZodOptional<z.ZodObject<{
            model: z.ZodOptional<z.ZodString>;
            models: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
                model: z.ZodString;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    none: "none";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        disabled: "disabled";
                        enabled: "enabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>]>>>;
            fallback_models: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>, z.ZodArray<z.ZodObject<{
                model: z.ZodString;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    none: "none";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        disabled: "disabled";
                        enabled: "enabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>>, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
                model: z.ZodString;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    none: "none";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        disabled: "disabled";
                        enabled: "enabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>]>>]>>;
            reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                auto: "auto";
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                minimal: "minimal";
                off: "off";
                xhigh: "xhigh";
            }>, z.ZodString]>>;
            variant: z.ZodOptional<z.ZodString>;
            category: z.ZodOptional<z.ZodString>;
            skills: z.ZodOptional<z.ZodArray<z.ZodString>>;
            temperature: z.ZodOptional<z.ZodNumber>;
            top_p: z.ZodOptional<z.ZodNumber>;
            prompt: z.ZodOptional<z.ZodString>;
            prompt_append: z.ZodOptional<z.ZodString>;
            tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
            disable: z.ZodOptional<z.ZodBoolean>;
            description: z.ZodOptional<z.ZodString>;
            mode: z.ZodOptional<z.ZodEnum<{
                all: "all";
                primary: "primary";
                subagent: "subagent";
            }>>;
            color: z.ZodOptional<z.ZodString>;
            displayName: z.ZodOptional<z.ZodString>;
            permission: z.ZodOptional<z.ZodObject<{
                edit: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                bash: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>]>>;
                webfetch: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                task: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                doom_loop: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                external_directory: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
            }, z.core.$catchall<z.ZodOptional<z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>>>>;
            maxTokens: z.ZodOptional<z.ZodNumber>;
            thinking: z.ZodOptional<z.ZodObject<{
                type: z.ZodEnum<{
                    disabled: "disabled";
                    enabled: "enabled";
                }>;
                budgetTokens: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
            reasoningEffort: z.ZodOptional<z.ZodEnum<{
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                minimal: "minimal";
                none: "none";
                xhigh: "xhigh";
            }>>;
            textVerbosity: z.ZodOptional<z.ZodEnum<{
                high: "high";
                low: "low";
                medium: "medium";
            }>>;
            providerOptions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            ultrawork: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            compaction: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        "OpenCode-Builder": z.ZodOptional<z.ZodObject<{
            model: z.ZodOptional<z.ZodString>;
            models: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
                model: z.ZodString;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    none: "none";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        disabled: "disabled";
                        enabled: "enabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>]>>>;
            fallback_models: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>, z.ZodArray<z.ZodObject<{
                model: z.ZodString;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    none: "none";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        disabled: "disabled";
                        enabled: "enabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>>, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
                model: z.ZodString;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    none: "none";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        disabled: "disabled";
                        enabled: "enabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>]>>]>>;
            reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                auto: "auto";
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                minimal: "minimal";
                off: "off";
                xhigh: "xhigh";
            }>, z.ZodString]>>;
            variant: z.ZodOptional<z.ZodString>;
            category: z.ZodOptional<z.ZodString>;
            skills: z.ZodOptional<z.ZodArray<z.ZodString>>;
            temperature: z.ZodOptional<z.ZodNumber>;
            top_p: z.ZodOptional<z.ZodNumber>;
            prompt: z.ZodOptional<z.ZodString>;
            prompt_append: z.ZodOptional<z.ZodString>;
            tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
            disable: z.ZodOptional<z.ZodBoolean>;
            description: z.ZodOptional<z.ZodString>;
            mode: z.ZodOptional<z.ZodEnum<{
                all: "all";
                primary: "primary";
                subagent: "subagent";
            }>>;
            color: z.ZodOptional<z.ZodString>;
            displayName: z.ZodOptional<z.ZodString>;
            permission: z.ZodOptional<z.ZodObject<{
                edit: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                bash: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>]>>;
                webfetch: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                task: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                doom_loop: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                external_directory: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
            }, z.core.$catchall<z.ZodOptional<z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>>>>;
            maxTokens: z.ZodOptional<z.ZodNumber>;
            thinking: z.ZodOptional<z.ZodObject<{
                type: z.ZodEnum<{
                    disabled: "disabled";
                    enabled: "enabled";
                }>;
                budgetTokens: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
            reasoningEffort: z.ZodOptional<z.ZodEnum<{
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                minimal: "minimal";
                none: "none";
                xhigh: "xhigh";
            }>>;
            textVerbosity: z.ZodOptional<z.ZodEnum<{
                high: "high";
                low: "low";
                medium: "medium";
            }>>;
            providerOptions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            ultrawork: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            compaction: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        prometheus: z.ZodOptional<z.ZodObject<{
            model: z.ZodOptional<z.ZodString>;
            models: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
                model: z.ZodString;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    none: "none";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        disabled: "disabled";
                        enabled: "enabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>]>>>;
            fallback_models: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>, z.ZodArray<z.ZodObject<{
                model: z.ZodString;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    none: "none";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        disabled: "disabled";
                        enabled: "enabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>>, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
                model: z.ZodString;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    none: "none";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        disabled: "disabled";
                        enabled: "enabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>]>>]>>;
            reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                auto: "auto";
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                minimal: "minimal";
                off: "off";
                xhigh: "xhigh";
            }>, z.ZodString]>>;
            variant: z.ZodOptional<z.ZodString>;
            category: z.ZodOptional<z.ZodString>;
            skills: z.ZodOptional<z.ZodArray<z.ZodString>>;
            temperature: z.ZodOptional<z.ZodNumber>;
            top_p: z.ZodOptional<z.ZodNumber>;
            prompt: z.ZodOptional<z.ZodString>;
            prompt_append: z.ZodOptional<z.ZodString>;
            tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
            disable: z.ZodOptional<z.ZodBoolean>;
            description: z.ZodOptional<z.ZodString>;
            mode: z.ZodOptional<z.ZodEnum<{
                all: "all";
                primary: "primary";
                subagent: "subagent";
            }>>;
            color: z.ZodOptional<z.ZodString>;
            displayName: z.ZodOptional<z.ZodString>;
            permission: z.ZodOptional<z.ZodObject<{
                edit: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                bash: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>]>>;
                webfetch: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                task: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                doom_loop: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                external_directory: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
            }, z.core.$catchall<z.ZodOptional<z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>>>>;
            maxTokens: z.ZodOptional<z.ZodNumber>;
            thinking: z.ZodOptional<z.ZodObject<{
                type: z.ZodEnum<{
                    disabled: "disabled";
                    enabled: "enabled";
                }>;
                budgetTokens: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
            reasoningEffort: z.ZodOptional<z.ZodEnum<{
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                minimal: "minimal";
                none: "none";
                xhigh: "xhigh";
            }>>;
            textVerbosity: z.ZodOptional<z.ZodEnum<{
                high: "high";
                low: "low";
                medium: "medium";
            }>>;
            providerOptions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            ultrawork: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            compaction: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        metis: z.ZodOptional<z.ZodObject<{
            model: z.ZodOptional<z.ZodString>;
            models: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
                model: z.ZodString;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    none: "none";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        disabled: "disabled";
                        enabled: "enabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>]>>>;
            fallback_models: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>, z.ZodArray<z.ZodObject<{
                model: z.ZodString;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    none: "none";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        disabled: "disabled";
                        enabled: "enabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>>, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
                model: z.ZodString;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    none: "none";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        disabled: "disabled";
                        enabled: "enabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>]>>]>>;
            reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                auto: "auto";
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                minimal: "minimal";
                off: "off";
                xhigh: "xhigh";
            }>, z.ZodString]>>;
            variant: z.ZodOptional<z.ZodString>;
            category: z.ZodOptional<z.ZodString>;
            skills: z.ZodOptional<z.ZodArray<z.ZodString>>;
            temperature: z.ZodOptional<z.ZodNumber>;
            top_p: z.ZodOptional<z.ZodNumber>;
            prompt: z.ZodOptional<z.ZodString>;
            prompt_append: z.ZodOptional<z.ZodString>;
            tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
            disable: z.ZodOptional<z.ZodBoolean>;
            description: z.ZodOptional<z.ZodString>;
            mode: z.ZodOptional<z.ZodEnum<{
                all: "all";
                primary: "primary";
                subagent: "subagent";
            }>>;
            color: z.ZodOptional<z.ZodString>;
            displayName: z.ZodOptional<z.ZodString>;
            permission: z.ZodOptional<z.ZodObject<{
                edit: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                bash: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>]>>;
                webfetch: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                task: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                doom_loop: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                external_directory: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
            }, z.core.$catchall<z.ZodOptional<z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>>>>;
            maxTokens: z.ZodOptional<z.ZodNumber>;
            thinking: z.ZodOptional<z.ZodObject<{
                type: z.ZodEnum<{
                    disabled: "disabled";
                    enabled: "enabled";
                }>;
                budgetTokens: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
            reasoningEffort: z.ZodOptional<z.ZodEnum<{
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                minimal: "minimal";
                none: "none";
                xhigh: "xhigh";
            }>>;
            textVerbosity: z.ZodOptional<z.ZodEnum<{
                high: "high";
                low: "low";
                medium: "medium";
            }>>;
            providerOptions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            ultrawork: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            compaction: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        momus: z.ZodOptional<z.ZodObject<{
            model: z.ZodOptional<z.ZodString>;
            models: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
                model: z.ZodString;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    none: "none";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        disabled: "disabled";
                        enabled: "enabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>]>>>;
            fallback_models: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>, z.ZodArray<z.ZodObject<{
                model: z.ZodString;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    none: "none";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        disabled: "disabled";
                        enabled: "enabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>>, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
                model: z.ZodString;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    none: "none";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        disabled: "disabled";
                        enabled: "enabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>]>>]>>;
            reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                auto: "auto";
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                minimal: "minimal";
                off: "off";
                xhigh: "xhigh";
            }>, z.ZodString]>>;
            variant: z.ZodOptional<z.ZodString>;
            category: z.ZodOptional<z.ZodString>;
            skills: z.ZodOptional<z.ZodArray<z.ZodString>>;
            temperature: z.ZodOptional<z.ZodNumber>;
            top_p: z.ZodOptional<z.ZodNumber>;
            prompt: z.ZodOptional<z.ZodString>;
            prompt_append: z.ZodOptional<z.ZodString>;
            tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
            disable: z.ZodOptional<z.ZodBoolean>;
            description: z.ZodOptional<z.ZodString>;
            mode: z.ZodOptional<z.ZodEnum<{
                all: "all";
                primary: "primary";
                subagent: "subagent";
            }>>;
            color: z.ZodOptional<z.ZodString>;
            displayName: z.ZodOptional<z.ZodString>;
            permission: z.ZodOptional<z.ZodObject<{
                edit: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                bash: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>]>>;
                webfetch: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                task: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                doom_loop: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                external_directory: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
            }, z.core.$catchall<z.ZodOptional<z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>>>>;
            maxTokens: z.ZodOptional<z.ZodNumber>;
            thinking: z.ZodOptional<z.ZodObject<{
                type: z.ZodEnum<{
                    disabled: "disabled";
                    enabled: "enabled";
                }>;
                budgetTokens: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
            reasoningEffort: z.ZodOptional<z.ZodEnum<{
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                minimal: "minimal";
                none: "none";
                xhigh: "xhigh";
            }>>;
            textVerbosity: z.ZodOptional<z.ZodEnum<{
                high: "high";
                low: "low";
                medium: "medium";
            }>>;
            providerOptions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            ultrawork: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            compaction: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        oracle: z.ZodOptional<z.ZodObject<{
            model: z.ZodOptional<z.ZodString>;
            models: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
                model: z.ZodString;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    none: "none";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        disabled: "disabled";
                        enabled: "enabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>]>>>;
            fallback_models: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>, z.ZodArray<z.ZodObject<{
                model: z.ZodString;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    none: "none";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        disabled: "disabled";
                        enabled: "enabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>>, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
                model: z.ZodString;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    none: "none";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        disabled: "disabled";
                        enabled: "enabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>]>>]>>;
            reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                auto: "auto";
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                minimal: "minimal";
                off: "off";
                xhigh: "xhigh";
            }>, z.ZodString]>>;
            variant: z.ZodOptional<z.ZodString>;
            category: z.ZodOptional<z.ZodString>;
            skills: z.ZodOptional<z.ZodArray<z.ZodString>>;
            temperature: z.ZodOptional<z.ZodNumber>;
            top_p: z.ZodOptional<z.ZodNumber>;
            prompt: z.ZodOptional<z.ZodString>;
            prompt_append: z.ZodOptional<z.ZodString>;
            tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
            disable: z.ZodOptional<z.ZodBoolean>;
            description: z.ZodOptional<z.ZodString>;
            mode: z.ZodOptional<z.ZodEnum<{
                all: "all";
                primary: "primary";
                subagent: "subagent";
            }>>;
            color: z.ZodOptional<z.ZodString>;
            displayName: z.ZodOptional<z.ZodString>;
            permission: z.ZodOptional<z.ZodObject<{
                edit: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                bash: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>]>>;
                webfetch: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                task: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                doom_loop: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                external_directory: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
            }, z.core.$catchall<z.ZodOptional<z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>>>>;
            maxTokens: z.ZodOptional<z.ZodNumber>;
            thinking: z.ZodOptional<z.ZodObject<{
                type: z.ZodEnum<{
                    disabled: "disabled";
                    enabled: "enabled";
                }>;
                budgetTokens: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
            reasoningEffort: z.ZodOptional<z.ZodEnum<{
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                minimal: "minimal";
                none: "none";
                xhigh: "xhigh";
            }>>;
            textVerbosity: z.ZodOptional<z.ZodEnum<{
                high: "high";
                low: "low";
                medium: "medium";
            }>>;
            providerOptions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            ultrawork: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            compaction: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        librarian: z.ZodOptional<z.ZodObject<{
            model: z.ZodOptional<z.ZodString>;
            models: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
                model: z.ZodString;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    none: "none";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        disabled: "disabled";
                        enabled: "enabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>]>>>;
            fallback_models: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>, z.ZodArray<z.ZodObject<{
                model: z.ZodString;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    none: "none";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        disabled: "disabled";
                        enabled: "enabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>>, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
                model: z.ZodString;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    none: "none";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        disabled: "disabled";
                        enabled: "enabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>]>>]>>;
            reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                auto: "auto";
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                minimal: "minimal";
                off: "off";
                xhigh: "xhigh";
            }>, z.ZodString]>>;
            variant: z.ZodOptional<z.ZodString>;
            category: z.ZodOptional<z.ZodString>;
            skills: z.ZodOptional<z.ZodArray<z.ZodString>>;
            temperature: z.ZodOptional<z.ZodNumber>;
            top_p: z.ZodOptional<z.ZodNumber>;
            prompt: z.ZodOptional<z.ZodString>;
            prompt_append: z.ZodOptional<z.ZodString>;
            tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
            disable: z.ZodOptional<z.ZodBoolean>;
            description: z.ZodOptional<z.ZodString>;
            mode: z.ZodOptional<z.ZodEnum<{
                all: "all";
                primary: "primary";
                subagent: "subagent";
            }>>;
            color: z.ZodOptional<z.ZodString>;
            displayName: z.ZodOptional<z.ZodString>;
            permission: z.ZodOptional<z.ZodObject<{
                edit: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                bash: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>]>>;
                webfetch: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                task: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                doom_loop: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                external_directory: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
            }, z.core.$catchall<z.ZodOptional<z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>>>>;
            maxTokens: z.ZodOptional<z.ZodNumber>;
            thinking: z.ZodOptional<z.ZodObject<{
                type: z.ZodEnum<{
                    disabled: "disabled";
                    enabled: "enabled";
                }>;
                budgetTokens: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
            reasoningEffort: z.ZodOptional<z.ZodEnum<{
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                minimal: "minimal";
                none: "none";
                xhigh: "xhigh";
            }>>;
            textVerbosity: z.ZodOptional<z.ZodEnum<{
                high: "high";
                low: "low";
                medium: "medium";
            }>>;
            providerOptions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            ultrawork: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            compaction: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        explore: z.ZodOptional<z.ZodObject<{
            model: z.ZodOptional<z.ZodString>;
            models: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
                model: z.ZodString;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    none: "none";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        disabled: "disabled";
                        enabled: "enabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>]>>>;
            fallback_models: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>, z.ZodArray<z.ZodObject<{
                model: z.ZodString;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    none: "none";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        disabled: "disabled";
                        enabled: "enabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>>, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
                model: z.ZodString;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    none: "none";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        disabled: "disabled";
                        enabled: "enabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>]>>]>>;
            reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                auto: "auto";
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                minimal: "minimal";
                off: "off";
                xhigh: "xhigh";
            }>, z.ZodString]>>;
            variant: z.ZodOptional<z.ZodString>;
            category: z.ZodOptional<z.ZodString>;
            skills: z.ZodOptional<z.ZodArray<z.ZodString>>;
            temperature: z.ZodOptional<z.ZodNumber>;
            top_p: z.ZodOptional<z.ZodNumber>;
            prompt: z.ZodOptional<z.ZodString>;
            prompt_append: z.ZodOptional<z.ZodString>;
            tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
            disable: z.ZodOptional<z.ZodBoolean>;
            description: z.ZodOptional<z.ZodString>;
            mode: z.ZodOptional<z.ZodEnum<{
                all: "all";
                primary: "primary";
                subagent: "subagent";
            }>>;
            color: z.ZodOptional<z.ZodString>;
            displayName: z.ZodOptional<z.ZodString>;
            permission: z.ZodOptional<z.ZodObject<{
                edit: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                bash: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>]>>;
                webfetch: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                task: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                doom_loop: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                external_directory: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
            }, z.core.$catchall<z.ZodOptional<z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>>>>;
            maxTokens: z.ZodOptional<z.ZodNumber>;
            thinking: z.ZodOptional<z.ZodObject<{
                type: z.ZodEnum<{
                    disabled: "disabled";
                    enabled: "enabled";
                }>;
                budgetTokens: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
            reasoningEffort: z.ZodOptional<z.ZodEnum<{
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                minimal: "minimal";
                none: "none";
                xhigh: "xhigh";
            }>>;
            textVerbosity: z.ZodOptional<z.ZodEnum<{
                high: "high";
                low: "low";
                medium: "medium";
            }>>;
            providerOptions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            ultrawork: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            compaction: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        "multimodal-looker": z.ZodOptional<z.ZodObject<{
            model: z.ZodOptional<z.ZodString>;
            models: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
                model: z.ZodString;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    none: "none";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        disabled: "disabled";
                        enabled: "enabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>]>>>;
            fallback_models: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>, z.ZodArray<z.ZodObject<{
                model: z.ZodString;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    none: "none";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        disabled: "disabled";
                        enabled: "enabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>>, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
                model: z.ZodString;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    none: "none";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        disabled: "disabled";
                        enabled: "enabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>]>>]>>;
            reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                auto: "auto";
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                minimal: "minimal";
                off: "off";
                xhigh: "xhigh";
            }>, z.ZodString]>>;
            variant: z.ZodOptional<z.ZodString>;
            category: z.ZodOptional<z.ZodString>;
            skills: z.ZodOptional<z.ZodArray<z.ZodString>>;
            temperature: z.ZodOptional<z.ZodNumber>;
            top_p: z.ZodOptional<z.ZodNumber>;
            prompt: z.ZodOptional<z.ZodString>;
            prompt_append: z.ZodOptional<z.ZodString>;
            tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
            disable: z.ZodOptional<z.ZodBoolean>;
            description: z.ZodOptional<z.ZodString>;
            mode: z.ZodOptional<z.ZodEnum<{
                all: "all";
                primary: "primary";
                subagent: "subagent";
            }>>;
            color: z.ZodOptional<z.ZodString>;
            displayName: z.ZodOptional<z.ZodString>;
            permission: z.ZodOptional<z.ZodObject<{
                edit: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                bash: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>]>>;
                webfetch: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                task: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                doom_loop: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                external_directory: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
            }, z.core.$catchall<z.ZodOptional<z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>>>>;
            maxTokens: z.ZodOptional<z.ZodNumber>;
            thinking: z.ZodOptional<z.ZodObject<{
                type: z.ZodEnum<{
                    disabled: "disabled";
                    enabled: "enabled";
                }>;
                budgetTokens: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
            reasoningEffort: z.ZodOptional<z.ZodEnum<{
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                minimal: "minimal";
                none: "none";
                xhigh: "xhigh";
            }>>;
            textVerbosity: z.ZodOptional<z.ZodEnum<{
                high: "high";
                low: "low";
                medium: "medium";
            }>>;
            providerOptions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            ultrawork: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            compaction: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        atlas: z.ZodOptional<z.ZodObject<{
            model: z.ZodOptional<z.ZodString>;
            models: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
                model: z.ZodString;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    none: "none";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        disabled: "disabled";
                        enabled: "enabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>]>>>;
            fallback_models: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>, z.ZodArray<z.ZodObject<{
                model: z.ZodString;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    none: "none";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        disabled: "disabled";
                        enabled: "enabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>>, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
                model: z.ZodString;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
                reasoningEffort: z.ZodOptional<z.ZodEnum<{
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    none: "none";
                    xhigh: "xhigh";
                }>>;
                temperature: z.ZodOptional<z.ZodNumber>;
                top_p: z.ZodOptional<z.ZodNumber>;
                maxTokens: z.ZodOptional<z.ZodNumber>;
                thinking: z.ZodOptional<z.ZodObject<{
                    type: z.ZodEnum<{
                        disabled: "disabled";
                        enabled: "enabled";
                    }>;
                    budgetTokens: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>]>>]>>;
            reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                auto: "auto";
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                minimal: "minimal";
                off: "off";
                xhigh: "xhigh";
            }>, z.ZodString]>>;
            variant: z.ZodOptional<z.ZodString>;
            category: z.ZodOptional<z.ZodString>;
            skills: z.ZodOptional<z.ZodArray<z.ZodString>>;
            temperature: z.ZodOptional<z.ZodNumber>;
            top_p: z.ZodOptional<z.ZodNumber>;
            prompt: z.ZodOptional<z.ZodString>;
            prompt_append: z.ZodOptional<z.ZodString>;
            tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
            disable: z.ZodOptional<z.ZodBoolean>;
            description: z.ZodOptional<z.ZodString>;
            mode: z.ZodOptional<z.ZodEnum<{
                all: "all";
                primary: "primary";
                subagent: "subagent";
            }>>;
            color: z.ZodOptional<z.ZodString>;
            displayName: z.ZodOptional<z.ZodString>;
            permission: z.ZodOptional<z.ZodObject<{
                edit: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                bash: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>]>>;
                webfetch: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                task: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                doom_loop: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
                external_directory: z.ZodOptional<z.ZodEnum<{
                    allow: "allow";
                    ask: "ask";
                    deny: "deny";
                }>>;
            }, z.core.$catchall<z.ZodOptional<z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>>>>;
            maxTokens: z.ZodOptional<z.ZodNumber>;
            thinking: z.ZodOptional<z.ZodObject<{
                type: z.ZodEnum<{
                    disabled: "disabled";
                    enabled: "enabled";
                }>;
                budgetTokens: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
            reasoningEffort: z.ZodOptional<z.ZodEnum<{
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                minimal: "minimal";
                none: "none";
                xhigh: "xhigh";
            }>>;
            textVerbosity: z.ZodOptional<z.ZodEnum<{
                high: "high";
                low: "low";
                medium: "medium";
            }>>;
            providerOptions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            ultrawork: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            compaction: z.ZodOptional<z.ZodObject<{
                model: z.ZodOptional<z.ZodString>;
                reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    auto: "auto";
                    high: "high";
                    low: "low";
                    max: "max";
                    medium: "medium";
                    minimal: "minimal";
                    off: "off";
                    xhigh: "xhigh";
                }>, z.ZodString]>>;
                variant: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
    }, z.core.$catchall<z.ZodOptional<z.ZodObject<{
        model: z.ZodOptional<z.ZodString>;
        models: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
            model: z.ZodString;
            reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                auto: "auto";
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                minimal: "minimal";
                off: "off";
                xhigh: "xhigh";
            }>, z.ZodString]>>;
            variant: z.ZodOptional<z.ZodString>;
            reasoningEffort: z.ZodOptional<z.ZodEnum<{
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                minimal: "minimal";
                none: "none";
                xhigh: "xhigh";
            }>>;
            temperature: z.ZodOptional<z.ZodNumber>;
            top_p: z.ZodOptional<z.ZodNumber>;
            maxTokens: z.ZodOptional<z.ZodNumber>;
            thinking: z.ZodOptional<z.ZodObject<{
                type: z.ZodEnum<{
                    disabled: "disabled";
                    enabled: "enabled";
                }>;
                budgetTokens: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
        }, z.core.$strip>]>>>;
        fallback_models: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>, z.ZodArray<z.ZodObject<{
            model: z.ZodString;
            reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                auto: "auto";
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                minimal: "minimal";
                off: "off";
                xhigh: "xhigh";
            }>, z.ZodString]>>;
            variant: z.ZodOptional<z.ZodString>;
            reasoningEffort: z.ZodOptional<z.ZodEnum<{
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                minimal: "minimal";
                none: "none";
                xhigh: "xhigh";
            }>>;
            temperature: z.ZodOptional<z.ZodNumber>;
            top_p: z.ZodOptional<z.ZodNumber>;
            maxTokens: z.ZodOptional<z.ZodNumber>;
            thinking: z.ZodOptional<z.ZodObject<{
                type: z.ZodEnum<{
                    disabled: "disabled";
                    enabled: "enabled";
                }>;
                budgetTokens: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
        }, z.core.$strip>>, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
            model: z.ZodString;
            reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                auto: "auto";
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                minimal: "minimal";
                off: "off";
                xhigh: "xhigh";
            }>, z.ZodString]>>;
            variant: z.ZodOptional<z.ZodString>;
            reasoningEffort: z.ZodOptional<z.ZodEnum<{
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                minimal: "minimal";
                none: "none";
                xhigh: "xhigh";
            }>>;
            temperature: z.ZodOptional<z.ZodNumber>;
            top_p: z.ZodOptional<z.ZodNumber>;
            maxTokens: z.ZodOptional<z.ZodNumber>;
            thinking: z.ZodOptional<z.ZodObject<{
                type: z.ZodEnum<{
                    disabled: "disabled";
                    enabled: "enabled";
                }>;
                budgetTokens: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
        }, z.core.$strip>]>>]>>;
        reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
            auto: "auto";
            high: "high";
            low: "low";
            max: "max";
            medium: "medium";
            minimal: "minimal";
            off: "off";
            xhigh: "xhigh";
        }>, z.ZodString]>>;
        variant: z.ZodOptional<z.ZodString>;
        category: z.ZodOptional<z.ZodString>;
        skills: z.ZodOptional<z.ZodArray<z.ZodString>>;
        temperature: z.ZodOptional<z.ZodNumber>;
        top_p: z.ZodOptional<z.ZodNumber>;
        prompt: z.ZodOptional<z.ZodString>;
        prompt_append: z.ZodOptional<z.ZodString>;
        tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
        disable: z.ZodOptional<z.ZodBoolean>;
        description: z.ZodOptional<z.ZodString>;
        mode: z.ZodOptional<z.ZodEnum<{
            all: "all";
            primary: "primary";
            subagent: "subagent";
        }>>;
        color: z.ZodOptional<z.ZodString>;
        displayName: z.ZodOptional<z.ZodString>;
        permission: z.ZodOptional<z.ZodObject<{
            edit: z.ZodOptional<z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>;
            bash: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>]>>;
            webfetch: z.ZodOptional<z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>;
            task: z.ZodOptional<z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>;
            doom_loop: z.ZodOptional<z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>;
            external_directory: z.ZodOptional<z.ZodEnum<{
                allow: "allow";
                ask: "ask";
                deny: "deny";
            }>>;
        }, z.core.$catchall<z.ZodOptional<z.ZodEnum<{
            allow: "allow";
            ask: "ask";
            deny: "deny";
        }>>>>>;
        maxTokens: z.ZodOptional<z.ZodNumber>;
        thinking: z.ZodOptional<z.ZodObject<{
            type: z.ZodEnum<{
                disabled: "disabled";
                enabled: "enabled";
            }>;
            budgetTokens: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
        reasoningEffort: z.ZodOptional<z.ZodEnum<{
            high: "high";
            low: "low";
            max: "max";
            medium: "medium";
            minimal: "minimal";
            none: "none";
            xhigh: "xhigh";
        }>>;
        textVerbosity: z.ZodOptional<z.ZodEnum<{
            high: "high";
            low: "low";
            medium: "medium";
        }>>;
        providerOptions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        ultrawork: z.ZodOptional<z.ZodObject<{
            model: z.ZodOptional<z.ZodString>;
            reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                auto: "auto";
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                minimal: "minimal";
                off: "off";
                xhigh: "xhigh";
            }>, z.ZodString]>>;
            variant: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        compaction: z.ZodOptional<z.ZodObject<{
            model: z.ZodOptional<z.ZodString>;
            reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                auto: "auto";
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                minimal: "minimal";
                off: "off";
                xhigh: "xhigh";
            }>, z.ZodString]>>;
            variant: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>>>>>;
    categories: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
        description: z.ZodOptional<z.ZodString>;
        model: z.ZodOptional<z.ZodString>;
        models: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
            model: z.ZodString;
            reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                auto: "auto";
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                minimal: "minimal";
                off: "off";
                xhigh: "xhigh";
            }>, z.ZodString]>>;
            variant: z.ZodOptional<z.ZodString>;
            reasoningEffort: z.ZodOptional<z.ZodEnum<{
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                minimal: "minimal";
                none: "none";
                xhigh: "xhigh";
            }>>;
            temperature: z.ZodOptional<z.ZodNumber>;
            top_p: z.ZodOptional<z.ZodNumber>;
            maxTokens: z.ZodOptional<z.ZodNumber>;
            thinking: z.ZodOptional<z.ZodObject<{
                type: z.ZodEnum<{
                    disabled: "disabled";
                    enabled: "enabled";
                }>;
                budgetTokens: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
        }, z.core.$strip>]>>>;
        fallback_models: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>, z.ZodArray<z.ZodObject<{
            model: z.ZodString;
            reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                auto: "auto";
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                minimal: "minimal";
                off: "off";
                xhigh: "xhigh";
            }>, z.ZodString]>>;
            variant: z.ZodOptional<z.ZodString>;
            reasoningEffort: z.ZodOptional<z.ZodEnum<{
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                minimal: "minimal";
                none: "none";
                xhigh: "xhigh";
            }>>;
            temperature: z.ZodOptional<z.ZodNumber>;
            top_p: z.ZodOptional<z.ZodNumber>;
            maxTokens: z.ZodOptional<z.ZodNumber>;
            thinking: z.ZodOptional<z.ZodObject<{
                type: z.ZodEnum<{
                    disabled: "disabled";
                    enabled: "enabled";
                }>;
                budgetTokens: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
        }, z.core.$strip>>, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
            model: z.ZodString;
            reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                auto: "auto";
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                minimal: "minimal";
                off: "off";
                xhigh: "xhigh";
            }>, z.ZodString]>>;
            variant: z.ZodOptional<z.ZodString>;
            reasoningEffort: z.ZodOptional<z.ZodEnum<{
                high: "high";
                low: "low";
                max: "max";
                medium: "medium";
                minimal: "minimal";
                none: "none";
                xhigh: "xhigh";
            }>>;
            temperature: z.ZodOptional<z.ZodNumber>;
            top_p: z.ZodOptional<z.ZodNumber>;
            maxTokens: z.ZodOptional<z.ZodNumber>;
            thinking: z.ZodOptional<z.ZodObject<{
                type: z.ZodEnum<{
                    disabled: "disabled";
                    enabled: "enabled";
                }>;
                budgetTokens: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
        }, z.core.$strip>]>>]>>;
        reasoning: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
            auto: "auto";
            high: "high";
            low: "low";
            max: "max";
            medium: "medium";
            minimal: "minimal";
            off: "off";
            xhigh: "xhigh";
        }>, z.ZodString]>>;
        variant: z.ZodOptional<z.ZodString>;
        temperature: z.ZodOptional<z.ZodNumber>;
        top_p: z.ZodOptional<z.ZodNumber>;
        max_tokens: z.ZodOptional<z.ZodNumber>;
        provider_options: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        maxTokens: z.ZodOptional<z.ZodNumber>;
        thinking: z.ZodOptional<z.ZodObject<{
            type: z.ZodEnum<{
                disabled: "disabled";
                enabled: "enabled";
            }>;
            budgetTokens: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
        reasoningEffort: z.ZodOptional<z.ZodEnum<{
            high: "high";
            low: "low";
            max: "max";
            medium: "medium";
            minimal: "minimal";
            none: "none";
            xhigh: "xhigh";
        }>>;
        textVerbosity: z.ZodOptional<z.ZodEnum<{
            high: "high";
            low: "low";
            medium: "medium";
        }>>;
        tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
        prompt_append: z.ZodOptional<z.ZodString>;
        max_prompt_tokens: z.ZodOptional<z.ZodNumber>;
        is_unstable_agent: z.ZodOptional<z.ZodBoolean>;
        disable: z.ZodOptional<z.ZodBoolean>;
        warn_unavailable: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>>;
    claude_code: z.ZodOptional<z.ZodObject<{
        mcp: z.ZodOptional<z.ZodBoolean>;
        commands: z.ZodOptional<z.ZodBoolean>;
        skills: z.ZodOptional<z.ZodBoolean>;
        agents: z.ZodOptional<z.ZodBoolean>;
        hooks: z.ZodOptional<z.ZodBoolean>;
        plugins: z.ZodOptional<z.ZodBoolean>;
        plugins_override: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
        anthropic_provider: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    sisyphus_agent: z.ZodOptional<z.ZodObject<{
        disabled: z.ZodOptional<z.ZodBoolean>;
        default_builder_enabled: z.ZodOptional<z.ZodBoolean>;
        planner_enabled: z.ZodOptional<z.ZodBoolean>;
        replace_plan: z.ZodOptional<z.ZodBoolean>;
        tdd: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
    }, z.core.$strip>>;
    comment_checker: z.ZodOptional<z.ZodObject<{
        custom_prompt: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    experimental: z.ZodOptional<z.ZodObject<{
        aggressive_truncation: z.ZodOptional<z.ZodBoolean>;
        preemptive_compaction: z.ZodOptional<z.ZodBoolean>;
        truncate_all_tool_outputs: z.ZodOptional<z.ZodBoolean>;
        dynamic_context_pruning: z.ZodOptional<z.ZodObject<{
            enabled: z.ZodDefault<z.ZodBoolean>;
            notification: z.ZodDefault<z.ZodEnum<{
                detailed: "detailed";
                minimal: "minimal";
                off: "off";
            }>>;
            turn_protection: z.ZodOptional<z.ZodObject<{
                enabled: z.ZodDefault<z.ZodBoolean>;
                turns: z.ZodDefault<z.ZodNumber>;
            }, z.core.$strip>>;
            protected_tools: z.ZodDefault<z.ZodArray<z.ZodString>>;
            strategies: z.ZodOptional<z.ZodObject<{
                deduplication: z.ZodOptional<z.ZodObject<{
                    enabled: z.ZodDefault<z.ZodBoolean>;
                }, z.core.$strip>>;
                supersede_writes: z.ZodOptional<z.ZodObject<{
                    enabled: z.ZodDefault<z.ZodBoolean>;
                    aggressive: z.ZodDefault<z.ZodBoolean>;
                }, z.core.$strip>>;
                purge_errors: z.ZodOptional<z.ZodObject<{
                    enabled: z.ZodDefault<z.ZodBoolean>;
                    turns: z.ZodDefault<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        task_system: z.ZodOptional<z.ZodBoolean>;
        plugin_load_timeout_ms: z.ZodOptional<z.ZodNumber>;
        safe_hook_creation: z.ZodOptional<z.ZodBoolean>;
        disable_omo_env: z.ZodOptional<z.ZodBoolean>;
        hashline_edit: z.ZodOptional<z.ZodBoolean>;
        model_fallback_title: z.ZodOptional<z.ZodBoolean>;
        max_tools: z.ZodOptional<z.ZodNumber>;
        disable_live_parent_wake_routing: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>;
    auto_update: z.ZodOptional<z.ZodBoolean>;
    skills: z.ZodOptional<z.ZodUnion<readonly [z.ZodArray<z.ZodString>, z.ZodObject<{
        sources: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
            path: z.ZodString;
            recursive: z.ZodOptional<z.ZodBoolean>;
            glob: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>]>>>;
        enable: z.ZodOptional<z.ZodArray<z.ZodString>>;
        disable: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$catchall<z.ZodUnion<readonly [z.ZodBoolean, z.ZodObject<{
        description: z.ZodOptional<z.ZodString>;
        template: z.ZodOptional<z.ZodString>;
        from: z.ZodOptional<z.ZodString>;
        model: z.ZodOptional<z.ZodString>;
        agent: z.ZodOptional<z.ZodString>;
        subtask: z.ZodOptional<z.ZodBoolean>;
        "argument-hint": z.ZodOptional<z.ZodString>;
        license: z.ZodOptional<z.ZodString>;
        compatibility: z.ZodOptional<z.ZodString>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        "allowed-tools": z.ZodOptional<z.ZodArray<z.ZodString>>;
        disable: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>]>>>]>>;
    goal: z.ZodOptional<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        auto_start: z.ZodDefault<z.ZodBoolean>;
        default_max_iterations: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>;
    ralph_loop: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    runtime_fallback: z.ZodOptional<z.ZodUnion<readonly [z.ZodBoolean, z.ZodObject<{
        enabled: z.ZodOptional<z.ZodBoolean>;
        retry_on_errors: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
        max_fallback_attempts: z.ZodOptional<z.ZodNumber>;
        cooldown_seconds: z.ZodOptional<z.ZodNumber>;
        timeout_seconds: z.ZodOptional<z.ZodNumber>;
        notify_on_fallback: z.ZodOptional<z.ZodBoolean>;
        restore_primary_after_cooldown: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>]>>;
    background_task: z.ZodOptional<z.ZodObject<{
        defaultConcurrency: z.ZodOptional<z.ZodNumber>;
        providerConcurrency: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
        modelConcurrency: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
        maxDepth: z.ZodOptional<z.ZodNumber>;
        maxLiveDescendantsPerRoot: z.ZodOptional<z.ZodNumber>;
        staleTimeoutMs: z.ZodOptional<z.ZodNumber>;
        messageStalenessTimeoutMs: z.ZodOptional<z.ZodNumber>;
        taskTtlMs: z.ZodOptional<z.ZodNumber>;
        sessionGoneTimeoutMs: z.ZodOptional<z.ZodNumber>;
        taskCleanupDelayMs: z.ZodOptional<z.ZodNumber>;
        syncPollTimeoutMs: z.ZodOptional<z.ZodNumber>;
        maxToolCalls: z.ZodOptional<z.ZodNumber>;
        circuitBreaker: z.ZodOptional<z.ZodObject<{
            enabled: z.ZodOptional<z.ZodBoolean>;
            maxToolCalls: z.ZodOptional<z.ZodNumber>;
            consecutiveThreshold: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    notification: z.ZodOptional<z.ZodObject<{
        force_enable: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>;
    model_capabilities: z.ZodOptional<z.ZodObject<{
        enabled: z.ZodOptional<z.ZodBoolean>;
        auto_refresh_on_start: z.ZodOptional<z.ZodBoolean>;
        refresh_timeout_ms: z.ZodOptional<z.ZodNumber>;
        source_url: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    openclaw: z.ZodOptional<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        gateways: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodObject<{
            type: z.ZodDefault<z.ZodEnum<{
                command: "command";
                http: "http";
            }>>;
            url: z.ZodOptional<z.ZodString>;
            method: z.ZodDefault<z.ZodString>;
            headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            command: z.ZodOptional<z.ZodString>;
            timeout: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>>;
        hooks: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodObject<{
            enabled: z.ZodDefault<z.ZodBoolean>;
            gateway: z.ZodString;
            instruction: z.ZodString;
        }, z.core.$strip>>>;
        replyListener: z.ZodOptional<z.ZodObject<{
            discordBotToken: z.ZodOptional<z.ZodString>;
            discordChannelId: z.ZodOptional<z.ZodString>;
            discordMention: z.ZodOptional<z.ZodString>;
            authorizedDiscordUserIds: z.ZodDefault<z.ZodArray<z.ZodString>>;
            telegramBotToken: z.ZodOptional<z.ZodString>;
            telegramChatId: z.ZodOptional<z.ZodString>;
            pollIntervalMs: z.ZodDefault<z.ZodNumber>;
            rateLimitPerMinute: z.ZodDefault<z.ZodNumber>;
            maxMessageLength: z.ZodDefault<z.ZodNumber>;
            includePrefix: z.ZodDefault<z.ZodBoolean>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    i18n: z.ZodOptional<z.ZodObject<{
        locale: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    monitor: z.ZodOptional<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        live_mode_enabled: z.ZodDefault<z.ZodBoolean>;
        allowed_commands: z.ZodOptional<z.ZodArray<z.ZodString>>;
        max_monitors_per_session: z.ZodDefault<z.ZodNumber>;
        max_runtime_ms: z.ZodDefault<z.ZodNumber>;
        batch_max_lines: z.ZodDefault<z.ZodNumber>;
        batch_max_bytes: z.ZodDefault<z.ZodNumber>;
        flush_interval_ms: z.ZodDefault<z.ZodNumber>;
        ring_max_lines: z.ZodDefault<z.ZodNumber>;
        line_max_bytes: z.ZodDefault<z.ZodNumber>;
        pattern_max_length: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>;
    team_mode: z.ZodOptional<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        tmux_visualization: z.ZodDefault<z.ZodBoolean>;
        max_parallel_members: z.ZodDefault<z.ZodNumber>;
        max_members: z.ZodDefault<z.ZodNumber>;
        max_messages_per_run: z.ZodDefault<z.ZodNumber>;
        max_wall_clock_minutes: z.ZodDefault<z.ZodNumber>;
        max_member_turns: z.ZodDefault<z.ZodNumber>;
        base_dir: z.ZodOptional<z.ZodString>;
        message_payload_max_bytes: z.ZodDefault<z.ZodNumber>;
        recipient_unread_max_bytes: z.ZodDefault<z.ZodNumber>;
        mailbox_poll_interval_ms: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>;
    keyword_detector: z.ZodOptional<z.ZodObject<{
        enabled_expansions: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            hyperplan: "hyperplan";
            "hyperplan-ultrawork": "hyperplan-ultrawork";
            team: "team";
            ultrawork: "ultrawork";
        }>>>;
        disabled_keywords: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            hyperplan: "hyperplan";
            "hyperplan-ultrawork": "hyperplan-ultrawork";
            team: "team";
            ultrawork: "ultrawork";
        }>>>;
    }, z.core.$strip>>;
    babysitting: z.ZodOptional<z.ZodObject<{
        timeout_ms: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>;
    git_master: z.ZodDefault<z.ZodObject<{
        commit_footer: z.ZodDefault<z.ZodUnion<readonly [z.ZodBoolean, z.ZodString]>>;
        include_co_authored_by: z.ZodDefault<z.ZodBoolean>;
        git_env_prefix: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>>;
    browser_automation_engine: z.ZodOptional<z.ZodObject<{
        provider: z.ZodDefault<z.ZodEnum<{
            "agent-browser": "agent-browser";
            "dev-browser": "dev-browser";
            playwright: "playwright";
            "playwright-cli": "playwright-cli";
        }>>;
        playwright_mcp_args: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>;
    websearch: z.ZodOptional<z.ZodObject<{
        provider: z.ZodOptional<z.ZodEnum<{
            exa: "exa";
            tavily: "tavily";
        }>>;
    }, z.core.$strip>>;
    tmux: z.ZodOptional<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        layout: z.ZodDefault<z.ZodEnum<{
            "even-horizontal": "even-horizontal";
            "even-vertical": "even-vertical";
            "main-horizontal": "main-horizontal";
            "main-vertical": "main-vertical";
            tiled: "tiled";
        }>>;
        main_pane_size: z.ZodDefault<z.ZodNumber>;
        main_pane_min_width: z.ZodDefault<z.ZodNumber>;
        agent_pane_min_width: z.ZodDefault<z.ZodNumber>;
        isolation: z.ZodDefault<z.ZodEnum<{
            inline: "inline";
            session: "session";
            window: "window";
        }>>;
    }, z.core.$strip>>;
    tui: z.ZodOptional<z.ZodDefault<z.ZodObject<{
        sidebar: z.ZodDefault<z.ZodObject<{
            enabled: z.ZodDefault<z.ZodBoolean>;
        }, z.core.$strip>>;
    }, z.core.$strip>>>;
    sisyphus: z.ZodOptional<z.ZodObject<{
        tasks: z.ZodOptional<z.ZodObject<{
            storage_path: z.ZodOptional<z.ZodString>;
            task_list_id: z.ZodOptional<z.ZodString>;
            claude_code_compat: z.ZodDefault<z.ZodBoolean>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    ulw_execute: z.ZodOptional<z.ZodObject<{
        auto_commit: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>>;
    start_work: z.ZodOptional<z.ZodObject<{
        auto_commit: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>>;
    default_mode: z.ZodOptional<z.ZodObject<{
        ultrawork: z.ZodDefault<z.ZodBoolean>;
        goal: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>>;
    _migrations: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export type OhMyOpenCodeConfig = z.infer<typeof OhMyOpenCodeConfigSchema>;
