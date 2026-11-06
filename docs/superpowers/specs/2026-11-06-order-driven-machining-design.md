# Order-driven machining twin

User approved the production-flow / disturbance-response positioning and requested implementation. Preserve the accepted workshop geometry and the original RFTwin application.

## First release
Two configurable part families, three production orders, six CNC machines, two rail robots and two AMRs. Parts follow turning, optional milling, deburring, washing, inspection and finished-goods delivery. Orders have quantities and simulated due times. Backend owns part locations, finite queues, machine compatibility, setup, processing, robot service and material transport. A resource cannot execute two tasks concurrently. AMRs depart after unloading instead of waiting for machining.

Select orders and parts to inspect stage, waiting reason, operation history and current position in the existing 3D scene. Faults pause affected machine work and expose affected orders. Compare wait-for-repair, reroute eligible unstarted work and due-date priority from identical isolated snapshots. Include setup/transport time, completion, tardiness, WIP wait, robot utilization and incomplete-run reporting. Applying a policy is a separate explicit user action and does not teleport work already loaded or processing.

## Architecture
Extend RFTwin with a machining domain using its deterministic SimulationClock and EventBus, served by the existing FastAPI application. Keep original FactoryEngine and routes intact: they encode a different production process. A dedicated /api/workshop service and WebSocket stream share one authoritative machining engine. UI has explicit production and scene-demo modes; backend unavailable freezes production and offers retry/demo, never pretends local animation is live. Typed snapshots and controls reject invalid input. Configurations and state hashes make branch comparisons reproducible.

## Boundaries
Simulation assumptions only, no real telemetry or machine control, no material-removal physics, no certified robot/collision planning. Transport uses prescribed aisle paths with conservative segment reservations; station transfer mechanisms are simplified. No prediction of real industrial performance. Existing maintenance work orders remain in the original application.

## Acceptance
Every released part has exactly one location, finite resources and queues are respected, all orders finish in the healthy demo, machine faults stop processing, loaded/in-process parts cannot be rerouted, snapshot comparisons do not modify live state, pause/reset/speed are shared server controls. Build both frontend entries, run original and new backend tests, retain scene-demo regression tests and run a real-backend browser scenario with screenshots.
