from app.services.heritage import has_heritage_tag, profile_lock_ready, tag_tokens
from app.models import IdentityProfile


def test_tag_tokens_split():
    assert tag_tokens("heritage:abc, poetry  gia_dinh") == [
        "heritage:abc",
        "poetry",
        "gia_dinh",
    ]


def test_has_heritage_tag_exact_not_prefix():
    assert has_heritage_tag("heritage:abc", "abc") is True
    assert has_heritage_tag("heritage:abcdef", "abc") is False
    assert has_heritage_tag("foo,heritage:abc,bar", "abc") is True


def test_profile_lock_rejects_placeholders():
    row = IdentityProfile(
        id="x",
        space_id="s",
        display_name="Bố",
        relation_label="Bố",
        status="remembered",
        created_by="u",
        created_at=None,  # type: ignore[arg-type]
    )
    row.profile_reviewed_at = None
    assert profile_lock_ready(row) is False

    from datetime import datetime, timezone

    row.profile_reviewed_at = datetime.now(timezone.utc)
    row.core_values_json = (
        '[{"label":"PLACEHOLDER","status":"placeholder"},'
        '{"label":"A","status":"draft"},{"label":"B","status":"draft"}]'
    )
    row.speech_style_json = '{"traits":["ấm"]}'
    row.address_forms_json = '{"with_spouse":{"self":"anh"}}'
    row.taboos_json = '{"hard":["Chính trị"]}'
    # only 2 real values
    assert profile_lock_ready(row) is False

    row.core_values_json = (
        '[{"label":"Yêu gia đình","status":"draft"},'
        '{"label":"Khiêm nhường","status":"draft"},'
        '{"label":"Nghề giáo","status":"draft"}]'
    )
    assert profile_lock_ready(row) is True
