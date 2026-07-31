def _login(client, email: str, name: str) -> str:
    res = client.post(
        "/api/auth/dev-login",
        json={"email": email, "password": "forever123", "name": name},
    )
    assert res.status_code == 200, res.text
    return res.json()["token"]


def test_steward_succession_flow(client):
    owner_token = _login(client, "steward-owner@example.com", "Con")
    owner_headers = {"Authorization": f"Bearer {owner_token}"}
    space = client.post(
        "/api/spaces", headers=owner_headers, json={"name": "Nhà kế nhiệm"}
    ).json()
    space_id = space["id"]

    invite = client.post(
        f"/api/spaces/{space_id}/invites", headers=owner_headers
    ).json()

    nominee_token = _login(client, "steward-nominee@example.com", "Mẹ")
    nominee_headers = {"Authorization": f"Bearer {nominee_token}"}
    joined = client.post(
        "/api/spaces/join",
        headers=nominee_headers,
        json={"code": invite["code"]},
    )
    assert joined.status_code == 200
    nominee_id = client.get("/api/auth/me", headers=nominee_headers).json()["id"]

    status = client.get(f"/api/spaces/{space_id}/stewardship", headers=owner_headers)
    assert status.status_code == 200
    assert status.json()["is_steward"] is True

    nominated = client.post(
        f"/api/spaces/{space_id}/stewardship/nominate",
        headers=owner_headers,
        json={"user_id": nominee_id, "note": "Con trao quyền giữ nhà cho mẹ"},
    )
    assert nominated.status_code == 200, nominated.text
    assert nominated.json()["status"] == "pending"

    accepted = client.post(
        f"/api/spaces/{space_id}/stewardship/accept",
        headers=nominee_headers,
    )
    assert accepted.status_code == 200
    assert accepted.json()["status"] == "accepted"

    activated = client.post(
        f"/api/spaces/{space_id}/stewardship/activate",
        headers=nominee_headers,
    )
    assert activated.status_code == 200, activated.text
    assert activated.json()["steward"]["id"] == nominee_id

    after = client.get(f"/api/spaces/{space_id}/stewardship", headers=nominee_headers)
    assert after.json()["is_steward"] is True
    assert after.json()["succession"] is None or after.json()["succession"]["status"] == "activated"

    space_view = client.get(f"/api/spaces/{space_id}", headers=nominee_headers).json()
    assert space_view["role"] == "owner"
