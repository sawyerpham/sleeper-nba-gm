"""One server-wide budget for Sleeper calls. Sleeper asks callers to stay under about 1000 calls a minute per IP (or the IP
can be blocked), and every user's calls leave from the server's one IP. The budget is a sliding 60 s window: page loads
may use up to CAP calls a minute, background work (the Telegram watcher) only up to BACKGROUND_CAP, so the watcher can
never take the room page loads need. A call over its cap waits for the window to free up instead of failing.

`LimitedSession` applies it to any requests made to a Sleeper host; mark background work with `with priority(True):`
in the thread that makes the call."""

from __future__ import annotations

import threading
import time
from collections import deque
from contextlib import contextmanager
from urllib.parse import urlsplit

import requests

CAP = 600
BACKGROUND_CAP = 400
WINDOW_S = 60.0
SLEEPER_HOSTS = {"api.sleeper.app", "api.sleeper.com"}


class SleeperLimiter:
    """A sliding-window call budget with a lower cap for background calls."""

    def __init__(self, cap: int = CAP, background_cap: int = BACKGROUND_CAP, window_s: float = WINDOW_S, clock=time.monotonic, sleep=time.sleep) -> None:
        """Caps per window; `clock` and `sleep` are injectable for tests."""
        self.cap, self.background_cap, self.window_s = cap, background_cap, window_s
        self._clock, self._sleep = clock, sleep
        self._calls: deque[float] = deque()
        self._lock = threading.Lock()
        self.waited = 0

    def acquire(self, background: bool = False) -> None:
        """Take one call from the budget, waiting while this priority's cap is used up."""
        cap = self.background_cap if background else self.cap
        while True:
            with self._lock:
                now = self._clock()
                while self._calls and self._calls[0] <= now - self.window_s:
                    self._calls.popleft()
                if len(self._calls) < cap:
                    self._calls.append(now)
                    return
                wait = self._calls[len(self._calls) - cap] + self.window_s - now
                self.waited += 1
            self._sleep(max(wait, 0.05))

    def used(self) -> int:
        """Calls made in the current window."""
        with self._lock:
            now = self._clock()
            return sum(1 for t in self._calls if t > now - self.window_s)


LIMITER = SleeperLimiter()
_local = threading.local()


@contextmanager
def priority(background: bool):
    """Mark the Sleeper calls this thread makes inside the block as background (or not)."""
    old = getattr(_local, "background", False)
    _local.background = background
    try:
        yield
    finally:
        _local.background = old


class LimitedSession(requests.Session):
    """A requests session whose calls to a Sleeper host go through LIMITER (other hosts, e.g. ESPN, are not counted)."""

    def request(self, method, url, *args, **kwargs):
        """Wait for the Sleeper budget, then send the request."""
        if (urlsplit(str(url)).hostname or "") in SLEEPER_HOSTS:
            LIMITER.acquire(getattr(_local, "background", False))
        return super().request(method, url, *args, **kwargs)
