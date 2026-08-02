from extract.diarize import _normalize_speaker_label


def test_normalize_speaker_labels():
    assert _normalize_speaker_label("SPEAKER_0") == "SPEAKER_00"
    assert _normalize_speaker_label("speaker_1") == "SPEAKER_01"
    assert _normalize_speaker_label("2") == "SPEAKER_02"
