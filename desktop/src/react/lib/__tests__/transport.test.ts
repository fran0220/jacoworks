import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { invokeMock, isTauriMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  isTauriMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  isTauri: isTauriMock,
}));

type TransportModule = typeof import("../transport");

async function loadTransport(): Promise<TransportModule> {
  return import("../transport");
}

beforeEach(() => {
  vi.resetModules();
  invokeMock.mockReset();
  isTauriMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("transport", () => {
  test("serializes request payload for Tauri invoke", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      status: 200,
      headers: { "content-type": "application/json" },
      body: '{"ok":true}',
    });

    const { httpFetch } = await loadTransport();
    const result = await httpFetch("https://gateway.test/api/sessions", {
      method: "POST",
      headers: { Authorization: "Bearer token" },
      body: '{"message":"hello"}',
    });

    expect(invokeMock).toHaveBeenCalledWith("http_fetch", {
      url: "https://gateway.test/api/sessions",
      method: "POST",
      headers: { Authorization: "Bearer token" },
      body: '{"message":"hello"}',
    });
    expect(result.status).toBe(200);
  });

  test("deserializes browser fetch response", async () => {
    isTauriMock.mockReturnValue(false);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"ok":true}', {
        status: 202,
        headers: {
          "content-type": "application/json",
          "x-trace-id": "trace-123",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { httpFetch } = await loadTransport();
    const response = await httpFetch("https://gateway.test/health");

    expect(fetchMock).toHaveBeenCalledWith("https://gateway.test/health", {
      method: "GET",
      headers: undefined,
      body: undefined,
    });
    expect(response.status).toBe(202);
    expect(response.body).toBe('{"ok":true}');
    expect(response.headers["x-trace-id"]).toBe("trace-123");
  });
});
