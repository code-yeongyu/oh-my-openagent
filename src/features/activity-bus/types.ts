export type ActivityEvent =
  | {
      kind: "task:created";
      timestamp: number;
      data: {
        taskId: string;
        parentId?: string;
        agent: string;
        description: string;
      };
    }
  | {
      kind: "task:progress";
      timestamp: number;
      data: {
        taskId: string;
        toolCalls: number;
        currentAction?: string;
      };
    }
  | {
      kind: "task:completed";
      timestamp: number;
      data: {
        taskId: string;
        duration: number;
      };
    }
  | {
      kind: "task:error";
      timestamp: number;
      data: {
        taskId: string;
        error: string;
        duration: number;
      };
    }
  | {
      kind: "agent:spawned";
      timestamp: number;
      data: {
        agent: string;
        taskId: string;
        model: string;
      };
    }
  | {
      kind: "agent:activity";
      timestamp: number;
      data: {
        agent: string;
        sessionId: string;
        toolName: string;
      };
    }
  | {
      kind: "agent:completed";
      timestamp: number;
      data: {
        agent: string;
        sessionId: string;
        duration: number;
      };
    }
  | {
      kind: "team:created";
      timestamp: number;
      data: {
        teamId: string;
        name: string;
        members: string[];
      };
    }
  | {
      kind: "team:member:status";
      timestamp: number;
      data: {
        teamId: string;
        member: string;
        status: "active" | "idle" | "blocked" | "error";
      };
    }
  | {
      kind: "team:task:progress";
      timestamp: number;
      data: {
        teamId: string;
        completed: number;
        total: number;
      };
    };

export type ActivityHandler = (event: ActivityEvent) => void | Promise<void>;

export type UnsubscribeFn = () => void;
