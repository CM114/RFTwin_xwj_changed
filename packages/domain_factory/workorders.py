"""Persistent work orders for simulated factory faults.

The work-order record is separate from the simulation engine: it never decides
whether equipment has recovered.  A session identifier prevents events from a
new backend process from colliding with an older run that reused the same ID.
"""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator


FAULT_TYPES = {
    "CONVEYOR_JAMMED": "conveyor_jam",
    "TOOL_FAILURE": "tool_failure",
    "ROBOT_ERROR": "amr_fault",
    "COMPRESSOR_FAULT": "compressor_fault",
}


class WorkOrderStore:
    """SQLite-backed incident log with explicit, atomic status transitions."""

    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as db:
            db.execute("""
                CREATE TABLE IF NOT EXISTS work_orders (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL,
                    run_id TEXT NOT NULL,
                    event_seq INTEGER NOT NULL,
                    source_type TEXT NOT NULL,
                    source_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    failure_type TEXT NOT NULL,
                    severity TEXT NOT NULL,
                    cell_id TEXT,
                    description TEXT NOT NULL,
                    status TEXT NOT NULL CHECK(status IN ('OPEN', 'IN_PROGRESS', 'COMPLETED')),
                    assignee TEXT,
                    note TEXT,
                    created_sim_time TEXT NOT NULL,
                    started_sim_time TEXT,
                    completed_sim_time TEXT,
                    created_tick INTEGER NOT NULL,
                    started_tick INTEGER,
                    completed_tick INTEGER,
                    repair_seconds REAL,
                    UNIQUE(session_id, run_id, event_seq)
                )
            """)

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        db = sqlite3.connect(self.path, timeout=5)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def ingest(self, session_id: str, event: dict) -> dict | None:
        """Record a supported fault event once, even if the event is replayed."""
        failure_type = FAULT_TYPES.get(event.get("event_type"))
        if not failure_type:
            return None
        values = (
            session_id, event["run_id"], event["seq"], event["source_type"],
            event["source_id"], event["event_type"], failure_type,
            event["severity"], event.get("cell_id"), event["message"],
            event["sim_time"], event["sim_tick"],
        )
        with self._connect() as db:
            db.execute("""
                INSERT OR IGNORE INTO work_orders (
                    session_id, run_id, event_seq, source_type, source_id, event_type,
                    failure_type, severity, cell_id, description, status,
                    created_sim_time, created_tick
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?)
            """, values)
            row = db.execute(
                "SELECT * FROM work_orders WHERE session_id=? AND run_id=? AND event_seq=?",
                (session_id, event["run_id"], event["seq"]),
            ).fetchone()
            return dict(row)

    def list(self, session_id: str, run_id: str, *, include_history: bool = False) -> list[dict]:
        with self._connect() as db:
            if include_history:
                rows = db.execute("SELECT * FROM work_orders ORDER BY id DESC").fetchall()
            else:
                rows = db.execute(
                    "SELECT * FROM work_orders WHERE session_id=? AND run_id=? ORDER BY id DESC",
                    (session_id, run_id),
                ).fetchall()
            return [dict(row) for row in rows]

    def get(self, order_id: int) -> dict:
        with self._connect() as db:
            row = db.execute("SELECT * FROM work_orders WHERE id=?", (order_id,)).fetchone()
            if row is None:
                raise KeyError(f"work order {order_id} not found")
            return dict(row)

    def start(self, order_id: int, assignee: str, sim_tick: int, sim_time: str) -> dict:
        if not isinstance(assignee, str) or not (1 <= len(assignee.strip()) <= 100):
            raise ValueError("assignee must contain 1–100 characters")
        with self._connect() as db:
            changed = db.execute(
                "UPDATE work_orders SET status='IN_PROGRESS', assignee=?, started_tick=?, "
                "started_sim_time=? WHERE id=? AND status='OPEN'",
                (assignee.strip(), sim_tick, sim_time, order_id),
            ).rowcount
            if not changed:
                self._raise_transition_error(db, order_id, "OPEN")
            return dict(db.execute("SELECT * FROM work_orders WHERE id=?", (order_id,)).fetchone())

    def complete(self, order_id: int, note: str, sim_tick: int, sim_time: str,
                 *, tick_seconds: float = 0.1) -> dict:
        if not isinstance(note, str) or len(note) > 1000:
            raise ValueError("note must be at most 1000 characters")
        if tick_seconds <= 0:
            raise ValueError("tick_seconds must be positive")
        with self._connect() as db:
            row = db.execute("SELECT * FROM work_orders WHERE id=?", (order_id,)).fetchone()
            if row is None:
                raise KeyError(f"work order {order_id} not found")
            if row["status"] != "IN_PROGRESS":
                raise ValueError("work order must be IN_PROGRESS")
            if sim_tick < row["started_tick"]:
                raise ValueError("completion tick cannot precede start tick")
            duration = round((sim_tick - row["started_tick"]) * tick_seconds, 1)
            changed = db.execute(
                "UPDATE work_orders SET status='COMPLETED', note=?, completed_tick=?, "
                "completed_sim_time=?, repair_seconds=? WHERE id=? AND status='IN_PROGRESS'",
                (note.strip(), sim_tick, sim_time, duration, order_id),
            ).rowcount
            if not changed:
                self._raise_transition_error(db, order_id, "IN_PROGRESS")
            return dict(db.execute("SELECT * FROM work_orders WHERE id=?", (order_id,)).fetchone())

    @staticmethod
    def _raise_transition_error(db: sqlite3.Connection, order_id: int, expected: str) -> None:
        row = db.execute("SELECT status FROM work_orders WHERE id=?", (order_id,)).fetchone()
        if row is None:
            raise KeyError(f"work order {order_id} not found")
        raise ValueError(f"work order must be {expected} (currently {row['status']})")

    @staticmethod
    def summarize(orders: list[dict]) -> dict:
        finished = [o["repair_seconds"] for o in orders if o["repair_seconds"] is not None]
        return {
            "open": sum(o["status"] == "OPEN" for o in orders),
            "in_progress": sum(o["status"] == "IN_PROGRESS" for o in orders),
            "completed": sum(o["status"] == "COMPLETED" for o in orders),
            "average_repair_sec": round(sum(finished) / len(finished), 1) if finished else None,
        }
