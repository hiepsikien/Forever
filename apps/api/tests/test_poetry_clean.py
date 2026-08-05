from app.services.poetry_clean import (
    clean_body_lines,
    clean_title,
    enrich_poem,
    format_body_tts,
    split_composed_date,
)


def test_strips_header_and_page_number():
    lines = clean_body_lines(
        "Thơ Tâm Tình\nCả tuần ông nhớ bà mong\nSáng nay thứ bảy đèo bòng nhau lên\n21",
        meter="luc_bat",
    )
    assert lines[0].startswith("Cả tuần")
    assert all(ln != "21" and "Tâm Tình" not in ln for ln in lines)


def test_luc_bat_tts_pauses():
    lines = [
        "Cả tuần ông nhớ bà mong",
        "Sáng nay thứ bảy đèo bòng nhau lên",
        "Tối qua thao thức cả đêm",
        "Thức ăn cháu dặn bà quên thứ gì",
    ]
    tts = format_body_tts(lines, meter="luc_bat")
    assert "mong, Sáng nay" in tts
    assert tts.count(".") >= 2


def test_split_glued_couple():
    glued = "Cả tuần ông nhớ bà mong Sáng nay thứ bảy đèo bòng nhau lên"
    lines = clean_body_lines(glued, meter="luc_bat")
    assert len(lines) == 2
    assert lines[0].endswith("mong")
    assert "Sáng nay" in lines[1]


def test_signature_date_leaves_body():
    lines, composed = split_composed_date(
        ["Mẹ ơi con gọi mẹ đây!!!", "7/8/2014"]
    )
    assert lines == ["Mẹ ơi con gọi mẹ đây!!!"]
    assert composed == "2014-08-07"


def test_year_inside_verse_is_not_a_signature():
    verse = ["Nhớ về năm 1975 xa lắc"]
    assert split_composed_date(verse) == (verse, None)


def test_tts_keeps_single_terminal_stop():
    tts = format_body_tts(
        ["Cả tuần ông nhớ bà mong", "Họ Lê con gái tuyệt vời !"],
        meter="luc_bat",
    )
    assert tts.endswith("tuyệt vời !")
    assert "!." not in tts


def test_enrich_poem_extracts_composed_date():
    poem = enrich_poem(
        {
            "title": "KHÓC MẸ",
            "body": "Thu về con mất mẹ rồi\nThu về con hóa mồ côi thế này\n7/8/2014",
            "meter": "luc_bat",
        }
    )
    assert "2014" not in poem["body"]
    assert poem["composed_on"] == "2014-08-07"
    assert poem["year_guess"] == 2014
    assert poem["line_count"] == 2


def test_enrich_poem_fields():
    poem = enrich_poem(
        {
            "title": "  ÔNG BÀ VÀ CÁC CHÁU  ",
            "body": "Thơ Tâm Tình\nCả tuần ông nhớ bà mong\nSáng nay thứ bảy đèo bòng nhau lên\n21",
            "meter": "luc_bat",
            "themes": ["gia_dinh"],
        }
    )
    assert poem["title"] == "ÔNG BÀ VÀ CÁC CHÁU"
    assert "Thơ Tâm Tình" not in poem["body"]
    assert "body_tts" in poem
    assert poem["line_count"] == 2
    assert clean_title("  a  ") == "a"
