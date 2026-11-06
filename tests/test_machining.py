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


def test_fault_after_assignment_marks_orders_affected_and_waiting_time_counts_pickup():
    engine = MachiningEngine()
    engine.advance(1)
    engine.set_fault('L01', 300, True)
    engine.advance(1)
    assert any(o['affected'] for o in engine.snapshot()['orders'])
    expected = sum(p['status'] in ('queued', 'waiting_transport', 'awaiting_unload', 'awaiting_pickup') for p in engine.parts.values())
    before = engine.waiting_seconds
    engine.advance(.2)
    assert engine.waiting_seconds - before >= expected * .2 - 1e-6


def handoff_engine(action, picked):
    engine = MachiningEngine()
    for _ in range(3000):
        engine.advance(.2)
        robot = engine.robots['R01']
        if robot['action'] == action and (engine.parts[robot['part_id']]['location'] == 'R01') == picked:
            return engine
    pytest.fail(f'Could not reach {action} / picked={picked}')


@pytest.mark.parametrize('action,picked', [('load', False), ('load', True), ('unload', False), ('unload', True)])
def test_handoff_fault_releases_shared_robot_and_healthy_cell_keeps_working(action, picked):
    engine = handoff_engine(action, picked)
    robot = engine.robots['R01']
    mid, pid = robot['machine_id'], robot['part_id']
    fault_time = engine.elapsed
    completed_before = sum(h['event'] == 'operation_completed' for h in engine.parts[pid]['history'])
    engine.set_fault(mid, 600, True)
    for _ in range(50):
        before = engine.parts[pid]['position'][:]
        engine.advance(.2)
        engine.assert_invariants()
        if robot['status'] == 'recovering' and picked:
            assert math.dist(before, engine.parts[pid]['position']) <= .51
    assert robot['machine_id'] != mid, 'A CNC production fault must not monopolize its shared robot'
    machine = engine.machines[mid]
    part = engine.parts[pid]
    if action == 'load':
        assert pid in machine['queue'] and machine['part_id'] is None
        assert part['location'] == mid and part['status'] == 'queued'
    elif picked:
        assert sum(h['event'] == 'operation_completed' for h in part['history']) == completed_before + 1
        assert machine['part_id'] is None
    else:
        assert machine['part_id'] == pid and machine['phase'] == 'done'
        assert part['location'] == mid and part['status'] == 'awaiting_unload'
    assert machine['status'] == 'fault'
    assert any(h['event'] == 'handoff_recovered' for h in part['history'])
    engine.advance(100)
    assert any(h['time'] > fault_time and h['event'] == 'load_completed' and h['resource'] == 'R01'
               for p in engine.parts.values() if p['id'] != pid for h in p['history'])
    engine.set_fault(mid, 1, False)
    engine.advance(2400)
    engine.assert_invariants()
    assert engine.complete


def test_loading_reserves_capacity_for_fault_rollback():
    engine = handoff_engine('load', True)
    mid = engine.robots['R01']['machine_id']
    machine = engine.machines[mid]
    machine['incoming'] = ['P002']
    assert not engine._capacity(machine), 'Keep an input slot reserved until the handoff finishes'


def test_new_dispatches_bypass_faulted_machines_and_wait_if_all_are_unavailable():
    engine = MachiningEngine()
    engine.set_fault('L01', 600, True)
    engine.advance(30)
    assert not engine.machines['L01']['incoming'] and not engine.machines['L01']['queue']
    assert all(a['to_id'] != 'L01' for a in engine.amrs.values())
    engine = MachiningEngine()
    for mid in ['L01', 'L02', 'L03']:
        engine.set_fault(mid, 600, True)
    engine.advance(10)
    assert all(a['status'] == 'idle' for a in engine.amrs.values())
    assert all(p['location'] == 'RAW' and p['waiting_reason'] == 'No compatible healthy machine available'
               for p in engine.parts.values())


def test_recovery_can_be_cloned_and_rerouted_without_mutating_live_state():
    engine = handoff_engine('load', True)
    mid = engine.robots['R01']['machine_id']
    pid = engine.robots['R01']['part_id']
    engine.set_fault(mid, 300, True)
    engine.advance(.2)
    assert engine.robots['R01']['status'] == 'recovering'
    clone = MachiningEngine.from_state(json.loads(json.dumps(engine.dump_state())))
    engine.advance(.2)
    clone.advance(.2)
    assert engine.dump_state() == clone.dump_state()
    before = engine.state_hash()
    assert len(compare_policies(engine, 1800)['scenarios']) == 3
    assert engine.state_hash() == before
    clone.set_policy('reroute')
    clone.advance(120)
    assert any(h['event'] == 'reroute_requested' for h in clone.parts[pid]['history'])


@pytest.mark.parametrize('policy', ['reroute', 'edd'])
def test_unload_recovery_reserves_output_before_rerouting_queued_parts(policy):
    engine = MachiningEngine()
    for _ in range(3000):
        engine.advance(.2)
        robot = engine.robots['R01']
        if (robot['action'] == 'unload' and engine.parts[robot['part_id']]['location'] == 'R01'
                and len(engine.machines[robot['machine_id']]['queue']) == 2):
            break
    else:
        pytest.fail('Did not reach a picked unload with two queued parts')
    assert robot['action'] == 'unload' and engine.parts[robot['part_id']]['location'] == 'R01'
    mid, pid = robot['machine_id'], robot['part_id']
    assert len(engine.machines[mid]['queue']) == 2
    engine.set_policy(policy)
    engine.set_fault(mid, 60, True)
    for _ in range(25):
        engine.advance(.2)
        engine.assert_invariants()
    assert any(h['event'] == 'handoff_recovered' for h in engine.parts[pid]['history'])
    engine.advance(1800)
    engine.assert_invariants()
    assert engine.complete
