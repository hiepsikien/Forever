def test_update_handle(client):
    login = client.post(
        "/api/auth/dev-login",
        json={"email": "handle@example.com", "password": "forever123", "name": "An"},
    )
    assert login.status_code == 200
    token = login.json()["token"]
    user = login.json()["user"]
    assert user.get("handle")

    headers = {"Authorization": f"Bearer {token}"}
    updated = client.patch(
        "/api/auth/me",
        headers=headers,
        json={"handle": "an_forever"},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["handle"] == "an_forever"
