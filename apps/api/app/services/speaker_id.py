"""Who is speaking on a voice turn — voiceprint first, then a spoken introduction.

The API never loads a model. It asks the embed process for a vector, then
compares that vector to `speaker_prints` for the space. A confident match
addresses that person and may update their print. Anything doubtful stays on
the logged-in account and is not enrolled. Prints are not Voice DNA clones.

A self-introduction in the transcript («Con Đình Anh đây», «Anh ơi em đây»)
can name the speaker when the voice does not. It is a local parse of words
already heard, so it adds no model call. Voice wins when the two disagree,
and words alone never enroll a print.

Addressing and updating a print are different gates. A doubtful cosine keeps
the logged-in account. That same clip may still blend into the account's
existing print when the account is the nearest voice and clears the lower
self-enroll bar. It never opens a print and never writes anyone else.
"""

from __future__ import annotations

import json
import logging
import math
import re
from dataclasses import dataclass
from datetime import datetime, timezone

import httpx
from nanoid import generate
from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..models import IdentityProfile, Message, SpeakerPrint, Thread, User, VoiceProfile
from .heritage import identity_for_thread, normalize_text
from .heritage_persona import persona_for

logger = logging.getLogger(__name__)

_MIN_VECTOR = 8


class SpeakerIdUnavailable(Exception):
    """The embed process did not answer. The call still proceeds."""


@dataclass(frozen=True)
class EmbedObservation:
    embedding: list[float]
    duration_s: float
    halves: tuple[list[float], list[float]] | None = None


@dataclass(frozen=True)
class SpeakerPrintView:
    user_id: str
    embedding: list[float]


@dataclass(frozen=True)
class SpeakerDecision:
    """`user_id` is set only when the match is confident enough to address them.

    `nearest_user_id` is the closest voice in the gallery when that person is
    strictly nearer than the runner-up. It is set on an unsure clip so the
    self-enroll rule can see who the mic was closest to without addressing them.
    A tie leaves it empty.
    """

    user_id: str | None
    confident: bool
    enroll_user_id: str | None
    score: float | None
    second: float | None
    reason: str
    nearest_user_id: str | None = None


@dataclass(frozen=True)
class SeedClip:
    """One vector for the rebuild script. `trusted` is a self Voice DNA sample.

    `skip_reason` is set when the clip is too short or mixed. Those clips are
    still scored against anchors in a dry-run, and they never join a print.
    """

    user_id: str
    embedding: list[float]
    trusted: bool
    skip_reason: str = ""
    label: str = ""


def anchor_user_id(
    profile: VoiceProfile, identity: IdentityProfile | None
) -> str | None:
    """Living member a Voice DNA sample may anchor. Heritage clones are not voices we hear on Gọi."""
    if profile.archived_at is not None or profile.subject_kind == "heritage":
        return None
    if identity is not None and identity.status == "remembered":
        return None
    if profile.subject_kind == "self" and profile.subject_user_id:
        return profile.subject_user_id
    if (
        identity is not None
        and identity.status == "living"
        and identity.linked_user_id
    ):
        return identity.linked_user_id
    return None


def normalize(vec: list[float]) -> list[float]:
    norm = math.sqrt(sum(x * x for x in vec))
    if norm <= 1e-12:
        return list(vec)
    return [x / norm for x in vec]


def cosine(left: list[float], right: list[float]) -> float | None:
    if not left or len(left) != len(right):
        return None
    return sum(a * b for a, b in zip(left, right))


def _finite_vector(raw: object, *, min_len: int = _MIN_VECTOR) -> list[float] | None:
    if not isinstance(raw, list) or len(raw) < min_len:
        return None
    out: list[float] = []
    for item in raw:
        if isinstance(item, bool) or not isinstance(item, (int, float)):
            return None
        value = float(item)
        if not math.isfinite(value):
            return None
        out.append(value)
    return normalize(out)


def parse_observation(payload: object) -> EmbedObservation | None:
    if not isinstance(payload, dict):
        return None
    embedding = _finite_vector(payload.get("embedding"))
    if embedding is None:
        return None
    duration = payload.get("duration_s")
    if isinstance(duration, bool) or not isinstance(duration, (int, float)):
        return None
    duration_s = float(duration)
    if not math.isfinite(duration_s) or duration_s < 0:
        return None
    halves: tuple[list[float], list[float]] | None = None
    raw_halves = payload.get("halves")
    if isinstance(raw_halves, list) and len(raw_halves) == 2:
        left = _finite_vector(raw_halves[0], min_len=len(embedding))
        right = _finite_vector(raw_halves[1], min_len=len(embedding))
        if (
            left is not None
            and right is not None
            and len(left) == len(embedding)
            and len(right) == len(embedding)
        ):
            halves = (left, right)
    return EmbedObservation(
        embedding=embedding, duration_s=duration_s, halves=halves
    )


def decide_speaker(
    embedding: list[float] | None,
    *,
    halves: tuple[list[float], list[float]] | None,
    duration_s: float | None,
    prints: list[SpeakerPrintView],
    threshold: float,
    margin: float,
    min_duration_s: float,
    half_min_cosine: float,
) -> SpeakerDecision:
    """Pick a person, or leave the turn on the account.

    `duration_s is None` skips the length check (the seed script already
    dropped short clips). Missing halves skip the two-voice check.
    """
    if not embedding:
        return SpeakerDecision(None, False, None, None, None, "unavailable")
    if duration_s is not None and duration_s < min_duration_s:
        return SpeakerDecision(None, False, None, None, None, "short")
    if halves is not None:
        half_score = cosine(halves[0], halves[1])
        if half_score is None or half_score < half_min_cosine:
            return SpeakerDecision(None, False, None, None, None, "mixed")
    scored: list[tuple[float, str]] = []
    unit = normalize(embedding)
    for row in prints:
        score = cosine(unit, normalize(row.embedding))
        if score is None:
            continue
        scored.append((score, row.user_id))
    if not scored:
        return SpeakerDecision(None, False, None, None, None, "no_gallery")
    scored.sort(key=lambda item: item[0], reverse=True)
    best, best_id = scored[0]
    second = scored[1][0] if len(scored) > 1 else None
    gap_ok = second is None or (best - second) >= margin
    # A tie is not a person. Addressing and self-enroll both need one nearest.
    nearest = best_id if second is None or best > second else None
    if best >= threshold and gap_ok:
        return SpeakerDecision(
            best_id, True, best_id, best, second, "match", nearest_user_id=best_id
        )
    return SpeakerDecision(
        None, False, None, best, second, "unsure", nearest_user_id=nearest
    )


def account_self_enroll_id(
    voice: SpeakerDecision,
    *,
    account_user_id: str | None,
    threshold: float,
) -> str | None:
    """Whose existing print a doubtful clip may blend into: only the account.

    The address gate can stay closed. The clip must already have survived the
    short and mixed checks (those reasons carry no nearest id). The account
    must be the unique nearest voice, and the cosine must clear `threshold`.
    The address margin is not required. This never points at a different person.
    """
    if voice.reason != "unsure":
        return None
    account = (account_user_id or "").strip()
    nearest = (voice.nearest_user_id or "").strip()
    if not account or nearest != account:
        return None
    if voice.score is None or voice.score < threshold:
        return None
    return account


def enroll_target(
    voice: SpeakerDecision,
    *,
    account_user_id: str | None,
    self_threshold: float,
    addressed: SpeakerDecision | None = None,
) -> str | None:
    """Print to blend, if any. Words never enroll. A confident match enrolls only that person.

    A doubtful voice enrolls the logged-in account when `account_self_enroll_id`
    says so. The caller still has to refuse a missing print — this id is not
    permission to create one.
    """
    decision = addressed or voice
    if decision.reason == "words":
        return None
    if decision.enroll_user_id:
        return decision.enroll_user_id
    return account_self_enroll_id(
        voice, account_user_id=account_user_id, threshold=self_threshold
    )


def blend(
    old: list[float], count: int, new: list[float], *, cap: int
) -> tuple[list[float], int] | None:
    """Running mean. Once `count` hits `cap`, each new clip keeps weight 1/cap."""
    if len(old) != len(new) or not new:
        return None
    fresh = normalize(new)
    limit = max(1, cap)
    if count <= 0:
        return fresh, 1
    weight = min(count, limit - 1)
    total = weight + 1
    mixed = [(old[i] * weight + fresh[i]) / total for i in range(len(fresh))]
    return normalize(mixed), min(count + 1, limit)


def centroid(vectors: list[list[float]]) -> list[float]:
    dim = len(vectors[0])
    mean = [sum(vec[i] for vec in vectors) / len(vectors) for i in range(dim)]
    return normalize(mean)


def assign_seed_clips(
    clips: list[SeedClip],
    *,
    threshold: float,
    margin: float,
    self_enroll_threshold: float = 0.45,
) -> dict[str, list[list[float]]]:
    """Trusted self-samples open a print. A voice turn joins an existing one.

    A confident match follows the voice, including a turn recorded on someone
    else's account. Below that gate, a turn joins the account's bucket only
    when that account already has an anchor, the account is the nearest
    anchor, and the cosine clears `self_enroll_threshold`. A turn whose
    nearest anchor is someone else stays out unless the match is confident.
    Nothing here invents a print for an account with no anchor.
    """
    buckets: dict[str, list[list[float]]] = {}
    for clip in clips:
        if not clip.trusted or clip.skip_reason:
            continue
        buckets.setdefault(clip.user_id, []).append(normalize(clip.embedding))
    for clip in clips:
        if clip.trusted or clip.skip_reason or not buckets:
            continue
        prints = [
            SpeakerPrintView(user_id, centroid(vectors))
            for user_id, vectors in buckets.items()
            if vectors
        ]
        decision = decide_speaker(
            normalize(clip.embedding),
            halves=None,
            duration_s=None,
            prints=prints,
            threshold=threshold,
            margin=margin,
            min_duration_s=0.0,
            half_min_cosine=0.0,
        )
        target = enroll_target(
            decision,
            account_user_id=clip.user_id,
            self_threshold=self_enroll_threshold,
        )
        # `target in buckets` is the anchor check: no key is created here.
        if target and target in buckets:
            buckets[target].append(normalize(clip.embedding))
    return {user_id: vectors for user_id, vectors in buckets.items() if vectors}


def anchor_print_views(clips: list[SeedClip]) -> list[SpeakerPrintView]:
    """Centroids of trusted samples only — the anchors a dry-run scores against."""
    grouped: dict[str, list[list[float]]] = {}
    for clip in clips:
        if not clip.trusted or clip.skip_reason:
            continue
        grouped.setdefault(clip.user_id, []).append(normalize(clip.embedding))
    return [
        SpeakerPrintView(user_id, centroid(vectors))
        for user_id, vectors in grouped.items()
        if vectors
    ]


def cosines_against(
    embedding: list[float], prints: list[SpeakerPrintView]
) -> list[tuple[str, float]]:
    """Cosine of one clip to each print, nearest first."""
    unit = normalize(embedding)
    scored: list[tuple[str, float]] = []
    for row in prints:
        score = cosine(unit, normalize(row.embedding))
        if score is None:
            continue
        scored.append((row.user_id, score))
    scored.sort(key=lambda item: (-item[1], item[0]))
    return scored


def format_call_clip_scores(clip: SeedClip, prints: list[SpeakerPrintView]) -> str:
    """One dry-run line: the account, and cosine to every anchor in the space."""
    scores = cosines_against(clip.embedding, prints)
    rendered = " ".join(f"user={user_id} score={score:.3f}" for user_id, score in scores)
    if not rendered:
        rendered = "(no anchors)"
    skip = f" skipped={clip.skip_reason}" if clip.skip_reason else ""
    label = f" message={clip.label}" if clip.label else ""
    return f"  call clip account={clip.user_id}{label}{skip} {rendered}"


def describe_call_clips(clips: list[SeedClip]) -> list[str]:
    """Dry-run lines for every past Gọi clip, including short and mixed ones."""
    anchors = anchor_print_views(clips)
    return [
        format_call_clip_scores(clip, anchors)
        for clip in clips
        if not clip.trusted
    ]


def _message_meta(message: Message) -> dict:
    raw = getattr(message, "meta_json", None) or ""
    # Callers sometimes pass a stand-in message (tests) with no real meta.
    if not isinstance(raw, str) or not raw.strip():
        return {}
    try:
        loaded = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return loaded if isinstance(loaded, dict) else {}


# «X đây ạ» is how someone introduces themselves on a call. The word after
# «đây» has to be a particle, otherwise «đây rồi» / «đây là» is not an intro.
_AFTER_DAY = frozenset({"a", "nha", "nhe", "nghe", "ha", "oi"})
_ROLE_WORDS = frozenset({"con", "chau", "chat", "em", "anh", "chi"})
# A greeting or a kinship word may sit in front of the name. Anything else
# («kể chuyện Đình Anh đây») is talking about someone, not introducing them.
_INTRO_LEAD = _ROLE_WORDS | {"da", "alo", "vang", "a", "oi", "la", "toi", "minh", "chao"}
_INTRO_WINDOW = 12
# A display name that is only a kinship word («Mẹ», «Anh») is not a personal name.
_NAME_STOP = frozenset(
    {
        "con", "chau", "chat", "em", "anh", "chi", "bo", "ba", "me", "ong",
        "co", "chu", "di", "bac", "toi", "minh", "vo", "chong",
    }
)


@dataclass(frozen=True)
class HouseholdMember:
    """One living, linked person the transcript may name."""

    user_id: str
    names: tuple[str, ...]
    role: str
    relation_key: str


def _tokens(text: str) -> list[str]:
    cleaned = re.sub(r"[^a-z0-9\s]+", " ", normalize_text(text))
    return [part for part in cleaned.split() if part]


def _name_phrases(raw: str) -> set[str]:
    tokens = [part for part in normalize_text(raw).split() if part]
    if not tokens or all(part in _NAME_STOP for part in tokens):
        return set()
    phrases = {" ".join(tokens)}
    if len(tokens) >= 2:
        phrases.add(" ".join(tokens[-2:]))
    if len(tokens) >= 3:
        last = tokens[-1]
        if last not in _NAME_STOP and len(last) >= 4:
            phrases.add(last)
    return {
        phrase
        for phrase in phrases
        if phrase not in _NAME_STOP
        and not all(part in _NAME_STOP for part in phrase.split())
    }


def _relation_key(relation_label: str) -> str:
    parts = normalize_text(relation_label).split()
    return parts[0] if parts else ""


def _member_role(relation_label: str, display_name: str) -> str:
    rel = normalize_text(relation_label)
    name = normalize_text(display_name)
    if rel in ("me", "vo", "chong") or (name == "me" and rel in ("me", "to", "toi")):
        return "spouse"
    if rel in ("chau", "chat") or rel.startswith(("chau ", "chat ")):
        return "grandchild"
    if rel in ("em", "em gai", "em trai", "anh", "chi", "anh trai", "chi gai") or rel.startswith(
        ("em ", "anh ", "chi ")
    ):
        return "sibling"
    if rel in ("con", "toi", "to") or rel.startswith("con "):
        return "child"
    return "other"


def load_household(db: Session, space_id: str) -> list[HouseholdMember]:
    """Living members who can be named on a call. Remembered people are not speakers."""
    rows = (
        db.query(IdentityProfile)
        .filter(
            IdentityProfile.space_id == space_id,
            IdentityProfile.status == "living",
            IdentityProfile.linked_user_id.isnot(None),
            IdentityProfile.archived_at.is_(None),
        )
        .all()
    )
    user_ids = [row.linked_user_id for row in rows if row.linked_user_id]
    users = (
        {
            user.id: user
            for user in db.query(User).filter(User.id.in_(user_ids)).all()
        }
        if user_ids
        else {}
    )
    members: list[HouseholdMember] = []
    for row in rows:
        if not row.linked_user_id:
            continue
        account = users.get(row.linked_user_id)
        phrases: set[str] = set()
        phrases |= _name_phrases(row.display_name or "")
        if account is not None:
            phrases |= _name_phrases(account.name or "")
        members.append(
            HouseholdMember(
                user_id=row.linked_user_id,
                names=tuple(sorted(phrases, key=len, reverse=True)),
                role=_member_role(row.relation_label or "", row.display_name or ""),
                relation_key=_relation_key(row.relation_label or ""),
            )
        )
    return members


def _day_indexes(tokens: list[str]) -> list[int]:
    found: list[int] = []
    for index, token in enumerate(tokens):
        if token != "day":
            continue
        nxt = tokens[index + 1] if index + 1 < len(tokens) else ""
        if nxt and nxt not in _AFTER_DAY:
            continue
        found.append(index)
    return found


def _name_before(tokens_before: list[str], members: list[HouseholdMember]) -> str | None:
    """Longest personal name sitting immediately before «đây»."""
    if len(tokens_before) > _INTRO_WINDOW:
        return None
    for length in (3, 2, 1):
        if len(tokens_before) < length:
            continue
        phrase = " ".join(tokens_before[-length:])
        owners = list(
            dict.fromkeys(
                member.user_id for member in members if phrase in member.names
            )
        )
        if len(owners) > 1:
            return None
        if len(owners) != 1:
            continue
        start = len(tokens_before) - length
        prev = tokens_before[start - 1] if start else ""
        if prev and prev not in _INTRO_LEAD:
            continue
        return owners[0]
    return None


def _people_for_role(
    role_word: str,
    vocative: str | None,
    members: list[HouseholdMember],
    *,
    spouse_self: str | None,
    spouse_other: str | None,
) -> str | None:
    """One person, or nobody when several could say the same «em đây»."""
    self_word = normalize_text(spouse_self or "")
    other_word = normalize_text(spouse_other or "")
    spouses = list(
        dict.fromkeys(member.user_id for member in members if member.role == "spouse")
    )
    if (
        vocative
        and self_word
        and other_word
        and vocative == self_word
        and role_word == other_word
        and len(spouses) == 1
    ):
        return spouses[0]

    if role_word == "con":
        pool = [member.user_id for member in members if member.role == "child"]
    elif role_word in ("chau", "chat"):
        pool = [member.user_id for member in members if member.role == "grandchild"]
    elif role_word in ("em", "anh", "chi"):
        pool = []
        spouse_uses_word = other_word == role_word or (role_word == "em" and not other_word)
        if spouse_uses_word:
            pool.extend(spouses)
        pool.extend(
            member.user_id
            for member in members
            if member.role == "sibling" and member.relation_key == role_word
        )
    else:
        return None
    pool = list(dict.fromkeys(pool))
    if len(pool) == 1:
        return pool[0]
    return None


def _role_before(
    tokens: list[str],
    day_at: int,
    members: list[HouseholdMember],
    *,
    spouse_self: str | None,
    spouse_other: str | None,
) -> str | None:
    if day_at < 1 or day_at > _INTRO_WINDOW:
        return None
    role_word = tokens[day_at - 1]
    if role_word not in _ROLE_WORDS:
        return None
    vocative = None
    if day_at >= 3 and tokens[day_at - 2] == "oi":
        vocative = tokens[day_at - 3]
    return _people_for_role(
        role_word,
        vocative,
        members,
        spouse_self=spouse_self,
        spouse_other=spouse_other,
    )


def match_spoken_intro(
    text: str,
    members: list[HouseholdMember],
    *,
    spouse_self: str | None = None,
    spouse_other: str | None = None,
) -> str | None:
    """The person who introduced themselves, if the wording names exactly one.

    «Con mới về» and «Cháu Hương Ly mới đi học» mention someone without
    presenting the speaker, so they match nobody.
    """
    tokens = _tokens(text)
    days = _day_indexes(tokens)
    if not days or not members:
        return None
    named = [
        hit
        for index in days
        if (hit := _name_before(tokens[:index], members))
    ]
    named = list(dict.fromkeys(named))
    if len(named) == 1:
        return named[0]
    if len(named) > 1:
        return None
    roles = [
        hit
        for index in days
        if (
            hit := _role_before(
                tokens,
                index,
                members,
                spouse_self=spouse_self,
                spouse_other=spouse_other,
            )
        )
    ]
    roles = list(dict.fromkeys(roles))
    if len(roles) == 1:
        return roles[0]
    return None


def spoken_speaker_id(db: Session, thread: Thread, text: str) -> str | None:
    """Who the transcript introduces. No model — safe to run beside the embed."""
    if thread.kind != "heritage" or not (text or "").strip():
        return None
    members = load_household(db, thread.space_id)
    if not members:
        return None
    remembered = identity_for_thread(db, thread)
    persona = persona_for(remembered)
    spouse_self = persona.me("spouse") if persona.speaks_to_spouse else None
    spouse_other = persona.you("spouse") if persona.speaks_to_spouse else None
    return match_spoken_intro(
        text,
        members,
        spouse_self=spouse_self,
        spouse_other=spouse_other,
    )


def fuse_speaker(voice: SpeakerDecision, spoken_user_id: str | None) -> SpeakerDecision:
    """Voice address wins. Words fill in only when the voice did not match.

    Words never enroll. A confident voice match still updates that print
    even if the sentence names someone else.
    """
    if voice.confident and voice.user_id:
        return voice
    if spoken_user_id:
        return SpeakerDecision(
            spoken_user_id,
            True,
            None,
            voice.score,
            voice.second,
            "words",
        )
    return voice


def recognized_speaker_id(message: Message) -> str | None:
    """Confident speaker, if this voice turn was matched. Else the account stands."""
    meta = _message_meta(message)
    speaker_id = meta.get("speaker_user_id")
    if isinstance(speaker_id, str) and speaker_id.strip():
        return speaker_id.strip()
    return None


def _stored_vector(raw: str) -> list[float] | None:
    try:
        loaded = json.loads(raw or "")
    except json.JSONDecodeError:
        return None
    return _finite_vector(loaded, min_len=2)


def load_print_views(db: Session, space_id: str) -> list[SpeakerPrintView]:
    rows = (
        db.query(SpeakerPrint).filter(SpeakerPrint.space_id == space_id).all()
    )
    views: list[SpeakerPrintView] = []
    for row in rows:
        vec = _stored_vector(row.embedding_json)
        if vec:
            views.append(SpeakerPrintView(row.user_id, vec))
    return views


def _blend_existing(
    db: Session,
    *,
    space_id: str,
    user_id: str,
    embedding: list[float],
    cap: int,
) -> bool:
    row = (
        db.query(SpeakerPrint)
        .filter(
            SpeakerPrint.space_id == space_id,
            SpeakerPrint.user_id == user_id,
        )
        .one_or_none()
    )
    if row is None:
        return False
    old = _stored_vector(row.embedding_json)
    if old is None:
        return False
    blended = blend(old, row.sample_count or 0, embedding, cap=cap)
    if blended is None:
        return False
    vector, count = blended
    now = datetime.now(timezone.utc)
    row.embedding_json = json.dumps(vector)
    row.sample_count = count
    row.updated_at = now
    return True


def apply_speaker_turn(
    db: Session,
    *,
    space_id: str,
    message: Message,
    observation: EmbedObservation | None,
    settings: Settings | None = None,
    spoken_user_id: str | None = None,
) -> SpeakerDecision:
    """Write `meta.speaker_user_id` when voice or a spoken intro names someone.

    A confident voice match enrolls that person's existing print. Below the
    address gate, the logged-in account's existing print may still update when
    they are the nearest voice. A spoken intro only changes who is addressed,
    and only when the voice did not match. Does not create a print. The seed
    script opens the gallery from anchors. Does not write a VoiceSample.
    """
    settings = settings or get_settings()
    meta = _message_meta(message)
    prior = meta.get("speaker")
    if isinstance(prior, dict) and prior.get("reason"):
        return SpeakerDecision(
            recognized_speaker_id(message),
            bool(prior.get("confident")),
            None,
            prior.get("score") if isinstance(prior.get("score"), (int, float)) else None,
            prior.get("second") if isinstance(prior.get("second"), (int, float)) else None,
            str(prior.get("reason")),
        )

    if not settings.speaker_id_enabled:
        voice = SpeakerDecision(None, False, None, None, None, "disabled")
    else:
        voice = decide_speaker(
            observation.embedding if observation else None,
            halves=observation.halves if observation else None,
            duration_s=observation.duration_s if observation else None,
            prints=load_print_views(db, space_id),
            threshold=settings.speaker_match_threshold,
            margin=settings.speaker_match_margin,
            min_duration_s=settings.speaker_min_duration_s,
            half_min_cosine=settings.speaker_half_min_cosine,
        )
    decision = fuse_speaker(voice, spoken_user_id)
    enroll_id = enroll_target(
        voice,
        account_user_id=getattr(message, "sender_user_id", None),
        self_threshold=settings.speaker_self_enroll_threshold,
        addressed=decision,
    )

    enrolled = False
    if enroll_id and observation is not None:
        # `_blend_existing` no-ops when the row is missing, so a live turn
        # cannot open a print.
        enrolled = _blend_existing(
            db,
            space_id=space_id,
            user_id=enroll_id,
            embedding=observation.embedding,
            cap=max(1, settings.speaker_print_cap),
        )

    block: dict = {
        "user_id": decision.user_id,
        "confident": decision.confident,
        "score": decision.score,
        "second": decision.second,
        "reason": decision.reason,
        "enrolled": enrolled,
        "voice_reason": voice.reason,
        "voice_user_id": voice.user_id,
        "nearest_user_id": voice.nearest_user_id,
        "words_user_id": spoken_user_id,
    }
    meta["speaker"] = block
    if decision.confident and decision.user_id:
        meta["speaker_user_id"] = decision.user_id
    else:
        meta.pop("speaker_user_id", None)
    message.meta_json = json.dumps(meta, ensure_ascii=False)
    db.add(message)
    db.commit()
    db.refresh(message)
    logger.info(
        "speaker-id message=%s reason=%s user=%s voice=%s words=%s score=%s enrolled=%s",
        message.id,
        decision.reason,
        decision.user_id or "-",
        voice.reason,
        spoken_user_id or "-",
        f"{decision.score:.3f}" if decision.score is not None else "-",
        enrolled,
    )
    return decision


def request_embedding(
    settings: Settings, *, path, mime: str | None
) -> EmbedObservation | None:
    """POST the clip to the embed process.

    Returns None when this file cannot be embedded. Raises
    SpeakerIdUnavailable when the process itself is unreachable, so a voice
    turn can fall back without failing the call.
    """
    url = (settings.speaker_id_url or "").strip().rstrip("/")
    if not url:
        raise SpeakerIdUnavailable("speaker_id_url empty")
    token = (settings.speaker_id_token or "").strip() or settings.extract_worker_token
    try:
        data = path.read_bytes()
    except OSError as exc:
        logger.info("speaker embed unreadable path=%s error=%s", path, exc)
        return None
    headers = {
        "X-Speaker-Token": token,
        "Content-Type": (mime or "application/octet-stream").split(";")[0].strip()
        or "application/octet-stream",
    }
    timeout = httpx.Timeout(settings.speaker_id_timeout_s, connect=1.0)
    try:
        with httpx.Client(timeout=timeout) as client:
            response = client.post(f"{url}/embed", content=data, headers=headers)
    except httpx.HTTPError as exc:
        raise SpeakerIdUnavailable(str(exc)) from exc
    if response.status_code == 401:
        raise SpeakerIdUnavailable("speaker-id rejected the token")
    if response.status_code != 200:
        logger.info(
            "speaker embed rejected status=%s", response.status_code
        )
        return None
    try:
        payload = response.json()
    except json.JSONDecodeError:
        return None
    return parse_observation(payload)


def upsert_print(
    db: Session,
    *,
    space_id: str,
    user_id: str,
    embedding: list[float],
    sample_count: int,
) -> SpeakerPrint:
    """Replace one print. Used by the seed script, not by a live turn."""
    now = datetime.now(timezone.utc)
    row = (
        db.query(SpeakerPrint)
        .filter(
            SpeakerPrint.space_id == space_id,
            SpeakerPrint.user_id == user_id,
        )
        .one_or_none()
    )
    vector = normalize(embedding)
    count = max(1, sample_count)
    if row is None:
        row = SpeakerPrint(
            id=generate(),
            space_id=space_id,
            user_id=user_id,
            embedding_json=json.dumps(vector),
            sample_count=count,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
    else:
        row.embedding_json = json.dumps(vector)
        row.sample_count = count
        row.updated_at = now
    return row
