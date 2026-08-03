def test_health(client):
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["ok"] is True
    assert res.json()["service"] == "forever"


def test_favicon(client):
    res = client.get("/favicon.ico")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("image/")
    assert len(res.content) > 0


def test_brand_og_banner(client):
    res = client.get("/brand/og-banner.png")
    assert res.status_code == 200
    assert "image/png" in res.headers["content-type"]
    assert res.content[:8] == b"\x89PNG\r\n\x1a\n"
