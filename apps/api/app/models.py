from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    firebase_uid: Mapped[str | None] = mapped_column(String(128), unique=True, nullable=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    phone: Mapped[str | None] = mapped_column(String(32), unique=True, nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    handle: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True, index=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    memberships: Mapped[list[Membership]] = relationship(back_populates="user")


class FamilySpace(Base):
    __tablename__ = "family_spaces"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    steward_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    memberships: Mapped[list[Membership]] = relationship(back_populates="space")
    threads: Mapped[list[Thread]] = relationship(back_populates="space")
    invites: Mapped[list[Invite]] = relationship(back_populates="space")
    memories: Mapped[list[MemoryItem]] = relationship(back_populates="space")
    successions: Mapped[list[StewardSuccession]] = relationship(back_populates="space")
    identities: Mapped[list[IdentityProfile]] = relationship(back_populates="space")
    voice_profiles: Mapped[list[VoiceProfile]] = relationship(back_populates="space")
    extract_jobs: Mapped[list[ExtractJob]] = relationship(back_populates="space")
    library_ingest_jobs: Mapped[list[LibraryIngestJob]] = relationship(
        back_populates="space"
    )
    settings: Mapped[SpaceSettings | None] = relationship(
        back_populates="space", uselist=False
    )


class Membership(Base):
    __tablename__ = "memberships"
    __table_args__ = (UniqueConstraint("space_id", "user_id", name="uq_membership"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    space_id: Mapped[str] = mapped_column(ForeignKey("family_spaces.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    role: Mapped[str] = mapped_column(String(32), default="member")  # owner | member
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    space: Mapped[FamilySpace] = relationship(back_populates="memberships")
    user: Mapped[User] = relationship(back_populates="memberships")


class Thread(Base):
    __tablename__ = "threads"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    space_id: Mapped[str] = mapped_column(ForeignKey("family_spaces.id"), index=True)
    kind: Mapped[str] = mapped_column(String(32), default="family")  # family | heritage
    title: Mapped[str] = mapped_column(String(160))
    # Which remembered person this thread talks to (heritage threads only).
    # Deliberately not a FK: identity_profiles.heritage_thread_id already points
    # back here, and a real constraint both ways is a cycle create_all cannot sort.
    heritage_identity_id: Mapped[str | None] = mapped_column(
        String(32), nullable=True, index=True
    )
    # family — everyone in the space reads it; direct — one member alone with them.
    audience_scope: Mapped[str] = mapped_column(String(32), default="family")
    # Set on direct threads: the only member who may read or write.
    member_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    space: Mapped[FamilySpace] = relationship(back_populates="threads")
    messages: Mapped[list[Message]] = relationship(back_populates="thread")


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    thread_id: Mapped[str] = mapped_column(ForeignKey("threads.id"), index=True)
    sender_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    sender_kind: Mapped[str] = mapped_column(String(32), default="user")  # user | agent | heritage
    kind: Mapped[str] = mapped_column(String(32), default="text")  # text | voice
    body: Mapped[str] = mapped_column(Text, default="")
    media_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    media_mime: Mapped[str | None] = mapped_column(String(120), nullable=True)
    # JSON: citations, quote_mode, etc. (heritage verbatim provenance)
    meta_json: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)

    thread: Mapped[Thread] = relationship(back_populates="messages")


class Invite(Base):
    __tablename__ = "invites"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    space_id: Mapped[str] = mapped_column(ForeignKey("family_spaces.id"), index=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    space: Mapped[FamilySpace] = relationship(back_populates="invites")


class MemoryItem(Base):
    __tablename__ = "memory_items"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    space_id: Mapped[str] = mapped_column(ForeignKey("family_spaces.id"), index=True)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    kind: Mapped[str] = mapped_column(
        String(32), default="note"
    )  # note | voice | photo | video | letter | poem | milestone
    title: Mapped[str] = mapped_column(String(200), default="")
    body: Mapped[str] = mapped_column(Text, default="")
    # Same words as `body` with breath pauses — Voice DNA TTS reads this, not `body`.
    body_tts: Mapped[str] = mapped_column(Text, default="")
    # Cached «Bố đọc» render (mp3). Fingerprint invalidates when text or clone changes.
    recite_media_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    recite_fingerprint: Mapped[str] = mapped_column(String(64), default="")
    media_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    media_mime: Mapped[str | None] = mapped_column(String(120), nullable=True)
    source_message_id: Mapped[str | None] = mapped_column(
        ForeignKey("messages.id"), nullable=True
    )
    tags: Mapped[str] = mapped_column(String(500), default="")
    # family — everyone in the space reads it; private — only `created_by`, and
    # only their own room with a remembered person may quote it back.
    visibility: Mapped[str] = mapped_column(String(16), default="family")
    occurred_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)

    space: Mapped[FamilySpace] = relationship(back_populates="memories")


class Keepsake(Base):
    """A library photo or poem offered as today's artifact on the family chat with the remembered person."""

    __tablename__ = "keepsakes"
    __table_args__ = (
        UniqueConstraint(
            "memory_item_id", "identity_id", name="uq_keepsake_memory_identity"
        ),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    space_id: Mapped[str] = mapped_column(ForeignKey("family_spaces.id"), index=True)
    identity_id: Mapped[str] = mapped_column(
        ForeignKey("identity_profiles.id"), index=True
    )
    memory_item_id: Mapped[str] = mapped_column(
        ForeignKey("memory_items.id"), index=True
    )
    # photo — ask the family to tell the story; poem — read/listen only.
    kind: Mapped[str] = mapped_column(String(16), default="photo", index=True)
    opener: Mapped[str] = mapped_column(Text, default="")
    # draft | ready | heard | skipped | retired
    status: Mapped[str] = mapped_column(String(16), default="draft", index=True)
    last_opened_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    opened_message_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    opened_thread_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class InterviewPrompt(Base):
    __tablename__ = "interview_prompts"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    space_id: Mapped[str | None] = mapped_column(
        ForeignKey("family_spaces.id"), nullable=True, index=True
    )
    body: Mapped[str] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class InterviewAnswer(Base):
    __tablename__ = "interview_answers"
    __table_args__ = (
        UniqueConstraint("prompt_id", "space_id", "user_id", name="uq_interview_answer"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    prompt_id: Mapped[str] = mapped_column(ForeignKey("interview_prompts.id"), index=True)
    space_id: Mapped[str] = mapped_column(ForeignKey("family_spaces.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    memory_item_id: Mapped[str] = mapped_column(ForeignKey("memory_items.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class StewardSuccession(Base):
    """Designated successor for family-space stewardship (longevity / handover)."""

    __tablename__ = "steward_successions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    space_id: Mapped[str] = mapped_column(ForeignKey("family_spaces.id"), index=True)
    nominee_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    nominated_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    # pending | accepted | declined | activated | revoked
    status: Mapped[str] = mapped_column(String(32), default="pending", index=True)
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    space: Mapped[FamilySpace] = relationship(back_populates="successions")


class SpaceSettings(Base):
    """Per-space configuration (API keys, preferences)."""

    __tablename__ = "space_settings"

    space_id: Mapped[str] = mapped_column(
        ForeignKey("family_spaces.id"), primary_key=True
    )
    elevenlabs_api_key: Mapped[str | None] = mapped_column(String(256), nullable=True)
    # Optional JSON overrides for heritage AI stages — see heritage_pipeline.py.
    heritage_pipeline_json: Mapped[str] = mapped_column(Text, default="")
    # Tầng 2 — hiến chương gia đình; xem heritage_rules_family.py.
    family_charter_json: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    space: Mapped[FamilySpace] = relationship(back_populates="settings")


class IdentityProfile(Base):
    """Person in the family vault — living member mirror or remembered heritage subject."""

    __tablename__ = "identity_profiles"
    __table_args__ = (
        UniqueConstraint("space_id", "handle", name="uq_identity_profile_handle"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    space_id: Mapped[str] = mapped_column(ForeignKey("family_spaces.id"), index=True)
    display_name: Mapped[str] = mapped_column(String(120))
    # Space-scoped @handle for tagging / deep links (living mirrors User.handle).
    handle: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    relation_label: Mapped[str] = mapped_column(String(80), default="")
    # living | remembered
    status: Mapped[str] = mapped_column(String(32), default="remembered", index=True)
    linked_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id"), nullable=True, index=True
    )
    heritage_thread_id: Mapped[str | None] = mapped_column(
        ForeignKey("threads.id"), nullable=True
    )
    # dormant | gathering | awakening | ready | paused
    heritage_entity_status: Mapped[str] = mapped_column(
        String(32), default="dormant", index=True
    )
    # Identity Lock (JSON text — assemble system prompt at request time)
    life_stage_json: Mapped[str] = mapped_column(Text, default="")
    roles_json: Mapped[str] = mapped_column(Text, default="")
    address_forms_json: Mapped[str] = mapped_column(Text, default="")
    speech_style_json: Mapped[str] = mapped_column(Text, default="")
    core_values_json: Mapped[str] = mapped_column(Text, default="")
    philosophy_json: Mapped[str] = mapped_column(Text, default="")
    taboos_json: Mapped[str] = mapped_column(Text, default="")
    poetry_quote_mode: Mapped[str] = mapped_column(String(32), default="paraphrase")
    dynamic_context: Mapped[str] = mapped_column(Text, default="")
    # When true, heritage chat may include a short summary of recent family-thread messages.
    family_context_opt_in: Mapped[bool] = mapped_column(default=False)
    profile_reviewed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    profile_reviewed_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    # Set when the steward shelves a person without destroying anything.
    archived_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    space: Mapped[FamilySpace] = relationship(back_populates="identities")
    voice_profiles: Mapped[list[VoiceProfile]] = relationship(
        back_populates="identity_profile"
    )


class IdentityProfileRevision(Base):
    """Snapshot of an Identity Lock before someone changed it.

    Each save that actually alters the lock writes the previous state here, so
    a moderator can walk back to any earlier version. Restore also snapshots
    the live row first — undo is itself reversible.
    """

    __tablename__ = "identity_profile_revisions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    space_id: Mapped[str] = mapped_column(ForeignKey("family_spaces.id"), index=True)
    identity_id: Mapped[str] = mapped_column(
        ForeignKey("identity_profiles.id"), index=True
    )
    snapshot_json: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class FamilyEntity(Base):
    """Family Codex row — a person the heritage entity can be asked about.

    Kept separate from IdentityProfile because the codex holds relatives who
    will never be app members or Voice DNA subjects (in-laws, grandchildren,
    cousins), and those rows must not clutter the Voice DNA picker.
    """

    __tablename__ = "family_entities"
    __table_args__ = (
        UniqueConstraint("space_id", "slug", name="uq_family_entity_slug"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    space_id: Mapped[str] = mapped_column(ForeignKey("family_spaces.id"), index=True)
    # Stable handle used by the analyzer to reference a person (e.g. "huong").
    slug: Mapped[str] = mapped_column(String(64), index=True)
    identity_profile_id: Mapped[str | None] = mapped_column(
        ForeignKey("identity_profiles.id"), nullable=True, index=True
    )
    # Whose family tree this row belongs to — the remembered subject.
    subject_identity_id: Mapped[str | None] = mapped_column(
        ForeignKey("identity_profiles.id"), nullable=True, index=True
    )
    canonical_name: Mapped[str] = mapped_column(String(120))
    aliases_json: Mapped[str] = mapped_column(Text, default="")
    relation_json: Mapped[str] = mapped_column(Text, default="")
    address_json: Mapped[str] = mapped_column(Text, default="")
    disambiguation: Mapped[str] = mapped_column(Text, default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    # draft | approved — only approved rows reach the prompt.
    status: Mapped[str] = mapped_column(String(32), default="draft", index=True)
    source: Mapped[str] = mapped_column(String(32), default="lock")
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class FamilyTreeNode(Base):
    """One person on the family genealogy chart for a space.

    May link to an IdentityProfile or exist only on the tree (e.g. a great-grandparent
    who never had an app profile).
    """

    __tablename__ = "family_tree_nodes"
    __table_args__ = (
        UniqueConstraint(
            "space_id",
            "identity_profile_id",
            name="uq_family_tree_node_identity",
        ),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    space_id: Mapped[str] = mapped_column(ForeignKey("family_spaces.id"), index=True)
    identity_profile_id: Mapped[str | None] = mapped_column(
        ForeignKey("identity_profiles.id"), nullable=True, index=True
    )
    display_name: Mapped[str] = mapped_column(String(120))
    birth_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    death_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Full solar death day YYYY-MM-DD; when set, a family-calendar milestone is upserted.
    death_date: Mapped[str | None] = mapped_column(String(10), nullable=True)
    # male | female | unknown — sibling labels and display hints only.
    gender_hint: Mapped[str] = mapped_column(String(16), default="unknown")
    # Order among siblings who share the same parent set (1 = eldest).
    birth_order: Mapped[int | None] = mapped_column(Integer, nullable=True)
    notes: Mapped[str] = mapped_column(Text, default="")
    # True only when the family marked this person as con riêng — not inferred
    # from a missing parent edge (the other parent is often the spouse, already saved).
    con_rieng: Mapped[bool] = mapped_column(Boolean, default=False)
    # Optional grave / bài vị photo (relative path under upload_dir).
    photo_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    photo_mime: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class FamilyTreeEdge(Base):
    """Directed relationship on the genealogy chart.

    parent — from_node is parent, to_node is child.
    spouse — undirected pair; a person may have many spouse edges (e.g. vợ cả, vợ lẽ).
    """

    __tablename__ = "family_tree_edges"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    space_id: Mapped[str] = mapped_column(ForeignKey("family_spaces.id"), index=True)
    from_node_id: Mapped[str] = mapped_column(
        ForeignKey("family_tree_nodes.id"), index=True
    )
    to_node_id: Mapped[str] = mapped_column(
        ForeignKey("family_tree_nodes.id"), index=True
    )
    # parent | spouse
    kind: Mapped[str] = mapped_column(String(16), index=True)
    # parent: {"parent_role": "father"|"mother"|"unknown"}
    # spouse: {"spouse_order": 1, "spouse_label": "Vợ cả"}
    meta_json: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class MemoryCandidate(Base):
    """A fact the chat heard, waiting for a human to say it may be kept.

    The hard rule is that nothing enters a remembered person's biography without
    a family member approving it, so chat can only ever propose. Approving is
    also the moment a fact becomes visible to the whole family, which is why a
    candidate from a private thread is reviewed by that thread's own member.
    """

    __tablename__ = "memory_candidates"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    space_id: Mapped[str] = mapped_column(ForeignKey("family_spaces.id"), index=True)
    identity_id: Mapped[str] = mapped_column(
        ForeignKey("identity_profiles.id"), index=True
    )
    thread_id: Mapped[str] = mapped_column(ForeignKey("threads.id"), index=True)
    # The message the family said it in — the reviewer needs to read it in context.
    source_message_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # The only person allowed to approve or dismiss this one.
    reviewer_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    statement: Mapped[str] = mapped_column(Text, default="")
    fact_kind: Mapped[str] = mapped_column(String(32), default="event")
    subject_slug: Mapped[str] = mapped_column(String(64), default="")
    # Kept as the analyzer wrote it: may be YYYY, YYYY-MM, or a full date.
    occurred_at: Mapped[str] = mapped_column(String(16), default="")
    status: Mapped[str] = mapped_column(String(16), default="pending")
    memory_item_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    reviewed_by: Mapped[str | None] = mapped_column(String(32), nullable=True)


class ThreadMemory(Base):
    """What a heritage thread has already learned and already said.

    One row per thread. The chat history alone is a poor memory: it grows past
    the prompt budget, and re-reading it every turn still lets the entity ask
    "con dạo này thế nào?" for the tenth time. This keeps the distilled version.
    """

    __tablename__ = "thread_memory"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    thread_id: Mapped[str] = mapped_column(
        ForeignKey("threads.id"), unique=True, index=True
    )
    # {facts_learned, topics_open, already_asked, emotional_tone, entities_seen}
    summary_json: Mapped[str] = mapped_column(Text, default="")
    # Heritage replies written into this thread since the row was created.
    turn_count: Mapped[int] = mapped_column(Integer, default=0)
    # turn_count at the last Gemini compaction, so we know when the next is due.
    compacted_turn: Mapped[int] = mapped_column(Integer, default=0)
    last_message_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class VoiceProfile(Base):
    """Voice DNA — Instant Voice Clone binding for self or heritage identity."""

    __tablename__ = "voice_profiles"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    space_id: Mapped[str] = mapped_column(ForeignKey("family_spaces.id"), index=True)
    # self | person | heritage
    subject_kind: Mapped[str] = mapped_column(String(32), index=True)
    subject_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id"), nullable=True, index=True
    )
    identity_profile_id: Mapped[str | None] = mapped_column(
        ForeignKey("identity_profiles.id"), nullable=True, index=True
    )
    provider: Mapped[str] = mapped_column(String(32), default="elevenlabs")
    provider_voice_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    # draft | ready | failed | paused
    status: Mapped[str] = mapped_column(String(32), default="draft", index=True)
    consent_text: Mapped[str] = mapped_column(Text, default="")
    consent_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    consented_by_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    error_message: Mapped[str] = mapped_column(Text, default="")
    display_name: Mapped[str] = mapped_column(String(160), default="")
    # JSON: knobs + clone used for heritage chat / «Gọi cho Bố» TTS.
    # Set from Speak via "Dùng cho Gọi" or when saving a render as the chat set.
    tts_prefs_json: Mapped[str] = mapped_column(Text, default="")
    archived_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    space: Mapped[FamilySpace] = relationship(back_populates="voice_profiles")
    identity_profile: Mapped[IdentityProfile | None] = relationship(
        back_populates="voice_profiles"
    )
    samples: Mapped[list[VoiceSample]] = relationship(back_populates="voice_profile")
    renders: Mapped[list[VoiceRender]] = relationship(back_populates="voice_profile")
    extract_jobs: Mapped[list[ExtractJob]] = relationship(back_populates="voice_profile")


class VoiceSample(Base):
    __tablename__ = "voice_samples"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    voice_profile_id: Mapped[str] = mapped_column(
        ForeignKey("voice_profiles.id"), index=True
    )
    media_path: Mapped[str] = mapped_column(String(512))
    media_mime: Mapped[str] = mapped_column(String(120))
    # record | upload | memory | extract | combine | process | split
    source: Mapped[str] = mapped_column(String(32), default="upload")
    note: Mapped[str] = mapped_column(Text, default="")
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    file_size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    quality_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    quality_label: Mapped[str] = mapped_column(String(32), default="")
    quality_tip: Mapped[str] = mapped_column(Text, default="")
    extract_job_id: Mapped[str | None] = mapped_column(
        ForeignKey("extract_jobs.id"), nullable=True, index=True
    )
    extract_segment_id: Mapped[str | None] = mapped_column(
        ForeignKey("extract_segments.id"), nullable=True, index=True
    )
    t_start: Mapped[float | None] = mapped_column(Float, nullable=True)
    t_end: Mapped[float | None] = mapped_column(Float, nullable=True)
    speaker_label: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # unprocessed | processed | archived — clone uses processed only
    pipeline_stage: Mapped[str] = mapped_column(String(32), default="processed")
    # JSON array of source sample ids when source=combine
    parent_sample_ids: Mapped[str] = mapped_column(Text, default="")
    processing_applied: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    voice_profile: Mapped[VoiceProfile] = relationship(back_populates="samples")


class ExtractJob(Base):
    """Shared pool from one tape: diarize once, import into any Voice DNA profiles."""

    __tablename__ = "extract_jobs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    space_id: Mapped[str] = mapped_column(ForeignKey("family_spaces.id"), index=True)
    # Optional UI context only — pool is not locked to one Voice DNA.
    voice_profile_id: Mapped[str | None] = mapped_column(
        ForeignKey("voice_profiles.id"), nullable=True, index=True
    )
    # upload | memory
    source_kind: Mapped[str] = mapped_column(String(32), default="upload")
    source_memory_id: Mapped[str | None] = mapped_column(
        ForeignKey("memory_items.id"), nullable=True, index=True
    )
    input_path: Mapped[str] = mapped_column(String(512))
    input_mime: Mapped[str] = mapped_column(String(120), default="")
    original_filename: Mapped[str] = mapped_column(String(260), default="")
    num_speakers: Mapped[int] = mapped_column(Integer)
    # queued | running | needs_review | failed | done
    status: Mapped[str] = mapped_column(String(32), default="queued", index=True)
    error_message: Mapped[str] = mapped_column(Text, default="")
    artifact_dir: Mapped[str] = mapped_column(String(512), default="")
    options_json: Mapped[str] = mapped_column(Text, default="{}")
    # SPEAKER_xx → voice_profile_id assignments during review
    speaker_assignments_json: Mapped[str] = mapped_column(Text, default="{}")
    duration_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    device: Mapped[str] = mapped_column(String(32), default="")
    model: Mapped[str] = mapped_column(String(200), default="")
    raw_turn_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    assigned_speaker_label: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    space: Mapped[FamilySpace] = relationship(back_populates="extract_jobs")
    voice_profile: Mapped[VoiceProfile | None] = relationship(
        back_populates="extract_jobs"
    )
    segments: Mapped[list[ExtractSegment]] = relationship(back_populates="job")


class ExtractSegment(Base):
    __tablename__ = "extract_segments"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    job_id: Mapped[str] = mapped_column(ForeignKey("extract_jobs.id"), index=True)
    speaker_label: Mapped[str] = mapped_column(String(64), index=True)
    t_start: Mapped[float] = mapped_column(Float)
    t_end: Mapped[float] = mapped_column(Float)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    media_path: Mapped[str] = mapped_column(String(512), default="")
    purity: Mapped[float | None] = mapped_column(Float, nullable=True)
    # clean | mixed | short
    quality: Mapped[str] = mapped_column(String(32), default="clean", index=True)
    # pending | accepted | rejected
    review_status: Mapped[str] = mapped_column(String(32), default="pending", index=True)
    voice_sample_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    job: Mapped[ExtractJob] = relationship(back_populates="segments")


class LibraryIngestJob(Base):
    """Upload a document/photo → Gemini proposes library items → human Approve."""

    __tablename__ = "library_ingest_jobs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    space_id: Mapped[str] = mapped_column(ForeignKey("family_spaces.id"), index=True)
    identity_id: Mapped[str | None] = mapped_column(
        ForeignKey("identity_profiles.id"), nullable=True, index=True
    )
    input_path: Mapped[str] = mapped_column(String(512))
    input_mime: Mapped[str] = mapped_column(String(120), default="")
    original_filename: Mapped[str] = mapped_column(String(260), default="")
    # queued | running | needs_review | failed | done
    status: Mapped[str] = mapped_column(String(32), default="queued", index=True)
    error_message: Mapped[str] = mapped_column(Text, default="")
    artifact_dir: Mapped[str] = mapped_column(String(512), default="")
    model: Mapped[str] = mapped_column(String(200), default="")
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    space: Mapped[FamilySpace] = relationship(back_populates="library_ingest_jobs")
    proposals: Mapped[list[LibraryIngestProposal]] = relationship(
        back_populates="job"
    )


class LibraryIngestProposal(Base):
    """One proposed MemoryItem from a library ingest job."""

    __tablename__ = "library_ingest_proposals"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    job_id: Mapped[str] = mapped_column(ForeignKey("library_ingest_jobs.id"), index=True)
    # poem | milestone | note | knowledge
    kind: Mapped[str] = mapped_column(String(32), default="note", index=True)
    title: Mapped[str] = mapped_column(String(200), default="")
    body: Mapped[str] = mapped_column(Text, default="")
    body_tts: Mapped[str] = mapped_column(Text, default="")
    meter: Mapped[str] = mapped_column(String(32), default="")
    themes_json: Mapped[str] = mapped_column(Text, default="[]")
    # own | gift — poem by the remembered person vs gifted by friends
    authorship: Mapped[str] = mapped_column(String(16), default="own")
    occurred_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    identity_id: Mapped[str | None] = mapped_column(
        ForeignKey("identity_profiles.id"), nullable=True, index=True
    )
    # pending | approved | rejected
    review_status: Mapped[str] = mapped_column(String(32), default="pending", index=True)
    memory_item_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    job: Mapped[LibraryIngestJob] = relationship(back_populates="proposals")


class VoiceRender(Base):
    """Saved TTS output from a Voice DNA profile (text → audio history)."""

    __tablename__ = "voice_renders"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    voice_profile_id: Mapped[str] = mapped_column(
        ForeignKey("voice_profiles.id"), index=True
    )
    space_id: Mapped[str] = mapped_column(ForeignKey("family_spaces.id"), index=True)
    text: Mapped[str] = mapped_column(Text)
    media_path: Mapped[str] = mapped_column(String(512))
    media_mime: Mapped[str] = mapped_column(String(120), default="audio/mpeg")
    model_id: Mapped[str] = mapped_column(String(64), default="")
    # Which vendor produced this take — a profile can be re-cloned elsewhere.
    provider: Mapped[str] = mapped_column(String(32), default="elevenlabs")
    provider_voice_id: Mapped[str] = mapped_column(String(120), default="")
    provider_voice_name: Mapped[str] = mapped_column(String(200), default="")
    stability: Mapped[float | None] = mapped_column(Float, nullable=True)
    similarity_boost: Mapped[float | None] = mapped_column(Float, nullable=True)
    style: Mapped[float | None] = mapped_column(Float, nullable=True)
    speed: Mapped[float | None] = mapped_column(Float, nullable=True)
    use_speaker_boost: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    lengthen_pauses: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    # MiniMax-only knobs. Empty emotion means the model inferred the mood.
    emotion: Mapped[str | None] = mapped_column(String(32), nullable=True)
    pitch: Mapped[int | None] = mapped_column(Integer, nullable=True)
    intensity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    timbre: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    voice_profile: Mapped[VoiceProfile] = relationship(back_populates="renders")


class AiUsageEvent(Base):
    """One AI API call (Gemini LLM/STT or TTS provider) for cost telemetry."""

    __tablename__ = "ai_usage_events"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    # Reference ids only — no FK so telemetry never blocks on missing rows.
    space_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    thread_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    message_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    user_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    service: Mapped[str] = mapped_column(String(32), index=True)  # gemini | elevenlabs | minimax
    provider: Mapped[str] = mapped_column(String(32), default="")
    operation: Mapped[str] = mapped_column(String(48), index=True)
    model: Mapped[str] = mapped_column(String(120), default="")
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    input_chars: Mapped[int] = mapped_column(Integer, default=0)
    output_chars: Mapped[int] = mapped_column(Integer, default=0)
    audio_bytes: Mapped[int] = mapped_column(Integer, default=0)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    estimated_cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    ok: Mapped[bool] = mapped_column(Boolean, default=True)
    meta_json: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class StoryWork(Base):
    """Reading prompts: classics (Kiều…) or Buddhist sutras the person recited."""

    __tablename__ = "story_works"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    slug: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(200))
    author: Mapped[str] = mapped_column(String(120), default="")
    source_note: Mapped[str] = mapped_column(Text, default="")
    # classic — truyện thơ; sutra — kinh Phật (Tịnh Độ…)
    category: Mapped[str] = mapped_column(String(32), default="classic", index=True)
    # Display order within category (lower first).
    sort_order: Mapped[int] = mapped_column(Integer, default=100)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    chunks: Mapped[list[StoryChunk]] = relationship(back_populates="work")


class StoryChunk(Base):
    """One readable passage (~10 lục bát couplets)."""

    __tablename__ = "story_chunks"
    __table_args__ = (
        UniqueConstraint("work_id", "sort_order", name="uq_story_chunk_order"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    work_id: Mapped[str] = mapped_column(ForeignKey("story_works.id"), index=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    label: Mapped[str] = mapped_column(String(160), default="")
    body: Mapped[str] = mapped_column(Text)
    line_start: Mapped[int] = mapped_column(Integer, default=0)
    line_end: Mapped[int] = mapped_column(Integer, default=0)
    approx_seconds: Mapped[int] = mapped_column(Integer, default=60)

    work: Mapped[StoryWork] = relationship(back_populates="chunks")


class IdentityStoryWork(Base):
    """Which classics are enabled on a remembered person's storytelling shelf."""

    __tablename__ = "identity_story_works"
    __table_args__ = (
        UniqueConstraint("identity_id", "work_id", name="uq_identity_story_work"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    space_id: Mapped[str] = mapped_column(ForeignKey("family_spaces.id"), index=True)
    identity_id: Mapped[str] = mapped_column(
        ForeignKey("identity_profiles.id"), index=True
    )
    work_id: Mapped[str] = mapped_column(ForeignKey("story_works.id"), index=True)
    enabled_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    enabled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class StoryRecording(Base):
    """Cached reading of one chunk — Voice DNA TTS (heritage) or optional human upload."""

    __tablename__ = "story_recordings"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    space_id: Mapped[str] = mapped_column(ForeignKey("family_spaces.id"), index=True)
    identity_id: Mapped[str] = mapped_column(
        ForeignKey("identity_profiles.id"), index=True
    )
    chunk_id: Mapped[str] = mapped_column(ForeignKey("story_chunks.id"), index=True)
    media_path: Mapped[str] = mapped_column(String(512))
    media_mime: Mapped[str] = mapped_column(String(120), default="audio/mp4")
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # tts — Voice DNA cache; human — mic upload (legacy / rare)
    source: Mapped[str] = mapped_column(String(16), default="tts", index=True)
    # Hash of voice+text so prefs/body changes re-synthesize.
    fingerprint: Mapped[str] = mapped_column(String(64), default="")
    # ready | retired
    status: Mapped[str] = mapped_column(String(16), default="ready", index=True)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
