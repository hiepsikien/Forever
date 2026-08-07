def _login(client, email: str, name: str) -> str:
    res = client.post(
        "/api/auth/dev-login",
        json={"email": email, "password": "forever123", "name": name},
    )
    assert res.status_code == 200, res.text
    return res.json()["token"]


def test_create_space_and_chat(client):
    token = _login(client, "child@example.com", "Con")
    headers = {"Authorization": f"Bearer {token}"}

    space_res = client.post("/api/spaces", headers=headers, json={"name": "Nhà mình"})
    assert space_res.status_code == 200
    space = space_res.json()
    assert space["name"] == "Nhà mình"
    assert space["role"] == "owner"

    threads_res = client.get(f"/api/spaces/{space['id']}/threads", headers=headers)
    assert threads_res.status_code == 200
    threads = threads_res.json()["threads"]
    assert len(threads) == 1
    thread_id = threads[0]["id"]

    send_res = client.post(
        f"/api/threads/{thread_id}/messages",
        headers=headers,
        json={"body": "Xin chào cả nhà"},
    )
    assert send_res.status_code == 200
    assert send_res.json()["body"] == "Xin chào cả nhà"

    msgs = client.get(f"/api/threads/{thread_id}/messages", headers=headers)
    assert msgs.status_code == 200
    bodies = msgs.json()["messages"]
    assert len(bodies) == 2
    assert bodies[0]["body"] == "Xin chào cả nhà"
    assert bodies[1]["sender_kind"] == "agent"
    assert bodies[1]["sender_name"] == "Người giữ nhà"

    invite = client.post(f"/api/spaces/{space['id']}/invites", headers=headers)
    assert invite.status_code == 200
    code = invite.json()["code"]

    mother_token = _login(client, "mother@example.com", "Mẹ")
    mother_headers = {"Authorization": f"Bearer {mother_token}"}
    joined = client.post(
        "/api/spaces/join",
        headers=mother_headers,
        json={"code": code},
    )
    assert joined.status_code == 200
    assert joined.json()["role"] == "member"

    mother_msg = client.post(
        f"/api/threads/{thread_id}/messages",
        headers=mother_headers,
        json={"body": "Mẹ vào rồi con ơi"},
    )
    assert mother_msg.status_code == 200

    # Phòng khách belongs to the family: nobody answers a message between them.
    msgs = client.get(f"/api/threads/{thread_id}/messages", headers=headers)
    assert len(msgs.json()["messages"]) == 3

    called = client.post(
        f"/api/threads/{thread_id}/messages",
        headers=mother_headers,
        json={"body": "@giunhà giúp mẹ mời thêm người với"},
    )
    assert called.status_code == 200

    bodies = client.get(f"/api/threads/{thread_id}/messages", headers=headers).json()[
        "messages"
    ]
    assert len(bodies) == 5
    assert bodies[-1]["sender_kind"] == "agent"
