export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export interface FamilySpace {
  id: string;
  name: string;
  role: "owner" | "member" | string;
  member_count: number;
  steward_user_id: string;
  created_at: string;
  members?: Array<{
    id: string;
    name: string;
    email: string;
    role: string;
  }>;
}

export interface ThreadSummary {
  id: string;
  space_id: string;
  kind: "family" | "heritage" | string;
  title: string;
  created_at: string;
  last_message?: {
    body: string;
    created_at: string;
    sender_kind: string;
  } | null;
}

export interface ChatMessage {
  id: string;
  thread_id: string;
  sender_user_id?: string | null;
  sender_kind: "user" | "heritage" | string;
  sender_name?: string | null;
  body: string;
  created_at: string;
}

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    const message =
      typeof body === "object" &&
      body &&
      "error" in body &&
      typeof (body as { error: unknown }).error === "string"
        ? (body as { error: string }).error
        : `Request failed (${status})`;
    super(message);
    this.status = status;
    this.body = body;
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  getToken: () => Promise<string | null> | string | null;
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function createApiClient({ baseUrl, getToken }: ApiClientOptions) {
  const root = baseUrl.replace(/\/$/, "");

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await getToken();
    const headers = new Headers(init.headers);
    if (!headers.has("Content-Type") && init.body) {
      headers.set("Content-Type", "application/json");
    }
    if (token) headers.set("Authorization", `Bearer ${token}`);

    const res = await fetch(`${root}${path}`, { ...init, headers });
    const body = await parseBody(res);
    if (!res.ok) throw new ApiError(res.status, body);
    return body as T;
  }

  return {
    health: () => request<{ ok: boolean }>("/health"),
    login: (email: string, password: string, name?: string) =>
      request<{ user: SessionUser; token: string }>("/api/auth/dev-login", {
        method: "POST",
        body: JSON.stringify({ email, password, name }),
      }),
    me: () => request<SessionUser>("/api/auth/me"),
    listSpaces: () => request<{ spaces: FamilySpace[] }>("/api/spaces"),
    createSpace: (name: string) =>
      request<FamilySpace>("/api/spaces", {
        method: "POST",
        body: JSON.stringify({ name }),
      }),
    getSpace: (spaceId: string) => request<FamilySpace>(`/api/spaces/${spaceId}`),
    createInvite: (spaceId: string) =>
      request<{ id: string; code: string; expires_at: string | null }>(
        `/api/spaces/${spaceId}/invites`,
        { method: "POST" },
      ),
    joinSpace: (code: string) =>
      request<FamilySpace>("/api/spaces/join", {
        method: "POST",
        body: JSON.stringify({ code }),
      }),
    listThreads: (spaceId: string) =>
      request<{ threads: ThreadSummary[] }>(`/api/spaces/${spaceId}/threads`),
    getThread: (threadId: string) =>
      request<ThreadSummary>(`/api/threads/${threadId}`),
    listMessages: (threadId: string, opts?: { limit?: number; before?: string }) => {
      const params = new URLSearchParams();
      if (opts?.limit) params.set("limit", String(opts.limit));
      if (opts?.before) params.set("before", opts.before);
      const q = params.toString();
      return request<{ messages: ChatMessage[] }>(
        `/api/threads/${threadId}/messages${q ? `?${q}` : ""}`,
      );
    },
    sendMessage: (threadId: string, body: string) =>
      request<ChatMessage>(`/api/threads/${threadId}/messages`, {
        method: "POST",
        body: JSON.stringify({ body }),
      }),
  };
}

export type ForeverApi = ReturnType<typeof createApiClient>;
