# Workshop fault recovery and stable cutaway

**Goal:** A CNC fault must release its shared tending robot after an explicit recovery motion, while the six CNC enclosures retain a consistent cutaway appearance.

**Design:** Retain the deterministic engine and existing policy comparisons. On a fault during handoff, retract an empty gripper, return an unprocessed held part to its reserved input slot, or complete transfer of an already picked, fully processed part to output. Never relocate an unfinished clamped workpiece. Release the robot to healthy machines after recovery. Reserve input capacity during loading so rollback cannot overfill a queue. New dispatches avoid unavailable CNCs; transfers already underway retain their destination and follow the selected waiting/rerouting policy. Keep all CNCs in fixed cutaway view regardless of processing or selection.

**Files:** `packages/domain_machining/engine.py`, `tests/test_machining.py`, workshop scene/labels, production browser tests, `docs/WORKSHOP_ZH.md`.

- [x] Reproduce loading/unloading robot starvation and record failing tests for pre/post-pickup recovery, continuity, capacity, healthy-machine service, repair and clone determinism.
- [x] Implement phase-aware recovery and unavailable-machine dispatch filtering. Verify focused domain/API tests and update displayed recovery descriptions.
- [x] Fix the scene cutaway and inspect screenshots across idle, processing, fault and selection. No state-dependent cover condition remains in either mode.
- [x] Run backend regression, frontend model/build and live workshop browser suites; inspect screenshots, update docs, commit and push.

**Constraints:** No new dependencies; no new robot, no teleporting held work, no change to original FactoryEngine. Recovery models a CNC production fault with independent functioning robot and releasable fixtures; a coupled safety stop is outside this demonstration model.

## Verification

- Observed seven new fault-recovery regressions fail before implementation, then pass.
- Independent review identified output overflow when rerouting queued work during a picked unload recovery. Added two reproductions (reroute/EDD), observed both fail, then reserved the unloading output slot. Reviewer rechecked successfully with 60 randomized fault/repair seeds, ownership checks and eventual completion.
- Backend full regression during integration: 191 passed. After the output reservation fix and final assumption text update, final focused machining/API suite: 23 passed, including the two additional output regression cases.
- Frontend models: 19 passed; type-check and Vite build passed.
- Workshop browser suite: 17 passed. After the final backend fix and service restart, all six production browser tests passed again, including the new interrupted-handoff/healthy-machine continuation scenario.
- Additional local stress verification: 20 randomized fault/repair runs respected invariants and completed all orders. The documented t=1s three-policy comparison retains identical results.
- Fixed cutaway screenshots inspected at desktop and narrow widths. Whitespace checks passed. The existing TestClient deprecation warning remains unrelated.
