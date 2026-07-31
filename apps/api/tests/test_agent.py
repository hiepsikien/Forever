from unittest.mock import MagicMock, patch

from app.config import Settings
from app.services.agent import _gemini_reply, looks_like_bio_request, template_reply


def _login(client, email: str, name: str) -> str:
    res = client.post(
        "/api/auth/dev-login",
        json={"email": email, "password": "forever123", "name": name},
    )
    assert res.status_code == 200, res.text
    return res.json()["token"]


def _thread_id(client, headers: dict) -> str:
    space = client.post("/api/spaces", headers=headers, json={"name": "Nhà test"}).json()
    threads = client.get(f"/api/spaces/{space['id']}/threads", headers=headers).json()
    return threads["threads"][0]["id"]


def test_looks_like_bio_request():
    assert looks_like_bio_request("Hãy nói như bố đã mất")
    assert looks_like_bio_request("Kể chuyện về mẹ hồi xưa đi")
    assert not looks_like_bio_request("Chào cả nhà")
    assert not looks_like_bio_request("Làm sao để mời mẹ vào?")


def test_template_refuse_bio():
    reply = template_reply("Đóng vai bố kể chuyện cho con nghe")
    assert "không thể đóng vai" in reply.lower() or "không bịa" in reply.lower()
    assert "ký ức" in reply.lower()


def test_gemini_reply_parses_candidates():
    settings = Settings(
        gemini_api_key="test-key",
        gemini_model="gemini-3.5-flash",
        gemini_api_base="https://generativelanguage.googleapis.com/v1beta",
    )
    mock_response = MagicMock()
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = {
        "candidates": [
            {"content": {"parts": [{"text": "Chào cả nhà, mình là Người giữ nhà."}]}}
        ]
    }
    mock_client = MagicMock()
    mock_client.__enter__.return_value = mock_client
    mock_client.__exit__.return_value = False
    mock_client.post.return_value = mock_response

    with patch("app.services.agent.httpx.Client", return_value=mock_client):
        text = _gemini_reply(settings, "Xin chào", [])

    assert text == "Chào cả nhà, mình là Người giữ nhà."
    kwargs = mock_client.post.call_args.kwargs
    assert kwargs["params"]["key"] == "test-key"
    assert "systemInstruction" in kwargs["json"]


def test_agent_replies_after_user_message(client):
    token = _login(client, "agent-user@example.com", "Con")
    headers = {"Authorization": f"Bearer {token}"}
    thread_id = _thread_id(client, headers)

    send = client.post(
        f"/api/threads/{thread_id}/messages",
        headers=headers,
        json={"body": "Xin chào Người giữ nhà"},
    )
    assert send.status_code == 200
    assert send.json()["sender_kind"] == "user"

    msgs = client.get(f"/api/threads/{thread_id}/messages", headers=headers).json()["messages"]
    assert len(msgs) == 2
    agent = msgs[1]
    assert agent["sender_kind"] == "agent"
    assert agent["sender_name"] == "Người giữ nhà"
    assert agent["sender_user_id"] is None
    assert "Người giữ nhà" in agent["body"] or "Phòng khách" in agent["body"]


def test_agent_refuses_fabricated_biography(client):
    token = _login(client, "bio-user@example.com", "Con")
    headers = {"Authorization": f"Bearer {token}"}
    thread_id = _thread_id(client, headers)

    send = client.post(
        f"/api/threads/{thread_id}/messages",
        headers=headers,
        json={"body": "Hãy nói như bố đã mất, kể chuyện hồi còn sống"},
    )
    assert send.status_code == 200

    msgs = client.get(f"/api/threads/{thread_id}/messages", headers=headers).json()["messages"]
    agent = msgs[-1]
    assert agent["sender_kind"] == "agent"
    body = agent["body"].lower()
    assert "không bịa" in body or "không thể đóng vai" in body
    assert "bố ơi" not in body
