/// <reference types="bun-types/test-globals" />
import type { Task } from "../../features/claude-tasks/types";
import {
  syncTaskToTodo,
  syncAllTasksToTodos,
  syncTaskTodoUpdate,
  type TodoInfo,
} from "./todo-sync";

describe("syncTaskToTodo", () => {
  it("converts pending task to pending todo", () => {
    // given
    const task: Task = {
      id: "T-123",
      subject: "Fix bug",
      description: "Fix critical bug",
      status: "pending",
      blocks: [],
      blockedBy: [],
    };

    // when
    const result = syncTaskToTodo(task);

    // then
    expect(result).toEqual({
      id: "T-123",
      content: "Fix bug",
      status: "pending",
      priority: undefined,
    });
  });

  it("converts in_progress task to in_progress todo", () => {
    // given
    const task: Task = {
      id: "T-456",
      subject: "Implement feature",
      description: "Add new feature",
      status: "in_progress",
      blocks: [],
      blockedBy: [],
    };

    // when
    const result = syncTaskToTodo(task);

    // then
    expect(result?.status).toBe("in_progress");
    expect(result?.content).toBe("Implement feature");
  });

  it("converts completed task to completed todo", () => {
    // given
    const task: Task = {
      id: "T-789",
      subject: "Review PR",
      description: "Review pull request",
      status: "completed",
      blocks: [],
      blockedBy: [],
    };

    // when
    const result = syncTaskToTodo(task);

    // then
    expect(result?.status).toBe("completed");
  });

  it("returns null for deleted task", () => {
    // given
    const task: Task = {
      id: "T-del",
      subject: "Deleted task",
      description: "This task is deleted",
      status: "deleted",
      blocks: [],
      blockedBy: [],
    };

    // when
    const result = syncTaskToTodo(task);

    // then
    expect(result).toBeNull();
  });

  it("extracts priority from metadata", () => {
    // given
    const task: Task = {
      id: "T-high",
      subject: "Critical task",
      description: "High priority task",
      status: "pending",
      blocks: [],
      blockedBy: [],
      metadata: { priority: "high" },
    };

    // when
    const result = syncTaskToTodo(task);

    // then
    expect(result?.priority).toBe("high");
  });

  it("handles medium priority", () => {
    // given
    const task: Task = {
      id: "T-med",
      subject: "Medium task",
      description: "Medium priority",
      status: "pending",
      blocks: [],
      blockedBy: [],
      metadata: { priority: "medium" },
    };

    // when
    const result = syncTaskToTodo(task);

    // then
    expect(result?.priority).toBe("medium");
  });

  it("handles low priority", () => {
    // given
    const task: Task = {
      id: "T-low",
      subject: "Low task",
      description: "Low priority",
      status: "pending",
      blocks: [],
      blockedBy: [],
      metadata: { priority: "low" },
    };

    // when
    const result = syncTaskToTodo(task);

    // then
    expect(result?.priority).toBe("low");
  });

  it("ignores invalid priority values", () => {
    // given
    const task: Task = {
      id: "T-invalid",
      subject: "Invalid priority",
      description: "Invalid priority value",
      status: "pending",
      blocks: [],
      blockedBy: [],
      metadata: { priority: "urgent" },
    };

    // when
    const result = syncTaskToTodo(task);

    // then
    expect(result?.priority).toBeUndefined();
  });

  it("handles missing metadata", () => {
    // given
    const task: Task = {
      id: "T-no-meta",
      subject: "No metadata",
      description: "Task without metadata",
      status: "pending",
      blocks: [],
      blockedBy: [],
    };

    // when
    const result = syncTaskToTodo(task);

    // then
    expect(result?.priority).toBeUndefined();
  });

  it("uses subject as todo content", () => {
    // given
    const task: Task = {
      id: "T-content",
      subject: "This is the subject",
      description: "This is the description",
      status: "pending",
      blocks: [],
      blockedBy: [],
    };

    // when
    const result = syncTaskToTodo(task);

    // then
    expect(result?.content).toBe("This is the subject");
  });
});

describe("syncTaskTodoUpdate", () => {
  let mockCtx: any;

  beforeEach(() => {
    mockCtx = {
      client: {
        session: {
          todo: vi.fn(),
        },
      },
    };
  });

  it("writes updated todo and preserves existing items", async () => {
    // given
    const task: Task = {
      id: "T-1",
      subject: "Updated task",
      description: "",
      status: "in_progress",
      blocks: [],
      blockedBy: [],
    };
    const currentTodos: TodoInfo[] = [
      { id: "T-1", content: "Old task", status: "pending" },
      { id: "T-2", content: "Keep task", status: "pending" },
    ];
    mockCtx.client.session.todo.mockResolvedValue({ data: currentTodos });
    let called = false;
    const writer = async (input: { sessionID: string; todos: TodoInfo[] }) => {
      called = true;
      expect(input.sessionID).toBe("session-1");
      expect(input.todos.length).toBe(2);
      expect(
        input.todos.find((todo: TodoInfo) => todo.id === "T-1")?.content,
      ).toBe("Updated task");
      expect(input.todos.some((todo: TodoInfo) => todo.id === "T-2")).toBe(
        true,
      );
    };

    // when
    await syncTaskTodoUpdate(mockCtx, task, "session-1", writer);

    // then
    expect(called).toBe(true);
  });

  it("removes deleted task from todos", async () => {
    // given
    const task: Task = {
      id: "T-1",
      subject: "Deleted task",
      description: "",
      status: "deleted",
      blocks: [],
      blockedBy: [],
    };
    const currentTodos: TodoInfo[] = [
      { id: "T-1", content: "Old task", status: "pending" },
      { id: "T-2", content: "Keep task", status: "pending" },
    ];
    mockCtx.client.session.todo.mockResolvedValue(currentTodos);
    let called = false;
    const writer = async (input: { sessionID: string; todos: TodoInfo[] }) => {
      called = true;
      expect(input.todos.length).toBe(1);
      expect(input.todos.some((todo: TodoInfo) => todo.id === "T-1")).toBe(
        false,
      );
      expect(input.todos.some((todo: TodoInfo) => todo.id === "T-2")).toBe(
        true,
      );
    };

    // when
    await syncTaskTodoUpdate(mockCtx, task, "session-1", writer);

    // then
    expect(called).toBe(true);
  });
});

describe("syncAllTasksToTodos", () => {
  let mockCtx: any;

  beforeEach(() => {
    mockCtx = {
      client: {
        session: {
          todo: vi.fn(),
        },
      },
    };
  });

  it("fetches current todos from OpenCode", async () => {
    // given
    const tasks: Task[] = [
      {
        id: "T-1",
        subject: "Task 1",
        description: "Description 1",
        status: "pending",
        blocks: [],
        blockedBy: [],
      },
    ];
    const currentTodos: TodoInfo[] = [
      {
        id: "T-existing",
        content: "Existing todo",
        status: "pending",
      },
    ];
    mockCtx.client.session.todo.mockResolvedValue(currentTodos);

    // when
    await syncAllTasksToTodos(mockCtx, tasks, "session-1");

    // then
    expect(mockCtx.client.session.todo).toHaveBeenCalledWith({
      path: { id: "session-1" },
    });
  });

  it("handles API response with data property", async () => {
    // given
    const tasks: Task[] = [];
    const currentTodos: TodoInfo[] = [
      {
        id: "T-1",
        content: "Todo 1",
        status: "pending",
      },
    ];
    mockCtx.client.session.todo.mockResolvedValue({
      data: currentTodos,
    });

    // when
    await syncAllTasksToTodos(mockCtx, tasks, "session-1");

    // then
    expect(mockCtx.client.session.todo).toHaveBeenCalled();
  });

  it("gracefully handles fetch failure", async () => {
    // given
    const tasks: Task[] = [
      {
        id: "T-1",
        subject: "Task 1",
        description: "Description 1",
        status: "pending",
        blocks: [],
        blockedBy: [],
      },
    ];
    mockCtx.client.session.todo.mockRejectedValue(new Error("API error"));

    // when
    const result = await syncAllTasksToTodos(mockCtx, tasks, "session-1");

    // then
    expect(result).toBeUndefined();
  });

  it("converts multiple tasks to todos", async () => {
    // given
    const tasks: Task[] = [
      {
        id: "T-1",
        subject: "Task 1",
        description: "Description 1",
        status: "pending",
        blocks: [],
        blockedBy: [],
        metadata: { priority: "high" },
      },
      {
        id: "T-2",
        subject: "Task 2",
        description: "Description 2",
        status: "in_progress",
        blocks: [],
        blockedBy: [],
        metadata: { priority: "low" },
      },
    ];
    mockCtx.client.session.todo.mockResolvedValue([]);

    // when
    await syncAllTasksToTodos(mockCtx, tasks, "session-1");

    // then
    expect(mockCtx.client.session.todo).toHaveBeenCalled();
  });

  it("removes deleted tasks from todo list", async () => {
    // given
    const tasks: Task[] = [
      {
        id: "T-1",
        subject: "Task 1",
        description: "Description 1",
        status: "deleted",
        blocks: [],
        blockedBy: [],
      },
    ];
    const currentTodos: TodoInfo[] = [
      {
        id: "T-1",
        content: "Task 1",
        status: "pending",
      },
    ];
    mockCtx.client.session.todo.mockResolvedValue(currentTodos);

    // when
    await syncAllTasksToTodos(mockCtx, tasks, "session-1");

    // then
    expect(mockCtx.client.session.todo).toHaveBeenCalled();
  });

  it("preserves existing todos not in task list", async () => {
    // given
    const tasks: Task[] = [
      {
        id: "T-1",
        subject: "Task 1",
        description: "Description 1",
        status: "pending",
        blocks: [],
        blockedBy: [],
      },
    ];
    const currentTodos: TodoInfo[] = [
      {
        id: "T-1",
        content: "Task 1",
        status: "pending",
      },
      {
        id: "T-existing",
        content: "Existing todo",
        status: "pending",
      },
    ];
    mockCtx.client.session.todo.mockResolvedValue(currentTodos);

    // when
    await syncAllTasksToTodos(mockCtx, tasks, "session-1");

    // then
    expect(mockCtx.client.session.todo).toHaveBeenCalled();
  });

  it("handles empty task list", async () => {
    // given
    const tasks: Task[] = [];
    mockCtx.client.session.todo.mockResolvedValue([]);

    // when
    await syncAllTasksToTodos(mockCtx, tasks, "session-1");

    // then
    expect(mockCtx.client.session.todo).toHaveBeenCalled();
  });

  it("handles undefined sessionID", async () => {
    // given
    const tasks: Task[] = [
      {
        id: "T-1",
        subject: "Task 1",
        description: "Description 1",
        status: "pending",
        blocks: [],
        blockedBy: [],
      },
    ];
    mockCtx.client.session.todo.mockResolvedValue([]);

    // when
    await syncAllTasksToTodos(mockCtx, tasks);

    // then
    expect(mockCtx.client.session.todo).toHaveBeenCalledWith({
      path: { id: "" },
    });
  });
});
