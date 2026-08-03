import shutil
import subprocess
from pathlib import Path


def _login(client, email: str, name: str) -> str:
    res = client.post(
        "/api/auth/dev-login",
        json={"email": email, "password": "forever123", "name": name},
    )
    assert res.status_code == 200, res.text
    return res.json()["token"]


def _make_test_mp4(path: Path) -> None:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return
    proc = subprocess.run(
        [
            ffmpeg,
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc=duration=2:size=320x240:rate=30",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            str(path),
        ],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, proc.stderr


def test_video_thumbnail_from_phone_mp4(client, tmp_path, monkeypatch):
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return

    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))
    from app.config import get_settings

    get_settings.cache_clear()

    token = _login(client, "thumb@example.com", "Con")
    headers = {"Authorization": f"Bearer {token}"}
    space = client.post("/api/spaces", headers=headers, json={"name": "Thumb"}).json()

    clip = tmp_path / "clip.mp4"
    _make_test_mp4(clip)
    assert clip.exists()

    from io import BytesIO

    uploaded = client.post(
        f"/api/spaces/{space['id']}/memories/upload",
        headers=headers,
        data={"kind": "video", "title": "Clip test"},
        files={"file": ("clip.mp4", BytesIO(clip.read_bytes()), "video/mp4")},
    )
    assert uploaded.status_code == 200, uploaded.text
    memory_id = uploaded.json()["id"]

    res = client.get(f"/api/memories/{memory_id}/thumbnail", headers=headers)
    assert res.status_code == 200, res.text
    assert res.headers["content-type"].startswith("image/jpeg")
    assert len(res.content) > 256

    get_settings.cache_clear()


def test_playback_rejects_invalid_remux_cache(client, tmp_path, monkeypatch):
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return

    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))
    from app.config import get_settings
    from app.services.video_playback import ensure_playback_mp4, is_playable_video

    get_settings.cache_clear()

    space_id = "space123"
    src = tmp_path / space_id / "clip.mp4"
    src.parent.mkdir(parents=True)
    _make_test_mp4(src)

    corrupt = src.parent / "clip.playback.v2.mp4"
    corrupt.write_bytes(b"not-a-real-video-but-large-enough" * 64)
    assert not is_playable_video(corrupt)

    playback = ensure_playback_mp4(f"{space_id}/clip.mp4")
    assert is_playable_video(playback)

    get_settings.cache_clear()
