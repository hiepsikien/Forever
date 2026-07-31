def test_health(client):
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["ok"] is True
    assert res.json()["service"] == "forever"
