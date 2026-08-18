from __future__ import annotations

import sys
import threading
import time
import types

from app.sentry_filter import before_send


def test_before_send_drops_local_postgres_refused():
    class OperationalError(Exception):
        pass

    err = OperationalError(
        'connection to server at "127.0.0.1", port 5434 failed: '
        "could not receive data from server: Connection refused"
    )
    dropped = before_send(
        {"message": "boom"},
        {"exc_info": (OperationalError, err, None)},
    )
    assert dropped is None


def test_before_send_drops_uvicorn_startup_failed_log():
    dropped = before_send(
        {"logentry": {"message": "Application startup failed. Exiting."}},
        {},
    )
    assert dropped is None


def test_before_send_keeps_other_errors():
    event = {"message": "heritage compose failed"}
    assert before_send(event, {}) is event


def _install_fake_firebase(monkeypatch, *, get_app, initialize_app):
    admin = types.ModuleType("firebase_admin")
    creds = types.ModuleType("firebase_admin.credentials")

    class Certificate:
        def __init__(self, _raw):
            pass

    class ApplicationDefault:
        def __init__(self):
            pass

    creds.Certificate = Certificate
    creds.ApplicationDefault = ApplicationDefault
    admin.get_app = get_app
    admin.initialize_app = initialize_app
    admin.credentials = creds
    monkeypatch.setitem(sys.modules, "firebase_admin", admin)
    monkeypatch.setitem(sys.modules, "firebase_admin.credentials", creds)


def _firebase_on(monkeypatch):
    monkeypatch.setattr(
        "app.auth.get_settings",
        lambda: type(
            "S",
            (),
            {
                "firebase_enabled": True,
                "firebase_project_id": "forever-test",
                "firebase_credentials_json": "",
            },
        )(),
    )


def test_init_firebase_is_idempotent(monkeypatch):
    from app import auth as auth_mod

    app = object()
    inits = {"n": 0}

    def get_app():
        if inits["n"] == 0:
            raise ValueError("The default Firebase app does not exist.")
        return app

    def initialize_app(_cred, _options):
        inits["n"] += 1
        if inits["n"] > 1:
            raise ValueError("The default Firebase app already exists.")
        return app

    _firebase_on(monkeypatch)
    _install_fake_firebase(monkeypatch, get_app=get_app, initialize_app=initialize_app)
    auth_mod._firebase_app = None
    first = auth_mod._init_firebase()
    second = auth_mod._init_firebase()
    assert first is second is app
    assert inits["n"] == 1
    auth_mod._firebase_app = None


def test_init_firebase_uses_existing_app_after_race(monkeypatch):
    from app import auth as auth_mod

    app = object()
    inits = {"n": 0}

    def get_app():
        if inits["n"] == 0:
            raise ValueError("The default Firebase app does not exist.")
        return app

    def initialize_app(_cred, _options):
        inits["n"] += 1
        if inits["n"] > 1:
            raise ValueError("The default Firebase app already exists.")
        return app

    _firebase_on(monkeypatch)
    _install_fake_firebase(monkeypatch, get_app=get_app, initialize_app=initialize_app)
    auth_mod._firebase_app = None
    # Simulate another worker winning: cache empty, SDK already has the app.
    inits["n"] = 1
    got = auth_mod._init_firebase()
    assert got is app
    assert inits["n"] == 1
    auth_mod._firebase_app = None


def test_init_firebase_lock_serializes_init(monkeypatch):
    from app import auth as auth_mod

    started = threading.Event()
    release = threading.Event()
    app = object()
    inits = {"n": 0}

    def get_app():
        if inits["n"] == 0:
            raise ValueError("The default Firebase app does not exist.")
        return app

    def initialize_app(_cred, _options):
        inits["n"] += 1
        if inits["n"] == 1:
            started.set()
            release.wait(timeout=2)
            return app
        raise ValueError("The default Firebase app already exists.")

    _firebase_on(monkeypatch)
    _install_fake_firebase(monkeypatch, get_app=get_app, initialize_app=initialize_app)
    auth_mod._firebase_app = None
    errors: list[BaseException] = []

    def run():
        try:
            auth_mod._init_firebase()
        except BaseException as exc:  # noqa: BLE001
            errors.append(exc)

    t1 = threading.Thread(target=run)
    t2 = threading.Thread(target=run)
    t1.start()
    assert started.wait(timeout=2)
    t2.start()
    time.sleep(0.05)
    release.set()
    t1.join(timeout=2)
    t2.join(timeout=2)
    assert errors == []
    assert inits["n"] == 1
    auth_mod._firebase_app = None
