# Machining workshop scene

The user approved the proposed floor plan and requested implementation and publication to their GitHub repository. Add an independent browser-based scene at /workshop.html to CM114/RFTwin_xwj_changed. Retain the existing factory application and MIT attribution.

## Scope

- A 48 m by 30 m virtual workshop, central logistics aisle, three lathes L01-L03, three machining centers M01-M03, two tending robots R01/R02 and two AMRs.
- Receiving/raw stock, deburring, washing, dimensional inspection, four WIP buffers, quality hold, rework, packing/finished goods, tooling, maintenance and two charging pads.
- Programmatically modeled editable scene objects, stable asset IDs, selectable objects and list entries, asset inspector, orbit/zoom, overview/top/focus views, label and route toggles.
- Simplified local animation state with pause, speed, reset and per-machine fault/restore. Robot behavior follows its associated machine. AMRs circulate on a defined unobstructed central loop.
- Simplified Chinese default and complete English interface toggle. Prominent local simulation label. No connection to real equipment; no claim of scheduling optimization, collision certification or real production prediction.
- Dark industrial interface, mint/blue route accents, warm robot color, readable labels, useful desktop and narrow-window layouts. No external model/font service.

## Demo interaction details

- Scene labels are textured plates attached to fixed world coordinates, so orbiting the camera never makes a label follow the viewer. Zone signs are oriented toward their aisle; asset labels sit at the associated machine or station.
- AMRs have a clearly readable chassis, cargo deck, lidar and direction indicator, and circulate on the central aisle loop.
- Lathe and machining-center enclosures expose their spindle, tool and worktable through front windows. Selecting a machine and choosing Focus opens a closer view and removes that machine's top panel to reveal the working area.
- The complete illustrative part route is shown by default, from raw stock through turning, milling, deburring, washing and dimensional inspection to finished goods. A moving workpiece marker travels the route; the footer repeats all seven stages.
- All machine motion and workpiece travel are visual demonstration behavior. They do not model machining parameters, part geometry changes, cycle times, quality outcomes or real equipment telemetry.

## Implementation boundaries

Keep pure layout and animation-state functions in frontend/src/workshop/model.ts. React controls live in App.tsx, 3D geometry in Scene.tsx and Objects.tsx, and bilingual copy in copy.ts. Vite builds both the existing index.html and the new workshop.html. Existing Python APIs and existing UI behavior remain intact.

## Validation and delivery

Validate the asset inventory, bounds and route clearance, paused/faulted state semantics and reset determinism. Build/typecheck both entries, run browser tests for visible WebGL, picking, controls, language and responsive layout, and inspect actual screenshots. Review changes before publishing. Push tested commits to the user's repository without force pushes.
