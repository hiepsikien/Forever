import os

os.environ["AUTH_DEV_MODE"] = "true"
os.environ["SEED_DEMO"] = "false"
os.environ["AGENT_ENABLED"] = "true"
os.environ["GEMINI_API_KEY"] = ""
os.environ["DATABASE_URL"] = "sqlite+pysqlite:///:memory:"

import pytest
from fastapi.testclient import TestClient

from app.db import Base, engine
from app.main import app


@pytest.fixture(scope="session", autouse=True)
def prepare_db():
    if engine.url.get_backend_name() == "sqlite":
        from sqlalchemy import event

        @event.listens_for(engine, "connect")
        def _sqlite_fk(dbapi_conn, _connection_record):
            cursor = dbapi_conn.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def client():
    with TestClient(app) as test_client:
        yield test_client
