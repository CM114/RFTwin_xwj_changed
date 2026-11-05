# Workshop Transport and Focus Implementation Plan

**Goal:** Make the machining workshop easier to read and show one workpiece carried by an AMR through every processing handoff.

**Architecture:** Keep the scene in the standalone R3F application. Extend the pure workshop model with rail-robot poses and a station-to-station transport route, then render those poses in the scene. Selection drives the camera target; labels remain flat world-space planes.

**Tech Stack:** TypeScript, React, React Three Fiber, Three.js, Node test runner and Playwright.

## Global Constraints

- Preserve the separate `/workshop.html` application and the existing factory application.
- Keep the scene explicitly labeled as local simulation behavior with no real equipment connection.
- Keep two tending robots and two AMRs; make the robots' three-machine coverage and carrier route visible.
- Add no external model, font or runtime service dependency.

### Task 1: Model robot cells and material transport

**Files:** `frontend/src/workshop/model.ts`, `frontend/tests/workshop/model.test.mjs`.

- [x] Add regression tests for two robot cells covering all six CNC machines, rail poses visiting each cell machine, and a carrier path passing all seven handoff points.
- [x] Update the model with row-level robot assignments, robot rail positions and a transfer route whose handoff points are reachable and match the intended assets.
- [x] Make the dedicated carrier AMR start at the raw-stock pickup while preserving AMR02's general logistics loop.
- [x] Run `npm run test:model` and verify both the new cases and existing deterministic simulation tests.

### Task 2: Render flat labels, rail robots and AMR cargo

**Files:** `frontend/src/workshop/Objects.tsx`, `frontend/src/workshop/Scene.tsx`, `frontend/src/workshop/workshop.css`.

- [x] Render all scene labels as larger flat planes without signposts or solid 3D sign boxes.
- [x] Add two visible floor-level robot rails and animate each robot along its row to serve all three CNCs.
- [x] Move AMR01 along the workpiece route and show the same metal workpiece on its cargo deck; keep AMR02 on the aisle loop.
- [x] Mark each transfer handoff on the floor and visually identify the next target station.

### Task 3: Lock selection to camera center and verify browser behavior

**Files:** `frontend/src/workshop/App.tsx`, `frontend/src/workshop/Scene.tsx`, `frontend/tests/e2e/workshop.spec.ts`, `docs/WORKSHOP_ZH.md`, `README.md`.

- [x] Add a browser regression asserting selecting a directory item automatically focuses it and updates the camera target to its coordinates.
- [x] Make selection reset the orbit target to the selected asset while preserving manual overview and top views.
- [x] Extend browser coverage for robot cell assignment and visible workpiece carrier motion; take screenshots of overview and selected-asset focus.
- [x] Update the Chinese guide and design record to explain the two rail-mounted tending robots and the AMR handoff route.
- [x] Run frontend build, model tests and all workshop Playwright tests; inspect the rendered screenshots and verify the local demo URL.

## Verified behavior

- Frontend typecheck and production build succeeded; 17 model tests and 11 workshop browser tests passed using installed Chrome with Playwright.
- The complete station sequence is exercised in the browser, including every unloading phase; screenshots cover flat labels, machine focus and robot handoff.
- Camera centering is checked using projected world coordinates. P001 is separately selectable and follows the actual workpiece position through unloading and processing; selecting AMR01 follows the vehicle.
- Independent review found a robot nameplate below the rail top and an ambiguous Follow part target. Both were corrected and the review repeated with no blocking findings.
- The previously accepted version remains at commit `7bb615d` and is preserved as `demo-baseline-v2`.
