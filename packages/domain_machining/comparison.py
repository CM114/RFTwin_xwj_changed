"""Isolated, reproducible policy branches from one JSON-compatible engine state."""
from .engine import MachiningEngine


def compare_policies(engine: MachiningEngine, horizon_seconds: float):
    if not 0 < horizon_seconds <= 7200:
        raise ValueError('Comparison horizon must be between 0 and 7200 seconds')
    state = engine.dump_state()
    result = dict(run_id=engine.run_id, revision=engine.revision, state_hash=engine.state_hash(),
                  horizon_seconds=horizon_seconds, scenarios=[])
    explanations = {
        'fifo': 'Wait for repair: preserve assigned queues and dispatch ready work in arrival order.',
        'reroute': 'Transfer eligible unstarted work from faulted queues to compatible healthy machines using AMRs; loaded work stays.',
        'edd': 'Prioritize earliest due orders at dispatch and queue service, with physical rerouting of eligible unstarted work.',
    }
    for policy in explanations:
        branch = MachiningEngine.from_state(state)
        branch.set_policy(policy)
        branch.advance(horizon_seconds)
        snap = branch.snapshot()
        result['scenarios'].append(dict(policy=policy, metrics=snap['metrics'], orders=snap['orders'],
            complete=branch.complete, elapsed=branch.elapsed, explanation=explanations[policy] +
            (' All orders completed within the horizon.' if branch.complete else ' Horizon ended with unfinished work; completion and tardiness are partial observations.')))
    return result
