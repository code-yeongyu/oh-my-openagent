import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';

export interface GuardrailRule {
  tool: string;
  pattern?: string;
  action: 'allow' | 'block' | 'ask';
  message?: string;
}

export interface GuardrailConfig {
  rules: GuardrailRule[];
}

export type GuardrailDecision = 'allowed' | 'blocked' | 'ask';

export class GuardrailService {
  private configPath: string;
  private config: GuardrailConfig | null = null;

  constructor(private workspaceRoot: string) {
    this.configPath = path.join(workspaceRoot, '.sisyphus', 'guardrails.yml');
  }

  loadConfig(): void {
    if (fs.existsSync(this.configPath)) {
      try {
        const fileContents = fs.readFileSync(this.configPath, 'utf8');
        this.config = yaml.load(fileContents) as GuardrailConfig;
      } catch (error) {
        console.error('Failed to load guardrails config:', error);
        this.config = { rules: [] };
      }
    } else {
        this.config = { rules: [] };
    }
  }

  check(toolName: string, context: Record<string, any>): { decision: GuardrailDecision; message?: string } {
    if (!this.config) {
      this.loadConfig();
    }

    if (!this.config || !this.config.rules) {
      return { decision: 'allowed' };
    }

    for (const rule of this.config.rules) {
        if (rule.tool === '*' || rule.tool === toolName) {
             if (rule.pattern) {
                 const inputStr = JSON.stringify(context);
                 try {
                    if (new RegExp(rule.pattern).test(inputStr)) {
                        return { 
                            decision: rule.action === 'block' ? 'blocked' : rule.action === 'ask' ? 'ask' : 'allowed', 
                            message: rule.message 
                        };
                    }
                 } catch (e) {
                     console.warn(`Invalid regex pattern in guardrail rule: ${rule.pattern}`);
                 }
             } else {
                 return { 
                     decision: rule.action === 'block' ? 'blocked' : rule.action === 'ask' ? 'ask' : 'allowed', 
                     message: rule.message 
                 };
             }
        }
    }

    return { decision: 'allowed' };
  }
}
