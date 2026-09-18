import { z } from "zod";
export declare const BrowserAutomationProviderSchema: z.ZodEnum<{
    "agent-browser": "agent-browser";
    "dev-browser": "dev-browser";
    playwright: "playwright";
    "playwright-cli": "playwright-cli";
}>;
export declare const BrowserAutomationConfigSchema: z.ZodObject<{
    provider: z.ZodDefault<z.ZodEnum<{
        "agent-browser": "agent-browser";
        "dev-browser": "dev-browser";
        playwright: "playwright";
        "playwright-cli": "playwright-cli";
    }>>;
    playwright_mcp_args: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export type BrowserAutomationProvider = z.infer<typeof BrowserAutomationProviderSchema>;
export type BrowserAutomationConfig = z.infer<typeof BrowserAutomationConfigSchema>;
