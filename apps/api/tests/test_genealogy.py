"""Genealogy chart — nodes, parent/child, and multiple spouses per person."""

from __future__ import annotations

from fastapi.testclient import TestClient


def _login(client, email: str, name: str) -> str:
    res = client.post(
        "/api/auth/dev-login",
        json={"email": email, "password": "forever123", "name": name},
    )
    assert res.status_code == 200, res.text
    return res.json()["token"]


def _space(client: TestClient, headers: dict) -> str:
    res = client.post("/api/spaces", headers=headers, json={"name": "Nhà họ"})
    assert res.status_code == 200, res.text
    return res.json()["id"]


def test_member_can_read_empty_genealogy(client: TestClient):
    token = _login(client, "gen-read@example.com", "Con")
    headers = {"Authorization": f"Bearer {token}"}
    space_id = _space(client, headers)

    res = client.get(f"/api/spaces/{space_id}/genealogy", headers=headers)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["nodes"] == []
    assert body["edges"] == []


def test_member_cannot_mutate_genealogy(client: TestClient):
    owner_token = _login(client, "gen-owner2@example.com", "Con")
    owner = {"Authorization": f"Bearer {owner_token}"}
    space_id = _space(client, owner)

    member_token = _login(client, "gen-member@example.com", "Mẹ")
    member = {"Authorization": f"Bearer {member_token}"}
    invite = client.post(
        f"/api/spaces/{space_id}/invites",
        headers=owner,
        json={"role": "member"},
    )
    assert invite.status_code == 200, invite.text
    joined = client.post(
        "/api/spaces/join",
        headers=member,
        json={"code": invite.json()["code"]},
    )
    assert joined.status_code == 200, joined.text

    res = client.post(
        f"/api/spaces/{space_id}/genealogy/nodes",
        headers=member,
        json={"display_name": "Cụ"},
    )
    assert res.status_code == 403


def test_owner_builds_tree_with_multiple_spouses(client: TestClient):
    token = _login(client, "gen-owner@example.com", "Con")
    headers = {"Authorization": f"Bearer {token}"}
    space_id = _space(client, headers)

    grandpa = client.post(
        f"/api/spaces/{space_id}/genealogy/nodes",
        headers=headers,
        json={"display_name": "Cụ Nội", "gender_hint": "male", "birth_year": 1890},
    )
    assert grandpa.status_code == 200, grandpa.text
    grandpa_id = grandpa.json()["id"]

    wife1 = client.post(
        f"/api/spaces/{space_id}/genealogy/nodes",
        headers=headers,
        json={"display_name": "Cụ Mẫu (vợ cả)", "gender_hint": "female"},
    )
    wife2 = client.post(
        f"/api/spaces/{space_id}/genealogy/nodes",
        headers=headers,
        json={"display_name": "Thất thế", "gender_hint": "female"},
    )
    assert wife1.status_code == 200, wife1.text
    assert wife2.status_code == 200, wife2.text

    s1 = client.post(
        f"/api/spaces/{space_id}/genealogy/edges",
        headers=headers,
        json={
            "from_node_id": grandpa_id,
            "to_node_id": wife1.json()["id"],
            "kind": "spouse",
            "meta": {"spouse_order": 1, "spouse_label": "Vợ cả"},
        },
    )
    s2 = client.post(
        f"/api/spaces/{space_id}/genealogy/edges",
        headers=headers,
        json={
            "from_node_id": grandpa_id,
            "to_node_id": wife2.json()["id"],
            "kind": "spouse",
            "meta": {"spouse_order": 2, "spouse_label": "Vợ lẽ"},
        },
    )
    assert s1.status_code == 200, s1.text
    assert s2.status_code == 200, s2.text

    child = client.post(
        f"/api/spaces/{space_id}/genealogy/nodes",
        headers=headers,
        json={"display_name": "Ông Nội", "gender_hint": "male", "birth_order": 1},
    )
    assert child.status_code == 200, child.text
    child_id = child.json()["id"]

    parent_edge = client.post(
        f"/api/spaces/{space_id}/genealogy/edges",
        headers=headers,
        json={
            "from_node_id": grandpa_id,
            "to_node_id": child_id,
            "kind": "parent",
            "meta": {"parent_role": "father"},
        },
    )
    assert parent_edge.status_code == 200, parent_edge.text

    tree = client.get(f"/api/spaces/{space_id}/genealogy", headers=headers)
    assert tree.status_code == 200, tree.text
    payload = tree.json()
    assert len(payload["nodes"]) == 4
    spouse_edges = [e for e in payload["edges"] if e["kind"] == "spouse"]
    assert len(spouse_edges) == 2
    assert {e["meta"].get("spouse_label") for e in spouse_edges} == {"Vợ cả", "Vợ lẽ"}

    dup = client.post(
        f"/api/spaces/{space_id}/genealogy/edges",
        headers=headers,
        json={
            "from_node_id": grandpa_id,
            "to_node_id": wife1.json()["id"],
            "kind": "spouse",
        },
    )
    assert dup.status_code == 400


def test_death_date_writes_family_calendar(client: TestClient):
    token = _login(client, "gen-death@example.com", "Con")
    headers = {"Authorization": f"Bearer {token}"}
    space_id = _space(client, headers)

    node = client.post(
        f"/api/spaces/{space_id}/genealogy/nodes",
        headers=headers,
        json={
            "display_name": "Cụ Nghiên",
            "gender_hint": "male",
            "death_date": "1971-03-12",
        },
    )
    assert node.status_code == 200, node.text
    body = node.json()
    assert body["death_date"] == "1971-03-12"
    assert body["death_year"] == 1971

    memories = client.get(f"/api/spaces/{space_id}/memories", headers=headers)
    assert memories.status_code == 200, memories.text
    miles = [m for m in memories.json()["memories"] if m["kind"] == "milestone"]
    assert len(miles) == 1
    mile = miles[0]
    assert mile["title"].startswith("Ngày mất")
    assert "lich:mat" in mile["tags"]
    assert f"gia-pha:{body['id']}" in mile["tags"]
    assert mile["occurred_at"].startswith("1971-03-12")

    again = client.patch(
        f"/api/spaces/{space_id}/genealogy/nodes/{body['id']}",
        headers=headers,
        json={"death_date": "1971-03-15"},
    )
    assert again.status_code == 200, again.text
    memories2 = client.get(f"/api/spaces/{space_id}/memories", headers=headers)
    miles2 = [m for m in memories2.json()["memories"] if m["kind"] == "milestone"]
    assert len(miles2) == 1
    assert miles2[0]["occurred_at"].startswith("1971-03-15")


def test_delete_node_removes_edges(client: TestClient):
    token = _login(client, "gen-del@example.com", "Con")
    headers = {"Authorization": f"Bearer {token}"}
    space_id = _space(client, headers)

    parent = client.post(
        f"/api/spaces/{space_id}/genealogy/nodes",
        headers=headers,
        json={"display_name": "Bố"},
    )
    child = client.post(
        f"/api/spaces/{space_id}/genealogy/nodes",
        headers=headers,
        json={"display_name": "Con"},
    )
    assert parent.status_code == 200
    assert child.status_code == 200

    edge = client.post(
        f"/api/spaces/{space_id}/genealogy/edges",
        headers=headers,
        json={
            "from_node_id": parent.json()["id"],
            "to_node_id": child.json()["id"],
            "kind": "parent",
        },
    )
    assert edge.status_code == 200

    deleted = client.delete(
        f"/api/spaces/{space_id}/genealogy/nodes/{parent.json()['id']}",
        headers=headers,
    )
    assert deleted.status_code == 200

    tree = client.get(f"/api/spaces/{space_id}/genealogy", headers=headers)
    assert tree.status_code == 200
    assert len(tree.json()["nodes"]) == 1
    assert tree.json()["edges"] == []


_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
    b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


def test_node_photo_upload_and_delete(client: TestClient):
    token = _login(client, "gen-photo@example.com", "Con")
    headers = {"Authorization": f"Bearer {token}"}
    space_id = _space(client, headers)
    node = client.post(
        f"/api/spaces/{space_id}/genealogy/nodes",
        headers=headers,
        json={"display_name": "Cụ"},
    )
    assert node.status_code == 200, node.text
    node_id = node.json()["id"]
    assert node.json()["has_photo"] is False

    uploaded = client.post(
        f"/api/spaces/{space_id}/genealogy/nodes/{node_id}/photo",
        headers=headers,
        files={"file": ("mo.png", _PNG, "image/png")},
    )
    assert uploaded.status_code == 200, uploaded.text
    assert uploaded.json()["has_photo"] is True
    assert uploaded.json()["photo_mime"] == "image/png"

    photo = client.get(
        f"/api/spaces/{space_id}/genealogy/nodes/{node_id}/photo",
        headers=headers,
    )
    assert photo.status_code == 200, photo.text
    assert photo.content == _PNG

    removed = client.delete(
        f"/api/spaces/{space_id}/genealogy/nodes/{node_id}/photo",
        headers=headers,
    )
    assert removed.status_code == 200, removed.text
    assert removed.json()["has_photo"] is False
    missing = client.get(
        f"/api/spaces/{space_id}/genealogy/nodes/{node_id}/photo",
        headers=headers,
    )
    assert missing.status_code == 404


def test_con_rieng_is_opt_in_not_default(client: TestClient):
    token = _login(client, "gen-rieng@example.com", "Con")
    headers = {"Authorization": f"Bearer {token}"}
    space_id = _space(client, headers)
    node = client.post(
        f"/api/spaces/{space_id}/genealogy/nodes",
        headers=headers,
        json={"display_name": "Cô Tâm"},
    )
    assert node.status_code == 200, node.text
    assert node.json()["con_rieng"] is False

    marked = client.patch(
        f"/api/spaces/{space_id}/genealogy/nodes/{node.json()['id']}",
        headers=headers,
        json={"con_rieng": True},
    )
    assert marked.status_code == 200, marked.text
    assert marked.json()["con_rieng"] is True
