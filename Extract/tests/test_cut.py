from extract.cut import apply_padding, merge_segments
from extract.types import Segment


def test_merge_same_speaker_within_gap():
    segs = [
        Segment("SPEAKER_00", 0.0, 1.0),
        Segment("SPEAKER_00", 1.5, 2.5),
        Segment("SPEAKER_01", 3.0, 4.0),
    ]
    merged = merge_segments(segs, max_gap=0.75, min_duration=0.4)
    assert len(merged) == 2
    assert merged[0] == Segment("SPEAKER_00", 0.0, 2.5)
    assert merged[1].speaker == "SPEAKER_01"


def test_merge_does_not_cross_speakers():
    segs = [
        Segment("SPEAKER_00", 0.0, 1.0),
        Segment("SPEAKER_01", 1.2, 2.0),
        Segment("SPEAKER_00", 2.1, 3.0),
    ]
    merged = merge_segments(segs, max_gap=0.75, min_duration=0.1)
    assert [s.speaker for s in merged] == ["SPEAKER_00", "SPEAKER_01", "SPEAKER_00"]


def test_drop_tiny_segments():
    segs = [
        Segment("SPEAKER_00", 0.0, 0.2),
        Segment("SPEAKER_01", 1.0, 2.0),
    ]
    merged = merge_segments(segs, max_gap=0.75, min_duration=0.4)
    assert len(merged) == 1
    assert merged[0].speaker == "SPEAKER_01"


def test_padding_clamps_to_duration():
    segs = [Segment("SPEAKER_00", 0.05, 1.0)]
    padded = apply_padding(segs, pad=0.2, total_duration=1.05)
    assert padded[0].start == 0.0
    assert padded[0].end == 1.05
