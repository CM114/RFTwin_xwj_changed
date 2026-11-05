"""Compare hypothetical repair durations without mutating the live engine."""
from __future__ import annotations

from .whatif import _branch, validate_whatif


def _set_remaining_time(engine, order: dict, duration_sec: float) -> None:
    """Adjust only the matching simulated fault in an isolated branch."""
    ticks = max(1, int(duration_sec / engine.clock.dt))
    until = engine.clock.tick + ticks
    target = order["source_id"]
    failure_type = order["failure_type"]
    if failure_type == "conveyor_jam":
        conveyor = engine.conv_state.get(target)
        if not conveyor or conveyor["status"] != "JAMMED":
            raise ValueError("the simulated conveyor is no longer jammed")
        conveyor["jam_until"] = until
    elif failure_type == "tool_failure":
        station = next((s for cell in engine.cells.values() for s in cell["stations"]
                        if s["robot_id"] == target and s["fault_kind"] == "tool_failure"), None)
        if station is None:
            raise ValueError("the simulated robot fault is no longer active")
        station["fault_until"], station["fault_dur"] = until, ticks
    elif failure_type == "amr_fault":
        amr = next((a for a in engine.amrs if a["amr_id"] == target and a["task_state"] == "ERROR"), None)
        if amr is None:
            raise ValueError("the simulated AMR fault is no longer active")
        amr["fault_until"] = until
    elif failure_type == "compressor_fault":
        if engine.compressor_fault_until <= engine.clock.tick:
            raise ValueError("the simulated compressor fault is no longer active")
        engine.compressor_fault_until = until
        for station in engine.cells["welding"]["stations"]:
            if station["fault_kind"] == "utility_air":
                station["fault_until"], station["fault_dur"] = until, ticks
    else:
        raise ValueError(f"unsupported failure type: {failure_type}")


def compare_repair_times(*, state: dict, params: dict, order: dict,
                         duration_a_sec: float, duration_b_sec: float,
                         horizon_min: int) -> dict:
    """Evaluate two remaining durations from the same state and random seed.

    Returned metrics are increments during the evaluation window, not the
    cumulative counters accumulated before the comparison began.
    """
    duration_a_sec, horizon_min = validate_whatif(duration_a_sec, horizon_min)
    duration_b_sec, _ = validate_whatif(duration_b_sec, horizon_min)
    if duration_a_sec is None or duration_b_sec is None:
        raise ValueError("both remaining repair durations are required")
    origin = {"run_id": state["provenance"]["run_id"], "seq": state["bus"]["seq"]}
    options = []
    for label, seconds in (("A", duration_a_sec), ("B", duration_b_sec)):
        branch = _branch(state, f"WORKORDER-{label}", origin, params)
        _set_remaining_time(branch, order, seconds)
        before = branch.kpis()
        ticks = int(horizon_min * 60 / branch.clock.dt)
        branch.run_ticks(ticks)
        branch.check_conservation()
        after = branch.kpis()
        options.append({
            "duration_sec": seconds,
            "good_units": after["good_units"] - before["good_units"],
            "downtime_sec": round(after["downtime_sec"] - before["downtime_sec"], 1),
            "energy_kwh_total": round(after["energy_kwh_total"] - before["energy_kwh_total"], 2),
        })
    return {"branch_from": origin, "horizon_min": horizon_min, "options": options,
            "is_simulation_result": True}
