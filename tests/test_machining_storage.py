"""Durable machining runs, restart recovery, and history API regressions."""
import asyncio
import json
import sqlite3
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'packages'))
from apps.factory_backend.main import app
from apps.factory_backend import workshop
from domain_machining.engine import MachiningEngine


@pytest.fixture(autouse=True)
def isolated_store(tmp_path, monkeypatch):
    path = tmp_path / 'workshop.sqlite3'
    monkeypatch.setenv('TWIN_WORKSHOP_DB', str(path))
    yield path


def test_restart_preserves_state_and_events_paused_with_new_revision():
    with TestClient(app) as client:
        client.post('/api/simulation/pause')
        client.post('/api/workshop/reset')
        client.post('/api/workshop/control', json={'advance_seconds': 73.4, 'speed': 2})
        client.post('/api/workshop/fault', json={'machine_id': 'L01', 'duration_seconds': 40, 'active': True})
        client.post('/api/workshop/control', json={'paused': False})
    before = workshop.service.engine.dump_state()
    with TestClient(app) as client:
        client.post('/api/simulation/pause')
        after = workshop.service.engine.dump_state()
        assert after['paused'] is True, 'restart must require an explicit resume command'
        assert after['revision'] > before['revision'], 'restart invalidates pending comparisons'
        assert after['run_id'] == before['run_id']
        assert after['clock'] == before['clock'], 'offline wall time must never advance simulation'
        assert after['bus'] == before['bus']
        expected = MachiningEngine.from_state(before)
        expected.paused = True
        expected.revision = after['revision']
        expected.advance(23.6)
        response = client.post('/api/workshop/control', json={'advance_seconds': 23.6})
        assert response.status_code == 200
        expected.revision += 1
        assert workshop.service.engine.dump_state() == expected.dump_state()


def test_reset_archives_and_restore_clones_full_history():
    with TestClient(app) as client:
        client.post('/api/simulation/pause')
        first = client.post('/api/workshop/reset').json()
        progressed = client.post('/api/workshop/control', json={'advance_seconds': 700}).json()
        run_id = first['run_id']
        full_count = workshop.service.engine.bus.seq
        assert full_count > 100
        second = client.post('/api/workshop/reset').json()
        listed = client.get('/api/workshop/runs')
        assert listed.status_code == 200
        assert listed.json()['current_run_id'] == second['run_id']
        row = next(row for row in listed.json()['runs'] if row['run_id'] == run_id)
        assert row['archived'] and row['event_count'] == full_count
        source = client.get(f'/api/workshop/runs/{run_id}').json()
        assert source['snapshot'] == progressed
        assert len(source['events']) == full_count
        assert len(source['snapshot']['events']) == 100
        restored = client.post(f'/api/workshop/runs/{run_id}/restore')
        assert restored.status_code == 200
        result = restored.json()
        assert result['run_id'] not in (run_id, second['run_id'])
        assert result['paused'] and result['elapsed'] == progressed['elapsed']
        assert result['parts'] == progressed['parts']
        assert workshop.service.engine.bus.run_id == result['run_id']
        assert all(event['run_id'] == result['run_id'] for event in workshop.service.engine.bus.recent(full_count))
        assert client.get(f'/api/workshop/runs/{run_id}').json() == source
        assert client.get('/api/workshop/runs/not-a-run').status_code == 404
        assert client.post('/api/workshop/runs/not-a-run/restore').status_code == 404


def test_failed_save_does_not_acknowledge_or_mutate_command(monkeypatch):
    with TestClient(app) as client:
        client.post('/api/simulation/pause')
        before = client.post('/api/workshop/reset').json()
        def no_space(*args, **kwargs):
            raise sqlite3.OperationalError('disk full')
        monkeypatch.setattr(workshop.service.storage, 'save', no_space)
        for path, payload in [('/control', {'advance_seconds': 10}),
                              ('/fault', {'machine_id': 'L01', 'duration_seconds': 30, 'active': True}),
                              ('/apply', {'policy': 'edd', 'run_id': before['run_id'], 'revision': before['revision']}),
                              ('/reset', None), (f"/runs/{before['run_id']}/restore", None)]:
            response = client.post('/api/workshop' + path, json=payload)
            assert response.status_code == 503
        failed = client.get('/api/workshop/snapshot').json()
        assert failed.pop('storage_error'), 'save failure must remain visible in live snapshots'
        before.pop('storage_error', None)
        assert failed == before
        monkeypatch.undo()


def test_corrupt_state_is_explicit_and_never_overwritten(isolated_store):
    with TestClient(app) as client:
        client.post('/api/simulation/pause')
        run_id = client.post('/api/workshop/reset').json()['run_id']
    with sqlite3.connect(isolated_store) as db:
        db.execute('UPDATE workshop_runs SET state_json = ? WHERE run_id = ?', ('{"corrupt":true}', run_id))
    with pytest.raises(RuntimeError, match='recover|Recovery|recovery'):
        with TestClient(app):
            pass
    with sqlite3.connect(isolated_store) as db:
        assert json.loads(db.execute('SELECT state_json FROM workshop_runs WHERE run_id = ?', (run_id,)).fetchone()[0]) == {'corrupt': True}


def test_durable_bus_exceeds_shared_live_window_and_preserves_run_metadata():
    service = workshop.WorkshopService()
    service.startup()
    # Explicit synthetic checkpoint events test durability independently of part count.
    for index in range(5100):
        service.engine._event('test_checkpoint', 'RAW', None, f'Synthetic checkpoint {index}')
    service.commit(service.engine)
    run_id = service.engine.run_id
    expected = service.engine.bus.dump_state()
    created_at = service.storage.get(run_id)['run']['created_at']
    service.shutdown()
    restarted = workshop.WorkshopService()
    restarted.startup()
    assert restarted.engine.bus.dump_state() == expected
    assert len(expected['buffer']) > 5000
    assert restarted.storage.get(run_id)['run']['created_at'] == created_at
    saved = restarted.storage.get(run_id)
    assert len(restarted.history(saved)) == expected['seq']
    assert len(saved['snapshot']['events']) == 100
    restarted.shutdown()


@pytest.mark.parametrize('kind', ['database', 'state'])
def test_unsupported_versions_require_explicit_recovery(isolated_store, kind):
    service = workshop.WorkshopService()
    service.startup()
    run_id = service.engine.run_id
    service.shutdown()
    with sqlite3.connect(isolated_store) as db:
        if kind == 'database':
            db.execute('PRAGMA user_version=999')
        else:
            db.execute('UPDATE workshop_runs SET state_version=999 WHERE run_id=?', (run_id,))
    with pytest.raises(RuntimeError, match='Unsupported.*version'):
        workshop.WorkshopService().startup()
    with sqlite3.connect(isolated_store) as db:
        assert db.execute('SELECT COUNT(*) FROM workshop_runs').fetchone()[0] == 1


def test_archived_rows_cannot_be_mutated_and_replacement_is_atomic():
    from domain_machining.storage import WorkshopStorageError, retain_full_history
    service = workshop.WorkshopService()
    service.startup()
    first = service.storage.current()
    replacement = MachiningEngine()
    retain_full_history(replacement)
    service.commit(replacement, replace=True)
    source = service.storage.get(first['run']['run_id'])
    with pytest.raises(WorkshopStorageError, match='immutable'):
        service.storage.save(first['state'], first['snapshot'])
    assert service.storage.current()['run']['run_id'] == replacement.run_id
    assert service.storage.get(first['run']['run_id']) == source
    current_checkpoint = service.storage.current()
    service.engine.advance(10)
    invalid_replacement = MachiningEngine(run_id=first['run']['run_id'])
    retain_full_history(invalid_replacement)
    with pytest.raises(workshop.HTTPException) as failed:
        service.commit(invalid_replacement, replace=True)
    assert failed.value.status_code == 503
    # Saving outgoing progress and the replacement share one rollback boundary.
    assert service.storage.current() == current_checkpoint
    assert service.storage.get(first['run']['run_id']) == source
    assert service.engine.run_id == replacement.run_id and service.engine.elapsed == 10
    service.shutdown()


def test_periodic_checkpoint_survives_without_graceful_shutdown():
    service = workshop.WorkshopService()
    service.startup()
    service.engine.paused = False
    service.last_checkpoint = 0
    async def tick_once():
        task = asyncio.create_task(service.ticker())
        await asyncio.sleep(.25)
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
    asyncio.run(tick_once())
    checkpoint = service.storage.current()
    assert checkpoint['state']['clock']['tick'] > 0
    # Simulate a lost process: no service.shutdown() checkpoint before recovery.
    restarted = workshop.WorkshopService()
    restarted.startup()
    assert restarted.engine.run_id == service.engine.run_id
    assert restarted.engine.clock.dump_state() == checkpoint['state']['clock']
    assert restarted.engine.paused
    restarted.shutdown()


def test_ticker_pauses_and_exposes_checkpoint_failure(monkeypatch):
    service = workshop.WorkshopService()
    service.startup()
    service.engine.paused = False
    service.last_checkpoint = 0
    def no_space(*args, **kwargs):
        raise sqlite3.OperationalError('disk full')
    with monkeypatch.context() as patch:
        patch.setattr(service.storage, 'save', no_space)
        async def tick_once():
            task = asyncio.create_task(service.ticker())
            await asyncio.sleep(.25)
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        asyncio.run(tick_once())
    assert service.engine.paused
    assert 'disk full' in service.snapshot()['storage_error']
    service.commit(service.engine)
    assert service.snapshot()['storage_error'] is None
    service.shutdown()


def test_history_returns_503_when_storage_directory_disappears(tmp_path, monkeypatch):
    with TestClient(app, raise_server_exceptions=False) as client:
        client.post('/api/simulation/pause')
        run_id = client.post('/api/workshop/reset').json()['run_id']
        with monkeypatch.context() as patch:
            patch.setattr(workshop.service.storage, 'path', tmp_path / 'unavailable-directory' / 'workshop.sqlite3')
            for method, path in [('get', '/api/workshop/runs'),
                                 ('get', f'/api/workshop/runs/{run_id}'),
                                 ('post', f'/api/workshop/runs/{run_id}/restore')]:
                response = getattr(client, method)(path)
                assert response.status_code == 503, (method, path, response.text)
                assert 'Workshop' in response.json()['detail']


def test_api_parts_expose_persistent_historical_fault_impact():
    with TestClient(app) as client:
        client.post('/api/simulation/pause')
        client.post('/api/workshop/reset')
        client.post('/api/workshop/control', json={'advance_seconds': 1})
        fault = client.post('/api/workshop/fault', json={
            'machine_id': 'L01', 'duration_seconds': 30, 'active': True}).json()
        affected_ids = {p['id'] for p in fault['parts'] if p['historically_affected']}
        assert affected_ids
        repaired = client.post('/api/workshop/fault', json={
            'machine_id': 'L01', 'duration_seconds': 30, 'active': False}).json()
        assert not any(order['affected'] for order in repaired['orders'])
        assert affected_ids <= {p['id'] for p in repaired['parts'] if p['historically_affected']}
        run_id = repaired['run_id']
    with TestClient(app) as client:
        restarted = client.get('/api/workshop/snapshot').json()
        assert affected_ids <= {p['id'] for p in restarted['parts'] if p['historically_affected']}
        archived = client.get(f'/api/workshop/runs/{run_id}').json()['snapshot']
        assert archived['parts'] == restarted['parts']
