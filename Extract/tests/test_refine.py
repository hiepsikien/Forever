from extract.refine import (
    exclusive_segments,
    label_quality,
    overlap_intervals,
    refine_segments,
    subtract_ranges,
)
from extract.types import Segment


def test_overlap_intervals_detects_shared_region():
    segs = [
        Segment("SPEAKER_00", 0.0, 2.0),
        Segment("SPEAKER_01", 1.0, 3.0),
    ]
    assert overlap_intervals(segs) == [(1.0, 2.0)]


def test_subtract_ranges_keeps_exclusive_sides():
    assert subtract_ranges(0.0, 2.0, [(1.0, 2.0)]) == [(0.0, 1.0)]
    assert subtract_ranges(1.0, 3.0, [(1.0, 2.0)]) == [(2.0, 3.0)]


def test_exclusive_segments_drops_overlap():
    segs = [
        Segment("SPEAKER_00", 0.0, 2.0),
        Segment("SPEAKER_01", 1.0, 3.0),
        Segment("SPEAKER_00", 3.5, 6.0),
    ]
    exclusive = exclusive_segments(segs)
    assert [(s.speaker, round(s.start, 2), round(s.end, 2)) for s in exclusive] == [
        ("SPEAKER_00", 0.0, 1.0),
        ("SPEAKER_01", 2.0, 3.0),
        ("SPEAKER_00", 3.5, 6.0),
    ]


def test_refine_marks_clean_when_long_enough():
    segs = [
        Segment("SPEAKER_00", 0.0, 5.0),
        Segment("SPEAKER_01", 5.5, 8.0),
    ]
    refined = refine_segments(
        segs,
        exclusive_only=True,
        edge_trim=0.05,
        max_gap=0.35,
        pad=0.05,
        min_duration=2.0,
    )
    assert all(s.quality in ("clean", "short") for s in refined)
    assert any(s.quality == "clean" and s.speaker == "SPEAKER_00" for s in refined)


def test_refine_removes_overlapped_middle():
    segs = [
        Segment("SPEAKER_00", 0.0, 4.0),
        Segment("SPEAKER_01", 1.5, 2.5),
    ]
    refined = refine_segments(
        segs,
        exclusive_only=True,
        edge_trim=0.0,
        max_gap=0.0,
        pad=0.0,
        min_duration=0.5,
    )
    # No emitted clip may cover the overlap interval.
    for s in refined:
        assert s.purity == 1.0
        assert s.end <= 1.5 + 1e-9 or s.start >= 2.5 - 1e-9
    sp0 = [s for s in refined if s.speaker == "SPEAKER_00"]
    assert len(sp0) == 2
    assert sp0[0].start == 0.0 and sp0[0].end == 1.5
    assert sp0[1].start == 2.5 and sp0[1].end == 4.0


def test_label_quality_mixed_when_low_purity():
    segs = [Segment("SPEAKER_00", 0.0, 3.0, purity=0.5)]
    labeled = label_quality(segs, min_duration=2.0, purity_min=0.9)
    assert labeled[0].quality == "mixed"
