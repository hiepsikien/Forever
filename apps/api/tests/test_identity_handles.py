"""IdentityProfile @handle — space-scoped tagging / deep links."""


def _login(client, email: str, name: str):
    res = client.post(
        "/api/auth/dev-login",
        json={"email": email, "password": "forever123", "name": name},
    )
    assert res.status_code == 200, res.text
    return res.json()["token"], res.json()["user"]


def _space(client, token: str):
    headers = {"Authorization": f"Bearer {token}"}
    created = client.post(
        "/api/spaces",
        headers=headers,
        json={"name": "Nhà handle test"},
    )
    assert created.status_code == 200, created.text
    return created.json()["id"], headers


def test_create_identity_allocates_handle(client):
    token, _ = _login(client, "handle-id@example.com", "Steward")
    space_id, headers = _space(client, token)
    created = client.post(
        f"/api/spaces/{space_id}/identities",
        headers=headers,
        json={
            "display_name": "Bố Triệu",
            "relation_label": "Bố",
            "status": "remembered",
            "handle": "bo_trieu",
        },
    )
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["handle"] == "bo_trieu"


def test_identity_handle_unique_in_space(client):
    token, _ = _login(client, "handle-clash@example.com", "Steward")
    space_id, headers = _space(client, token)
    first = client.post(
        f"/api/spaces/{space_id}/identities",
        headers=headers,
        json={
            "display_name": "Mẹ Định",
            "relation_label": "Mẹ",
            "status": "remembered",
            "handle": "me_dinh",
        },
    )
    assert first.status_code == 200, first.text
    second = client.post(
        f"/api/spaces/{space_id}/identities",
        headers=headers,
        json={
            "display_name": "Người khác",
            "relation_label": "Cô",
            "status": "remembered",
            "handle": "me_dinh",
        },
    )
    # allocate_identity_handle suffixes on clash at create time
    assert second.status_code == 200, second.text
    assert second.json()["handle"] != "me_dinh"
    assert second.json()["handle"].startswith("me_dinh")


def test_resolve_handle_to_memorial(client):
    token, _ = _login(client, "handle-resolve@example.com", "Steward")
    space_id, headers = _space(client, token)
    created = client.post(
        f"/api/spaces/{space_id}/identities",
        headers=headers,
        json={
            "display_name": "Bố Triệu",
            "relation_label": "Bố",
            "status": "remembered",
            "handle": "bo_trieu_r",
        },
    )
    assert created.status_code == 200, created.text
    identity_id = created.json()["id"]
    resolved = client.get(
        f"/api/spaces/{space_id}/handles/bo_trieu_r",
        headers=headers,
    )
    assert resolved.status_code == 200, resolved.text
    payload = resolved.json()
    assert payload["kind"] == "identity"
    assert payload["id"] == identity_id
    assert payload["library_path"] == f"/library/{space_id}/person/{identity_id}"


def test_user_handle_syncs_linked_identity(client):
    token, user = _login(client, "handle-sync@example.com", "An")
    space_id, headers = _space(client, token)
    # Ensure self mirror exists
    listed = client.get(f"/api/spaces/{space_id}/identities", headers=headers)
    assert listed.status_code == 200
    mirror = next(
        (i for i in listed.json()["identities"] if i.get("linked_user_id") == user["id"]),
        None,
    )
    assert mirror is not None
    updated = client.patch(
        "/api/auth/me",
        headers=headers,
        json={"handle": "an_synced"},
    )
    assert updated.status_code == 200, updated.text
    listed2 = client.get(f"/api/spaces/{space_id}/identities", headers=headers)
    mirror2 = next(
        i
        for i in listed2.json()["identities"]
        if i.get("linked_user_id") == user["id"]
    )
    assert mirror2["handle"] == "an_synced"
