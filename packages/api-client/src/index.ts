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
  status:
    "pending" | "accepted" | "declined" | "activated" | "revoked" | string;
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
  /** family — everyone reads it; direct — one member alone with the remembered person. */
  audience_scope?: "family" | "direct" | string;
  member_user_id?: string | null;
  created_at: string;
  last_message?: {
    kind?: "text" | "voice" | string;
    body: string;
    created_at: string;
    sender_kind: string;
  } | null;
  heritage?: HeritageReadiness | null;
}

export interface MemoryCandidate {
  id: string;
  space_id: string;
  identity_id: string;
  identity_name: string;
  thread_id: string;
  /** direct means it was said in a private room — approving makes it family-wide. */
  audience_scope?: "family" | "direct" | string;
  statement: string;
  fact_kind: "life_state" | "event" | "preference" | "relationship" | string;
  subject_slug?: string;
  occurred_at?: string;
  status: "pending" | "approved" | "dismissed" | string;
  source_message_id?: string | null;
  source_body?: string;
  memory_item_id?: string | null;
  created_at: string;
}

export interface HeritageReadiness {
  identity_id: string;
  display_name: string;
  relation_label: string;
  entity_status:
    | "dormant"
    | "gathering"
    | "awakening"
    | "ready"
    | "paused"
    | string;
  voice_profile_id?: string | null;
  voice_status?: string | null;
  processed_count: number;
  unprocessed_count: number;
  voice_ready: boolean;
  knowledge_count: number;
  knowledge_target: number;
  knowledge_ready: boolean;
  poem_count?: number;
  profile_ready?: boolean;
  profile_reviewed_at?: string | null;
  chat_ready: boolean;
  can_activate: boolean;
  can_pause?: boolean;
  can_resume?: boolean;
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
  meta?: Record<string, unknown> | null;
  created_at: string;
}

export interface MemoryItem {
  id: string;
  space_id: string;
  created_by: string;
  creator_name?: string | null;
  kind: "note" | "voice" | "photo" | "video" | "letter" | "poem" | string;
  title: string;
  body: string;
  /** Same words as `body` with breath pauses — use for TTS, not for display. */
  body_tts?: string;
  has_media: boolean;
  media_mime?: string | null;
  source_message_id?: string | null;
  tags: string;
  /** private means only `created_by` reads it, and only in their own heritage room. */
  visibility?: MemoryVisibility;
  occurred_at?: string | null;
  created_at: string;
}

export type MemoryVisibility = "family" | "private";

export interface ImportPoemInput {
  title?: string;
  body: string;
  body_tts?: string;
  meter?: string;
  themes?: string[];
  composed_on?: string | null;
  source_name?: string;
  page_label?: string | null;
}

export interface ImportPoemsResult {
  dry_run: boolean;
  imported?: number;
  would_import?: number;
  titles?: string[];
  memories?: MemoryItem[];
  skipped: { title: string; reason: "duplicate" | "empty_body" | string }[];
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
  heritage_entity_status?: string | null;
  created_by: string;
  created_at: string;
  voice_profile_id?: string | null;
  voice_status?: string | null;
  voice_sample_count?: number | null;
  voice_provider_voice_id?: string | null;
  life_stage?: unknown;
  roles?: unknown;
  address_forms?: unknown;
  speech_style?: unknown;
  core_values?: unknown;
  philosophy?: unknown;
  taboos?: unknown;
  poetry_quote_mode?: "paraphrase" | "verbatim" | string;
  dynamic_context?: string;
  profile_reviewed_at?: string | null;
  profile_reviewed_by?: string | null;
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
  extract_job_id?: string | null;
  extract_segment_id?: string | null;
  t_start?: number | null;
  t_end?: number | null;
  speaker_label?: string | null;
  pipeline_stage?: "unprocessed" | "processed" | "archived" | string;
  parent_sample_ids?: string[];
  processing_applied?: Record<string, unknown>;
  created_at: string;
  voice_display_name?: string;
  voice_subject_kind?: string;
  voice_status?: string;
}

export interface ExtractSegment {
  id: string;
  job_id: string;
  speaker_label: string;
  t_start: number;
  t_end: number;
  duration_ms: number;
  duration_label?: string | null;
  media_path?: string | null;
  purity?: number | null;
  quality: "clean" | "mixed" | "short" | string;
  review_status: "pending" | "accepted" | "rejected" | string;
  voice_sample_id?: string | null;
  created_at: string;
}

export interface ExtractJob {
  id: string;
  space_id: string;
  /** Optional UI context only — pool is not locked to one Voice DNA. */
  voice_profile_id?: string | null;
  source_kind: string;
  source_memory_id?: string | null;
  original_filename?: string | null;
  input_mime?: string | null;
  num_speakers: number;
  status: "queued" | "running" | "needs_review" | "failed" | "done" | string;
  error_message?: string | null;
  artifact_dir?: string | null;
  options?: Record<string, unknown>;
  /** SPEAKER_xx → voice_profile_id */
  speaker_assignments?: Record<string, string>;
  duration_seconds?: number | null;
  device?: string | null;
  model?: string | null;
  raw_turn_count?: number | null;
  assigned_speaker_label?: string | null;
  clean_segment_count?: number;
  accepted_segment_count?: number;
  created_by: string;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  segments?: ExtractSegment[];
}

export interface ExtractCreateIdentity {
  display_name: string;
  relation_label?: string;
  status?: "living" | "remembered";
  consent?: boolean;
}

export interface VoiceRender {
  id: string;
  voice_profile_id: string;
  space_id: string;
  text: string;
  media_mime: string;
  model_id?: string | null;
  provider?: string | null;
  provider_voice_id?: string | null;
  provider_voice_name?: string | null;
  stability?: number | null;
  similarity_boost?: number | null;
  style?: number | null;
  speed?: number | null;
  use_speaker_boost?: boolean | null;
  lengthen_pauses?: boolean | null;
  emotion?: string | null;
  pitch?: number | null;
  intensity?: number | null;
  timbre?: number | null;
  created_by: string;
  created_at: string;
  voice_display_name?: string | null;
  voice_subject_kind?: string | null;
}

/**
 * TTS knobs. Each provider honours only its own half — the server drops the
 * other side rather than storing settings that never reached the vendor.
 */
export interface VoiceTtsOptions {
  model_id?: string;
  provider_voice_id?: string;
  provider_voice_name?: string;
  /** Shared. */
  speed?: number;
  lengthen_pauses?: boolean;
  /** ElevenLabs only. */
  stability?: number;
  similarity_boost?: number;
  style?: number;
  use_speaker_boost?: boolean;
  /** MiniMax only. */
  emotion?: string;
  pitch?: number;
  intensity?: number;
  timbre?: number;
}

export interface AudioFileInfo {
  file_name: string;
  media_mime?: string | null;
  size_bytes?: number | null;
  container?: string | null;
  codec?: string | null;
  sample_rate?: number | null;
  channels?: number | null;
  channel_layout?: string | null;
  bit_depth?: number | null;
  bitrate_bps?: number | null;
  duration_ms?: number | null;
  /** True when sample rate is low enough to cost voice identity on clone. */
  narrow_band?: boolean | null;
  source?: string | null;
  pipeline_stage?: string | null;
  model_id?: string | null;
}

export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category: string;
  description?: string;
  labels?: Record<string, string>;
  created_at_unix?: number | null;
}

/** HD synthesis takes tens of seconds, and cloning uploads minutes of audio.
 * Aborting early is worse than waiting: the provider still charges for work it
 * finished, and the steward would be tempted to pay for a second attempt. */
export const VOICE_TTS_TIMEOUT_MS = 180_000;
export const VOICE_CLONE_TIMEOUT_MS = 300_000;
export const VOICE_PROVIDER_TIMEOUT_MS = 60_000;

export type VoiceProvider = "elevenlabs" | "minimax";

export const VOICE_PROVIDERS = [
  {
    id: "elevenlabs",
    label: "ElevenLabs",
    hint: "Mẫu ngắn, cảm xúc mạnh",
  },
  {
    id: "minimax",
    label: "MiniMax",
    hint: "Nhận mẫu tới 5 phút — giống người gốc hơn",
  },
] as const;

export function voiceProviderLabel(provider: string | null | undefined): string {
  const found = VOICE_PROVIDERS.find((p) => p.id === provider);
  return found?.label ?? "ElevenLabs";
}

/** TTS models that officially include Vietnamese, per provider. */
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

export const MINIMAX_TTS_MODELS = [
  {
    id: "speech-2.8-hd",
    label: "Speech 2.8 HD · Giống nhất",
    hint: "Ưu tiên cho giọng ký ức",
  },
  {
    id: "speech-2.8-turbo",
    label: "Speech 2.8 Turbo · Nhanh",
    hint: "Nhanh hơn, giống kém hơn một chút",
  },
  {
    id: "speech-2.6-hd",
    label: "Speech 2.6 HD",
    hint: "Bản trước, giọng trầm ổn",
  },
  {
    id: "speech-2.6-turbo",
    label: "Speech 2.6 Turbo",
    hint: "Bản trước, nhanh",
  },
  {
    id: "speech-02-hd",
    label: "Speech 02 HD",
    hint: "Bản cũ, để đối chiếu",
  },
] as const;

export type VoiceTtsModelId =
  | (typeof VOICE_TTS_MODELS)[number]["id"]
  | (typeof MINIMAX_TTS_MODELS)[number]["id"];

export function voiceTtsModelsFor(
  provider: string | null | undefined,
): readonly { id: string; label: string; hint: string }[] {
  return provider === "minimax" ? MINIMAX_TTS_MODELS : VOICE_TTS_MODELS;
}

/**
 * MiniMax emotion presets. `auto` sends nothing and lets the model read the
 * mood from the text — the safest default for a remembered voice.
 */
export const MINIMAX_EMOTIONS = [
  { id: "auto", label: "Tự động", hint: "Model tự đọc cảm xúc từ câu chữ" },
  { id: "calm", label: "Bình thản", hint: "Đều, điềm tĩnh" },
  { id: "happy", label: "Vui", hint: "Tươi, nhấn nhá nhiều hơn" },
  { id: "sad", label: "Buồn", hint: "Chậm, trầm xuống" },
  { id: "angry", label: "Tức", hint: "Gắt, dứt khoát" },
  { id: "fearful", label: "Lo sợ", hint: "Run, ngắt hơi" },
  { id: "disgusted", label: "Ghét", hint: "Khinh, kéo dài" },
  { id: "surprised", label: "Ngạc nhiên", hint: "Bật lên, cao giọng" },
  { id: "fluent", label: "Trôi chảy", hint: "Chỉ có ở Speech 2.6" },
  { id: "whisper", label: "Thì thầm", hint: "Chỉ có ở Speech 2.6" },
] as const;

export type MinimaxEmotion = (typeof MINIMAX_EMOTIONS)[number]["id"];

/** `fluent` and `whisper` shipped only on the 2.6 line. */
const EMOTIONS_2_6_ONLY: readonly string[] = ["fluent", "whisper"];

export function minimaxEmotionsForModel(
  modelId: string | null | undefined,
): readonly { id: MinimaxEmotion; label: string; hint: string }[] {
  const is26 = (modelId ?? "").startsWith("speech-2.6-");
  return is26
    ? MINIMAX_EMOTIONS
    : MINIMAX_EMOTIONS.filter((e) => !EMOTIONS_2_6_ONLY.includes(e.id));
}

export function minimaxEmotionLabel(id: string | null | undefined): string {
  if (!id) return "Tự động";
  return MINIMAX_EMOTIONS.find((e) => e.id === id)?.label ?? id;
}

/** Which provider a stored model id belongs to, for labelling old renders. */
export function voiceProviderForModel(
  modelId: string | null | undefined,
): VoiceProvider | null {
  if (!modelId) return null;
  if (modelId.startsWith("speech-")) return "minimax";
  if (modelId.startsWith("eleven_")) return "elevenlabs";
  return null;
}

export function voiceTtsModelLabel(modelId: string | null | undefined): string {
  if (!modelId) return "—";
  const found = [...VOICE_TTS_MODELS, ...MINIMAX_TTS_MODELS].find(
    (m) => m.id === modelId,
  );
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
  unprocessed_count?: number;
  processed_count?: number;
  archived_count?: number;
  processed_duration_ms?: number;
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
    opts?: { json?: boolean; timeoutMs?: number },
  ): Promise<T> {
    const root = resolveRoot();
    const token = await getToken();
    const headers = new Headers(init.headers);
    const useJson = opts?.json !== false;
    if (useJson && !headers.has("Content-Type") && init.body) {
      headers.set("Content-Type", "application/json");
    }
    if (token) headers.set("Authorization", `Bearer ${token}`);

    const effectiveTimeout = opts?.timeoutMs ?? timeoutMs;
    const signal =
      init.signal ??
      (effectiveTimeout > 0 &&
      typeof AbortSignal !== "undefined" &&
      "timeout" in AbortSignal
        ? AbortSignal.timeout(effectiveTimeout)
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
      request<StewardSuccession>(
        `/api/spaces/${spaceId}/stewardship/nominate`,
        {
          method: "POST",
          body: JSON.stringify({ user_id: userId, note }),
        },
      ),
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
    getSpace: (spaceId: string) =>
      request<FamilySpace>(`/api/spaces/${spaceId}`),
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
    openDirectHeritageThread: (spaceId: string, identityId: string) =>
      request<ThreadSummary>(
        `/api/spaces/${spaceId}/identities/${identityId}/direct-thread`,
        { method: "POST" },
      ),
    listMessages: (
      threadId: string,
      opts?: { limit?: number; before?: string },
    ) => {
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
      payload: {
        title?: string;
        body: string;
        tags?: string;
        occurred_at?: string;
      },
    ) =>
      request<MemoryItem>(`/api/spaces/${spaceId}/memories/note`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    uploadMemory: async (
      spaceId: string,
      payload: {
        kind: "voice" | "photo" | "video";
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
    importPoems: (
      spaceId: string,
      payload: {
        identity_id: string;
        poems: ImportPoemInput[];
        dry_run?: boolean;
      },
    ) =>
      request<ImportPoemsResult>(
        `/api/spaces/${spaceId}/memories/poems/import`,
        { method: "POST", body: JSON.stringify(payload) },
      ),
    memoryFromMessage: (spaceId: string, messageId: string, title?: string) =>
      request<MemoryItem>(`/api/spaces/${spaceId}/memories/from-message`, {
        method: "POST",
        body: JSON.stringify({ message_id: messageId, title }),
      }),
    memoryMediaUrl: (memoryId: string) =>
      `${resolveRoot()}/api/memories/${memoryId}/media`,
    memoryPlaybackUrl: (memoryId: string) =>
      `${resolveRoot()}/api/memories/${memoryId}/playback`,
    memoryThumbnailUrl: (memoryId: string) =>
      `${resolveRoot()}/api/memories/${memoryId}/thumbnail`,
    updateMemory: (
      memoryId: string,
      payload: {
        title?: string;
        body?: string;
        tags?: string;
        visibility?: MemoryVisibility;
      },
    ) =>
      request<MemoryItem>(`/api/memories/${memoryId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    deleteMemory: (memoryId: string) =>
      request<{ ok: boolean }>(`/api/memories/${memoryId}`, {
        method: "DELETE",
      }),
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
        life_stage?: unknown;
        roles?: unknown;
        address_forms?: unknown;
        speech_style?: unknown;
        core_values?: unknown;
        philosophy?: unknown;
        taboos?: unknown;
        poetry_quote_mode?: "paraphrase" | "verbatim";
        dynamic_context?: string;
        mark_profile_reviewed?: boolean;
      },
    ) =>
      request<IdentityProfile>(
        `/api/spaces/${spaceId}/identities/${identityId}`,
        {
          method: "PATCH",
          body: JSON.stringify(payload),
        },
      ),
    listMemoryCandidates: (
      spaceId: string,
      status: "pending" | "approved" | "dismissed" = "pending",
    ) =>
      request<{ candidates: MemoryCandidate[] }>(
        `/api/spaces/${spaceId}/memory-candidates?status=${status}`,
      ),
    approveMemoryCandidate: (
      candidateId: string,
      visibility: MemoryVisibility = "family",
    ) =>
      request<{ candidate: MemoryCandidate; memory_id: string }>(
        `/api/memory-candidates/${candidateId}/approve`,
        { method: "POST", body: JSON.stringify({ visibility }) },
      ),
    dismissMemoryCandidate: (candidateId: string) =>
      request<{ candidate: MemoryCandidate }>(
        `/api/memory-candidates/${candidateId}/dismiss`,
        { method: "POST" },
      ),
    getHeritageReadiness: (spaceId: string, identityId: string) =>
      request<HeritageReadiness>(
        `/api/spaces/${spaceId}/identities/${identityId}/heritage-readiness`,
      ),
    activateHeritageEntity: (spaceId: string, identityId: string) =>
      request<HeritageReadiness>(
        `/api/spaces/${spaceId}/identities/${identityId}/activate-heritage`,
        { method: "POST" },
      ),
    pauseHeritageEntity: (spaceId: string, identityId: string) =>
      request<HeritageReadiness>(
        `/api/spaces/${spaceId}/identities/${identityId}/pause-heritage`,
        { method: "POST" },
      ),
    resumeHeritageEntity: (spaceId: string, identityId: string) =>
      request<HeritageReadiness>(
        `/api/spaces/${spaceId}/identities/${identityId}/resume-heritage`,
        { method: "POST" },
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
        provider?: VoiceProvider;
      },
    ) => {
      const params = new URLSearchParams();
      params.set("cloned_only", (opts?.clonedOnly ?? true) ? "true" : "false");
      if (opts?.nameContains) params.set("name_contains", opts.nameContains);
      if (opts?.voiceId) params.set("voice_id", opts.voiceId);
      if (opts?.provider) params.set("provider", opts.provider);
      return request<{ voices: ElevenLabsVoice[] }>(
        `/api/spaces/${spaceId}/elevenlabs-voices?${params.toString()}`,
        {},
        { timeoutMs: VOICE_PROVIDER_TIMEOUT_MS },
      );
    },
    deleteElevenLabsVoice: (
      spaceId: string,
      providerVoiceId: string,
      provider?: VoiceProvider,
    ) => {
      const q = provider ? `?provider=${provider}` : "";
      return request<{ ok: boolean; detached_voice_ids: string[] }>(
        `/api/spaces/${spaceId}/elevenlabs-voices/${encodeURIComponent(providerVoiceId)}${q}`,
        { method: "DELETE" },
        { timeoutMs: VOICE_PROVIDER_TIMEOUT_MS },
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
        source?: "record" | "upload" | "memory" | "extract";
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
      const isVideo = (payload.mimeType || "").startsWith("video/");
      return request<{
        sample_id: string;
        from_video?: boolean;
        voice: VoiceProfile;
      }>(
        `/api/voices/${voiceId}/samples`,
        { method: "POST", body: form as unknown as BodyInit },
        { json: false, timeoutMs: isVideo ? 180_000 : 60_000 },
      );
    },
    listSpaceVoiceSamples: (
      spaceId: string,
      voiceId?: string,
      stage?: "unprocessed" | "processed" | "archived",
    ) => {
      const params = new URLSearchParams();
      if (voiceId) params.set("voice_id", voiceId);
      if (stage) params.set("stage", stage);
      const q = params.toString() ? `?${params.toString()}` : "";
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
    updateVoiceSampleStage: (
      voiceId: string,
      sampleId: string,
      pipelineStage: "unprocessed" | "processed" | "archived",
    ) =>
      request<VoiceSample>(`/api/voices/${voiceId}/samples/${sampleId}`, {
        method: "PATCH",
        body: JSON.stringify({ pipeline_stage: pipelineStage }),
      }),
    bulkStageVoiceSamples: (
      voiceId: string,
      sampleIds: string[],
      pipelineStage: "unprocessed" | "processed" | "archived",
    ) =>
      request<VoiceProfile>(`/api/voices/${voiceId}/samples/bulk-stage`, {
        method: "POST",
        body: JSON.stringify({
          sample_ids: sampleIds,
          pipeline_stage: pipelineStage,
        }),
      }),
    combineVoiceSamples: (
      voiceId: string,
      sampleIds: string[],
      opts?: { note?: string; normalize?: boolean },
    ) =>
      request<{ sample_id: string; voice: VoiceProfile }>(
        `/api/voices/${voiceId}/samples/combine`,
        {
          method: "POST",
          body: JSON.stringify({
            sample_ids: sampleIds,
            note: opts?.note ?? "",
            normalize: opts?.normalize ?? false,
          }),
        },
      ),
    processVoiceSamples: (
      voiceId: string,
      sampleIds: string[],
      opts?: { normalize?: boolean },
    ) =>
      request<{ created_sample_ids: string[]; voice: VoiceProfile }>(
        `/api/voices/${voiceId}/samples/process`,
        {
          method: "POST",
          body: JSON.stringify({
            sample_ids: sampleIds,
            normalize: opts?.normalize ?? true,
          }),
        },
      ),
    splitVoiceSample: (
      voiceId: string,
      sampleId: string,
      opts?: { at_ms?: number; note?: string },
    ) =>
      request<{
        sample_ids: string[];
        archived_original: boolean;
        voice: VoiceProfile;
      }>(`/api/voices/${voiceId}/samples/split`, {
        method: "POST",
        body: JSON.stringify({
          sample_id: sampleId,
          at_ms: opts?.at_ms,
          note: opts?.note ?? "",
        }),
      }),
    deleteVoiceSample: (voiceId: string, sampleId: string) =>
      request<VoiceProfile>(`/api/voices/${voiceId}/samples/${sampleId}`, {
        method: "DELETE",
      }),
    cloneVoice: (
      voiceId: string,
      opts?: {
        remove_background_noise?: boolean;
        sample_ids?: string[];
        provider?: VoiceProvider;
      },
    ) =>
      request<VoiceProfile>(
        `/api/voices/${voiceId}/clone`,
        { method: "POST", body: JSON.stringify(opts ?? {}) },
        { timeoutMs: VOICE_CLONE_TIMEOUT_MS },
      ),
    pauseVoice: (voiceId: string) =>
      request<VoiceProfile>(`/api/voices/${voiceId}/pause`, { method: "POST" }),
    selectVoiceClone: (
      voiceId: string,
      providerVoiceId: string,
      provider?: VoiceProvider,
    ) =>
      request<VoiceProfile>(
        `/api/voices/${voiceId}/select-clone`,
        {
          method: "POST",
          body: JSON.stringify({
            provider_voice_id: providerVoiceId,
            ...(provider ? { provider } : {}),
          }),
        },
        { timeoutMs: VOICE_PROVIDER_TIMEOUT_MS },
      ),
    listVoiceRenders: (voiceId: string) =>
      request<{ renders: VoiceRender[] }>(`/api/voices/${voiceId}/renders`),
    listSpaceVoiceRenders: (
      spaceId: string,
      opts?: { voiceId?: string; providerVoiceId?: string },
    ) => {
      const params = new URLSearchParams();
      if (opts?.voiceId) params.set("voice_id", opts.voiceId);
      if (opts?.providerVoiceId) {
        params.set("provider_voice_id", opts.providerVoiceId);
      }
      const q = params.toString() ? `?${params.toString()}` : "";
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
      opts?: VoiceTtsOptions,
    ) =>
      request<VoiceRender>(
        `/api/voices/${voiceId}/tts`,
        { method: "POST", body: JSON.stringify({ text, save: true, ...opts }) },
        { timeoutMs: VOICE_TTS_TIMEOUT_MS },
      ),
    synthesizeVoiceTts: async (
      voiceId: string,
      text: string,
      opts?: VoiceTtsOptions,
    ) => {
      const root = resolveRoot();
      const token = await getToken();
      const headers = new Headers({ "Content-Type": "application/json" });
      if (token) headers.set("Authorization", `Bearer ${token}`);
      const signal =
        typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
          ? AbortSignal.timeout(VOICE_TTS_TIMEOUT_MS)
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
    // Short timeout: this only feeds an info panel, so failing fast beats
    // leaving the user on a spinner for the default upload-sized window.
    voiceSampleAudioInfo: (voiceId: string, sampleId: string) =>
      request<AudioFileInfo>(
        `/api/voices/${voiceId}/samples/${sampleId}/audio-info`,
        {},
        { timeoutMs: 15_000 },
      ),
    voiceRenderAudioInfo: (voiceId: string, renderId: string) =>
      request<AudioFileInfo>(
        `/api/voices/${voiceId}/renders/${renderId}/audio-info`,
        {},
        { timeoutMs: 15_000 },
      ),

    createExtractJob: async (
      spaceId: string,
      payload: {
        uri: string;
        name: string;
        mimeType: string;
        numSpeakers: number;
        /** Optional context only — does not lock the pool to one profile. */
        voiceProfileId?: string;
      },
    ) => {
      const form = new FormData();
      form.append("num_speakers", String(payload.numSpeakers));
      if (payload.voiceProfileId) {
        form.append("voice_profile_id", payload.voiceProfileId);
      }
      form.append("file", {
        uri: payload.uri,
        name: payload.name,
        type: payload.mimeType,
      } as unknown as Blob);
      return request<ExtractJob>(
        `/api/spaces/${spaceId}/extract/jobs`,
        { method: "POST", body: form as unknown as BodyInit },
        { json: false },
      );
    },
    createExtractJobFromMemory: (
      spaceId: string,
      payload: {
        memoryId: string;
        numSpeakers: number;
        voiceProfileId?: string;
      },
    ) =>
      request<ExtractJob>(`/api/spaces/${spaceId}/extract/jobs/from-memory`, {
        method: "POST",
        body: JSON.stringify({
          memory_id: payload.memoryId,
          num_speakers: payload.numSpeakers,
          voice_profile_id: payload.voiceProfileId,
        }),
      }),
    listExtractJobs: (spaceId: string, voiceId?: string) => {
      const q = voiceId ? `?voice_id=${encodeURIComponent(voiceId)}` : "";
      return request<{ jobs: ExtractJob[] }>(
        `/api/spaces/${spaceId}/extract/jobs${q}`,
      );
    },
    getExtractJob: (spaceId: string, jobId: string) =>
      request<ExtractJob>(`/api/spaces/${spaceId}/extract/jobs/${jobId}`),
    listExtractSegments: (
      spaceId: string,
      jobId: string,
      opts?: { quality?: string; speakerLabel?: string },
    ) => {
      const params = new URLSearchParams();
      if (opts?.quality) params.set("quality", opts.quality);
      if (opts?.speakerLabel) params.set("speaker_label", opts.speakerLabel);
      const q = params.toString() ? `?${params.toString()}` : "";
      return request<{ segments: ExtractSegment[] }>(
        `/api/spaces/${spaceId}/extract/jobs/${jobId}/segments${q}`,
      );
    },
    assignExtractSpeaker: (
      spaceId: string,
      jobId: string,
      payload: {
        speakerLabel: string;
        voiceProfileId?: string;
        createIdentity?: ExtractCreateIdentity;
      },
    ) =>
      request<
        ExtractJob & {
          assigned_voice?: {
            id: string;
            display_name: string;
            subject_kind: string;
            identity_profile_id?: string | null;
          };
        }
      >(`/api/spaces/${spaceId}/extract/jobs/${jobId}/assign-speaker`, {
        method: "POST",
        body: JSON.stringify({
          speaker_label: payload.speakerLabel,
          voice_profile_id: payload.voiceProfileId,
          create_identity: payload.createIdentity,
        }),
      }),
    acceptExtractSegments: (
      spaceId: string,
      jobId: string,
      payload: {
        segmentIds?: string[];
        speakerLabel?: string;
        quality?: "clean" | "short" | "mixed";
        voiceProfileId?: string;
        createIdentity?: ExtractCreateIdentity;
      },
    ) =>
      request<{
        imported: number;
        sample_ids: string[];
        voice_profile_id: string;
        voice_display_name: string;
        job: ExtractJob;
        total_clean_seconds: number;
      }>(`/api/spaces/${spaceId}/extract/jobs/${jobId}/segments/accept`, {
        method: "POST",
        body: JSON.stringify({
          segment_ids: payload.segmentIds ?? [],
          speaker_label: payload.speakerLabel,
          quality: payload.quality ?? "clean",
          voice_profile_id: payload.voiceProfileId,
          create_identity: payload.createIdentity,
        }),
      }),
    finishExtractJob: (spaceId: string, jobId: string) =>
      request<ExtractJob>(
        `/api/spaces/${spaceId}/extract/jobs/${jobId}/finish`,
        { method: "POST" },
      ),
    extractSegmentMediaUrl: (spaceId: string, segmentId: string) =>
      `${resolveRoot()}/api/spaces/${spaceId}/extract/segments/${segmentId}/media`,
  };
}

export type ForeverApi = ReturnType<typeof createApiClient>;
