"""Versioned, atomic SQLite checkpoints for machining runs and their full event bus.

Archived runs are immutable. A single transaction checkpoints the outgoing run,
archives it, saves its replacement and changes the current-run pointer.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from .engine import MachiningEngine

SCHEMA_VERSION = 1
STATE_VERSION = 1


class WorkshopStorageError(RuntimeError):
    """A saved workshop cannot be safely read or written."""


def engine_from_state(state: dict) -> MachiningEngine:
    """Restore deterministic state without the shared bus's live-window truncation."""
    required = {'run_id', 'revision', 'paused', 'speed', 'policy', 'fraction',
                'waiting_seconds', 'parts', 'machines', 'robots', 'amrs',
                'reservations', 'finished_at', 'config', 'clock', 'bus'}
    if not isinstance(state, dict) or not required <= state.keys():
        raise WorkshopStorageError('Saved workshop state is incomplete')
    try:
        engine = MachiningEngine.from_state(state)
        retain_full_history(engine, state['bus'])
        if engine.bus.run_id != engine.run_id:
            raise ValueError('event bus run_id differs from engine run_id')
        events = engine.bus.dump_state()['buffer']
        if (len(events) != engine.bus.seq
                or any(event['seq'] != index or event['run_id'] != engine.run_id
                       for index, event in enumerate(events, 1))):
            raise ValueError('event history is incomplete or belongs to another run')
        engine.assert_invariants()
        engine.snapshot()
        return engine
    except (KeyError, TypeError, ValueError, AssertionError, AttributeError) as ex:
        raise WorkshopStorageError(f'Saved workshop state is invalid: {ex}') from ex


def retain_full_history(engine: MachiningEngine, bus_state: dict | None = None) -> None:
    """Workshop checkpoints retain every event, beyond the snapshot's recent 100."""
    state = bus_state if bus_state is not None else engine.bus.dump_state()
    engine.bus.retention = None
    engine.bus.load_state(state)


class WorkshopStore:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with self._connect() as db:
                version = db.execute('PRAGMA user_version').fetchone()[0]
                if version not in (0, SCHEMA_VERSION):
                    raise WorkshopStorageError(f'Unsupported workshop database version {version}')
                if version == 0:
                    tables = db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
                    if tables:
                        raise WorkshopStorageError('Unversioned workshop database contains existing tables')
                    db.execute('''CREATE TABLE workshop_runs (
                        run_id TEXT PRIMARY KEY, state_version INTEGER NOT NULL,
                        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                        archived INTEGER NOT NULL DEFAULT 0,
                        source_run_id TEXT, state_json TEXT NOT NULL,
                        snapshot_json TEXT NOT NULL, digest TEXT NOT NULL
                    )''')
                    db.execute('''CREATE TABLE workshop_meta (
                        key TEXT PRIMARY KEY, value TEXT NOT NULL
                    )''')
                    db.execute(f'PRAGMA user_version = {SCHEMA_VERSION}')
                else:
                    # Detect truncated / incompatible schemas before any save can occur.
                    db.execute('SELECT run_id, state_version, digest FROM workshop_runs LIMIT 0')
                    db.execute('SELECT key, value FROM workshop_meta LIMIT 0')
        except (OSError, sqlite3.Error) as ex:
            raise WorkshopStorageError(f'Unable to open workshop storage: {ex}') from ex

    @contextmanager
    def _connect(self):
        db = None
        try:
            db = sqlite3.connect(self.path, timeout=5)
            db.row_factory = sqlite3.Row
            with db:
                yield db
        except sqlite3.Error as ex:
            raise WorkshopStorageError(f'Workshop database operation failed: {ex}') from ex
        finally:
            if db is not None:
                db.close()

    @staticmethod
    def _digest(state_json: str, snapshot_json: str) -> str:
        return hashlib.sha256((state_json + '\n' + snapshot_json).encode('utf-8')).hexdigest()

    def _decode(self, row):
        if row['state_version'] != STATE_VERSION:
            raise WorkshopStorageError(f"Unsupported saved workshop state version {row['state_version']}")
        if self._digest(row['state_json'], row['snapshot_json']) != row['digest']:
            raise WorkshopStorageError(f"Saved workshop {row['run_id']} failed its integrity check")
        try:
            state = json.loads(row['state_json'])
            snapshot = json.loads(row['snapshot_json'])
            engine = engine_from_state(state)
            if (snapshot['run_id'] != row['run_id'] or engine.run_id != row['run_id']
                    or snapshot['revision'] != engine.revision
                    or snapshot['elapsed'] != engine.elapsed):
                raise ValueError('checkpoint identity or simulation clock mismatch')
            return {'run': self._summary(row, snapshot, engine.bus.seq),
                    'state': state, 'snapshot': snapshot}
        except (ValueError, KeyError, TypeError) as ex:
            raise WorkshopStorageError(f"Invalid checkpoint for {row['run_id']}: {ex}") from ex

    @staticmethod
    def _summary(row, snapshot, event_count):
        return dict(run_id=row['run_id'], created_at=row['created_at'],
                    updated_at=row['updated_at'], archived=bool(row['archived']),
                    source_run_id=row['source_run_id'], elapsed=snapshot['elapsed'],
                    revision=snapshot['revision'], policy=snapshot['policy'],
                    paused=snapshot['paused'], complete=snapshot['complete'],
                    completed_parts=snapshot['metrics']['completed_parts'],
                    total_parts=snapshot['metrics']['total_parts'], event_count=event_count)

    def current(self):
        with self._connect() as db:
            pointer = db.execute("SELECT value FROM workshop_meta WHERE key='current_run_id'").fetchone()
            if pointer is None:
                if db.execute('SELECT 1 FROM workshop_runs LIMIT 1').fetchone():
                    raise WorkshopStorageError('Workshop current-run pointer is missing')
                return None
            row = db.execute('SELECT * FROM workshop_runs WHERE run_id=?', (pointer['value'],)).fetchone()
            if row is None or row['archived']:
                raise WorkshopStorageError('Workshop current-run pointer is invalid')
            return self._decode(row)

    def get(self, run_id: str):
        with self._connect() as db:
            row = db.execute('SELECT * FROM workshop_runs WHERE run_id=?', (run_id,)).fetchone()
            if row is None:
                raise KeyError(run_id)
            return self._decode(row)

    def list_runs(self):
        with self._connect() as db:
            rows = db.execute('SELECT * FROM workshop_runs ORDER BY updated_at DESC, run_id').fetchall()
            return [self._decode(row)['run'] for row in rows]

    def save(self, state: dict, snapshot: dict, *, previous=None, source_run_id=None):
        """Commit a checkpoint; replacement also checkpoints and archives its predecessor."""
        records = [previous, (state, snapshot)] if previous is not None else [(state, snapshot)]
        encoded = []
        for item_state, item_snapshot in records:
            if item_state['run_id'] != item_snapshot['run_id']:
                raise WorkshopStorageError('Cannot save mismatched workshop checkpoint')
            state_json = json.dumps(item_state, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
            snapshot_json = json.dumps(item_snapshot, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
            encoded.append((item_state['run_id'], state_json, snapshot_json))
        now = datetime.now(timezone.utc).isoformat(timespec='microseconds')
        with self._connect() as db:
            for run_id, state_json, snapshot_json in encoded:
                existing = db.execute('SELECT archived FROM workshop_runs WHERE run_id=?', (run_id,)).fetchone()
                if existing is not None and existing['archived']:
                    raise WorkshopStorageError(f'Archived workshop {run_id} is immutable')
                db.execute('''INSERT INTO workshop_runs
                    (run_id,state_version,created_at,updated_at,archived,source_run_id,state_json,snapshot_json,digest)
                    VALUES (?,?,?,?,0,?,?,?,?)
                    ON CONFLICT(run_id) DO UPDATE SET updated_at=excluded.updated_at,
                    state_json=excluded.state_json,snapshot_json=excluded.snapshot_json,digest=excluded.digest''',
                    (run_id, STATE_VERSION, now, now, source_run_id if run_id == state['run_id'] else None,
                     state_json, snapshot_json, self._digest(state_json, snapshot_json)))
            db.execute('UPDATE workshop_runs SET archived=1 WHERE run_id<>?', (state['run_id'],))
            db.execute("INSERT INTO workshop_meta(key,value) VALUES ('current_run_id',?) "
                       'ON CONFLICT(key) DO UPDATE SET value=excluded.value', (state['run_id'],))
