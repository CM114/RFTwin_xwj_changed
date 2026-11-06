"""Release regressions for fault attribution, traffic and physical handoffs."""
import json
import math
import random
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'packages'))
from domain_machining.engine import MachiningEngine


def test_repair_clears_current_impact_and_preserves_history():
    engine = MachiningEngine(run_id='impact')
    engine.advance(1)
    engine.set_fault('L01', 300, True)
    impacted = [o['id'] for o in engine.snapshot()['orders'] if o['affected']]
    assert impacted
    engine.set_fault('L01', 300, False)
    orders = engine.snapshot()['orders']
    assert not any(o['affected'] for o in orders)
    assert all(o['historically_affected'] for o in orders if o['id'] in impacted)
    engine.advance(2400)
    assert engine.complete
    assert not any(o['affected'] for o in engine.snapshot()['orders'])


def test_automatic_repair_and_reroute_recompute_actual_dependency():
    engine = MachiningEngine()
    engine.advance(1)
    engine.set_fault('L01', 1, True)
    assert any(o['affected'] for o in engine.snapshot()['orders'])
    engine.advance(1)
    assert not any(o['affected'] for o in engine.snapshot()['orders'])
    assert any(o['historically_affected'] for o in engine.snapshot()['orders'])


def test_wait_categories_are_disjoint_and_match_machine_ownership():
    engine = MachiningEngine()
    engine.advance(40)
    for row in engine.snapshot()['bottlenecks']:
        mid = row['resource']
        machine = engine.machines[mid]
        assert row['queued_parts'] == len(machine['queue'])
        assert row['incoming_parts'] == len(machine['incoming'])
        assert row['awaiting_dispatch_parts'] == sum(
            p['target'] == mid and p['status'] == 'waiting_transport'
            for p in engine.parts.values())
        assert row['waiting_parts'] == sum(row[k] for k in
            ('queued_parts', 'incoming_parts', 'awaiting_dispatch_parts'))


def test_complete_pipeline_has_continuous_parts_concurrent_safe_carriers_and_clone():
    engine = MachiningEngine(run_id='motion')
    concurrent_ticks = 0
    min_distance = float('inf')
    transfers = set()
    cloned = False
    for _ in range(12000):
        before = {pid: p['position'][:] for pid, p in engine.parts.items()}
        carriers_before = {aid: a['position'][:] for aid, a in engine.amrs.items()}
        engine.advance(.2)
        engine.assert_invariants()
        for pid, p in engine.parts.items():
            assert math.dist(before[pid], p['position']) <= .610001, (engine.elapsed, pid, p)
            if p.get('transfer'):
                transfers.add(p['transfer']['kind'])
        carriers = list(engine.amrs.values())
        min_distance = min(min_distance, math.dist(carriers[0]['position'], carriers[1]['position']))
        concurrent_ticks += all(math.dist(carriers_before[a['id']], a['position']) > .001 for a in carriers)
        if not cloned and any(p.get('transfer') for p in engine.parts.values()) and engine.elapsed > 150:
            clone = MachiningEngine.from_state(json.loads(json.dumps(engine.dump_state())))
            clone.advance(.2)
            check = MachiningEngine.from_state(engine.dump_state())
            check.advance(.2)
            assert clone.dump_state() == check.dump_state()
            cloned = True
        if engine.complete:
            break
    assert engine.complete
    assert concurrent_ticks > 30
    assert min_distance >= 2.4 - 1e-7
    assert {'pickup', 'delivery', 'station_load', 'station_unload'} <= transfers
    assert cloned
    assert all(p['stage_index'] == 6 and p['completed_at'] is not None for p in engine.parts.values())


def test_seeded_faults_and_policy_changes_finish_without_ownership_loss():
    for seed in range(3):
        rng = random.Random(seed)
        engine = MachiningEngine(run_id=f'stress-{seed}')
        for step in range(3000):
            if step < 500 and step % 23 == 0:
                engine.set_fault(rng.choice(['L01', 'L02', 'L03', 'M01', 'M02', 'M03']), rng.uniform(1, 60), True)
                engine.set_policy(rng.choice(['fifo', 'reroute', 'edd']))
            engine.advance(1)
            engine.assert_invariants()
            if engine.complete:
                break
        assert engine.complete, (seed, engine.elapsed)
        assert not any(o['affected'] for o in engine.snapshot()['orders'])


def test_every_transfer_and_traffic_wait_clones_deterministically_with_stable_queues():
    engine = MachiningEngine(run_id='all-phases')
    checked = set()
    previous_queues = {}
    for _ in range(12000):
        engine.advance(.2)
        for p in engine.parts.values():
            if p['status'] == 'queued':
                if p['id'] in previous_queues:
                    assert p['position'] == previous_queues[p['id']]
        previous_queues = {p['id']: p['position'][:] for p in engine.parts.values() if p['status'] == 'queued'}
        phases = {p['transfer']['kind'] for p in engine.parts.values() if p.get('transfer')}
        if any(a['status'] == 'waiting_traffic' for a in engine.amrs.values()):
            phases.add('waiting_traffic')
        for phase in phases - checked:
            saved = json.loads(json.dumps(engine.dump_state()))
            a = MachiningEngine.from_state(saved)
            b = MachiningEngine.from_state(saved)
            a.advance(5)
            b.advance(5)
            assert a.dump_state() == b.dump_state()
            assert engine.dump_state() == saved
            checked.add(phase)
        if engine.complete:
            break
    assert {'pickup', 'delivery', 'station_load', 'station_unload', 'waiting_traffic'} <= checked


@pytest.mark.parametrize('policy', ['fifo', 'reroute', 'edd'])
def test_tick_level_seeded_fault_motion_and_swept_carrier_separation(policy):
    rng = random.Random(17)
    engine = MachiningEngine(run_id=policy)
    engine.set_policy(policy)
    for step in range(13000):
        if step < 2200 and step % 71 == 0:
            engine.set_fault(rng.choice(['L01', 'L02', 'L03', 'M01', 'M02', 'M03']), rng.uniform(1, 50), True)
        previous = {pid: p['position'][:] for pid, p in engine.parts.items()}
        engine.advance(.2)
        engine.assert_invariants()
        assert all(math.dist(previous[pid], p['position']) <= .610001 for pid, p in engine.parts.items())
        if engine.complete:
            break
    assert engine.complete


def test_finished_inventory_commits_after_final_rack_handoff():
    engine = MachiningEngine()
    saw_delivery = False
    for _ in range(12000):
        engine.advance(.2)
        for a in engine.amrs.values():
            if a['to_id'] == 'FG' and a['status'] == 'delivery_transfer':
                p = engine.parts[a['part_id']]
                assert p['location'] == a['id'] and p['status'] != 'finished'
                assert p['completed_at'] is None and p['transfer']['remaining'] > 0
                saw_delivery = True
        for p in engine.parts.values():
            if p['status'] == 'finished':
                assert p['position'] == pytest.approx(engine._buffer_position('FG', p['buffer_slot']))
        if engine.complete:
            break
    assert saw_delivery and engine.complete
