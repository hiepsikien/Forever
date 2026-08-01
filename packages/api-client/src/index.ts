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

export interface SpaceSettings {
  elevenlabs_api_key_set: boolean;
  elevenlabs_api_key_hint: string;
  can_edit: boolean;
  consent_self: string;
  consent_heritage: string;
  updated_at?: string | null;
}

export interface IdentityProfile {
  id: string;
  space_id: string;
  display_name: string;
  relation_label: string;
  status: "living" | "remembered" | string;
  linked_user_id?: string | null;
  heritage_thread_id?: string | null;
  created_by: string;
  created_at: string;
  voice_profile_id?: string | null;
  voice_status?: string | null;
  voice_sample_count?: number | null;
  voice_provider_voice_id?: string | null;
}

export interface VoiceSample {
  id: string;
  voice_profile_id?: string;
  source: string;
  note?: string;
  media_mime: string;
  duration_ms?: number | null;
  duration_label?: string | null;
  file_size_bytes?: number;
  quality_score?: number | null;
  quality_label?: string | null;
  quality_tip?: string | null;
  created_at: string;
  voice_display_name?: string;
  voice_subject_kind?: string;
  voice_status?: string;
}

export interface VoiceRender {
  id: string;
  voice_profile_id: string;
  space_id: string;
  text: string;
  media_mime: string;
  model_id?: string | null;
  provider_voice_id?: string | null;
  provider_voice_name?: string | null;
  stability?: number | null;
  similarity_boost?: number | null;
  created_by: string;
  created_at: string;
  voice_display_name?: string | null;
  voice_subject_kind?: string | null;
}

export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category: string;
  description?: string;
  labels?: Record<string, string>;
  created_at_unix?: number | null;
}

/** TTS models that officially include Vietnamese. */
export const VOICE_TTS_MODELS = [
  {
    id: "eleven_v3",
    label: "v3 · Chất lượng cao",
    hint: "Cảm xúc tốt nhất, chậm hơn",
  },
  {
    id: "eleven_turbo_v2_5",
    label: "Turbo v2.5 · Cân bằng",
    hint: "Nhanh hơn, vẫn hỗ trợ tiếng Việt",
  },
  {
    id: "eleven_flash_v2_5",
    label: "Flash v2.5 · Nhanh",
    hint: "Realtime / chi phí thấp",
  },
] as const;

export type VoiceTtsModelId = (typeof VOICE_TTS_MODELS)[number]["id"];

export function voiceTtsModelLabel(modelId: string | null | undefined): string {
  if (!modelId) return "—";
  const found = VOICE_TTS_MODELS.find((m) => m.id === modelId);
  return found?.label ?? modelId;
}

export interface VoiceProfile {
  id: string;
  space_id: string;
  subject_kind: "self" | "heritage" | string;
  subject_user_id?: string | null;
  identity_profile_id?: string | null;
  provider: string;
  provider_voice_id?: string | null;
  status: "draft" | "ready" | "failed" | "paused" | string;
  display_name: string;
  consent_at?: string | null;
  error_message?: string | null;
  sample_count: number;
  samples?: VoiceSample[];
  created_by: string;
  created_at: string;
  updated_at: string;
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
    getSpaceSettings: (spaceId: string) =>
      request<SpaceSettings>(`/api/spaces/${spaceId}/settings`),
    updateSpaceSettings: (
      spaceId: string,
      payload: { elevenlabs_api_key?: string | null },
    ) =>
      request<SpaceSettings>(`/api/spaces/${spaceId}/settings`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    listIdentities: (spaceId: string) =>
      request<{ identities: IdentityProfile[] }>(
        `/api/spaces/${spaceId}/identities`,
      ),
    createIdentity: (
      spaceId: string,
      payload: {
        display_name: string;
        relation_label?: string;
        status?: "living" | "remembered";
      },
    ) =>
      request<IdentityProfile>(`/api/spaces/${spaceId}/identities`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    updateIdentity: (
      spaceId: string,
      identityId: string,
      payload: {
        display_name?: string;
        relation_label?: string;
        status?: "living" | "remembered";
      },
    ) =>
      request<IdentityProfile>(
        `/api/spaces/${spaceId}/identities/${identityId}`,
        {
          method: "PATCH",
          body: JSON.stringify(payload),
        },
      ),
    listVoices: (spaceId: string) =>
      request<{ voices: VoiceProfile[] }>(`/api/spaces/${spaceId}/voices`),
    getVoice: (voiceId: string) =>
      request<VoiceProfile>(`/api/voices/${voiceId}`),
    listElevenLabsVoices: (
      spaceId: string,
      opts?: {
        clonedOnly?: boolean;
        nameContains?: string;
        voiceId?: string;
      },
    ) => {
      const params = new URLSearchParams();
      params.set(
        "cloned_only",
        (opts?.clonedOnly ?? true) ? "true" : "false",
      );
      if (opts?.nameContains) params.set("name_contains", opts.nameContains);
      if (opts?.voiceId) params.set("voice_id", opts.voiceId);
      return request<{ voices: ElevenLabsVoice[] }>(
        `/api/spaces/${spaceId}/elevenlabs-voices?${params.toString()}`,
      );
    },
    createSelfVoice: (spaceId: string, consent = true) =>
      request<VoiceProfile>(`/api/spaces/${spaceId}/voices/self`, {
        method: "POST",
        body: JSON.stringify({ consent }),
      }),
    createVoiceForIdentity: (
      spaceId: string,
      identityProfileId: string,
      consent = true,
    ) =>
      request<VoiceProfile>(`/api/spaces/${spaceId}/voices/for-identity`, {
        method: "POST",
        body: JSON.stringify({
          identity_profile_id: identityProfileId,
          consent,
        }),
      }),
    createHeritageVoice: (
      spaceId: string,
      identityProfileId: string,
      consent = true,
    ) =>
      request<VoiceProfile>(`/api/spaces/${spaceId}/voices/heritage`, {
        method: "POST",
        body: JSON.stringify({
          identity_profile_id: identityProfileId,
          consent,
        }),
      }),
    addVoiceSample: async (
      voiceId: string,
      payload: {
        uri: string;
        name: string;
        mimeType: string;
        source?: "record" | "upload" | "memory";
        durationMs?: number;
        note?: string;
      },
    ) => {
      const form = new FormData();
      if (payload.source) form.append("source", payload.source);
      if (payload.durationMs != null && payload.durationMs > 0) {
        form.append("duration_ms", String(Math.round(payload.durationMs)));
      }
      if (payload.note) form.append("note", payload.note);
      form.append("file", {
        uri: payload.uri,
        name: payload.name,
        type: payload.mimeType,
      } as unknown as Blob);
      return request<{ sample_id: string; voice: VoiceProfile }>(
        `/api/voices/${voiceId}/samples`,
        { method: "POST", body: form as unknown as BodyInit },
        { json: false },
      );
    },
    listSpaceVoiceSamples: (spaceId: string, voiceId?: string) => {
      const q = voiceId ? `?voice_id=${encodeURIComponent(voiceId)}` : "";
      return request<{ samples: VoiceSample[] }>(
        `/api/spaces/${spaceId}/voice-samples${q}`,
      );
    },
    generateVoiceScript: (
      spaceId: string,
      payload?: { theme?: string; seed?: number },
    ) =>
      request<{
        script: string;
        source: "gemini" | "fallback" | string;
        approx_seconds: number;
      }>(`/api/spaces/${spaceId}/voice-scripts/generate`, {
        method: "POST",
        body: JSON.stringify({
          theme: payload?.theme ?? "",
          seed: payload?.seed ?? 0,
        }),
      }),
    updateVoiceSampleNote: (voiceId: string, sampleId: string, note: string) =>
      request<VoiceSample>(`/api/voices/${voiceId}/samples/${sampleId}`, {
        method: "PATCH",
        body: JSON.stringify({ note }),
      }),
    deleteVoiceSample: (voiceId: string, sampleId: string) =>
      request<VoiceProfile>(`/api/voices/${voiceId}/samples/${sampleId}`, {
        method: "DELETE",
      }),
    cloneVoice: (
      voiceId: string,
      opts?: { remove_background_noise?: boolean },
    ) =>
      request<VoiceProfile>(`/api/voices/${voiceId}/clone`, {
        method: "POST",
        body: JSON.stringify(opts ?? {}),
      }),
    pauseVoice: (voiceId: string) =>
      request<VoiceProfile>(`/api/voices/${voiceId}/pause`, { method: "POST" }),
    listVoiceRenders: (voiceId: string) =>
      request<{ renders: VoiceRender[] }>(`/api/voices/${voiceId}/renders`),
    listSpaceVoiceRenders: (spaceId: string, voiceId?: string) => {
      const q = voiceId
        ? `?voice_id=${encodeURIComponent(voiceId)}`
        : "";
      return request<{ renders: VoiceRender[] }>(
        `/api/spaces/${spaceId}/voice-renders${q}`,
      );
    },
    voiceRenderMediaUrl: (voiceId: string, renderId: string) =>
      `${resolveRoot()}/api/voices/${voiceId}/renders/${renderId}/media`,
    deleteVoiceRender: (voiceId: string, renderId: string) =>
      request<{ ok: boolean }>(`/api/voices/${voiceId}/renders/${renderId}`, {
        method: "DELETE",
      }),
    saveVoiceRender: async (
      voiceId: string,
      text: string,
      opts?: {
        model_id?: string;
        provider_voice_id?: string;
        provider_voice_name?: string;
        stability?: number;
        similarity_boost?: number;
        style?: number;
        use_speaker_boost?: boolean;
      },
    ) =>
      request<VoiceRender>(`/api/voices/${voiceId}/tts`, {
        method: "POST",
        body: JSON.stringify({ text, save: true, ...opts }),
      }),
    synthesizeVoiceTts: async (
      voiceId: string,
      text: string,
      opts?: {
        model_id?: string;
        provider_voice_id?: string;
        provider_voice_name?: string;
        stability?: number;
        similarity_boost?: number;
        style?: number;
        use_speaker_boost?: boolean;
      },
    ) => {
      const root = resolveRoot();
      const token = await getToken();
      const headers = new Headers({ "Content-Type": "application/json" });
      if (token) headers.set("Authorization", `Bearer ${token}`);
      const signal =
        timeoutMs > 0 &&
        typeof AbortSignal !== "undefined" &&
        "timeout" in AbortSignal
          ? AbortSignal.timeout(timeoutMs)
          : undefined;
      const res = await fetch(`${root}/api/voices/${voiceId}/tts`, {
        method: "POST",
        headers,
        body: JSON.stringify({ text, save: false, ...opts }),
        ...(signal ? { signal } : {}),
      });
      if (!res.ok) {
        const body = await parseBody(res);
        throw new ApiError(res.status, body);
      }
      return new Uint8Array(await res.arrayBuffer());
    },
    voiceSampleMediaUrl: (voiceId: string, sampleId: string) =>
      `${resolveRoot()}/api/voices/${voiceId}/samples/${sampleId}/media`,
  };
}

export type ForeverApi = ReturnType<typeof createApiClient>;
