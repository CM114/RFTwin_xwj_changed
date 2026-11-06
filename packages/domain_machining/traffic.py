"""Deterministic tick reservations for continuous, separated carrier motion.

Reservations describe occupied positions at consecutive tick boundaries. Conflict
checks minimize relative distance over each entire interval, including a waiting
or parked carrier. Only overlapping times conflict, so distant carriers progress
concurrently and no carrier can acquire a partial route then deadlock.
"""
import math

SEPARATION = 2.4


def sample_path(start, points, distance):
    position = start[:]
    points = [p[:] for p in points]
    result = []
    while points:
        budget = distance
        while points and budget > 1e-9:
            target = points[0]
            length = math.dist(position, target)
            fraction = min(1., budget / max(length, 1e-9))
            position = [x + (y - x) * fraction for x, y in zip(position, target)]
            budget -= length * fraction
            if fraction >= 1:
                points.pop(0)
        result.append(position[:])
    return result


def separated(a0, a1, b0, b1):
    delta = [a0[k] - b0[k] for k in (0, 2)]
    velocity = [(a1[k] - a0[k]) - (b1[k] - b0[k]) for k in (0, 2)]
    speed2 = sum(x * x for x in velocity)
    t = max(0., min(1., -sum(x * y for x, y in zip(delta, velocity)) / speed2)) if speed2 else 0.
    return sum((x + t * y) ** 2 for x, y in zip(delta, velocity)) >= SEPARATION ** 2 - 1e-8


def departure_delay(start, trajectory, other, other_trajectory):
    """Find the earliest safe departure, honoring the other carrier's full future."""
    positions = [entry['position'] for entry in trajectory]
    theirs = [other] + [entry['position'] for entry in other_trajectory]
    ours = [start] + positions
    for delay in range(len(theirs) + 1):
        valid = True
        for tick in range(max(delay + len(positions), len(theirs) - 1)):
            a0 = ours[max(0, min(len(ours) - 1, tick - delay))]
            a1 = ours[max(0, min(len(ours) - 1, tick + 1 - delay))]
            b0 = theirs[min(tick, len(theirs) - 1)]
            b1 = theirs[min(tick + 1, len(theirs) - 1)]
            if not separated(a0, a1, b0, b1):
                valid = False
                break
        if valid:
            return delay
    raise RuntimeError('No safe carrier departure after the existing reservation clears')
