"""Behavioral contracts for the deterministic order-driven workshop."""
import json
import math
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'packages'))
from domain_machining.engine import MachiningEngine
from domain_machining.config import WorkshopConfig
from domain_machining.comparison import compare_policies


def test_healthy_orders_finish_with_conserved_parts_and_finite_resources():
    engine = MachiningEngine(run_id='test')
    total = len(engine.parts)
    for _ in range(3600):
        engine.advance(1)
        snap = engine.snapshot()
        assert len({p['id'] for p in snap['parts']}) == total
        engine.assert_invariants()
        if snap['complete']:
            break
    assert snap['complete']
    assert snap['metrics']['completed_parts'] == total
    assert all(p['location'] == 'FG' for p in snap['parts'])
    assert all(o['status'] == 'completed' for o in snap['orders'])
    assert all(r['utilization'] > 0 for r in snap['robots'])
    assert all(a['completed_trips'] > 0 for a in snap['amrs'])
    assert all(a['status'] == 'idle' for a in snap['amrs'])
    assert all(len(m['queue']) <= 2 for m in snap['machines'])
    assert any(h['event'] == 'setup_started' for p in snap['parts'] for h in p['history'])
    sleeve = next(p for p in snap['parts'] if p['part_type'] == 'sleeve')
    shaft = next(p for p in snap['parts'] if p['part_type'] == 'shaft')
    assert not any(h['resource'].startswith('M') for h in sleeve['history'])
    assert any(h['resource'].startswith('M') for h in shaft['history'])


def test_clock_bus_restore_and_policy_comparison_are_deterministic_and_isolated():
    engine = MachiningEngine(run_id='same')
    engine.advance(100)
    state = json.loads(json.dumps(engine.dump_state()))
    clone = MachiningEngine.from_state(state)
    engine.advance(37)
    clone.advance(37)
    assert engine.dump_state() == clone.dump_state()
    before = engine.state_hash()
    result = compare_policies(engine, 1800)
    assert engine.state_hash() == before
    assert result['state_hash'] == before
    assert [s['policy'] for s in result['scenarios']] == ['fifo', 'reroute', 'edd']
    assert all(s['complete'] for s in result['scenarios'])
    assert compare_policies(engine, 1800) == result


def test_fault_holds_loaded_work_and_repair_resumes_it_without_teleportation():
    engine = MachiningEngine()
    for _ in range(300):
        engine.advance(1)
        machine = next((m for m in engine.snapshot()['machines'] if m['id'].startswith('L') and m['status'] == 'running'), None)
        if machine:
            break
    assert machine
    engine.set_fault(machine['id'], 30, True)
    initial = engine.snapshot()
    engine.advance(10)
    held = next(m for m in engine.snapshot()['machines'] if m['id'] == machine['id'])
    assert held['status'] == 'fault'
    assert held['part_id'] == machine['part_id']
    assert held['progress'] == machine['progress']
    assert any(o['affected'] for o in initial['orders'])
    positions = {p['id']: p['position'] for p in engine.snapshot()['parts']}
    engine.set_policy('reroute')
    assert {p['id']: p['position'] for p in engine.snapshot()['parts']} == positions
    engine.advance(25)
    assert next(m for m in engine.snapshot()['machines'] if m['id'] == machine['id'])['status'] != 'fault'
    assert any(e['kind'] == 'restore' for e in engine.snapshot()['events'])


def test_manual_repair_restores_setup_status_without_advancing_paused_clock():
    engine = MachiningEngine()
    machine = None
    for _ in range(300):
        engine.advance(.2)
        machine = next((m for m in engine.snapshot()['machines']
                        if m['id'].startswith('L') and m['status'] == 'setup'), None)
        if machine:
            break
    assert machine is not None
    engine.set_fault(machine['id'], 30, True)
    elapsed = engine.elapsed
    engine.set_fault(machine['id'], 30, False)
    restored = next(m for m in engine.snapshot()['machines'] if m['id'] == machine['id'])
    assert engine.paused and engine.elapsed == elapsed
    assert restored['status'] == 'setup'
    assert restored['part_id'] == machine['part_id']


def test_reroute_moves_only_unstarted_work_using_transport():
    engine = MachiningEngine()
    engine.advance(1)
    engine.set_fault('L01', 700, True)
    before = engine.state_hash()
    result = compare_policies(engine, 500)
    assert engine.state_hash() == before
    fifo, reroute, _ = result['scenarios']
    assert reroute['metrics'] != fifo['metrics']
    branch = MachiningEngine.from_state(engine.dump_state())
    branch.set_policy('reroute')
    branch.advance(100)
    part = branch.parts['P001']
    assert any(h['event'] == 'reroute_requested' for h in part['history'])
    assert sum(h['event'] == 'transport_assigned' for h in part['history']) >= 2
    assert not any(h['event'] == 'processing_started' and h['resource'] == 'L01' for h in part['history'])


def test_configuration_validation_and_short_horizon_are_explicit():
    for orders in [[], [{'id': 'x', 'part_type': 'gear', 'quantity': 1, 'due_seconds': 50}],
                   [{'id': 'x', 'part_type': 'shaft', 'quantity': 0, 'due_seconds': 50}]]:
        with pytest.raises(ValueError):
            WorkshopConfig(orders=orders)
    engine = MachiningEngine()
    result = compare_policies(engine, 1)
    assert all(not s['complete'] for s in result['scenarios'])
    assert all(s['metrics']['total_parts'] > s['metrics']['completed_parts'] for s in result['scenarios'])


def test_carriers_stay_in_aisle_and_robot_unload_retracts_to_dock():
    engine = MachiningEngine()
    seen_unload = False
    for _ in range(3000):
        engine.advance(.2)
        for a in engine.amrs.values():
            x, _, z = a['position']
            if -15 < x < 10:
                assert abs(z) <= 3.01, 'AMR must remain outside CNC and robot rail footprint'
        for r in engine.robots.values():
            assert r['position'][2] in (-4.8, 4.8)
            if r['action'] == 'unload' and r['remaining'] < .3:
                seen_unload = True
                p = engine.parts[r['part_id']]
                assert abs(p['position'][2]) <= 4.1, 'Unloading robot must retract to aisle-side dock'
        if seen_unload:
            break
    assert seen_unload


def test_all_transfer_paths_clear_station_bodies_and_rails():
    engine = MachiningEngine()
    obstacles = [(x, z, 4.5, 4.5) for x in (-12, -3, 6) for z in (-8, 8)] + [
        (-20, -8, 5, 7), (20, -8, 5, 5), (14, 8, 3, 3), (20, 8, 3, 3),
        (13, -8, 4, 4), (13, -12, 3, 2), (8, -12, 3, 2), (-20, 8, 5, 4),
        (-20, 12, 4, 2), (-20, 3.8, 2, 2), (-17, 3.8, 2, 2),
        (-6, -3.3, 3, 1), (3, -3.3, 3, 1), (10, 3.8, 3, 1.6), (17, -3.8, 3, 1.6),
        (-3, -4.8, 20, .92), (-3, 4.8, 20, .92)]
    docks = [engine._dock(mid) for mid in ['RAW', 'FG'] + list(engine.machines)]
    radius = math.hypot(.85, .6) + .15
    for start in docks:
        for end in docks:
            previous = start
            for point in engine._path(start, end):
                steps = max(1, math.ceil(math.dist(previous, point) / .1))
                for step in range(steps + 1):
                    x = previous[0] + (point[0] - previous[0]) * step / steps
                    z = previous[2] + (point[2] - previous[2]) * step / steps
                    for ox, oz, w, d in obstacles:
                        dx = max(0, abs(x - ox) - w / 2)
                        dz = max(0, abs(z - oz) - d / 2)
                        assert math.hypot(dx, dz) >= radius, (start, end, x, z, ox, oz)
                previous = point


def test_inventory_and_station_queues_have_distinct_visible_slots():
    engine = MachiningEngine()
    snap = engine.snapshot()
    assert len({tuple(p['position']) for p in snap['parts']}) == len(snap['parts'])
    engine.advance(1800)
    snap = engine.snapshot()
    assert snap['complete']
    assert len({tuple(p['position']) for p in snap['parts']}) == len(snap['parts'])


def test_idle_carriers_park_clear_and_travel_empty_after_unloading():
    engine = MachiningEngine()
    seen_return = False
    for _ in range(1000):
        engine.advance(.2)
        for a in engine.amrs.values():
            if a['status'] == 'idle':
                assert abs(a['position'][0]) > 22
            if a['status'] == 'returning':
                seen_return = True
                assert a['part_id'] is None
        if seen_return:
            break
    assert seen_return


def test_fault_before_release_marks_orders_affected_and_waiting_time_counts_pickup():
    engine = MachiningEngine()
    engine.set_fault('L01', 300, True)
    engine.advance(1)
    assert any(o['affected'] for o in engine.snapshot()['orders'])
    expected = sum(p['status'] in ('queued', 'waiting_transport', 'awaiting_unload', 'awaiting_pickup') for p in engine.parts.values())
    before = engine.waiting_seconds
    engine.advance(.2)
    assert engine.waiting_seconds - before >= expected * .2 - 1e-6
