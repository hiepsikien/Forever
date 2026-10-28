"""Who is speaking on a voice turn — voiceprint first, then a spoken introduction.

The API never loads a model. It asks the embed process for a vector, then
compares that vector to `speaker_prints` for the space. A confident match
addresses that person and may update their print. A doubtful voice stays on
the logged-in account for the address. That account's existing print may
still move when they are the nearest voice by a small gap and the words did
not name someone else. Prints are not Voice DNA clones.

A self-introduction in the transcript («Con Đình Anh đây», «Anh ơi em đây»)
can name the speaker when the voice does not. It is a local parse of words
already heard, so it adds no model call. Voice wins when the two disagree.
Words never select a print. When they name someone other than the account,
the lower gate stays shut: one clip is not both the addressed person and
the account's voice.

Addressing and updating a print are different gates. A doubtful cosine keeps
the logged-in account. That same clip may still blend into the account's
existing print when the account is the nearest voice and clears the lower
self-enroll bar. It never opens a print and never writes anyone else.

The rebuild script is what opens a print, from a majority of that account's
own past calls. Voice DNA samples are not required and do not open one.
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
    """One vector for the rebuild script.

    `trusted` marks a Voice DNA sample. Those samples are ignored: a print
    opens from call history, so someone with no Voice DNA can still have one.
    `skip_reason` is set when the clip is too short or mixed. Those clips
    never join a print. `spoken_user_id` is who the transcript introduced.
    A name other than the account stays out of that account's majority.
    """

    user_id: str
    embedding: list[float]
    trusted: bool
    skip_reason: str = ""
    label: str = ""
    spoken_user_id: str | None = None


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


def _nearest_print(
    embedding: list[float], prints: list[SpeakerPrintView]
) -> tuple[str | None, float | None]:
    best_id: str | None = None
    best: float | None = None
    unit = normalize(embedding)
    for row in prints:
        score = cosine(unit, normalize(row.embedding))
        if score is None:
            continue
        if best is None or score > best:
            best = score
            best_id = row.user_id
    return best_id, best


def _halves_agree_on(
    halves: tuple[list[float], list[float]],
    prints: list[SpeakerPrintView],
    person_id: str,
    agree_min: float,
) -> bool:
    """Both halves are closer to `person_id` than to anyone else, by `agree_min`."""
    for half in halves:
        nearest, score = _nearest_print(half, prints)
        if nearest != person_id or score is None or score < agree_min:
            return False
    return True


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
    half_agree_min: float = 0.40,
) -> SpeakerDecision:
    """Pick a person, or leave the turn on the account.

    `duration_s is None` skips the length check (the seed script already
    dropped short clips). Missing halves skip the two-voice check. Halves
    below `half_min_cosine` are still one person when the whole clip
    confidently matches someone and each half clears `half_agree_min` for
    that same person. Halves that point at two people stay mixed.
    """
    if not embedding:
        return SpeakerDecision(None, False, None, None, None, "unavailable")
    if duration_s is not None and duration_s < min_duration_s:
        return SpeakerDecision(None, False, None, None, None, "short")
    scored: list[tuple[float, str]] = []
    unit = normalize(embedding)
    for row in prints:
        score = cosine(unit, normalize(row.embedding))
        if score is None:
            continue
        scored.append((score, row.user_id))
    half_score = cosine(halves[0], halves[1]) if halves is not None else None
    low_halves = halves is not None and (half_score is None or half_score < half_min_cosine)
    if not scored:
        if low_halves:
            return SpeakerDecision(None, False, None, None, None, "mixed")
        return SpeakerDecision(None, False, None, None, None, "no_gallery")
    scored.sort(key=lambda item: item[0], reverse=True)
    best, best_id = scored[0]
    second = scored[1][0] if len(scored) > 1 else None
    gap_ok = second is None or (best - second) >= margin
    # A tie is not a person. Addressing and self-enroll both need one nearest.
    nearest = best_id if second is None or best > second else None
    confident = best >= threshold and gap_ok
    if low_halves and not (
        confident
        and halves is not None
        and _halves_agree_on(halves, prints, best_id, half_agree_min)
    ):
        return SpeakerDecision(None, False, None, None, None, "mixed")
    if confident:
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
    margin: float,
) -> str | None:
    """Whose existing print a doubtful clip may blend into: only the account.

    The address gate can stay closed. The clip must already have survived the
    short and mixed checks (those reasons carry no nearest id). The account
    must be the nearest voice, the cosine must clear `threshold`, and the gap
    over the runner-up must clear `margin`. That margin is narrower than the
    address gap. A tie, or a photo-finish, does not move the print. This never
    points at a different person.
    """
    if voice.reason != "unsure":
        return None
    account = (account_user_id or "").strip()
    nearest = (voice.nearest_user_id or "").strip()
    if not account or nearest != account:
        return None
    if voice.score is None or voice.score < threshold:
        return None
    if voice.second is not None and (voice.score - voice.second) < margin:
        return None
    return account


def enroll_target(
    voice: SpeakerDecision,
    *,
    account_user_id: str | None,
    self_threshold: float,
    self_margin: float,
    spoken_user_id: str | None = None,
    addressed: SpeakerDecision | None = None,
) -> str | None:
    """Whose existing print to blend, if any.

    Words never select the print. They do not enroll the person the sentence
    named. When those words name someone other than the logged-in account,
    the lower gate stays shut — the clip is not written onto the account
    either. Words that name the account, or no words at all, still allow
    `account_self_enroll_id`. A confident match enrolls only that person
    (`fuse_speaker` keeps reason "match" in that case). The caller refuses a
    missing row — this id is not permission to create one.
    """
    decision = addressed or voice
    if decision.enroll_user_id:
        return decision.enroll_user_id
    account = (account_user_id or "").strip()
    named = (spoken_user_id or "").strip()
    if named and named != account:
        return None
    return account_self_enroll_id(
        voice,
        account_user_id=account_user_id,
        threshold=self_threshold,
        margin=self_margin,
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


def _seed_order_key(clip: SeedClip) -> tuple:
    """Stable across input order. Identical labels still sort by the vector."""
    raw = tuple(round(value, 6) for value in clip.embedding)
    return (clip.label, clip.user_id, raw)


def _in_own_majority_pool(clip: SeedClip) -> bool:
    """A call clip that may count as this account's own voice.

    Voice DNA samples, short clips, and mixed clips do not. A transcript that
    names someone else does not either — one «em đây» must not drag the
    account's pattern. Words still do not open a print by themselves.
    """
    if clip.trusted or clip.skip_reason or not clip.embedding:
        return False
    named = (clip.spoken_user_id or "").strip()
    return not named or named == clip.user_id


def evenly_spaced(items: list, limit: int) -> list:
    """Spread `limit` picks across `items`, which the caller has already ordered.

    A long call history stays a few dozen embeddings instead of every clip.
    The picks sit in the middle of equal time buckets, so the sample is the
    whole span and not only the latest calls. The same ordered list always
    yields the same picks.
    """
    count = len(items)
    if limit <= 0 or count <= limit:
        return list(items)
    step = count / limit
    return [items[min(count - 1, int((index + 0.5) * step))] for index in range(limit)]


def _neighborhood(units: list[list[float]], index: int, link: float) -> list[int]:
    origin = units[index]
    members: list[int] = []
    for other_index, other in enumerate(units):
        score = cosine(origin, other)
        if score is not None and score >= link:
            members.append(other_index)
    return members


def _pick_medoid(units: list[list[float]], link: float) -> int:
    """Largest neighborhood, then the tighter one, then the earlier clip."""
    best_index = 0
    best_key: tuple[int, float, int] | None = None
    for index in range(len(units)):
        members = _neighborhood(units, index, link)
        sims = [
            score
            for other_index in members
            if (score := cosine(units[index], units[other_index])) is not None
        ]
        mean = sum(sims) / len(sims) if sims else 0.0
        key = (len(members), mean, -index)
        if best_key is None or key > best_key:
            best_key = key
            best_index = index
    return best_index


def _select_majority(
    units: list[list[float]],
    *,
    link: float,
    min_count: int,
    majority: float,
) -> tuple[list[int], str, int]:
    """Indices of the dominant pattern, or why the account gets no print.

    The third value is the size of the largest pattern, even when it is
    rejected. `few` means there are not enough usable calls. `thin` means
    the tightest group is still smaller than `min_count`. `split` means two
    voices share the account and neither is a clear majority.
    """
    count = len(units)
    if count == 0:
        return [], "few", 0
    medoid = _pick_medoid(units, link)
    kept = _neighborhood(units, medoid, link)
    if count < min_count:
        return [], "few", len(kept)
    if len(kept) < min_count:
        return [], "thin", len(kept)
    if len(kept) + 1e-9 < majority * count:
        return [], "split", len(kept)
    outside = [units[index] for index in range(count) if index not in set(kept)]
    if outside:
        second_medoid = _pick_medoid(outside, link)
        second = _neighborhood(outside, second_medoid, link)
        if len(kept) <= len(second):
            return [], "split", len(kept)
    return kept, "print", len(kept)


def _seed_reason(reason: str, cluster: int, min_count: int) -> str:
    if reason == "few":
        if cluster == 0:
            return "không có đoạn dùng được"
        return f"cần {min_count} đoạn cùng giọng"
    if reason == "thin":
        return f"cụm lớn nhất mới có {cluster} đoạn"
    return "chưa phải đa số"


@dataclass(frozen=True)
class SeedPlan:
    """Prints to write, and the dry-run lines that explain each account."""

    prints: dict[str, list[list[float]]]
    lines: tuple[str, ...]


def plan_seed_clips(
    clips: list[SeedClip],
    *,
    threshold: float,
    margin: float,
    link: float | None = None,
    min_count: int = 4,
    majority: float = 0.60,
) -> SeedPlan:
    """Open a print from the majority pattern in each account's own calls.

    Voice DNA samples are ignored. Usable calls are the ones that are long
    enough, one voice, and not a self-introduction of someone else. The
    pattern is every clip within `link` of the medoid. It opens a print when
    it has at least `min_count` clips, covers at least `majority` of that
    account's usable calls, and is strictly larger than the next pattern
    outside it. A 50/50 phone does not pick a voice.

    Those centroids stay frozen. A clip left out of every pattern — another
    person on this phone, or this person on someone else's phone — joins an
    existing print only when `decide_speaker` is a confident match
    (`threshold` and `margin`). The live self-enroll bar is not used, and
    words do not open a print. Order does not change who is accepted.
    """
    link_cosine = threshold if link is None else link
    ordered = sorted(
        (clip for clip in clips if not clip.trusted),
        key=_seed_order_key,
    )
    by_user: dict[str, list[SeedClip]] = {}
    for clip in ordered:
        by_user.setdefault(clip.user_id, []).append(clip)

    kept_ids: set[int] = set()
    buckets: dict[str, list[list[float]]] = {}
    lines: list[str] = []
    for user_id in sorted(by_user):
        rows = by_user[user_id]
        pool = [clip for clip in rows if _in_own_majority_pool(clip)]
        skipped = sum(1 for clip in rows if clip.skip_reason)
        named_other = sum(
            1
            for clip in rows
            if not clip.skip_reason
            and clip.embedding
            and (clip.spoken_user_id or "").strip() not in ("", user_id)
        )
        units = [normalize(clip.embedding) for clip in pool]
        chosen, reason, cluster = _select_majority(
            units, link=link_cosine, min_count=min_count, majority=majority
        )
        ratio = (cluster / len(pool)) if pool else 0.0
        if reason == "print":
            buckets[user_id] = [units[index] for index in chosen]
            for index in chosen:
                kept_ids.add(id(pool[index]))
            decision = "print"
        elif not pool and named_other:
            decision = f"no print ({named_other} câu tự xưng chỉ người khác)"
        else:
            decision = (
                f"no print ({_seed_reason(reason, cluster, min_count)})"
            )
        lines.append(
            f"  user={user_id} usable={len(pool)} skipped={skipped} "
            f"words={named_other} cluster={cluster} ratio={ratio:.2f} -> {decision}"
        )

    prints = [
        SpeakerPrintView(user_id, centroid(vectors))
        for user_id, vectors in buckets.items()
        if vectors
    ]
    joined: dict[str, int] = {}
    if prints:
        for clip in ordered:
            if clip.skip_reason or not clip.embedding or id(clip) in kept_ids:
                continue
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
            target = decision.enroll_user_id if decision.reason == "match" else None
            if target and target in buckets:
                buckets[target].append(normalize(clip.embedding))
                joined[target] = joined.get(target, 0) + 1
    for user_id, count in sorted(joined.items()):
        lines.append(f"  joined user={user_id} clips={count}")
    return SeedPlan(
        prints={user_id: vectors for user_id, vectors in buckets.items() if vectors},
        lines=tuple(lines),
    )


def assign_seed_clips(
    clips: list[SeedClip],
    *,
    threshold: float,
    margin: float,
    link: float | None = None,
    min_count: int = 4,
    majority: float = 0.60,
) -> dict[str, list[list[float]]]:
    """Whose vectors to store. See `plan_seed_clips`."""
    return plan_seed_clips(
        clips,
        threshold=threshold,
        margin=margin,
        link=link,
        min_count=min_count,
        majority=majority,
    ).prints


def describe_seed_plan(
    clips: list[SeedClip],
    *,
    threshold: float,
    margin: float,
    link: float | None = None,
    min_count: int = 4,
    majority: float = 0.60,
) -> list[str]:
    """Dry-run lines: one decision per account, not one line per clip."""
    return list(
        plan_seed_clips(
            clips,
            threshold=threshold,
            margin=margin,
            link=link,
            min_count=min_count,
            majority=majority,
        ).lines
    )


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

    The words decision carries no enroll id, so the named person is not the
    print that gets written. When the words name someone other than the
    account, `enroll_target` also leaves the account print alone. Words that
    name the account do not cancel a self-update the voice already earned. A
    confident voice match still updates that print even if the sentence names
    someone else.
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
    they are the nearest voice by the self-enroll gap. A spoken intro changes
    who is addressed when the voice did not match. It does not choose the
    print. When it names someone else, that lower gate stays shut. Does not
    create a print. The seed script opens the gallery from a majority of past
    calls. Does not write a VoiceSample.
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
            half_agree_min=settings.speaker_half_agree_min,
        )
    decision = fuse_speaker(voice, spoken_user_id)
    enroll_id = enroll_target(
        voice,
        account_user_id=getattr(message, "sender_user_id", None),
        self_threshold=settings.speaker_self_enroll_threshold,
        self_margin=settings.speaker_self_enroll_margin,
        spoken_user_id=spoken_user_id,
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
