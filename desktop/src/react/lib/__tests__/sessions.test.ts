import { beforeEach, describe, expect, test, vi } from "vitest";

const { getTokenMock, httpFetchMock } = vi.hoisted(() => ({
  getTokenMock: vi.fn(),
  httpFetchMock: vi.fn(),
}));

vi.mock("../auth", () => ({
  getToken: getTokenMock,
}));

vi.mock("../transport", () => ({
  httpFetch: httpFetchMock,
}));

vi.mock("../config", () => ({
  GATEWAY_URL: "http://gateway.test",
}));

type SessionsModule = typeof import("../sessions");

async function loadSessions(): Promise<SessionsModule> {
  return import("../sessions");
}

beforeEach(() => {
  vi.resetModules();
  getTokenMock.mockReset();
  httpFetchMock.mockReset();
  getTokenMock.mockReturnValue("session-token");
});

describe("sessions", () => {
  test("createSession sends correct payload", async () => {
    httpFetchMock.mockResolvedValue({
      status: 201,
      headers: {},
      body: JSON.stringify({
        id: "s-1",
        title: "New Session",
        messages: "[]",
        created_at: "2026-03-04T10:00:00.000Z",
        updated_at: "2026-03-04T10:00:00.000Z",
        type: "chat",
        workspace_path: "/workspace/project",
        model: "proxy-claude/claude-sonnet-4-6",
      }),
    });

    const sessions = await loadSessions();
    await sessions.createSession({
      workspacePath: "/workspace/project",
      model: "proxy-claude/claude-sonnet-4-6",
    });

    expect(httpFetchMock).toHaveBeenCalledWith(
      "http://gateway.test/api/sessions",
      expect.objectContaining({ method: "POST" }),
    );

    const request = httpFetchMock.mock.calls[0]?.[1] as {
      body: string;
      headers: Record<string, string>;
    };
    expect(JSON.parse(request.body)).toEqual({
      type: "cowork",
      workspace_path: "/workspace/project",
      model: "proxy-claude/claude-sonnet-4-6",
    });
    expect(request.headers.Authorization).toBe("Bearer session-token");
  });

  test("createSession omits empty model field", async () => {
    httpFetchMock.mockResolvedValue({
      status: 201,
      headers: {},
      body: JSON.stringify({
        id: "s-no-model",
        title: "New Session",
        messages: "[]",
        created_at: "2026-03-04T10:00:00.000Z",
        updated_at: "2026-03-04T10:00:00.000Z",
        type: "chat",
        workspace_path: "/workspace/project",
        model: "claude-sonnet-4-6",
      }),
    });

    const sessions = await loadSessions();
    await sessions.createSession({ workspacePath: "/workspace/project", model: "   " });

    const request = httpFetchMock.mock.calls[0]?.[1] as { body: string };
    expect(JSON.parse(request.body)).toEqual({
      type: "cowork",
      workspace_path: "/workspace/project",
    });
  });

  test("updateSession sends PUT", async () => {
    httpFetchMock.mockResolvedValue({
      status: 200,
      headers: {},
      body: "{}",
    });

    const sessions = await loadSessions();
    await sessions.updateSession("s-1", {
      title: "Updated",
      messages: [{ role: "user", content: "hello" }],
      model: "proxy-gpt/gpt-5.4",
      workspacePath: "/tmp/ws",
    });

    expect(httpFetchMock).toHaveBeenCalledWith(
      "http://gateway.test/api/sessions/s-1",
      expect.objectContaining({ method: "PUT" }),
    );

    const request = httpFetchMock.mock.calls[0]?.[1] as { body: string };
    expect(JSON.parse(request.body)).toEqual({
      title: "Updated",
      messages: JSON.stringify([{ role: "user", content: "hello" }]),
      model: "proxy-gpt/gpt-5.4",
      workspace_path: "/tmp/ws",
    });
  });

  test("deleteSession sends DELETE", async () => {
    httpFetchMock.mockResolvedValue({
      status: 204,
      headers: {},
      body: "",
    });

    const sessions = await loadSessions();
    await sessions.deleteSession("s-1");

    expect(httpFetchMock).toHaveBeenCalledWith(
      "http://gateway.test/api/sessions/s-1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  test("listSessions returns chat array", async () => {
    httpFetchMock.mockResolvedValue({
      status: 200,
      headers: {},
      body: JSON.stringify([
        {
          id: "chat-1",
          title: "Chat One",
          message_count: 2,
          created_at: "2026-03-04T10:00:00.000Z",
          updated_at: "2026-03-04T10:01:00.000Z",
          type: "chat",
          model: "proxy-claude/claude-opus-4-6",
          workspace_path: "/workspace/a",
        },
        {
          id: "cowork-1",
          title: "Cowork",
          message_count: 3,
          created_at: "2026-03-04T10:00:00.000Z",
          updated_at: "2026-03-04T10:01:00.000Z",
          type: "cowork",
        },
      ]),
    });

    const sessions = await loadSessions();
    const list = await sessions.listSessions();

    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({
      id: "chat-1",
      title: "Chat One",
      type: "chat",
      model: "proxy-claude/claude-opus-4-6",
      workspacePath: "/workspace/a",
    });
    expect(list[1]).toMatchObject({
      id: "cowork-1",
      title: "Cowork",
      type: "cowork",
    });
  });

  test("session data shape is parsed correctly", async () => {
    const createdAt = "2026-03-04T12:00:00.000Z";
    const updatedAt = 1_709_567_777_000;

    httpFetchMock.mockResolvedValue({
      status: 201,
      headers: {},
      body: JSON.stringify({
        id: "s-struct",
        title: "Struct Session",
        messages: JSON.stringify([{ role: "assistant", content: "hello" }]),
        created_at: createdAt,
        updated_at: updatedAt,
        type: "chat",
        workspace_path: "/tmp/ws",
        model: "proxy-gpt/gpt-5.4",
      }),
    });

    const sessions = await loadSessions();
    const session = await sessions.createSession({ model: "proxy-gpt/gpt-5.4" });

    expect(session).toMatchObject({
      id: "s-struct",
      title: "Struct Session",
      type: "chat",
      workspacePath: "/tmp/ws",
      model: "proxy-gpt/gpt-5.4",
    });
    expect(session.createdAt).toBe(new Date(createdAt).getTime());
    expect(session.updatedAt).toBe(updatedAt);
    expect(session.messages).toEqual([{ role: "assistant", content: "hello" }]);
  });
});
