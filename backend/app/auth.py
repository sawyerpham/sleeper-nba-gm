"""Sign-in by emailed magic link (Resend), the session cookie, and the access checks every API route goes through (P39).

The emailed link opens the app at /?login=<token> and the page POSTs the token to /api/auth/verify: a GET would let a mail
scanner that follows links use up the token. Without RESEND_API_KEY the link is logged instead of sent (local dev).

Env: RESEND_API_KEY, MAIL_FROM (a sender on a domain verified in Resend), APP_URL (where the link points, default
http://localhost:5173), ADMIN_EMAILS (comma-separated)."""

from __future__ import annotations

import ipaddress
import logging
import os
from typing import Literal

import requests
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from .accounts import SESSION_TTL, RateLimited
from .core.api.deps import get_state

log = logging.getLogger(__name__)
COOKIE = "session"
RESEND = "https://api.resend.com/emails"
GEO = "https://ipwho.is/{}?fields=success,city,region,country_code,connection"
GEO_PER_LOAD = 10  # new IPs looked up per admin stats load (each one once; the result is saved)

router = APIRouter(prefix="/auth", tags=["auth"])


def app_url() -> str:
    """The app's public address, no trailing slash."""
    return os.environ.get("APP_URL", "http://localhost:5173").rstrip("/")


def client_ip(request: Request) -> str | None:
    """The caller's IP (uvicorn resolves X-Forwarded-For from a trusted proxy into request.client)."""
    return request.client.host if request.client else None


def send_login_email(email: str, link: str) -> None:
    """Email the sign-in link through Resend; log it when RESEND_API_KEY isn't set. Raises on a Resend error."""
    key = os.environ.get("RESEND_API_KEY")
    if not key:
        log.warning("RESEND_API_KEY not set; sign-in link for %s: %s", email, link)
        return
    text = f"Sign in to NBA Fantasy:\n\n{link}\n\nThe link works once and expires in 15 minutes. If you didn't ask for it, ignore this email."
    html = (f'<p>Sign in to NBA Fantasy:</p><p><a href="{link}">Sign in</a></p>'
            "<p>The link works once and expires in 15 minutes. If you didn't ask for it, ignore this email.</p>")
    r = requests.post(RESEND, headers={"Authorization": f"Bearer {key}"}, timeout=10,
                      json={"from": os.environ.get("MAIL_FROM", "NBA Fantasy <onboarding@resend.dev>"), "to": [email],
                            "subject": "Your NBA Fantasy sign-in link", "text": text, "html": html})
    r.raise_for_status()


def current_user(request: Request) -> dict:
    """The signed-in user (401 otherwise). A route with a `league_id` (path or query) also needs the user to own that
    league: someone else's league is a 404, the same as one that doesn't exist."""
    accounts = get_state(request).accounts
    user = accounts.user_for_session(request.cookies.get(COOKIE), client_ip(request))
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in first")
    lid = request.path_params.get("league_id") or request.query_params.get("league_id")
    if lid and accounts.owner(lid) != user["id"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"unknown league {lid}")
    request.state.user = user
    return user


def require_telegram(user: dict = Depends(current_user)) -> dict:
    """The signed-in user when their account type includes Telegram alerts (premium, admin, owner); 403 otherwise."""
    if not user["telegram"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Telegram alerts come with a premium account")
    return user


def require_admin(user: dict = Depends(current_user)) -> dict:
    """The signed-in user when they are an admin; 403 otherwise."""
    if not user["admin"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admins only")
    return user


class LoginIn(BaseModel):
    """POST /auth/login body."""
    email: str


class VerifyIn(BaseModel):
    """POST /auth/verify body."""
    token: str


@router.post("/login")
def login(body: LoginIn, request: Request) -> dict:
    """Email a sign-in link. The answer is the same whether or not the email has an account."""
    accounts = get_state(request).accounts
    try:
        token = accounts.request_login(body.email, client_ip(request))
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    except RateLimited as exc:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, str(exc)) from exc
    try:
        send_login_email(body.email.strip().lower(), f"{app_url()}/?login={token}")
    except requests.RequestException as exc:
        log.warning("login email failed: %s", exc)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Couldn't send the email, try again") from exc
    return {"sent": True}


@router.post("/verify")
def verify(body: VerifyIn, request: Request, response: Response) -> dict:
    """Trade a sign-in token for a session cookie. An owner's sign-in also takes over the leagues that have no owner (the
    data from before accounts)."""
    state = get_state(request)
    got = state.accounts.verify_login(body.token, client_ip(request))
    if got is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That sign-in link is used or expired. Ask for a new one.")
    session, user = got
    if user["kind"] == "owner":
        claimed = state.accounts.claim_unowned(state.leagues.list_ids(), user["id"])
        if claimed:
            log.info("admin %s took over %s", user["email"], claimed)
    response.set_cookie(COOKIE, session, max_age=SESSION_TTL, httponly=True, samesite="lax",
                        secure=app_url().startswith("https://"), path="/")
    return me_of(user)


@router.post("/logout")
def logout(request: Request, response: Response) -> dict:
    """End the session and clear the cookie."""
    get_state(request).accounts.logout(request.cookies.get(COOKIE))
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


def me_of(user: dict) -> dict:
    """What the frontend needs about the signed-in user."""
    return {"id": user["id"], "email": user["email"], "admin": user["admin"], "telegram": user["telegram"], "kind": user["kind"]}


@router.get("/me")
def me(user: dict = Depends(current_user)) -> dict:
    """The signed-in user (401 when signed out)."""
    return me_of(user)


admin_router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


class BotTokenIn(BaseModel):
    """PUT /admin/telegram body: a bot token from @BotFather, or "" to remove the bot."""
    token: str


@admin_router.get("/telegram")
def admin_telegram(request: Request) -> dict:
    """The bot alerts go out from (its @username, never the token), where its token comes from, and how many chats are linked."""
    from . import notify

    state = get_state(request)
    saved = state.accounts.setting(notify.TOKEN_SETTING)
    return {"configured": notify.configured(), "bot": notify.bot_username() if notify.configured() else None,
            "source": "app" if saved else ".env" if notify.configured() else None,
            "linked": state.accounts.stats()["telegram_linked"]}


@admin_router.put("/telegram")
def admin_set_telegram(body: BotTokenIn, request: Request) -> dict:
    """Switch the bot alerts go out from ("" removes it); every linked chat is unlinked when it changes. 400 for a token
    Telegram doesn't accept."""
    from . import notify

    try:
        return notify.set_token(get_state(request).accounts, body.token)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


class RoleIn(BaseModel):
    """PUT /admin/users/{id}/role body."""
    role: Literal["user", "premium", "admin"]


@admin_router.put("/users/{user_id}/role")
def admin_set_role(user_id: int, body: RoleIn, request: Request) -> dict:
    """Set a user's type (user, premium or admin). Owners (ADMIN_EMAILS) can't be changed here; 400 for them, 404 for no such user."""
    accounts = get_state(request).accounts
    try:
        user = accounts.set_role(user_id, body.role)
    except LookupError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such user") from exc
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    log.info("%s set %s to %s", request.state.user["email"], user["email"], body.role)
    return {"id": user["id"], "email": user["email"], "role": user["kind"]}


def lookup_geo(ip: str) -> dict | None:
    """Where an IP is, from ipwho.is: {ip, place ("City, Region, CC"), isp}; None for a private address or a failed lookup."""
    try:
        if not ipaddress.ip_address(ip).is_global:
            return None
        r = requests.get(GEO.format(ip), timeout=4).json()
    except (ValueError, requests.RequestException):
        return None
    if not r.get("success"):
        return None
    place = ", ".join(x for x in (r.get("city"), r.get("region"), r.get("country_code")) if x)
    return {"ip": ip, "place": place, "isp": (r.get("connection") or {}).get("isp")}


@admin_router.get("/stats")
def admin_stats(request: Request) -> dict:
    """The admin panel's numbers: accounts.stats() plus the size of the player pool and how many leagues are on disk. Users
    whose last IP has no saved location get it looked up (GEO_PER_LOAD per load)."""
    state = get_state(request)
    stats = state.accounts.stats()
    for u in [u for u in stats["recent"] if u["ip"] and (u["geo"] or {}).get("ip") != u["ip"]][:GEO_PER_LOAD]:
        geo = lookup_geo(u["ip"])
        if geo:
            state.accounts.set_geo(u["id"], geo)
            u["geo"] = geo
    return {**stats, "players": len(state.players), "leagues_on_disk": len(state.leagues.list_ids())}


class TelegramMessageIn(BaseModel):
    """POST /admin/telegram/send body: the text, and one user's id (None = everyone with Telegram linked)."""
    text: str = Field(min_length=1, max_length=2000)
    user_id: int | None = None


@admin_router.post("/telegram/send")
def admin_send_telegram(body: TelegramMessageIn, request: Request) -> dict:
    """Send a message from the bot to one linked user or all of them (sent as plain text, so nothing in it is markup).
    400 without a bot or a blank text, 404 when that user has no linked chat."""
    from . import notify

    accounts = get_state(request).accounts
    text = body.text.strip()
    if not notify.configured() or not text:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No bot set" if text else "Write a message first")
    to = [u for u in accounts.telegram_recipients() if body.user_id is None or u["id"] == body.user_id]
    if body.user_id is not None and not to:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That user has no linked Telegram")
    sent = sum(notify.send(text, u["tg_chat_id"], accounts) for u in to)
    log.info("%s sent a Telegram message to %s of %s", request.state.user["email"], sent, len(to))
    return {"sent": sent, "of": len(to)}
