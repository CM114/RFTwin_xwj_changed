# Machining Workshop Implementation Plan

> Execute the accepted scene design continuously. Use test-driven development for the pure model and browser regression tests for interactions. A final read-only reviewer checks the complete diff.

**Goal:** Deliver a selectable, animated 3D machining workshop and publish its source in the user's existing GitHub repository.

**Architecture:** Add a standalone Vite entry without requiring the Python backend. Share an explicit typed layout between rendering, the asset browser and validation. Keep local demonstration state separate from the existing factory engine.

**Tech Stack:** Existing React 18, TypeScript, Three.js, React Three Fiber, Drei and Playwright. Node's existing test runner plus TypeScript transpilation for pure-model tests.

## Global Constraints

- Existing app and Python backend remain usable; retain MIT license and attribution.
- Scene footprint 48 x 30 m; six machine tools, two tending robots and two AMRs.
- Default simplified Chinese, English toggle; all displayed animation and status are explicitly local demo data.
- No external 3D model, texture, font or API runtime dependency.
- Do not commit dependencies, build output, screenshots containing credentials, secrets or local databases.

## Task 1: Typed layout and local demonstration state

Files: frontend/src/workshop/model.ts; frontend/tests/workshop/model.test.mjs.

Interfaces: Vec2 = [number, number]; AssetKind = lathe|mill|robot|amr|raw|deburr|washer|inspection|buffer|hold|rework|finished|tooling|maintenance|charger. WorkshopAsset has id, bilingual name, kind, position, footprint and zone. Export ASSETS, MACHINES, FLOOR, AMR_PATH, createSimulation, advanceSimulation, setMachineFault and amrPose.

SimulationState has elapsed, paused, speed, machines keyed by ID (status, progress, completedCycles), and events (id, time, assetId, kind). Machine statuses are running, setup, idle and fault. amrPose returns position and heading. A fault freezes machine progress; global pause freezes all simulated time; reset recreates the original state.

- [ ] Add meaningful inventory, geometry, pause/fault, reset and vehicle-loop tests and observe failure before implementing the model.
- [ ] Implement the shared layout and deterministic state transitions. All assets stay inside the floor and AMRs stay clear of stationary assets.
- [ ] Run node --test frontend/tests/workshop/model.test.mjs and record the output.

## Task 2: Independent 3D application

Files: frontend/workshop.html; frontend/src/workshop/main.tsx, App.tsx, Scene.tsx, Objects.tsx, copy.ts, workshop.css; frontend/vite.config.ts; package.json.

- [ ] Add a browser specification expecting the workshop canvas, six machines and selectable L01 details; verify the current build lacks the new entry.
- [ ] Implement asset geometry, two machine-tending robots, two loop-following AMRs, warehouse props, zone signs, floor markings and clickable labels.
- [ ] Implement asset search/filter, details, pause/speed/reset/fault controls, camera presets, label/route toggles and bilingual strings.
- [ ] Add workshop dev/build/test commands and a multi-page build configuration preserving index.html.
- [ ] Build/typecheck and run browser tests covering selection, state, navigation, localization, narrow layouts and no page errors.

## Task 3: Visual QA, documentation, review and GitHub delivery

Files: frontend/tests/e2e/workshop.spec.ts; docs/WORKSHOP_ZH.md; README.md; .gitignore.

- [ ] Inspect rendered desktop, top-down and narrow screenshots; repair clipping, unreadable labels or composition issues.
- [ ] Document independent startup, controls, layout editing, demo limitations and future backend integration.
- [ ] Run focused tests, build and existing app smoke tests. Request read-only whole-change review and resolve important issues.
- [ ] Commit only intended source/docs/tests, verify remote state, and push without force. Confirm published refs match the tested commit.
