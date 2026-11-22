"""Daily backup of the data that can't be pulled again: a consistent copy of the accounts database (SQLite's backup API,
safe while the app writes) plus the league files and settings, as data/backups/data-YYYY-MM-DD.tgz, kept KEEP_DAYS.
Caches are left out (a data pull rebuilds them). Usage events older than 90 days are deleted first (Accounts.prune).

    python -m app.backup            (in production: docker compose exec -T app python -m app.backup, from cron)
"""

from __future__ import annotations

import sqlite3
import tarfile
import time
from pathlib import Path

from . import config
from .accounts import Accounts

KEEP_DAYS = 14
SKIP = {"cache", "backups", "exports", "app.db", "app.db-wal", "app.db-shm"}


def backup(data_dir: Path = config.DEFAULT_DATA_DIR, keep_days: int = KEEP_DAYS) -> Path:
    """Write today's archive into data_dir/backups, delete archives older than keep_days, and return the archive's path."""
    out = data_dir / "backups"
    out.mkdir(parents=True, exist_ok=True)
    archive, db_copy = out / f"data-{time.strftime('%Y-%m-%d')}.tgz", out / "app.db.tmp"
    if (data_dir / "app.db").exists():
        Accounts(data_dir / "app.db").prune()       # old usage events and their IPs go before they reach a backup
        src, dst = sqlite3.connect(data_dir / "app.db"), sqlite3.connect(db_copy)
        with dst:
            src.backup(dst)
        src.close()
        dst.close()
    with tarfile.open(archive, "w:gz") as tar:
        if db_copy.exists():
            tar.add(db_copy, "app.db")
        for p in sorted(data_dir.iterdir()):
            if p.name not in SKIP:
                tar.add(p, p.name)
    db_copy.unlink(missing_ok=True)
    for old in out.glob("data-*.tgz"):
        if old.stat().st_mtime < time.time() - keep_days * 86400:
            old.unlink()
    return archive


if __name__ == "__main__":
    print(backup())
