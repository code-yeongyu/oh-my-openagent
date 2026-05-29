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
    }
  | {
      kind: "memory:stored";
      timestamp: number;
      data: {
        id: string;
        content: string;
        memoryType: string;
        filePath?: string;
        symbolName?: string;
        astPattern?: string;
      };
    }
  | {
      kind: "memory:retrieved";
      timestamp: number;
      data: {
        id: string;
        content: string;
        similarity: number;
        filePath?: string;
        symbolName?: string;
        astPattern?: string;
      };
    }
  | {
      kind: "context:extracted";
      timestamp: number;
      data: {
        filePath: string;
        symbolsExtracted: string[];
        originalSize: number;
        extractedSize: number;
        tokensSaved: number;
      };
    };

export type ActivityHandler = (event: ActivityEvent) => void | Promise<void>;

export type UnsubscribeFn = () => void;
