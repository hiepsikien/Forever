export interface SessionUser {
  id: string;
  email: string;
  phone?: string | null;
  name: string;
  handle?: string | null;
}

export interface StewardPerson {
  id: string;
  name: string;
  handle?: string | null;
  email?: string;
}

export interface StewardSuccession {
  id: string;
  space_id: string;
  status: "pending" | "accepted" | "declined" | "activated" | "revoked" | string;
  note: string;
  nominee: StewardPerson;
  nominated_by: StewardPerson;
  created_at: string;
  accepted_at?: string | null;
  activated_at?: string | null;
}

export interface StewardshipStatus {
  space_id: string;
  steward: StewardPerson | null;
  is_steward: boolean;
  succession: StewardSuccession | null;
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
    handle?: string | null;
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
    kind?: "text" | "voice" | string;
    body: string;
    created_at: string;
    sender_kind: string;
  } | null;
}

export interface ChatMessage {
  id: string;
  thread_id: string;
  sender_user_id?: string | null;
  sender_kind: "user" | "agent" | "heritage" | string;
  sender_name?: string | null;
  sender_handle?: string | null;
  kind?: "text" | "voice" | string;
  body: string;
  has_media?: boolean;
  media_mime?: string | null;
  created_at: string;
}

export interface MemoryItem {
  id: string;
  space_id: string;
  created_by: string;
  creator_name?: string | null;
  kind: "note" | "voice" | "photo" | "letter" | string;
  title: string;
  body: string;
  has_media: boolean;
  media_mime?: string | null;
  source_message_id?: string | null;
  tags: string;
  occurred_at?: string | null;
  created_at: string;
}

export interface InterviewPrompt {
  id: string;
  body: string;
  sort_order: number;
  answered: boolean;
  memory_item_id?: string | null;
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
  baseUrl: string | (() => string);
  getToken: () => Promise<string | null> | string | null;
  /** Default 15000. Set 0 to disable. */
  timeoutMs?: number;
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

function isTimeoutError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const name = String((e as { name?: unknown }).name || "");
  return (
    name === "TimeoutError" ||
    name === "AbortError" ||
    name.includes("Timeout") ||
    name.includes("Abort")
  );
}

export function createApiClient({
  baseUrl,
  getToken,
  timeoutMs = 15_000,
}: ApiClientOptions) {
  const resolveRoot = () =>
    (typeof baseUrl === "function" ? baseUrl() : baseUrl).replace(/\/$/, "");

  async function request<T>(
    path: string,
    init: RequestInit = {},
    opts?: { json?: boolean },
  ): Promise<T> {
    const root = resolveRoot();
    const token = await getToken();
    const headers = new Headers(init.headers);
    const useJson = opts?.json !== false;
    if (useJson && !headers.has("Content-Type") && init.body) {
      headers.set("Content-Type", "application/json");
    }
    if (token) headers.set("Authorization", `Bearer ${token}`);

    const signal =
      init.signal ??
      (timeoutMs > 0 && typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
        ? AbortSignal.timeout(timeoutMs)
        : undefined);

    try {
      const res = await fetch(`${root}${path}`, {
        ...init,
        headers,
        ...(signal ? { signal } : {}),
      });
      const body = await parseBody(res);
      if (!res.ok) throw new ApiError(res.status, body);
      return body as T;
    } catch (e) {
      if (isTimeoutError(e)) {
        throw new Error(
          `Không kết nối được API (${root}). Kiểm tra máy và điện thoại cùng mạng, API đang chạy --host 0.0.0.0.`,
        );
      }
      throw e;
    }
  }

  return {
    get baseUrl() {
      return resolveRoot();
    },
    health: () => request<{ ok: boolean }>("/health"),
    login: (email: string, password: string, name?: string) =>
      request<{ user: SessionUser; token: string }>("/api/auth/dev-login", {
        method: "POST",
        body: JSON.stringify({ email, password, name }),
      }),
    me: () => request<SessionUser>("/api/auth/me"),
    establishSession: () =>
      request<{ user: SessionUser }>("/api/auth/session", { method: "POST" }),
    updateProfile: (payload: { name?: string; handle?: string }) =>
      request<SessionUser>("/api/auth/me", {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    listSpaces: () => request<{ spaces: FamilySpace[] }>("/api/spaces"),
    getStewardship: (spaceId: string) =>
      request<StewardshipStatus>(`/api/spaces/${spaceId}/stewardship`),
    nominateSuccessor: (spaceId: string, userId: string, note?: string) =>
      request<StewardSuccession>(`/api/spaces/${spaceId}/stewardship/nominate`, {
        method: "POST",
        body: JSON.stringify({ user_id: userId, note }),
      }),
    acceptSuccession: (spaceId: string) =>
      request<StewardSuccession>(`/api/spaces/${spaceId}/stewardship/accept`, {
        method: "POST",
      }),
    declineSuccession: (spaceId: string) =>
      request<StewardSuccession>(`/api/spaces/${spaceId}/stewardship/decline`, {
        method: "POST",
      }),
    activateSuccession: (spaceId: string) =>
      request<{ steward: StewardPerson; succession: StewardSuccession }>(
        `/api/spaces/${spaceId}/stewardship/activate`,
        { method: "POST" },
      ),
    revokeSuccession: (spaceId: string) =>
      request<{ ok: boolean; revoked: number }>(
        `/api/spaces/${spaceId}/stewardship/revoke`,
        { method: "POST" },
      ),
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
    sendVoiceMessage: async (
      threadId: string,
      payload: {
        uri: string;
        name: string;
        mimeType: string;
        body?: string;
      },
    ) => {
      const form = new FormData();
      if (payload.body) form.append("body", payload.body);
      form.append("file", {
        uri: payload.uri,
        name: payload.name,
        type: payload.mimeType,
      } as unknown as Blob);
      return request<ChatMessage>(
        `/api/threads/${threadId}/messages/voice`,
        { method: "POST", body: form as unknown as BodyInit },
        { json: false },
      );
    },
    messageMediaUrl: (messageId: string) =>
      `${resolveRoot()}/api/messages/${messageId}/media`,
    listMemories: (spaceId: string) =>
      request<{ memories: MemoryItem[] }>(`/api/spaces/${spaceId}/memories`),
    createNoteMemory: (
      spaceId: string,
      payload: { title?: string; body: string; tags?: string; occurred_at?: string },
    ) =>
      request<MemoryItem>(`/api/spaces/${spaceId}/memories/note`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    uploadMemory: async (
      spaceId: string,
      payload: {
        kind: "voice" | "photo";
        uri: string;
        name: string;
        mimeType: string;
        title?: string;
        body?: string;
        tags?: string;
      },
    ) => {
      const form = new FormData();
      form.append("kind", payload.kind);
      if (payload.title) form.append("title", payload.title);
      if (payload.body) form.append("body", payload.body);
      if (payload.tags) form.append("tags", payload.tags);
      form.append("file", {
        uri: payload.uri,
        name: payload.name,
        type: payload.mimeType,
      } as unknown as Blob);
      return request<MemoryItem>(
        `/api/spaces/${spaceId}/memories/upload`,
        { method: "POST", body: form as unknown as BodyInit },
        { json: false },
      );
    },
    memoryFromMessage: (spaceId: string, messageId: string, title?: string) =>
      request<MemoryItem>(`/api/spaces/${spaceId}/memories/from-message`, {
        method: "POST",
        body: JSON.stringify({ message_id: messageId, title }),
      }),
    memoryMediaUrl: (memoryId: string) =>
      `${resolveRoot()}/api/memories/${memoryId}/media`,
    listInterviewPrompts: (spaceId: string) =>
      request<{ prompts: InterviewPrompt[] }>(
        `/api/spaces/${spaceId}/interview/prompts`,
      ),
    answerInterviewText: (
      spaceId: string,
      promptId: string,
      payload: { body: string; title?: string },
    ) =>
      request<{
        answer_id: string;
        prompt_id: string;
        memory: MemoryItem;
      }>(`/api/spaces/${spaceId}/interview/prompts/${promptId}/answers`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    answerInterviewVoice: async (
      spaceId: string,
      promptId: string,
      payload: {
        uri: string;
        name: string;
        mimeType: string;
        title?: string;
        body?: string;
      },
    ) => {
      const form = new FormData();
      if (payload.title) form.append("title", payload.title);
      if (payload.body) form.append("body", payload.body);
      form.append("file", {
        uri: payload.uri,
        name: payload.name,
        type: payload.mimeType,
      } as unknown as Blob);
      return request<{
        answer_id: string;
        prompt_id: string;
        memory: MemoryItem;
      }>(
        `/api/spaces/${spaceId}/interview/prompts/${promptId}/answers/voice`,
        { method: "POST", body: form as unknown as BodyInit },
        { json: false },
      );
    },
  };
}

export type ForeverApi = ReturnType<typeof createApiClient>;
