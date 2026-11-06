"""Deterministic finite-resource workshop, independent of the legacy FactoryEngine.

One 200 ms clock drives every transfer. Positions are prescribed aisle trajectories,
not industrial collision planning. State is plain JSON so branches can be restored.
"""
from __future__ import annotations

import copy
import hashlib
import json
import math
import uuid

from twin_runtime_core.clock import SimulationClock
from twin_runtime_core.events import EventBus

from .config import (COMPATIBILITY, DURATIONS, OPERATIONS, POSITIONS, QUEUE_CAPACITY,
                     ROUTES, SETUP_SECONDS, STAGES, WorkshopConfig)
from .traffic import departure_delay, sample_path, separated


class MachiningEngine:
    def __init__(self, config: WorkshopConfig | None = None, run_id: str | None = None):
        self.config = config or WorkshopConfig()
        self.run_id = run_id or f'WORKSHOP-{uuid.uuid4().hex[:12]}'
        self.clock = SimulationClock(200, '2026-01-01T08:00:00+00:00')
        self.bus = EventBus(self.run_id)
        self.revision = 0
        self.paused = True
        self.speed = 1.
        self.policy = 'fifo'
        self.fraction = 0.
        self.waiting_seconds = 0.
        self.parts = {}
        self.machines = {mid: dict(id=mid, operation=op, status='idle', part_id=None,
            progress=0., queue=[], fault_remaining=0., phase='idle', remaining=0.,
            duration=0., family=None, incoming=[], output=[]) for mid, op in OPERATIONS.items()}
        self.robots = {rid: dict(id=rid, position=[-12., .35, z], status='idle',
            machine_id=None, part_id=None, tip=None, utilization=0., busy_seconds=0.,
            remaining=0., duration=0., start=[-12., .35, z], action=None, recovery=None)
            for rid, z in [('R01', -4.8), ('R02', 4.8)]}
        self.amrs = {aid: dict(id=aid, position=pos, heading=0., status='idle', part_id=None,
            from_id=None, to_id=None, path=[], loaded=False, completed_trips=0, segments=[], parking=pos[:],
            trajectory=[], traffic_delay=0)
            for aid, pos in [('AMR01', [-24., .35, -1.2]), ('AMR02', [24., .35, 1.2])]}
        self.reservations = {}
        self.finished_at = {}
        for order in self.config.orders:
            for _ in range(order.quantity):
                pid = f'P{len(self.parts)+1:03d}'
                self.parts[pid] = dict(id=pid, order_id=order.id, part_type=order.part_type,
                    operation='turning', stage_index=0, status='waiting_transport', location='RAW',
                    position=self._dock('RAW'), waiting_reason='Awaiting AMR and turning input capacity',
                    history=[], assigned_machine=None, route_index=0, target=None,
                    ready_at=0., completed_at=None, affected=False, historically_affected=False,
                    transfer=None, buffer_location='RAW', buffer_slot=len(self.parts), reserved_slot=None)
                self._event('released', 'RAW', pid, f'{pid} released for {order.id}')
        self._place_static_parts()

    @property
    def elapsed(self):
        return round(self.clock.sim_seconds, 6)

    @property
    def complete(self):
        return (all(p['status'] == 'finished' for p in self.parts.values())
                and all(a['status'] == 'idle' for a in self.amrs.values()))

    def _event(self, kind, resource, pid, message):
        ev = self.bus.emit(sim_tick=self.clock.tick, sim_time=self.clock.sim_time_iso,
            source_type='machining', source_id=resource, event_type=kind, severity='info',
            message=message, cell_id=pid)
        if pid:
            self.parts[pid]['history'].append(dict(time=self.elapsed, event=kind, resource=resource))
        return ev

    def _priority(self, p):
        due = next(o.due_seconds for o in self.config.orders if o.id == p['order_id'])
        return (due if self.policy == 'edd' else p['ready_at'], p['id'])

    def _capacity(self, machine):
        # Keep the input slot until loading commits, so fault rollback always fits.
        loading = int(machine['phase'] == 'loading')
        return len(machine['queue']) + len(machine['incoming']) + loading < QUEUE_CAPACITY

    def _choose(self, p):
        candidates = [m for m in self.machines.values() if m['operation'] == p['operation']
                      and p['part_type'] in COMPATIBILITY[m['id']] and not m['fault_remaining']]
        available = [m for m in candidates if self._capacity(m)]
        if not available:
            return None
        return min(available, key=lambda m: (len(m['queue']) + len(m['incoming']) + bool(m['part_id']), m['id']))['id']

    def advance(self, seconds: float):
        if not math.isfinite(seconds) or seconds < 0:
            raise ValueError('seconds must be finite and nonnegative')
        self.fraction += seconds
        ticks = int((self.fraction + 1e-8) / self.clock.dt)
        self.fraction = round(self.fraction - ticks * self.clock.dt, 9)
        for _ in range(ticks):
            if self.complete:
                break
            self._step()

    def _step(self):
        dt = self.clock.dt
        self.clock.advance()
        self.revision += 1
        for m in self.machines.values():
            if m['fault_remaining'] > 0:
                m['fault_remaining'] = max(0., round(m['fault_remaining'] - dt, 6))
                if m['fault_remaining'] == 0:
                    self._event('restore', m['id'], m['part_id'], f"{m['id']} repaired; retained work resumes")
                else:
                    m['status'] = 'fault'
                    continue
            if m['phase'] in ('setup', 'running'):
                m['remaining'] = max(0., m['remaining'] - dt)
                if m['phase'] == 'running':
                    m['progress'] = min(1., 1 - m['remaining'] / m['duration'])
                if m['remaining'] < 1e-7:
                    if m['phase'] == 'setup':
                        self._start_processing(m)
                    elif m['id'][0] in 'LM':
                        m['phase'] = 'done'
                        self.parts[m['part_id']]['status'] = 'awaiting_unload'
                    elif len(m['output']) < QUEUE_CAPACITY:
                        self._begin_station_handoff(m, 'unload')
                    else:
                        m['phase'] = 'done'
            if m['id'][0] not in 'LM' and m['phase'] == 'done' and len(m['output']) < QUEUE_CAPACITY:
                self._begin_station_handoff(m, 'unload')
            if m['id'][0] not in 'LM' and m['phase'] in ('loading', 'unloading'):
                p = self.parts[m['part_id']]
                if self._move_transfer(p, dt):
                    if m['phase'] == 'loading':
                        p.update(buffer_location=None, buffer_slot=None)
                        self._start_setup(m)
                    else:
                        self._finish_operation(m)
            if m['id'][0] not in 'LM' and m['phase'] == 'idle' and m['queue']:
                pid = sorted(m['queue'], key=lambda pid: self._priority(self.parts[pid]))[0]
                m['queue'].remove(pid)
                m['part_id'] = pid
                self._begin_station_handoff(m, 'load')
            m['status'] = self._machine_status(m)
        self._step_robots(dt)
        self._step_amrs(dt)
        self._dispatch()
        self._place_static_parts()
        self._refresh_fault_impact()
        self.waiting_seconds += dt * sum(p['status'] in ('queued', 'waiting_transport', 'awaiting_unload', 'awaiting_pickup') for p in self.parts.values())

    @staticmethod
    def _machine_status(machine):
        if machine['fault_remaining']:
            return 'fault'
        return {'idle': 'waiting' if machine['queue'] else 'idle', 'loading': 'waiting',
                'setup': 'setup', 'running': 'running', 'done': 'blocked',
                'unloading': 'blocked'}[machine['phase']]

    def _place_static_parts(self):
        # Initial inventory placement only. Every later change is a timed handoff;
        # removing a neighbor never renumbers or moves a part's reserved slot.
        if self.clock.tick == 0:
            for p in self.parts.values():
                p['position'] = self._buffer_position('RAW', p['buffer_slot'])

    def _buffer_position(self, location, slot):
        if location in ('RAW', 'FG'):
            return [(-21.35 if location == 'RAW' else 18.65) + slot % 4 * .9,
                    .95 + slot // 16 * .45, -9.6 + (slot // 4) % 4 * 1.05]
        pos = self._dock(location)
        pos[0] += (slot % 4 - 1.5) * .55
        pos[1] += slot // 4 * .45
        return pos

    def _reserve_buffer_slot(self, location):
        used = {p['buffer_slot'] for p in self.parts.values() if p.get('buffer_location') == location}
        used.update(p['reserved_slot']['slot'] for p in self.parts.values()
                    if p.get('reserved_slot') and p['reserved_slot']['location'] == location)
        return next(slot for slot in range(len(self.parts) + 4) if slot not in used)

    def _begin_transfer(self, p, kind, target, duration=None):
        duration = duration or max(self.clock.dt, math.dist(p['position'], target) / 2.5)
        p['transfer'] = dict(kind=kind, start=p['position'][:], target=target[:],
                             duration=duration, remaining=duration)

    @staticmethod
    def _move_transfer(p, dt):
        transfer = p['transfer']
        transfer['remaining'] = max(0., transfer['remaining'] - dt)
        t = min(1., 1 - transfer['remaining'] / transfer['duration'])
        p['position'] = [x + (y - x) * t for x, y in zip(transfer['start'], transfer['target'])]
        if transfer['remaining'] < 1e-7:
            p['transfer'] = None
            return True
        return False

    def _begin_station_handoff(self, m, action):
        p = self.parts[m['part_id']]
        if action == 'load':
            target = POSITIONS[m['id']]
        else:
            slot = self._reserve_buffer_slot(m['id'])
            p['reserved_slot'] = dict(location=m['id'], slot=slot)
            target = self._buffer_position(m['id'], slot)
        m['phase'] = 'loading' if action == 'load' else 'unloading'
        p.update(status=m['phase'], stage_index=STAGES[m['operation']])
        self._begin_transfer(p, 'station_' + action, target)

    def _start_setup(self, m):
        p = self.parts[m['part_id']]
        p.update(location=m['id'], position=POSITIONS[m['id']][:], waiting_reason=None)
        p.update(stage_index=STAGES[m['operation']], buffer_location=None, buffer_slot=None, transfer=None)
        if m['family'] != p['part_type']:
            m.update(phase='setup', remaining=SETUP_SECONDS, duration=SETUP_SECONDS, family=p['part_type'])
            p['status'] = 'setup'
            self._event('setup_started', m['id'], p['id'], f"Setup {m['id']} for {p['part_type']}")
        else:
            self._start_processing(m)

    def _start_processing(self, m):
        p = self.parts[m['part_id']]
        duration = DURATIONS[p['part_type']][m['operation']]
        m.update(phase='running', remaining=duration, duration=duration, progress=0.)
        p.update(status='processing', stage_index=STAGES[m['operation']], waiting_reason=None)
        self._event('processing_started', m['id'], p['id'], f"{p['id']} begins {m['operation']}")

    def _finish_operation(self, m):
        p = self.parts[m['part_id']]
        m['output'].append(p['id'])
        self._event('operation_completed', m['id'], p['id'], f"{p['id']} completes {m['operation']}")
        p['route_index'] += 1
        route = ROUTES[p['part_type']]
        p.update(operation=route[p['route_index']] if p['route_index'] < len(route) else 'finished',
                 status='waiting_transport', assigned_machine=None, target=None, ready_at=self.elapsed,
                 waiting_reason='Awaiting AMR and downstream capacity', location=m['id'],
                 buffer_location=m['id'], buffer_slot=p['reserved_slot']['slot'] if p.get('reserved_slot') else p['buffer_slot'],
                 reserved_slot=None, transfer=None)
        m.update(part_id=None, phase='idle', progress=0., remaining=0.)

    def _step_robots(self, dt):
        for rid, r in self.robots.items():
            cells = ['L01', 'L02', 'L03'] if rid == 'R01' else ['M01', 'M02', 'M03']
            if r['status'] != 'idle':
                m = self.machines[r['machine_id']]
                if r['status'] == 'recovering' or m['fault_remaining'] > 0:
                    self._recover_robot_handoff(r, m, dt)
                else:
                    self._step_robot_handoff(r, m, dt)
            if r['status'] == 'idle':
                ready = [self.machines[mid] for mid in cells if not self.machines[mid]['fault_remaining']]
                unload = next((m for m in ready if m['phase'] == 'done' and len(m['output']) < QUEUE_CAPACITY), None)
                load = [m for m in ready if m['phase'] == 'idle' and m['queue']]
                m = unload or (min(load, key=lambda m: min(self._priority(self.parts[p]) for p in m['queue'])) if load else None)
                if m:
                    action = 'unload' if unload else 'load'
                    if action == 'load':
                        pid = min(m['queue'], key=lambda pid: self._priority(self.parts[pid]))
                        m['queue'].remove(pid)
                        m['part_id'] = pid
                    pid = m['part_id']
                    duration = 4. + abs(r['position'][0] - POSITIONS[m['id']][0]) / 3.
                    m['phase'] = 'loading' if action == 'load' else 'unloading'
                    r.update(status=action + 'ing', action=action, machine_id=m['id'], part_id=pid,
                             duration=duration, remaining=duration, start=r['position'][:])
                    p = self.parts[pid]
                    if action == 'unload':
                        p['reserved_slot'] = dict(location=m['id'], slot=self._reserve_buffer_slot(m['id']))
                    r['pickup_position'] = p['position'][:]
                    r['drop_position'] = (POSITIONS[m['id']][:] if action == 'load' else
                                           self._buffer_position(m['id'], p['reserved_slot']['slot']))
                    # Retain the four-second service minimum, and bound payload speed.
                    service = max(4., 2 * math.dist(r['pickup_position'], r['drop_position']) / 2.5)
                    r['service_duration'] = service
                    r['duration'] = r['remaining'] = duration - 4. + service
                    p['stage_index'] = STAGES[m['operation']]
                    self.parts[pid].update(status=action + 'ing', waiting_reason=None)
                    self._event(action + '_started', rid, pid, f"{rid} {action}s {pid} at {m['id']}")

    @staticmethod
    def _release_robot(robot):
        robot.update(status='idle', machine_id=None, part_id=None, tip=None, action=None,
                     recovery=None, remaining=0., duration=0.)

    def _recover_robot_handoff(self, r, m, dt):
        """Recover from a CNC production fault; the independent tending robot still works."""
        p = self.parts[r['part_id']]
        if r['status'] != 'recovering':
            carried = p['location'] == r['id']
            start = (r['tip'] or [r['position'][0], 1.3, r['position'][2]])[:]
            target = (self._buffer_position(m['id'], p['buffer_slot']) if r['action'] == 'load'
                      else r['drop_position']) if carried else [r['position'][0], 1.3, r['position'][2]]
            duration = max(.4, math.dist(start, target) / 2.5)
            r.update(status='recovering', remaining=duration, duration=duration,
                     recovery=dict(carried=carried, start=start, target=target))
            p['waiting_reason'] = 'Machine fault: robot retracting to release shared resource'
            self._event('handoff_recovery_started', r['id'], p['id'],
                        f"{r['id']} recovers interrupted {r['action']} at {m['id']}")
        r['busy_seconds'] += dt
        r['remaining'] = max(0., r['remaining'] - dt)
        recovery = r['recovery']
        t = min(1., 1 - r['remaining'] / r['duration'])
        r['tip'] = [recovery['start'][k] + (recovery['target'][k] - recovery['start'][k]) * t for k in range(3)]
        if recovery['carried']:
            p['position'] = r['tip'][:]
        if r['remaining'] > 1e-7:
            return
        if r['action'] == 'load':
            # No machining has started. Return it to the reserved input slot.
            m['queue'].insert(0, p['id'])
            m.update(part_id=None, phase='idle', progress=0., remaining=0.)
            p.update(location=m['id'], status='queued', transfer=None,
                     assigned_machine=m['id'], waiting_reason='Awaiting machine repair or physical reroute')
        elif recovery['carried']:
            # Processing finished before pickup; complete delivery into the output buffer.
            self._finish_operation(m)
        else:
            # Still clamped: leave the completed part in the machine for later unloading.
            m['phase'] = 'done'
            p['reserved_slot'] = None
            p.update(status='awaiting_unload', waiting_reason='Awaiting machine repair before unloading')
        m['status'] = self._machine_status(m)
        self._event('handoff_recovered', r['id'], p['id'],
                    f"{r['id']} released after recovery at {m['id']}")
        self._release_robot(r)

    def _step_robot_handoff(self, r, m, dt):
        r['busy_seconds'] += dt
        r['remaining'] = max(0., r['remaining'] - dt)
        travel = abs(POSITIONS[m['id']][0] - r['start'][0]) / 3.
        consumed = r['duration'] - r['remaining']
        x = r['start'][0] + (POSITIONS[m['id']][0] - r['start'][0]) * min(1., consumed / max(travel, 1e-8))
        r['position'][0] = x
        p = self.parts[r['part_id']]
        service_t = min(1., max(0., (consumed - travel) / r.get('service_duration', 4.)))
        rail = r['position']
        if service_t < .5:
            t = service_t * 2
            start = [x, 1.3, rail[2]]
            r['tip'] = [start[k] + (r['pickup_position'][k] - start[k]) * t for k in range(3)]
        else:
            t = (service_t - .5) * 2
            r['tip'] = [r['drop_position'][k] * t + r['pickup_position'][k] * (1 - t) for k in range(3)]
            p.update(position=r['tip'][:], location=r['id'])
        if r['remaining'] < 1e-7:
            if r['action'] == 'load':
                self._start_setup(m)
            else:
                self._finish_operation(m)
            self._event(r['action'] + '_completed', r['id'], p['id'], f"{r['id']} completes {r['action']} at {m['id']}")
            self._release_robot(r)

    @staticmethod
    def _dock(mid):
        if mid == 'RAW':
            return [-16., .9, -8.]
        if mid == 'FG':
            return [20., .9, -4.1]
        pos = POSITIONS[mid][:]
        pos[1] = .9
        if mid[0] in 'LM':
            pos[2] = -3. if pos[2] < 0 else 3.
        else:
            pos[2] += 3.2 if pos[2] < 0 else -3.2
        return pos

    @staticmethod
    def _path(start, end):
        # Fixed central aisle and station spurs; no direct machine-to-machine shortcuts.
        lane = -1.2 if end[2] < 0 else 1.2
        points = [[start[0], .35, -1.2 if start[2] < 0 else 1.2],
                  [start[0], .35, lane], [end[0], .35, lane], [end[0], .35, end[2]]]
        out = []
        current = start[:]
        for point in points:
            length = math.dist(current, point)
            n = max(1, math.ceil(length / 1.5))
            for j in range(1, n + 1):
                out.append([current[k] + (point[k] - current[k]) * j / n for k in range(3)])
            current = point
        return out

    def _carrier_trajectory(self, a, p, target, slot):
        trajectory = []
        current = a['position'][:]
        handoffs = {}
        for mode, destination in [('pickup', p['location']), ('transport', target), ('returning', None)]:
            end = self._dock(destination) if destination else a['parking'][:]
            end[1] = .35
            points = sample_path(current, self._path(current, end), 3. * self.clock.dt)
            trajectory.extend(dict(position=point, mode=mode) for point in points)
            current = end[:]
            if mode == 'returning':
                continue
            cargo = [end[0], .9, end[2]]
            start = p['position'] if mode == 'pickup' else cargo
            finish = cargo if mode == 'pickup' else self._buffer_position(target, slot)
            count = max(1, math.ceil(math.dist(start, finish) / (2.5 * self.clock.dt)))
            phase = 'pickup_transfer' if mode == 'pickup' else 'delivery_transfer'
            trajectory.extend(dict(position=current[:], mode=phase) for _ in range(count))
            handoffs[phase] = dict(target=finish, duration=count * self.clock.dt)
        return trajectory, handoffs

    def _step_amrs(self, dt):
        for a in self.amrs.values():
            a['previous_position'] = a['position'][:]
        for aid, a in self.amrs.items():
            if a['status'] == 'idle':
                continue
            if a['traffic_delay']:
                a['traffic_delay'] -= 1
                a['status'] = 'waiting_traffic'
                continue
            if not a['trajectory']:
                a.update(status='idle', from_id=None, to_id=None, segments=[], path=[])
                self.reservations.pop(aid, None)
                continue
            entry = a['trajectory'].pop(0)
            point, mode = entry['position'], entry['mode']
            previous = a['position']
            if math.dist(previous, point) > 1e-8:
                a['heading'] = math.atan2(point[2] - previous[2], point[0] - previous[0])
            a.update(position=point[:], status=mode)
            a['path'] = [e['position'][:] for e in a['trajectory'][:100] if e['mode'] == mode]
            if mode == 'returning':
                if not a['trajectory']:
                    a.update(status='idle', from_id=None, to_id=None, path=[])
                    self.reservations.pop(aid, None)
                continue
            p = self.parts[a['part_id']]
            if mode in ('pickup_transfer', 'delivery_transfer'):
                if p['transfer'] is None:
                    handoff = a['handoffs'][mode]
                    self._begin_transfer(p, 'pickup' if mode == 'pickup_transfer' else 'delivery',
                                         handoff['target'], handoff['duration'])
                    p['status'] = mode
                if not self._move_transfer(p, dt):
                    continue
                if mode == 'pickup_transfer':
                    if a['from_id'] in self.machines:
                        self.machines[a['from_id']]['output'].remove(p['id'])
                    p.update(location=aid, status='transport', buffer_location=None, buffer_slot=None,
                             waiting_reason=None)
                    a['loaded'] = True
                    self._event('picked_up', aid, p['id'], f"{aid} picks up {p['id']}")
                else:
                    target = a['to_id']
                    slot = p['reserved_slot']['slot']
                    p.update(location=target, assigned_machine=None, target=None,
                             buffer_location=target, buffer_slot=slot, reserved_slot=None)
                    if target == 'FG':
                        p.update(status='finished', stage_index=6, completed_at=self.elapsed,
                                 waiting_reason=None, affected=False)
                        self._event('finished', target, p['id'], f"{p['id']} delivered to finished goods")
                        if all(x['status'] == 'finished' for x in self.parts.values() if x['order_id'] == p['order_id']):
                            self.finished_at[p['order_id']] = self.elapsed
                    else:
                        m = self.machines[target]
                        m['incoming'].remove(p['id'])
                        m['queue'].append(p['id'])
                        p.update(status='queued', assigned_machine=target, waiting_reason='Awaiting machine / tending robot')
                        self._event('queued', target, p['id'], f"{p['id']} delivered to {target} input")
                    a.update(status='returning', part_id=None, from_id=target, to_id=None, loaded=False,
                             completed_trips=a['completed_trips'] + 1)
            elif a['loaded']:
                p['position'] = [point[0], .9, point[2]]

    def _dispatch(self):
        if self.policy in ('reroute', 'edd'):
            self._reroute_queued()
        waiting = sorted((p for p in self.parts.values() if p['status'] == 'waiting_transport'), key=self._priority)
        for p in waiting:
            if p['target'] in self.machines and self.machines[p['target']]['fault_remaining']:
                # Unassigned transport can be planned again; a moving AMR keeps its destination.
                p.update(target=None, assigned_machine=None)
            if p['target'] is None:
                p['target'] = 'FG' if p['operation'] == 'finished' else self._choose(p)
                p['assigned_machine'] = p['target'] if p['target'] != 'FG' else None
            target = p['target']
            if not target:
                healthy = any(m['operation'] == p['operation'] and not m['fault_remaining']
                              and p['part_type'] in COMPATIBILITY[m['id']] for m in self.machines.values())
                p['waiting_reason'] = 'Downstream input queues full' if healthy else 'No compatible healthy machine available'
                continue
            if target != 'FG' and not self._capacity(self.machines[target]):
                p['waiting_reason'] = f'{target} input queue full'
                continue
            idle = [a for a in self.amrs.values() if a['status'] == 'idle']
            if not idle:
                p['waiting_reason'] = 'Both AMRs busy'
                continue
            pickup_dock = self._dock(p['location'])
            a = min(idle, key=lambda a: (a['completed_trips'], math.dist(a['position'], pickup_dock)))
            slot = self._reserve_buffer_slot(target)
            trajectory, handoffs = self._carrier_trajectory(a, p, target, slot)
            other = next(x for x in self.amrs.values() if x['id'] != a['id'])
            other_future = ([dict(position=other['position'][:], mode='waiting_traffic')]
                            * other['traffic_delay'] + other['trajectory'])
            delay = departure_delay(a['position'], trajectory, other['position'], other_future)
            self.reservations[a['id']] = dict(until_tick=self.clock.tick + delay + len(trajectory))
            p['reserved_slot'] = dict(location=target, slot=slot)
            a.update(status='waiting_traffic' if delay else 'pickup', part_id=p['id'],
                     from_id=p['location'], to_id=target, loaded=False, trajectory=trajectory,
                     traffic_delay=delay, handoffs=handoffs,
                     path=[e['position'][:] for e in trajectory if e['mode'] == 'pickup'], segments=[])
            if target != 'FG':
                self.machines[target]['incoming'].append(p['id'])
            p.update(status='awaiting_pickup', waiting_reason='Assigned AMR approaching')
            self._event('transport_assigned', a['id'], p['id'], f"{a['id']} assigned {p['id']}: {p['location']} → {target}")

    def set_fault(self, machine_id, duration_seconds, active):
        if machine_id not in self.machines or machine_id[0] not in 'LM':
            raise ValueError('Fault target must be one of L01–L03 or M01–M03')
        if not math.isfinite(duration_seconds) or duration_seconds <= 0:
            raise ValueError('Fault duration must be positive and finite')
        m = self.machines[machine_id]
        m['fault_remaining'] = float(duration_seconds) if active else 0.
        m['status'] = self._machine_status(m)
        self._refresh_fault_impact()
        self._event('fault' if active else 'restore', machine_id, m['part_id'],
                    f'{machine_id}: simulated fault for {duration_seconds:g}s' if active else f'{machine_id}: repair completed')
        self.revision += 1

    def _refresh_fault_impact(self):
        for p in self.parts.values():
            dependencies = [m for m in self.machines.values() if
                p['id'] in m['queue'] or p['id'] in m['incoming'] or m['part_id'] == p['id']]
            if p['target'] in self.machines:
                dependencies.append(self.machines[p['target']])
            unavailable = (p['status'] == 'waiting_transport' and p['operation'] != 'finished'
                and not any(m['operation'] == p['operation'] and not m['fault_remaining']
                            and p['part_type'] in COMPATIBILITY[m['id']] for m in self.machines.values()))
            p['affected'] = p['status'] != 'finished' and (unavailable or any(m['fault_remaining'] for m in dependencies))
            p['historically_affected'] = p.get('historically_affected', False) or p['affected']

    def set_policy(self, policy):
        if policy not in ('fifo', 'reroute', 'edd'):
            raise ValueError('Unknown dispatch policy')
        self.policy = policy
        if policy in ('reroute', 'edd'):
            for p in self.parts.values():
                if p['status'] == 'waiting_transport':
                    p.update(target=None, assigned_machine=None)
            self._reroute_queued()
        self._refresh_fault_impact()
        self.revision += 1
        self._event('policy_applied', 'dispatch', None, f'Dispatch policy: {policy}')

    def _reroute_queued(self):
        for p in self.parts.values():
            if p['status'] != 'queued':
                continue
            m = self.machines[p['location']]
            # A handoff already unloading owns its eventual output slot, including recovery.
            reserved_output = int(m['phase'] == 'unloading')
            if not m['fault_remaining'] or len(m['output']) + reserved_output >= QUEUE_CAPACITY:
                continue
            alternatives = [x for x in self.machines.values() if x['operation'] == m['operation']
                            and not x['fault_remaining'] and self._capacity(x)
                            and p['part_type'] in COMPATIBILITY[x['id']]]
            if alternatives:
                m['queue'].remove(p['id'])
                m['output'].append(p['id'])
                p.update(status='waiting_transport', target=None, assigned_machine=None,
                         waiting_reason='Awaiting physical reroute by AMR')
                self._event('reroute_requested', m['id'], p['id'], f"{p['id']}: unstarted work requests physical transfer")

    def dump_state(self):
        result = {key: copy.deepcopy(getattr(self, key)) for key in
                  ('run_id', 'revision', 'paused', 'speed', 'policy', 'fraction', 'waiting_seconds',
                   'parts', 'machines', 'robots', 'amrs', 'reservations', 'finished_at')}
        result.update(config=self.config.model_dump(mode='json'), clock=self.clock.dump_state(), bus=self.bus.dump_state())
        return result

    @classmethod
    def from_state(cls, state):
        state = copy.deepcopy(state)
        engine = cls(WorkshopConfig.model_validate(state.pop('config')), run_id=state['run_id'])
        engine.clock.load_state(state.pop('clock'))
        engine.bus.load_state(state.pop('bus'))
        for key, value in state.items():
            setattr(engine, key, value)
        return engine

    def state_hash(self):
        return 'sha256:' + hashlib.sha256(json.dumps(self.dump_state(), sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()

    def assert_invariants(self):
        claimed = []
        for m in self.machines.values():
            assert len(m['queue']) + len(m['incoming']) + int(m['phase'] == 'loading') <= QUEUE_CAPACITY
            assert len(m['output']) + int(m['phase'] == 'unloading') <= QUEUE_CAPACITY
            assert len(set(m['queue'] + m['incoming'])) == len(m['queue'] + m['incoming'])
            claimed.extend(m['queue'])
            claimed.extend(m['output'])
            if m['part_id']:
                claimed.append(m['part_id'])
        assert len(claimed) == len(set(claimed)), 'Part assigned to multiple processing resources'
        passengers = [a['part_id'] for a in self.amrs.values() if a['part_id']]
        assert len(passengers) == len(set(passengers))
        incoming = [pid for m in self.machines.values() for pid in m['incoming']]
        assert len(incoming) == len(set(incoming)), 'Duplicate inbound reservation'
        slots = []
        for p in self.parts.values():
            assert p['location'] in POSITIONS or p['location'] in self.robots or p['location'] in self.amrs
            assert len(p['position']) == 3 and all(math.isfinite(x) for x in p['position'])
            location = p['location']
            if location in self.machines:
                m = self.machines[location]
                assert p['id'] in m['queue'] + m['output'] + [m['part_id']]
            elif location in self.robots:
                r = self.robots[location]
                assert r['part_id'] == p['id'] and self.machines[r['machine_id']]['part_id'] == p['id']
            elif location in self.amrs:
                a = self.amrs[location]
                assert a['loaded'] and a['part_id'] == p['id'] and p['id'] not in claimed
            else:
                assert p['id'] not in claimed
            if p.get('buffer_location'):
                slots.append((p['buffer_location'], p['buffer_slot']))
            if p.get('reserved_slot'):
                slots.append((p['reserved_slot']['location'], p['reserved_slot']['slot']))
            if p['status'] == 'finished':
                assert location == 'FG' and p['transfer'] is None and p['completed_at'] is not None and not p['affected']
        assert len(slots) == len(set(slots)), 'Two parts occupy or reserve one buffer slot'
        for a in self.amrs.values():
            assert not a['loaded'] or (a['part_id'] and self.parts[a['part_id']]['location'] == a['id'])
            assert a['status'] not in ('idle', 'returning') or (not a['loaded'] and a['part_id'] is None)
            if a['part_id']:
                p = self.parts[a['part_id']]
                assert p['target'] == a['to_id'] and p['reserved_slot']['location'] == a['to_id']
                if a['to_id'] in self.machines:
                    assert p['id'] in self.machines[a['to_id']]['incoming']
        assert set(incoming) == {a['part_id'] for a in self.amrs.values()
                                 if a['part_id'] and a['to_id'] in self.machines}, 'Orphan inbound reservation'
        a, b = self.amrs.values()
        assert separated(a.get('previous_position', a['position']), a['position'],
                         b.get('previous_position', b['position']), b['position']), 'Carrier swept paths overlap'
        assert all(p['part_type'] in COMPATIBILITY[m['id']] for m in self.machines.values()
                   for p in [self.parts[pid] for pid in m['queue'] + m['incoming'] + ([m['part_id']] if m['part_id'] else [])])

    def snapshot(self):
        self._refresh_fault_impact()
        orders = []
        for o in self.config.orders:
            parts = [p for p in self.parts.values() if p['order_id'] == o.id]
            done = sum(p['status'] == 'finished' for p in parts)
            finish = self.finished_at.get(o.id)
            orders.append(dict(**o.model_dump(), completed=done, status='completed' if done == o.quantity else 'in_progress' if self.elapsed else 'released',
                projected_finish=finish, tardiness=round(max(0., (finish if finish is not None else self.elapsed) - o.due_seconds), 3),
                affected=any(p['affected'] for p in parts),
                historically_affected=any(p.get('historically_affected', False) for p in parts)))
        completed = sum(p['status'] == 'finished' for p in self.parts.values())
        utilization = {rid: round(r['busy_seconds'] / max(self.elapsed, .2), 4) for rid, r in self.robots.items()}
        metrics = dict(completed_parts=completed, total_parts=len(self.parts), wip=len(self.parts) - completed,
            waiting_seconds=round(self.waiting_seconds, 3), on_time_orders=sum(o['status'] == 'completed' and o['tardiness'] == 0 for o in orders),
            tardy_seconds=round(sum(o['tardiness'] for o in orders), 3), robot_utilization=utilization)
        bottlenecks = []
        for mid, m in self.machines.items():
            dispatch = [p['id'] for p in self.parts.values() if p['target'] == mid and p['status'] == 'waiting_transport']
            waiting = [self.parts[pid] for pid in m['queue'] + m['incoming'] + dispatch]
            if m['fault_remaining'] or waiting:
                bottlenecks.append(dict(resource=mid, reason='Machine fault: processing / handoff paused' if m['fault_remaining'] else 'Finite input / tending capacity',
                    queued_parts=len(m['queue']), incoming_parts=len(m['incoming']), awaiting_dispatch_parts=len(dispatch),
                    waiting_parts=len(waiting), order_ids=sorted({p['order_id'] for p in waiting} | ({self.parts[m['part_id']]['order_id']} if m['part_id'] else set()))))
        events = [dict(seq=e['seq'], time=round(e['sim_tick'] * self.clock.dt, 3), kind=e['event_type'], resource=e['source_id'],
                       part_id=e['cell_id'], message=e['message']) for e in self.bus.recent(100)]
        robots = copy.deepcopy(list(self.robots.values()))
        for r in robots:
            r['utilization'] = utilization[r['id']]
        amrs = copy.deepcopy(list(self.amrs.values()))
        for a in amrs:
            a.pop('trajectory', None)
            a.pop('handoffs', None)
        return dict(run_id=self.run_id, revision=self.revision, elapsed=self.elapsed, paused=self.paused, speed=self.speed,
                    policy=self.policy, complete=self.complete, orders=orders, parts=copy.deepcopy(list(self.parts.values())),
                    machines=copy.deepcopy(list(self.machines.values())), robots=robots, amrs=amrs,
                    metrics=metrics, bottlenecks=bottlenecks, events=events, assumptions=[
                        'Demonstration simulation only; no real telemetry, machine control or material-removal physics.',
                        'Shaft: turning → milling → deburr → wash → inspection. Sleeve skips milling.',
                        'Input queues hold 2 parts including inbound and loading rollback reservations; unloading reserves an output slot. RAW/FG hold the finite order set.',
                        'Two exclusive rail robots each tend three CNCs; station transfers and fixtures are simplified.',
                        'RAW/FG and queues use stable reserved slots; timed rack/dock and station handoffs move parts continuously before inventory or processing commits.',
                        'Two AMRs reserve occupied trajectory intervals, including waits, dock service and empty returns. Time-separated paths operate concurrently with 2.4 m geometric separation; this is not certified collision planning.',
                        'Family setup 8 s; CNC faults retain clamped work. Interrupted robot handoffs retract/return input or complete picked output, then release the shared robot. Only unstarted queued work can reroute.',
                        'CNC production faults leave the independent robot and releasable fixtures operational; coupled safety stops or seized grippers are not modeled.',
                        'Projected finish is available when an order completes; compare policies for forward simulation estimates.',
                        'Due dates and all durations are simulated seconds; unfinished orders accrue observed tardiness only.'])
