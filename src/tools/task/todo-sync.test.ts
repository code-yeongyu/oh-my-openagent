/// <reference types="bun-types/test-globals" />
import type { Task } from "./types";
import type { NumberingInfo } from "../../features/claude-tasks/tree-numbering";
import {
  syncTaskToTodo,
  syncAllTasksToTodos,
  syncTaskTodoUpdate,
  type TodoInfo,
} from "./todo-sync";

describe("syncTaskToTodo with tree numbering", () => {
  const createTask = (overrides: Partial<Task> = {}): Task => ({
    id: "T-test",
    subject: "Test Task",
    description: "",
    status: "pending",
    blocks: [],
    blockedBy: [],
    threadID: "session-1",
    ...overrides,
  });

  it("numbers root task as '1. Root Task'", () => {
    // given
    const task = createTask({
      id: "T-root",
      subject: "Root Task",
    });

    // when
    const result = syncTaskToTodo(task, { depth: 0, numberingPath: [1] });

    // then
    expect(result?.content).toBe("1. Root Task");
  });

  it("numbers child task as '  1.1. Child Task' with 2-space indent", () => {
    // given
    const task = createTask({
      id: "T-child",
      subject: "Child Task",
      parentID: "T-root",
    });

    // when
    const result = syncTaskToTodo(task, { depth: 1, numberingPath: [1, 1] });

    // then
    expect(result?.content).toBe("  1.1. Child Task");
  });

  it("numbers grandchild task as '    1.1.1. Grandchild' with 4-space indent", () => {
    // given
    const task = createTask({
      id: "T-grandchild",
      subject: "Grandchild",
      parentID: "T-child",
    });

    // when
    const result = syncTaskToTodo(task, { depth: 2, numberingPath: [1, 1, 1] });

    // then
    expect(result?.content).toBe("    1.1.1. Grandchild");
  });

  it("handles multiple siblings at root level", () => {
    // given
    const task = createTask({
      id: "T-root-2",
      subject: "Second Root",
    });

    // when
    const result = syncTaskToTodo(task, { depth: 0, numberingPath: [2] });

    // then
    expect(result?.content).toBe("2. Second Root");
  });

  it("handles nested siblings (1.2, 1.3)", () => {
    // given
    const task = createTask({
      id: "T-sibling",
      subject: "Second Child",
      parentID: "T-root",
    });

    // when
    const result = syncTaskToTodo(task, { depth: 1, numberingPath: [1, 2] });

    // then
    expect(result?.content).toBe("  1.2. Second Child");
  });

  it("converts pending task to pending todo", () => {
    // given
    const task = createTask({
      id: "T-123",
      subject: "Fix bug",
      description: "Fix critical bug",
      status: "pending",
    });

    // when
    const result = syncTaskToTodo(task, { depth: 0, numberingPath: [1] });

    // then
    expect(result).toEqual({
      id: "T-123",
      content: "1. Fix bug",
      status: "pending",
      priority: "medium",
    });
  });

  it("converts in_progress task to in_progress todo", () => {
    // given
    const task = createTask({
      id: "T-456",
      subject: "Implement feature",
      description: "Add new feature",
      status: "in_progress",
    });

    // when
    const result = syncTaskToTodo(task, { depth: 0, numberingPath: [1] });

    // then
    expect(result?.status).toBe("in_progress");
    expect(result?.content).toBe("1. Implement feature");
  });

  it("converts completed task to completed todo", () => {
    // given
    const task = createTask({
      id: "T-789",
      subject: "Review PR",
      description: "Review pull request",
      status: "completed",
    });

    // when
    const result = syncTaskToTodo(task, { depth: 0, numberingPath: [1] });

    // then
    expect(result?.status).toBe("completed");
  });

  it("returns null for deleted task", () => {
    // given
    const task = createTask({
      id: "T-del",
      subject: "Deleted task",
      description: "This task is deleted",
      status: "deleted",
    });

    // when
    const result = syncTaskToTodo(task, { depth: 0, numberingPath: [1] });

    // then
    expect(result).toBeNull();
  });

  it("extracts priority from metadata", () => {
    // given
    const task = createTask({
      id: "T-high",
      subject: "Critical task",
      description: "High priority task",
      status: "pending",
      metadata: { priority: "high" },
    });

    // when
    const result = syncTaskToTodo(task, { depth: 0, numberingPath: [1] });

    // then
    expect(result?.priority).toBe("high");
  });

  it("handles medium priority", () => {
    // given
    const task = createTask({
      id: "T-med",
      subject: "Medium task",
      description: "Medium priority",
      status: "pending",
      metadata: { priority: "medium" },
    });

    // when
    const result = syncTaskToTodo(task, { depth: 0, numberingPath: [1] });

    // then
    expect(result?.priority).toBe("medium");
  });

  it("handles low priority", () => {
    // given
    const task = createTask({
      id: "T-low",
      subject: "Low task",
      description: "Low priority",
      status: "pending",
      metadata: { priority: "low" },
    });

    // when
    const result = syncTaskToTodo(task, { depth: 0, numberingPath: [1] });

    // then
    expect(result?.priority).toBe("low");
  });

  it("ignores invalid priority values", () => {
    // given
    const task = createTask({
      id: "T-invalid",
      subject: "Invalid priority",
      description: "Invalid priority value",
      status: "pending",
      metadata: { priority: "urgent" },
    });

    // when
    const result = syncTaskToTodo(task, { depth: 0, numberingPath: [1] });

    // then
    expect(result?.priority).toBe("medium");
  });

  it("handles missing metadata", () => {
    // given
    const task = createTask({
      id: "T-no-meta",
      subject: "No metadata",
      description: "Task without metadata",
      status: "pending",
    });

    // when
    const result = syncTaskToTodo(task, { depth: 0, numberingPath: [1] });

    // then
    expect(result?.priority).toBe("medium");
  });

  it("uses subject as todo content (with numbering)", () => {
    // given
    const task = createTask({
      id: "T-content",
      subject: "This is the subject",
      description: "This is the description",
      status: "pending",
    });

    // when
    const result = syncTaskToTodo(task, { depth: 0, numberingPath: [1] });

    // then
    expect(result?.content).toBe("1. This is the subject");
  });
});

describe("syncTaskTodoUpdate", () => {
  let mockCtx: any;
  const createTask = (overrides: Partial<Task> = {}): Task => ({
    id: "T-test",
    subject: "Test Task",
    description: "",
    status: "pending",
    blocks: [],
    blockedBy: [],
    threadID: "session-1",
    ...overrides,
  });

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
    const task = createTask({
      id: "T-1",
      subject: "Updated task",
      status: "in_progress",
    });
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
      ).toBe("1. Updated task");
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
    const task = createTask({
      id: "T-1",
      subject: "Deleted task",
      status: "deleted",
    });
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
  const createTask = (overrides: Partial<Task> = {}): Task => ({
    id: "T-test",
    subject: "Test Task",
    description: "",
    status: "pending",
    blocks: [],
    blockedBy: [],
    threadID: "session-1",
    ...overrides,
  });

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
      createTask({
        id: "T-1",
        subject: "Task 1",
        description: "Description 1",
        status: "pending",
      }),
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
      createTask({
        id: "T-1",
        subject: "Task 1",
        description: "Description 1",
        status: "pending",
      }),
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
      createTask({
        id: "T-1",
        subject: "Task 1",
        description: "Description 1",
        status: "pending",
        metadata: { priority: "high" },
      }),
      createTask({
        id: "T-2",
        subject: "Task 2",
        description: "Description 2",
        status: "in_progress",
        metadata: { priority: "low" },
      }),
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
      createTask({
        id: "T-1",
        subject: "Task 1",
        description: "Description 1",
        status: "deleted",
      }),
    ];
    const currentTodos: TodoInfo[] = [
      {
        id: "T-1",
        content: "Task 1",
        status: "pending",
      },
    ];
    mockCtx.client.session.todo.mockResolvedValue(currentTodos);
    let writtenTodos: TodoInfo[] = [];
    const writer = async (input: { sessionID: string; todos: TodoInfo[] }) => {
      writtenTodos = input.todos;
    };

    // when
    await syncAllTasksToTodos(mockCtx, tasks, "session-1", writer);

    // then
    expect(writtenTodos.some((t: TodoInfo) => t.id === "T-1")).toBe(false);
  });

  it("preserves existing todos not in task list", async () => {
    // given
    const tasks: Task[] = [
      createTask({
        id: "T-1",
        subject: "Task 1",
        description: "Description 1",
        status: "pending",
      }),
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
    let writtenTodos: TodoInfo[] = [];
    const writer = async (input: { sessionID: string; todos: TodoInfo[] }) => {
      writtenTodos = input.todos;
    };

    // when
    await syncAllTasksToTodos(mockCtx, tasks, "session-1", writer);

    // then
    expect(writtenTodos.some((t: TodoInfo) => t.id === "T-existing")).toBe(true);
    expect(writtenTodos.some((t: TodoInfo) => t.content === "1. Task 1")).toBe(true);
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

  it("calls writer with final todos", async () => {
    // given
    const tasks: Task[] = [
      createTask({
        id: "T-1",
        subject: "Task 1",
        description: "Description 1",
        status: "pending",
      }),
    ];
    mockCtx.client.session.todo.mockResolvedValue([]);
    let writerCalled = false;
    const writer = async (input: { sessionID: string; todos: TodoInfo[] }) => {
      writerCalled = true;
      expect(input.sessionID).toBe("session-1");
      expect(input.todos.length).toBe(1);
      expect(input.todos[0].content).toBe("1. Task 1");
    };

    // when
    await syncAllTasksToTodos(mockCtx, tasks, "session-1", writer);

    // then
    expect(writerCalled).toBe(true);
  });

  it("deduplicates no-id todos when task replaces existing content", async () => {
    // given
    const tasks: Task[] = [
      {
        id: "T-1",
        subject: "Task 1 (updated)",
        description: "Description 1",
        status: "in_progress",
        blocks: [],
        blockedBy: [],
        threadID: "session-1",
      },
    ];
    const currentTodos: TodoInfo[] = [
      {
        content: "1. Task 1 (updated)",
        status: "pending",
      },
    ];
    mockCtx.client.session.todo.mockResolvedValue(currentTodos);
    let writtenTodos: TodoInfo[] = [];
    const writer = async (input: { sessionID: string; todos: TodoInfo[] }) => {
      writtenTodos = input.todos;
    };

    // when
    await syncAllTasksToTodos(mockCtx, tasks, "session-1", writer);

    // then — no duplicates
    const matching = writtenTodos.filter((t: TodoInfo) => t.content === "1. Task 1 (updated)");
    expect(matching.length).toBe(1);
    expect(matching[0].status).toBe("in_progress");
  });

  it("preserves todos without id field", async () => {
    // given
    const tasks: Task[] = [
      {
        id: "T-1",
        subject: "Task 1",
        description: "Description 1",
        status: "pending",
        blocks: [],
        blockedBy: [],
        threadID: "session-1",
      },
    ];
    const currentTodos: TodoInfo[] = [
      {
        id: "T-1",
        content: "Task 1",
        status: "pending",
      },
      {
        content: "Todo without id",
        status: "pending",
      },
    ];
    mockCtx.client.session.todo.mockResolvedValue(currentTodos);

    // when
    await syncAllTasksToTodos(mockCtx, tasks, "session-1");

    // then
    expect(mockCtx.client.session.todo).toHaveBeenCalled();
  });
});
