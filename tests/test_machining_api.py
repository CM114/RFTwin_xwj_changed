import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'packages'))
from apps.factory_backend.main import app


@pytest.fixture(scope='module')
def client():
    with TestClient(app) as client:
        client.post('/api/simulation/pause')
        yield client


def test_snapshot_reset_controls_and_config(client):
    config = client.get('/api/workshop/config')
    assert config.status_code == 200
    first = client.post('/api/workshop/reset').json()
    assert first['paused'] and first['elapsed'] == 0
    assert len(first['orders']) == 3
    assert len(first['robots']) == len(first['amrs']) == 2
    snap = client.post('/api/workshop/control', json={'speed': 4, 'advance_seconds': 10}).json()
    assert snap['elapsed'] == 10 and snap['paused'] and snap['speed'] == 4
    assert snap['revision'] > first['revision']
    moving = [a for a in snap['amrs'] if a['status'] != 'idle']
    assert moving
    assert all(a.get('path') and all(len(point) == 3 for point in a['path']) for a in moving), '3D routes must use the authoritative remaining path'
    fresh = client.post('/api/workshop/reset', json={'orders': [{'id': 'CUSTOM', 'part_type': 'sleeve', 'quantity': 2, 'due_seconds': 300}]}).json()
    assert fresh['run_id'] != first['run_id']
    assert fresh['metrics']['total_parts'] == 2
    client.post('/api/workshop/reset')


def test_errors_fault_compare_isolation_and_stale_apply(client):
    for path, payload in [('/control', {'speed': -1}), ('/control', {'advance_seconds': 999999}),
                          ('/control', {'speed': 'nan'}), ('/control', {'paused': 'false'}),
                          ('/fault', {'machine_id': 'D01', 'duration_seconds': 10, 'active': True}),
                          ('/fault', {'machine_id': 'L01', 'duration_seconds': -1, 'active': True}),
                          ('/compare', {'horizon_seconds': 999999}),
                          ('/reset', {'orders': []})]:
        assert client.post('/api/workshop' + path, json=payload).status_code == 422
    fault = client.post('/api/workshop/fault', json={'machine_id': 'L01', 'duration_seconds': 60, 'active': True})
    assert fault.status_code == 200
    before = client.get('/api/workshop/snapshot').json()
    compared = client.post('/api/workshop/compare', json={'horizon_seconds': 20})
    assert compared.status_code == 200
    assert client.get('/api/workshop/snapshot').json() == before
    base = compared.json()
    applied = client.post('/api/workshop/apply', json={'policy': 'reroute', 'run_id': base['run_id'], 'revision': base['revision']})
    assert applied.status_code == 200 and applied.json()['policy'] == 'reroute'
    assert client.post('/api/workshop/apply', json={'policy': 'edd', 'run_id': base['run_id'], 'revision': base['revision']}).status_code == 409
    client.post('/api/workshop/reset')
    assert client.post('/api/workshop/apply', json={'policy': 'edd', 'run_id': base['run_id'], 'revision': base['revision']}).status_code == 409


def test_workshop_websocket_sends_authoritative_snapshots(client):
    client.post('/api/workshop/reset')
    with client.websocket_connect('/ws/workshop') as ws:
        first = ws.receive_json()
        assert first['paused'] and first['elapsed'] == 0
        client.post('/api/workshop/control', json={'advance_seconds': 5})
        for _ in range(5):
            snap = ws.receive_json()
            if snap['elapsed'] == 5:
                break
        assert snap['elapsed'] == 5
