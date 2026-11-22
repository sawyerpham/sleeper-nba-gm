import os
from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="session")
def fixtures_dir() -> Path:
    """The captured-API fixtures directory."""
    return FIXTURES


ADMIN = "admin@test.local"
os.environ["ADMIN_EMAILS"] = ADMIN
os.environ.pop("RESEND_API_KEY", None)


def sign_in(client, email: str = ADMIN) -> dict:
    """Sign `client` in as `email` through the real verify route (the login token comes straight from the accounts store,
    standing in for the email); returns /auth/me."""
    state = client.app.state.app_state
    r = client.post("/api/auth/verify", json={"token": state.accounts.request_login(email, None)})
    assert r.status_code == 200, r.text
    return r.json()
