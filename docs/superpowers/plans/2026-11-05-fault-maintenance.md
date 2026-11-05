# Fault Maintenance Work Orders Implementation Plan

> **For agentic workers:** Implement incrementally with a failing behavior test before each change; run the focused checks and then the full existing suite.

**Goal:** Preserve the RFTwin factory dashboard while adding a simulated fault-to-maintenance work-order workflow with repair comparison and a traceable record of the added functionality.

**Architecture:** Keep the existing deterministic engine authoritative for factory state. A separate SQLite-backed work-order service records selected live engine fault events, technician assignment and closure, with session/run provenance. The frontend adds a work-order view and links to the existing 3D view; all work-order data is explicitly simulated. Two repair-time alternatives are evaluated on isolated copies of the same engine snapshot.

**Tech Stack:** Python 3.12, FastAPI, SQLite, pytest, React 18, TypeScript, Vite, existing React Three Fiber scene.

## Global Constraints

- Retain the original MIT license and attribution; do not claim ownership of upstream code.
- Never control a real device. Work orders and repair comparisons use simulated state only.
- Preserve the upstream snapshot schema, local replay behavior, reset semantics and existing fault handling.
- Store local database files outside version control and isolate each backend session/run.
- Only close or repair a fault from the current engine instance when it matches the work order's incident.
- Clearly indicate when the authoritative backend is unavailable.

---

### Task 1: Work-order persistence and lifecycle

**Files:** Create `packages/domain_factory/workorders.py` and `tests/test_workorders.py`; update `.gitignore`.

**Interfaces:** `WorkOrderStore(path)` exposes `ingest(session_id, event)`, `list(session_id, run_id)`, `get(id)`, `start(id, assignee, sim_tick, sim_time)` and `complete(id, note, sim_tick, sim_time)`. The selected fault types are conveyor jam, robot tool failure, AMR failure and compressor fault. Duplicate event IDs do not create duplicate work orders.

- [ ] Write tests that create a temporary SQLite store, ingest the same event twice, assign a technician, close the order, reopen the store, and reject an invalid transition.
- [ ] Run `.venv\Scripts\python.exe -m pytest tests/test_workorders.py -q`; verify the new module is absent.
- [ ] Implement SQLite persistence and the `OPEN -> IN_PROGRESS -> COMPLETED` lifecycle; compute work-order counts and simulated elapsed time from ticks.
- [ ] Rerun the focused tests and confirm persistence, idempotence, validation and session isolation.

### Task 2: Live simulation integration and comparisons

**Files:** Modify `apps/factory_backend/main.py` and `packages/domain_factory/engine.py`; create `tests/test_workorder_api.py`.

**Interfaces:** `GET /api/work-orders` returns current-session work orders plus counts; `POST /api/work-orders/{id}/start` accepts an assignee; `POST /api/work-orders/{id}/complete` records the note; `POST /api/work-orders/{id}/compare` accepts two remaining repair durations and a simulation horizon. Endpoints report validation and stale-run errors instead of changing an unrelated incident.

- [ ] Write API tests that inject a conveyor fault, observe exactly one generated work order, assign it, complete it, and verify the simulated conveyor recovers. Test a stale order and invalid transition.
- [ ] Run `.venv\Scripts\python.exe -m pytest tests/test_workorder_api.py -q` and verify the endpoint tests fail.
- [ ] Capture qualifying fault events on direct injection, scenario application and ticker events. Keep simulation state changes under the existing lock. Invoke the original repair path for supported current incidents and label unsupported automatic recovery honestly.
- [ ] Compare two hypothetical remaining repair times using two isolated branches created from the same snapshot; return good output, downtime and energy outcomes without modifying live state.
- [ ] Rerun the focused service and API tests, including comparison isolation.

### Task 3: Dashboard integration

**Files:** Create `frontend/src/panels/WorkOrdersView.tsx` and `frontend/src/panels/workorders.css`; modify `frontend/src/App.tsx`, `frontend/src/panels/Panels.tsx`, `frontend/src/state/store.ts` and `frontend/src/i18n/index.ts`.

**Interfaces:** Add a `workorders` view accessible in the header; display simulated work-order counts, selected fault details, assignment/closure controls, and repair comparison. Preserve the 3D tab and expose a route back to it from the work-order view.

- [ ] Add a browser-level check for the work-order tab and offline/live messaging, then verify it fails before the view exists.
- [ ] Implement the view using existing API URL configuration and connection status; refresh work orders after mutations and show API errors.
- [ ] Run `npm.cmd run build` in `frontend` and execute the focused browser check if the browser runtime is available.

### Task 4: Final verification and documentation

**Files:** Modify `README.md`; add a Chinese operation guide at `docs/MAINTENANCE_ZH.md`.

- [ ] Document the simulated workflow, data persistence, supported repair actions, deployment limitations, MIT attribution, and the development contribution boundary.
- [ ] Run the focused backend tests, full backend suite, frontend build and available browser checks. Inspect `git diff --check` and `git status --short`.
- [ ] Record the tested behavior, any unresolved limitations, and the GitHub publication status for the user.
