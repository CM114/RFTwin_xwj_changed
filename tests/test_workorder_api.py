"""End-to-end simulated fault and maintenance API behavior."""
import json
import sqlite3
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages"))
sys.path.insert(0, str(ROOT))

from apps.factory_backend import main  # noqa: E402
from domain_factory.workorders import WorkOrderStore  # noqa: E402


@pytest.fixture
def client(tmp_path):
    main.WORK_ORDER_STORE = WorkOrderStore(tmp_path / "workorders.sqlite3")
    with TestClient(main.app) as c:
        assert c.post("/api/simulation/pause").status_code == 200
        yield c


def test_fault_to_work_order_to_simulated_recovery(client):
    injected = client.post("/api/failures/inject", json={
        "failure_type": "conveyor_jam", "target_id": "C-03", "duration_sec": 120,
    })
    assert injected.status_code == 200
    listed = client.get("/api/work-orders")
    assert listed.status_code == 200
    data = listed.json()
    order = next(o for o in data["orders"] if o["source_id"] == "C-03")
    assert order["status"] == "OPEN" and order["current_run"] and order["fault_active"]
    assert data["summary"]["open"] == 1
    order_id = order["id"]

    assert client.post(f"/api/work-orders/{order_id}/complete", json={"note": "clear"}).status_code == 409
    started = client.post(f"/api/work-orders/{order_id}/start", json={"assignee": "张工"})
    assert started.status_code == 200 and started.json()["order"]["status"] == "IN_PROGRESS"

    eng = main._run("LIVE-001")
    before = json.dumps(eng.dump_state(), sort_keys=True)
    comparison = client.post(f"/api/work-orders/{order_id}/compare", json={
        "duration_a_sec": 30, "duration_b_sec": 120, "horizon_min": 5,
    })
    assert comparison.status_code == 200, comparison.text
    result = comparison.json()
    assert [o["duration_sec"] for o in result["options"]] == [30, 120]
    assert all({"good_units", "downtime_sec", "energy_kwh_total"} <= o.keys() for o in result["options"])
    assert json.dumps(eng.dump_state(), sort_keys=True) == before

    tick = eng.clock.tick
    done = client.post(f"/api/work-orders/{order_id}/complete", json={"note": "清除堵塞"})
    assert done.status_code == 200, done.text
    assert done.json()["order"]["status"] == "COMPLETED"
    assert done.json()["recovery"] == "restored"
    assert eng.conv_state["C-03"]["status"] == "RUNNING"
    assert eng.clock.tick == tick  # completing a paused repair must not advance production
    assert client.post(f"/api/work-orders/{order_id}/complete", json={"note": "again"}).status_code == 409


def test_stale_or_replaced_incident_cannot_repair_current_equipment(client):
    payload = {"failure_type": "conveyor_jam", "target_id": "C-03", "duration_sec": 120}
    assert client.post("/api/failures/inject", json=payload).status_code == 200
    old = client.get("/api/work-orders").json()["orders"][0]
    assert client.post(f"/api/work-orders/{old['id']}/start", json={"assignee": "维修员"}).status_code == 200
    assert client.post("/api/failures/inject", json=payload).status_code == 200
    new = client.get("/api/work-orders").json()["orders"][0]
    assert old["id"] != new["id"]
    rejected = client.post(f"/api/work-orders/{old['id']}/complete", json={"note": "superseded"})
    assert rejected.status_code == 200
    assert rejected.json()["recovery"] == "superseded"
    assert main._run("LIVE-001").conv_state["C-03"]["status"] == "JAMMED"

    previous = main.WORK_ORDER_SESSION
    try:
        main.WORK_ORDER_SESSION = "a-different-backend-session"
        assert client.post(f"/api/work-orders/{new['id']}/start", json={"assignee": "维修员"}).status_code == 409
    finally:
        main.WORK_ORDER_SESSION = previous


def test_active_fault_remains_actionable_after_event_buffer_eviction(client):
    assert client.post("/api/failures/inject", json={
        "failure_type": "conveyor_jam", "target_id": "C-03", "duration_sec": 120,
    }).status_code == 200
    order = client.get("/api/work-orders").json()["orders"][0]
    main._run("LIVE-001").bus._buffer.clear()
    assert client.get("/api/work-orders").json()["orders"][0]["fault_active"] is True
    assert client.post(f"/api/work-orders/{order['id']}/start", json={"assignee": "维修员"}).status_code == 200
    assert client.post(f"/api/work-orders/{order['id']}/complete", json={"note": "repaired"}).status_code == 200


def test_robot_repair_uses_engine_recovery_and_preserves_parts(client):
    response = client.post("/api/failures/inject", json={
        "failure_type": "tool_failure", "target_id": "R-06", "duration_sec": 180,
    })
    assert response.status_code == 200
    order = next(o for o in client.get("/api/work-orders").json()["orders"] if o["source_id"] == "R-06")
    assert client.post(f"/api/work-orders/{order['id']}/start", json={"assignee": "维修员"}).status_code == 200
    result = client.post(f"/api/work-orders/{order['id']}/complete", json={"note": "更换工具"})
    assert result.status_code == 200
    assert result.json()["recovery"] == "restored"
    eng = main._run("LIVE-001")
    station = next(s for cell in eng.cells.values() for s in cell["stations"] if s["robot_id"] == "R-06")
    assert station["fault_kind"] is None
    eng.check_conservation()


def test_amr_completion_does_not_claim_device_has_already_recovered(client):
    assert client.post("/api/failures/inject", json={
        "failure_type": "amr_fault", "target_id": "AMR-01", "duration_sec": 120,
    }).status_code == 200
    order = next(o for o in client.get("/api/work-orders").json()["orders"] if o["source_id"] == "AMR-01")
    assert client.post(f"/api/work-orders/{order['id']}/start", json={"assignee": "维修员"}).status_code == 200
    result = client.post(f"/api/work-orders/{order['id']}/complete", json={"note": "已处理"})
    assert result.status_code == 200
    assert result.json()["recovery"] == "waiting_for_auto_recovery"
    assert result.json()["order"]["fault_active"] is True


def test_applying_scenario_also_creates_a_work_order(client):
    eng = main._run("LIVE-001")
    main.SCENARIOS.append({"scenario_id": "SC-TEST", "branch_from": {"run_id": eng.run_id},
                           "injection": {"failure_type": "conveyor_jam", "target_id": "C-01",
                                         "duration_sec": 120}})
    assert client.post("/api/scenarios/SC-TEST/apply").status_code == 200
    orders = client.get("/api/work-orders").json()["orders"]
    assert sum(o["source_id"] == "C-01" for o in orders) == 1


def test_work_order_routes_use_existing_rate_limit_buckets():
    from apps.factory_backend.guard import bucket_for

    assert bucket_for("/api/work-orders/123/start") == "mutate"
    assert bucket_for("/api/work-orders/123/complete") == "mutate"
    assert bucket_for("/api/work-orders/123/compare") == "whatif"


def test_failed_persistence_rolls_back_simulated_recovery(client, monkeypatch):
    assert client.post("/api/failures/inject", json={
        "failure_type": "conveyor_jam", "target_id": "C-03", "duration_sec": 120,
    }).status_code == 200
    order = client.get("/api/work-orders").json()["orders"][0]
    assert client.post(f"/api/work-orders/{order['id']}/start", json={"assignee": "维修员"}).status_code == 200
    eng = main._run("LIVE-001")
    before = eng.state_hash()

    def fail_write(*args, **kwargs):
        raise sqlite3.OperationalError("test database unavailable")

    monkeypatch.setattr(main.WORK_ORDER_STORE, "complete", fail_write)
    with pytest.raises(sqlite3.OperationalError):
        client.post(f"/api/work-orders/{order['id']}/complete", json={"note": "test"})
    assert eng.state_hash() == before
    assert main.WORK_ORDER_STORE.get(order["id"])["status"] == "IN_PROGRESS"
