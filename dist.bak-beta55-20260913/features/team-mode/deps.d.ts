import type { TeamModeConfig } from "../../config/schema/team-mode";
import { spawn } from "../../shared/bun-spawn-shim";
export interface TeamModeDependencyReport {
    tmuxAvailable: boolean;
    gitAvailable: boolean;
}
type Spawn = typeof spawn;
type TeamModeDependencyDeps = {
    readonly spawn?: Spawn;
    readonly tmuxEnv?: string;
};
export declare function checkTeamModeDependencies(config: TeamModeConfig, deps?: TeamModeDependencyDeps): Promise<TeamModeDependencyReport>;
export {};
