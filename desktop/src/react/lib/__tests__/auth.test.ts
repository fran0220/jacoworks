import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { httpFetchMock } = vi.hoisted(() => ({
  httpFetchMock: vi.fn(),
}));

vi.mock("../transport", () => ({
  httpFetch: httpFetchMock,
}));

vi.mock("../config", () => ({
  GATEWAY_URL: "http://gateway.test",
}));

type AuthModule = typeof import("../auth");

const TEST_USER = {
  id: "u-1",
  name: "Admin",
  email: "admin@jacoworks.local",
  role: "admin",
};

function createStorage(seed: Record<string, string> = {}): Storage {
  const store = new Map(Object.entries(seed));
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? (store.get(key) ?? null) : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

async function loadAuth(): Promise<AuthModule> {
  return import("../auth");
}

beforeEach(() => {
  vi.resetModules();
  httpFetchMock.mockReset();
  Object.defineProperty(globalThis, "localStorage", {
    value: createStorage(),
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("auth", () => {
  test("login sends correct request format", async () => {
    const username = "admin";
    const secret = "login-secret";

    httpFetchMock.mockResolvedValue({
      status: 200,
      headers: {},
      body: JSON.stringify({ token: "token-123", user: TEST_USER }),
    });

    const auth = await loadAuth();
    await auth.login(username, secret);

    expect(httpFetchMock).toHaveBeenCalledTimes(1);
    const request = httpFetchMock.mock.calls[0] as [
      string,
      { method: string; headers: Record<string, string>; body: string },
    ];
    expect(request[0]).toBe("http://gateway.test/api/auth/login");
    expect(request[1].method).toBe("POST");
    expect(request[1].headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(request[1].body)).toEqual({ username, password: secret });
  });

  test("login success stores token", async () => {
    httpFetchMock.mockResolvedValue({
      status: 200,
      headers: {},
      body: JSON.stringify({ token: "token-123", user: TEST_USER }),
    });

    const auth = await loadAuth();
    await auth.login("admin", "admin123");

    expect(auth.getToken()).toBe("token-123");
    expect(localStorage.getItem("jacoworks_token")).toBe("token-123");
    expect(localStorage.getItem("jacoworks_user")).toBe(JSON.stringify(TEST_USER));
  });

  test("logout clears token", async () => {
    httpFetchMock
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        body: JSON.stringify({ token: "token-123", user: TEST_USER }),
      })
      .mockResolvedValueOnce({
        status: 204,
        headers: {},
        body: "",
      });

    const auth = await loadAuth();
    await auth.login("admin", "admin123");
    auth.logout();

    expect(auth.isAuthenticated()).toBe(false);
    expect(auth.getToken()).toBeNull();
    expect(localStorage.getItem("jacoworks_token")).toBeNull();
    expect(httpFetchMock).toHaveBeenNthCalledWith(
      2,
      "http://gateway.test/api/auth/logout",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer token-123" }),
      }),
    );
  });

  test("authenticated requests include Authorization header", async () => {
    httpFetchMock
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        body: JSON.stringify({ token: "token-123", user: TEST_USER }),
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        body: JSON.stringify({
          llm_proxy_url: "http://proxy.local",
          llm_proxy_key: "proxy-key",
        }),
      });

    const auth = await loadAuth();
    await auth.login("admin", "admin123");
    await auth.fetchAgentConfig();

    const requestOptions = httpFetchMock.mock.calls[1]?.[1] as {
      headers?: Record<string, string>;
      method?: string;
    };
    expect(requestOptions.method).toBe("GET");
    expect(requestOptions.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer token-123",
    });
  });

  test("401 response clears token", async () => {
    httpFetchMock
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        body: JSON.stringify({ token: "token-123", user: TEST_USER }),
      })
      .mockResolvedValueOnce({
        status: 401,
        headers: {},
        body: JSON.stringify({ error: "unauthorized" }),
      });

    const auth = await loadAuth();
    await auth.login("admin", "admin123");
    await expect(auth.fetchAgentConfig()).rejects.toThrow("unauthorized");

    expect(auth.isAuthenticated()).toBe(false);
    expect(auth.getToken()).toBeNull();
    expect(localStorage.getItem("jacoworks_token")).toBeNull();
  });
});
