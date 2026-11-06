# Workshop release hardening

**Goal:** Resolve the six user-approved defects before software-registration documentation: fault lifecycle, authoritative visible inventory, useful two-carrier concurrency, explicit waiting counts, continuous handoffs, restart recovery and durable history.

**Architecture:** Extend the existing deterministic machining engine, typed API and React scene; preserve the original application and feature branch. SQLite stores machining runs and full engine snapshots. No new dependencies or real-equipment claims. The existing dedicated feature branch is clean and is reused so the user's preview remains available.

## State contracts

- Orders: `affected` is current fault impact; `historically_affected` is persistent history. Completed orders cannot be currently affected.
- Bottlenecks: `queued_parts`, `incoming_parts`, `awaiting_dispatch_parts`; `waiting_parts` is their explicit total. Machine snapshots retain `queue`, `incoming`, `output`.
- AMRs: authoritative `loaded` boolean and remaining path; empty carriers show no cargo. Traffic may report `waiting_traffic`.
- All part positions come from backend; docking/rack and fixed-station handoffs consume time and move continuously. Transfer phases and reservations survive JSON cloning.
- Persistence: `/api/workshop/runs` lists saved runs, `/api/workshop/runs/{run_id}` returns saved snapshot + durable events, `/api/workshop/runs/{run_id}/restore` restores a saved run paused under a fresh run ID. Store current state after commands and periodically; graceful shutdown flushes. Environment `TWIN_WORKSHOP_DB` overrides default `.data/workshop.sqlite3`; tests use temporary storage.

## Tasks

- [x] Domain: regression-first current/historical fault semantics; categorized waits; replace spatial full-trip exclusion with time-indexed trajectory reservations including swept carrier separation and completion/no-deadlock checks; timed continuous handoffs including inventory; preserve deterministic clone and fault recovery.
- [x] Persistence/API: SQLite atomic state/history saves, restart restore paused, archived runs survive reset, history and restore routes, isolation tests and legacy lifespan integration.
- [x] Frontend: remove all decorative cargo in production only; correct current/history labels, waiting categories, traffic/handoff states; production-history view with restore; contracts and browser tests.
- [x] Integration: all six acceptance cases verified; independent review, focused and full regression, build/browser/screenshots and operating-doc updates completed. Verified change set prepared for commit and push to the existing feature branch.

## Acceptance

Repair clears current fault status while retaining history; visible finished inventory is empty initially; AMR02 has no box empty; two AMRs travel concurrently on nonconflicting segments without collision/deadlock; displayed queue equals actual queue and separately shows in-transit/planned work; RAW/FG/fixed station transfers move continuously; restarted service retains run, parts, clock, histories and reservations and resumes only on command; reset archives prior runs; saved history can be inspected and restored. Registration documentation must describe simulation features actually implemented and retain upstream MIT attribution.

## Verification evidence

- Full backend regression: 213 passed. Final machining/domain/API/storage regression after final review fixes: 45 passed.
- Frontend model contracts: 23 passed; TypeScript check and production build passed.
- Browser workshop regression: 22 passed, including six live-backend production cases and four isolated contract/error cases. Actual API/browser history test verifies repair history, archival, paused-copy restore and source-record immutability.
- Real backend process restart retained the progressed 73.4-second snapshot exactly, including parts, carriers, active fault and events; only paused/revision recovery semantics change.
- Desktop, narrow layout and record-dialog screenshots inspected. Independent domain/storage/frontend cross-review and final integration review found no material blockers.
- Operational documentation updated with SQLite path, recovery/backup behavior, current/history semantics, queue categories, traffic assumptions and continuously timed handoffs. Original MIT attribution retained.
