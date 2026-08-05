from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

from app.config import Settings
from app.models import FamilyEntity
from app.services.heritage_analyzer import (
    DEPTH_TOKENS,
    ContextFrame,
    analyze_turn,
    parse_frame,
)
from app.services.heritage_gemini import parse_json_object
from app.services.heritage_values import select_value_lens, value_lens_block

LOCK_VALUES = [
    {"id": "family_love", "label": "Yêu thương gia đình hết mực", "example": "Vì chồng con cháu"},
    {"id": "filial_piety", "label": "Hiếu nghĩa — nhớ cha mẹ", "example": "Nén hương thay mẹ"},
    {"id": "marital_fidelity", "label": "Thủy chung vợ chồng", "example": "Biển đông chưa cạn"},
    {"id": "moral_integrity", "label": "Giữ tâm trong sạch, chữ nhân", "example": ""},
    {"id": "teacher_craft", "label": "Trồng người", "example": ""},
    {"id": "serene_aging", "label": "An nhiên tuổi già", "example": ""},
]


def _entity(slug: str, name: str, relation: str) -> FamilyEntity:
    return FamilyEntity(
        id=slug,
        space_id="s",
        slug=slug,
        canonical_name=name,
        aliases_json=json.dumps([name], ensure_ascii=False),
        relation_json=json.dumps({"to_subject": relation}, ensure_ascii=False),
        status="approved",
        created_by="u",
    )


# --- frame parsing ---

def test_parse_frame_keeps_only_known_slugs():
    frame = parse_frame(
        {
            "intent": "ask_person",
            "depth": "story",
            "emotion": "warm",
            "entity_slugs": ["huong", "khong_co_that"],
            "topics": ["con_cai", "bịa"],
            "retrieval_queries": ["con gái đi xa", "nhớ con", "a", "b", "c"],
        },
        known_slugs={"huong"},
    )
    assert frame is not None
    assert frame.entity_slugs == ["huong"]
    assert frame.topics == ["con_cai"]
    assert len(frame.retrieval_queries) == 3
    assert frame.source == "gemini"


def test_parse_frame_falls_back_on_bad_enums():
    frame = parse_frame({"intent": "nonsense", "depth": "epic"}, known_slugs=set())
    assert frame is not None
    assert frame.intent == "smalltalk"
    assert frame.depth == "short"


def test_parse_frame_rejects_empty_payload():
    assert parse_frame(None, known_slugs=set()) is None


def test_parse_json_object_tolerates_code_fence():
    payload = parse_json_object('```json\n{"intent": "meta"}\n```')
    assert payload == {"intent": "meta"}


# --- depth drives length ---

def test_depth_controls_output_budget():
    assert ContextFrame(depth="ack").max_output_tokens == DEPTH_TOKENS["ack"]
    assert ContextFrame(depth="story").max_output_tokens > DEPTH_TOKENS["short"]
    assert "1 câu" in ContextFrame(depth="ack").depth_rule


# --- analyzer call ---

def _settings(**kwargs) -> Settings:
    return Settings(gemini_api_key="test-key", seed_demo=False, **kwargs)


def test_analyze_turn_parses_gemini_json():
    response = MagicMock()
    response.raise_for_status = MagicMock()
    response.json.return_value = {
        "candidates": [
            {
                "content": {
                    "parts": [
                        {
                            "text": json.dumps(
                                {
                                    "intent": "meta",
                                    "depth": "ack",
                                    "emotion": "playful",
                                    "topics": ["khac"],
                                    "entity_slugs": [],
                                }
                            )
                        }
                    ]
                }
            }
        ]
    }
    client = MagicMock()
    client.__enter__.return_value = client
    client.__exit__.return_value = False
    client.post.return_value = response

    with patch("app.services.heritage_gemini.httpx.Client", return_value=client):
        frame = analyze_turn(
            _settings(),
            user_text="Con đang chat với bố trên server local ạ.",
            history=[],
            entities=[_entity("huong", "Nguyễn Lê Hương", "con gái")],
        )
    assert frame.intent == "meta"
    assert frame.depth == "ack"
    assert frame.source == "gemini"


def test_analyze_turn_falls_back_when_gemini_fails():
    client = MagicMock()
    client.__enter__.return_value = client
    client.__exit__.return_value = False
    client.post.side_effect = RuntimeError("network down")

    with patch("app.services.heritage_gemini.httpx.Client", return_value=client):
        frame = analyze_turn(
            _settings(), user_text="Bố ơi", history=[], entities=[]
        )
    assert frame.source.startswith("fallback")
    assert frame.depth == "short"


def test_analyze_turn_without_api_key_is_a_no_op():
    frame = analyze_turn(
        Settings(gemini_api_key="", seed_demo=False),
        user_text="Bố ơi",
        history=[],
        entities=[],
    )
    assert frame.source == "fallback:no_api_key"


# --- value lens ---

def test_value_lens_for_spouse_topic():
    picked = select_value_lens(LOCK_VALUES, intent="smalltalk", topics=["vo_chong"])
    assert [v["id"] for v in picked] == ["marital_fidelity", "family_love"]


def test_value_lens_for_advice_leans_on_integrity():
    picked = select_value_lens(LOCK_VALUES, intent="ask_advice", topics=["con_cai"])
    assert picked[0]["id"] == "moral_integrity"


def test_value_lens_defaults_to_family_love():
    picked = select_value_lens(LOCK_VALUES, intent="smalltalk", topics=[])
    assert picked[0]["id"] == "family_love"


def test_value_lens_handles_lock_without_ids():
    picked = select_value_lens([{"label": "Yêu gia đình"}], intent="grief", topics=[])
    assert picked and picked[0]["label"] == "Yêu gia đình"


def test_value_lens_skips_placeholders():
    assert select_value_lens([{"label": "PLACEHOLDER — chưa chốt"}]) == []


def test_value_lens_block_hides_the_machinery():
    block = value_lens_block(select_value_lens(LOCK_VALUES, topics=["vo_chong"]))
    assert "Thủy chung vợ chồng" in block
    assert "không nêu tên giá trị ra thành lời" in block
