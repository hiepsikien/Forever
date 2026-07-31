from app.seed import seed_interview_prompts
from app.db import SessionLocal


def _login(client, email: str, name: str) -> str:
    res = client.post(
        "/api/auth/dev-login",
        json={"email": email, "password": "forever123", "name": name},
    )
    assert res.status_code == 200, res.text
    return res.json()["token"]


def test_list_prompts_and_text_answer(client):
    db = SessionLocal()
    try:
        seed_interview_prompts(db)
    finally:
        db.close()

    token = _login(client, "interview@example.com", "Con")
    headers = {"Authorization": f"Bearer {token}"}
    space = client.post("/api/spaces", headers=headers, json={"name": "Nhà capsule"}).json()
    space_id = space["id"]

    prompts_res = client.get(
        f"/api/spaces/{space_id}/interview/prompts",
        headers=headers,
    )
    assert prompts_res.status_code == 200, prompts_res.text
    prompts = prompts_res.json()["prompts"]
    assert len(prompts) >= 1
    assert prompts[0]["answered"] is False
    prompt_id = prompts[0]["id"]

    answer = client.post(
        f"/api/spaces/{space_id}/interview/prompts/{prompt_id}/answers",
        headers=headers,
        json={"body": "Canh chua và cơm cháy"},
    )
    assert answer.status_code == 200, answer.text
    payload = answer.json()
    assert payload["prompt_id"] == prompt_id
    assert payload["memory"]["kind"] == "note"
    assert "Canh chua" in payload["memory"]["body"]
    assert payload["memory"]["tags"] == "time-capsule"

    again = client.get(f"/api/spaces/{space_id}/interview/prompts", headers=headers)
    matched = next(p for p in again.json()["prompts"] if p["id"] == prompt_id)
    assert matched["answered"] is True
    assert matched["memory_item_id"] == payload["memory"]["id"]

    memories = client.get(f"/api/spaces/{space_id}/memories", headers=headers).json()["memories"]
    assert any(m["id"] == payload["memory"]["id"] for m in memories)

    dup = client.post(
        f"/api/spaces/{space_id}/interview/prompts/{prompt_id}/answers",
        headers=headers,
        json={"body": "Trả lời lần hai"},
    )
    assert dup.status_code == 409
