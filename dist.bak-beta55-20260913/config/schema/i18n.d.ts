import { z } from "zod";
export declare const I18nConfigSchema: z.ZodObject<{
    locale: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type I18nConfig = z.infer<typeof I18nConfigSchema>;
