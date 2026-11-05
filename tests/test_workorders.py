"""Behavior tests for persistent, simulation-scoped maintenance work orders."""
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages"))

from domain_factory.workorders import WorkOrderStore  # noqa: E402


@pytest.fixture
def fault_event():
    return {
        "run_id": "LIVE-001", "seq": 42, "sim_tick": 100,
        "sim_time": "2026-01-01T10:00:00", "source_type": "CONVEYOR",
        "source_id": "C-03", "event_type": "CONVEYOR_JAMMED",
        "severity": "HIGH", "cell_id": None, "message": "C-03 jammed",
    }


def test_faults_are_recorded_once_and_persist_across_reopening(tmp_path, fault_event):
    path = tmp_path / "orders.sqlite3"
    store = WorkOrderStore(path)
    first = store.ingest("session-one", fault_event)
    duplicate = store.ingest("session-one", fault_event)
    assert first["id"] == duplicate["id"]
    assert first["status"] == "OPEN"
    assert first["source_id"] == "C-03"
    reopened = WorkOrderStore(path)
    assert len(reopened.list("session-one", "LIVE-001")) == 1
    another_session = reopened.ingest("session-two", fault_event)
    assert another_session["id"] != first["id"]


def test_only_supported_fault_events_create_work_orders(tmp_path, fault_event):
    store = WorkOrderStore(tmp_path / "orders.sqlite3")
    assert store.ingest("session-one", {**fault_event, "event_type": "MINOR_STOP"}) is None
    assert store.list("session-one", "LIVE-001") == []


def test_assignment_completion_and_simulated_repair_time(tmp_path, fault_event):
    store = WorkOrderStore(tmp_path / "orders.sqlite3")
    order = store.ingest("session-one", fault_event)
    started = store.start(order["id"], "  张工  ", 200, "2026-01-01T10:00:10")
    assert started["status"] == "IN_PROGRESS"
    assert started["assignee"] == "张工"
    closed = store.complete(order["id"], "清除堵塞", 500, "2026-01-01T10:00:40")
    assert closed["status"] == "COMPLETED"
    assert closed["note"] == "清除堵塞"
    assert closed["repair_seconds"] == 30.0
    assert WorkOrderStore(tmp_path / "orders.sqlite3").get(order["id"])["status"] == "COMPLETED"


def test_rejects_invalid_lifecycle_transitions_and_unknown_orders(tmp_path, fault_event):
    store = WorkOrderStore(tmp_path / "orders.sqlite3")
    order = store.ingest("session-one", fault_event)
    with pytest.raises(ValueError):
        store.start(order["id"], " ", 200, "10:00:10")
    with pytest.raises(ValueError):
        store.complete(order["id"], "", 200, "10:00:10")
    store.start(order["id"], "维修员", 200, "10:00:10")
    with pytest.raises(ValueError):
        store.start(order["id"], "另一人", 201, "10:00:11")
    with pytest.raises(KeyError):
        store.get(99999)


def test_summary_counts_history_and_only_averages_completed_repairs(tmp_path, fault_event):
    store = WorkOrderStore(tmp_path / "orders.sqlite3")
    first = store.ingest("session-one", fault_event)
    second = store.ingest("session-two", {**fault_event, "seq": 43})
    store.start(first["id"], "维修员", 100, "10:00:00")
    store.complete(first["id"], "处理完成", 400, "10:00:30")
    history = store.list("session-two", "LIVE-001", include_history=True)
    assert len(history) == 2 and second["status"] == "OPEN"
    assert store.summarize(history) == {
        "open": 1, "in_progress": 0, "completed": 1, "average_repair_sec": 30.0,
    }
