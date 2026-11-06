# Order-driven machining implementation plan

> **For agentic workers:** Use executing-plans inline; request an independent code review at the integration checkpoint.

**Goal:** Deliver order-driven machining, visible material flow and isolated recovery comparison in the accepted 3D workshop.

**Architecture:** A dedicated machining domain reuses RFTwin clock/events; the existing FastAPI host publishes typed snapshots and owns controls. The workshop renders this state and retains its existing local scene-demo mode.

**Tech Stack:** Python / Pydantic / FastAPI / WebSocket, React / TypeScript / React Three Fiber, pytest / Playwright.

## Global constraints
- Retain existing 3D geometry, original RFTwin application and MIT attribution.
- No new runtime dependencies or real-device claims.
- Backend owns production outcomes, UI owns presentation.
- Work on the clean existing feature/machining-workshop branch; accepted demo is preserved by demo-baseline-v2.

## Tasks
- [x] 1. Add tests/test_machining.py: deterministic completion, conservation, queues/resource exclusivity, fault hold, setups, route differences, no teleportation. Run `.venv/Scripts/python.exe -m pytest tests/test_machining.py -q` and observe missing-domain failure. Implement packages/domain_machining/config.py, engine.py and comparison.py using SimulationClock/EventBus. Repeat tests until green.
- [x] 2. Add tests/test_machining_api.py for snapshot/control/fault/config validation, comparison isolation, stale apply and WebSocket. Run and observe missing-endpoint failures. Implement apps/factory_backend/workshop.py and include its router/lifespan in main.py before static mounting. Return errors for invalid targets/controls and run all backend tests.
- [x] 3. Add frontend production contracts, connection hook, bilingual production panel, and pose adapters under frontend/src/workshop/. Test real-backend browser mode transitions and production controls before integrating. Extend Scene.tsx to render backend machines, both real carriers, all parts, robot handoffs and selection tracking. Keep current App.tsx local behavior under scene-demo mode. Build before Playwright.
- [x] 4. Run a complete healthy/fault/compare/apply browser scenario, inspect desktop/narrow screenshots, run baseline model/e2e and backend suites. Request read-only code review, fix substantive findings, update docs/WORKSHOP_ZH.md and README.md, commit and push verified changes to the existing authorized branch.

## Verification commands
` .venv/Scripts/python.exe -m pytest tests/ -q`
`npm --prefix frontend run test:model`
`npm --prefix frontend run build`
`$env:PW_CHROMIUM='C:\Program Files\Google\Chrome\Application\chrome.exe'; npm --prefix frontend run test:e2e -- --grep workshop`
`git diff --check`

## Integration evidence (2026-11-06)

- Final full backend suite: 184 passed; one existing TestClient deprecation warning.
- Frontend model suite: 19 passed. Type-check and both production builds passed.
- Real-backend workshop browser suite: 16 passed, including preserved scene-demo regressions, full delivery, selection tracking, shared reset, fault comparison and policy application. Desktop and narrow screenshots inspected.
- Generated types, fixture validation, layout synchronization and staged whitespace checks passed.
- Independent backend and frontend review findings addressed: delayed HTTP reset responses cannot supersede a newer streamed run; fault controls target supported CNCs; settings refresh on shared reset; final empty AMR return completes; manual repair preserves interrupted setup status.
- Final integration inspection confirms displayed AMR routes use authoritative remaining paths. The bounded geometry cache stores immutable tuples; dispatch copies mutable paths and keeps reservations within each engine. The documented three-policy example was recomputed without result changes.
- Production parameters remain illustrative; simplified station transfers and in-memory state are documented in docs/WORKSHOP_ZH.md.
