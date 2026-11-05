import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(new URL('../../package.json', import.meta.url));
const ts = require('typescript');
const modelUrl = new URL('../../src/workshop/model.ts', import.meta.url);
let model;

async function loadModel() {
  if (!model) {
    let source;
    try {
      source = await readFile(modelUrl, 'utf8');
    } catch (error) {
      assert.fail(`Workshop model must exist at ${modelUrl.pathname}: ${error.code}`);
    }
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    });
    model = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
  }
  return model;
}

const machineIds = ['L01', 'L02', 'L03', 'M01', 'M02', 'M03'];
const expectedPositions = {
  L01: [-12, -8], L02: [-3, -8], L03: [6, -8],
  M01: [-12, 8], M02: [-3, 8], M03: [6, 8],
  R01: [-12, -4.8], R02: [-12, 4.8], AMR01: [-16, -8], RAW: [-20, -8], FG: [20, -8],
  D01: [14, 8], W01: [20, 8], Q01: [13, -8], HOLD: [13, -12], REWORK: [8, -12],
  TOOL: [-20, 8], MAINT: [-20, 12], CH01: [-20, 3.8], CH02: [-17, 3.8],
  B01: [-6, -3.3], B02: [3, -3.3], B03: [10, 3.8], B04: [17, -3.8],
};

function close(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should equal ${expected}`);
}

test('exports the complete bilingual workshop inventory with stable IDs and zones', async () => {
  const { ASSETS, MACHINES, FLOOR } = await loadModel();
  assert.deepEqual(FLOOR, { width: 48, depth: 30 });
  assert.equal(ASSETS.length, 25);
  assert.equal(new Set(ASSETS.map(({ id }) => id)).size, ASSETS.length);
  assert.deepEqual(MACHINES.map(({ id }) => id).sort(), machineIds);
  assert.deepEqual(ASSETS.filter(({ kind }) => kind === 'robot').map(({ id }) => id), ['R01', 'R02']);
  assert.deepEqual(ASSETS.filter(({ kind }) => kind === 'amr').map(({ id }) => id), ['AMR01', 'AMR02']);
  const kinds = ['lathe', 'mill', 'robot', 'amr', 'raw', 'deburr', 'washer', 'inspection',
    'buffer', 'hold', 'rework', 'finished', 'tooling', 'maintenance', 'charger'];
  assert.deepEqual([...new Set(ASSETS.map(({ kind }) => kind))].sort(), kinds.sort());
  const zones = ['raw', 'turning', 'milling', 'post', 'quality', 'finished', 'support', 'logistics'];
  for (const asset of ASSETS) {
    assert.match(asset.name.zh, /[\u3400-\u9fff]/, asset.id);
    assert.match(asset.name.en, /[a-z]/i, asset.id);
    assert.ok(zones.includes(asset.zone), `${asset.id} zone`);
    if (expectedPositions[asset.id]) assert.deepEqual(asset.position, expectedPositions[asset.id]);
  }
});

test('asset footprints stay inside the floor and stationary assets keep the central aisle clear', async () => {
  const { ASSETS, FLOOR, MACHINES } = await loadModel();
  for (const asset of ASSETS) {
    const [x, z] = asset.position;
    const [width, depth] = asset.footprint;
    assert.ok(width > 0 && depth > 0, asset.id);
    assert.ok(Math.abs(x) + width / 2 <= FLOOR.width / 2, `${asset.id} x bound`);
    assert.ok(Math.abs(z) + depth / 2 <= FLOOR.depth / 2, `${asset.id} z bound`);
    if (asset.kind !== 'amr') assert.ok(Math.abs(z) - depth / 2 >= 2.5, `${asset.id} aisle`);
    else assert.deepEqual([width, depth], [1.7, 1.2], `${asset.id} visible vehicle footprint`);
  }
  for (const machine of MACHINES) assert.deepEqual(machine.footprint, [4.5, 4.5]);
  const stationary = ASSETS.filter(({ kind }) => kind !== 'amr');
  for (let i = 0; i < stationary.length; i++) {
    for (let j = i + 1; j < stationary.length; j++) {
      const a = stationary[i], b = stationary[j];
      const separated = Math.abs(a.position[0] - b.position[0]) >= (a.footprint[0] + b.footprint[0]) / 2
        || Math.abs(a.position[1] - b.position[1]) >= (a.footprint[1] + b.footprint[1]) / 2;
      assert.ok(separated, `${a.id} overlaps ${b.id}`);
    }
  }
});

test('the closed AMR route clears stationary footprints with vehicle radius and a safety margin', async () => {
  const { ASSETS, AMR_PATH } = await loadModel();
  assert.deepEqual(AMR_PATH, [[-21, -1.2], [21, -1.2], [21, 1.2], [-21, 1.2], [-21, -1.2]]);
  const radius = Math.hypot(1.5 / 2, 1.0 / 2);
  const margin = 0.25;
  for (let segment = 1; segment < AMR_PATH.length; segment++) {
    const from = AMR_PATH[segment - 1], to = AMR_PATH[segment];
    const steps = Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / 0.1);
    for (let step = 0; step <= steps; step++) {
      const position = from.map((value, axis) => value + (to[axis] - value) * step / steps);
      for (const asset of ASSETS.filter(({ kind }) => kind !== 'amr')) {
        const dx = Math.max(Math.abs(position[0] - asset.position[0]) - asset.footprint[0] / 2, 0);
        const dz = Math.max(Math.abs(position[1] - asset.position[1]) - asset.footprint[1] / 2, 0);
        assert.ok(Math.hypot(dx, dz) >= radius + margin, `${asset.id} route clearance`);
      }
    }
  }
});

test('AMRs travel at 1.2 m/s, wrap continuously, and stay half a loop apart', async () => {
  const { AMR_PATH, ASSETS, amrPose, processPose } = await loadModel();
  const perimeter = 88.8, period = perimeter / 1.2;
  assert.deepEqual(amrPose(0, 0), { position: [-21, -1.2], heading: 0 });
  assert.deepEqual(amrPose(0, 1), { position: [21, 1.2], heading: Math.PI });
  assert.deepEqual(ASSETS.find(({ id }) => id === 'AMR01').position, processPose(0).position);
  assert.deepEqual(ASSETS.find(({ id }) => id === 'AMR02').position, amrPose(0, 1).position);
  close(amrPose(10, 0).position[0], -9);
  close(amrPose(35, 0).position[0], 21);
  close(amrPose(35, 0).heading, Math.PI / 2);
  for (let time = 0; time < period * 2; time += 0.37) {
    const first = amrPose(time, 0), second = amrPose(time + period / 2, 0);
    const phased = amrPose(time, 1);
    first.position.forEach((value, axis) => close(value, amrPose(time + period, 0).position[axis]));
    phased.position.forEach((value, axis) => close(value, second.position[axis]));
    assert.ok(Number.isFinite(first.heading));
    assert.ok(Math.abs(first.position[0]) <= 21 + 1e-9 && Math.abs(first.position[1]) <= 1.2 + 1e-9);
  }
  const nearEnd = amrPose(period - 0.0001, 0).position;
  assert.ok(Math.hypot(nearEnd[0] - AMR_PATH[0][0], nearEnd[1] - AMR_PATH[0][1]) < 0.001);
  assert.deepEqual(amrPose(Number.NaN, 0), amrPose(0, 0));
});

test('the workpiece flow connects raw stock, both CNC operations, finishing, inspection, and shipping', async () => {
  const { ASSETS, PROCESS_STAGES, PROCESS_PATH, PROCESS_SPEED, processPose } = await loadModel();
  assert.deepEqual(PROCESS_STAGES.map(({ id }) => id), ['RAW', 'L01', 'M01', 'D01', 'W01', 'Q01', 'FG']);
  for (const stage of PROCESS_STAGES) {
    const asset = ASSETS.find(({ id }) => id === stage.id);
    assert.ok(Math.hypot(stage.position[0] - asset.position[0], stage.position[1] - asset.position[1]) <= 5.1,
      `${stage.id} transfer point stays next to its real station`);
    assert.ok(PROCESS_PATH.some(([x, z]) => x === stage.position[0] && z === stage.position[1]),
      `${stage.id} handoff lies on the carrier route`);
  }
  assert.deepEqual(PROCESS_PATH[0], PROCESS_STAGES[0].position);
  assert.ok(PROCESS_PATH.some(([x, z]) => x === PROCESS_STAGES.at(-1).position[0] && z === PROCESS_STAGES.at(-1).position[1]));
  assert.deepEqual(ASSETS.find(({ id }) => id === 'AMR01').position, processPose(0).position,
    'the dedicated process carrier starts beside raw stock');
  for (const point of PROCESS_PATH) {
    assert.ok(Math.abs(point[0]) <= 24 && Math.abs(point[1]) <= 15, `flow point ${point}`);
  }
});

test('two rail-mounted tending robots cover every CNC machine in their process cells', async () => {
  const { ASSETS, MACHINES, ROBOT_CELLS, robotPose } = await loadModel();
  assert.deepEqual(ROBOT_CELLS.map(({ id, machineIds }) => [id, machineIds]), [
    ['R01', ['L01', 'L02', 'L03']],
    ['R02', ['M01', 'M02', 'M03']],
  ]);
  assert.deepEqual(ROBOT_CELLS.flatMap(({ machineIds }) => machineIds).sort(), MACHINES.map(({ id }) => id).sort());
  for (const [index, ids] of [[0, ['L01', 'L02', 'L03']], [1, ['M01', 'M02', 'M03']]]) {
    for (const [slot, id] of ids.entries()) {
      const pose = Array.from({ length: 600 }, (_, time) => robotPose(time, index)).find((candidate) => candidate.machineId === id && candidate.position[0] === MACHINES.find(({ id: machineId }) => machineId === id).position[0]);
      assert.ok(pose, `${id} is served during the demonstration`);
      assert.equal(pose.machineId, id);
      assert.equal(pose.position[0], MACHINES.find(({ id: machineId }) => machineId === id).position[0]);
      assert.equal(pose.position[1], index === 0 ? -4.8 : 4.8);
    }
    assert.equal(ASSETS.some(({ id }) => id === ROBOT_CELLS[index].id), true);
  }
});

test('the material carrier route avoids station bodies and robot rails', async () => {
  const { ASSETS, PROCESS_PATH, ROBOT_CELLS } = await loadModel();
  const radius = Math.hypot(1.7 / 2, 1.2 / 2);
  for (let index = 1; index < PROCESS_PATH.length; index++) {
    const from = PROCESS_PATH[index - 1], to = PROCESS_PATH[index];
    const steps = Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / 0.1);
    for (let step = 0; step <= steps; step++) {
      const x = from[0] + (to[0] - from[0]) * step / steps;
      const z = from[1] + (to[1] - from[1]) * step / steps;
      for (const asset of ASSETS.filter(({ kind }) => kind !== 'amr' && kind !== 'robot')) {
        const dx = Math.max(0, Math.abs(x - asset.position[0]) - asset.footprint[0] / 2);
        const dz = Math.max(0, Math.abs(z - asset.position[1]) - asset.footprint[1] / 2);
        assert.ok(Math.hypot(dx, dz) >= radius + 0.1, `${asset.id} carrier clearance at ${x},${z}`);
      }
      for (const cell of ROBOT_CELLS) {
        const dx = Math.max(0, Math.abs(x + 3) - 10);
        const dz = Math.max(0, Math.abs(z - cell.trackZ) - 0.46);
        assert.ok(Math.hypot(dx, dz) >= radius + 0.1, `${cell.id} rail clearance`);
      }
    }
  }
});

test('a workpiece route is continuous and the AMR returns empty after delivering', async () => {
  const { PROCESS_PATH, PROCESS_DURATION, PROCESS_TIMELINE, processPose } = await loadModel();
  assert.deepEqual(PROCESS_PATH[0], PROCESS_PATH.at(-1));
  assert.deepEqual(processPose(PROCESS_DURATION), { ...processPose(0), cycle: 1 });
  assert.deepEqual(processPose(-10), processPose(0));
  assert.deepEqual(processPose(Number.NaN), processPose(0));
  const returning = PROCESS_TIMELINE.find(({ kind }) => kind === 'return');
  assert.equal(processPose(returning.start + 1).carrying, false);
  for (const phase of PROCESS_TIMELINE.filter(({ kind }) => kind === 'transport')) {
    assert.equal(processPose(phase.start + 0.01).carrying, true);
  }
  for (let time = 0.1; time < PROCESS_DURATION; time += 0.1) {
    const before = processPose(time - 0.1), after = processPose(time);
    assert.ok(Math.hypot(after.position[0] - before.position[0], after.position[1] - before.position[1]) < 0.063);
  }
});

test('the carrier stops for every station and transfers the workpiece into its working area', async () => {
  const { PROCESS_TIMELINE, processPose, PROCESS_STAGES } = await loadModel();
  assert.ok(Array.isArray(PROCESS_TIMELINE));
  for (const [index, stage] of PROCESS_STAGES.entries()) {
    const stop = PROCESS_TIMELINE.find((phase) => phase.stageIndex === index && phase.kind === 'unload');
    if (index === 0) continue;
    assert.ok(stop, stage.id);
    const before = processPose(stop.start + 0.1);
    const after = processPose(stop.start + stop.duration - 0.1);
    assert.deepEqual(before.position, after.position, `${stage.id} AMR waits during handoff`);
    assert.notDeepEqual(before.workpiecePosition, after.workpiecePosition, `${stage.id} workpiece leaves deck`);
    if (index < PROCESS_STAGES.length - 1) {
      const processing = PROCESS_TIMELINE.find((phase) => phase.stageIndex === index && phase.kind === 'process');
      const working = processPose(processing.start + 1);
      assert.equal(working.carrying, false);
      assert.ok(Math.abs(working.workpiecePosition[2] - stage.position[1]) > 1);
    }
  }
});

test('following the workpiece tracks its working position after it leaves the AMR', async () => {
  const { WORKPIECE_ASSET, assetPose, PROCESS_TIMELINE, processPose } = await loadModel();
  const processing = PROCESS_TIMELINE.find(({ kind, stageIndex }) => kind === 'process' && stageIndex === 2);
  const time = processing.start + 1;
  const part = assetPose(WORKPIECE_ASSET, time);
  const flow = processPose(time);
  assert.deepEqual(part.position, [flow.workpiecePosition[0], flow.workpiecePosition[2]]);
  assert.equal(part.height, flow.workpiecePosition[1]);
  assert.notDeepEqual(part.position, flow.position);
});

test('reset creates independent deterministic machine state with the approved initial statuses', async () => {
  const { createSimulation } = await loadModel();
  const first = createSimulation(), second = createSimulation();
  assert.deepEqual(first, second);
  assert.notEqual(first.machines, second.machines);
  assert.notEqual(first.events, second.events);
  assert.equal(first.elapsed, 0);
  assert.equal(first.paused, false);
  assert.equal(first.speed, 1);
  assert.deepEqual(Object.keys(first.machines).sort(), machineIds);
  assert.deepEqual(Object.fromEntries(Object.entries(first.machines).map(([id, machine]) => [id, machine.status])), {
    L01: 'running', L02: 'running', L03: 'setup', M01: 'running', M02: 'running', M03: 'idle',
  });
  assert.deepEqual(first.events, []);
  for (const machine of Object.values(first.machines)) {
    assert.equal(machine.progress, 0);
    assert.equal(machine.completedCycles, 0);
  }
  first.machines.L01.progress = 0.9;
  assert.equal(second.machines.L01.progress, 0);
});

test('advancing is immutable, uses simulation speed, and leaves idle machines idle', async () => {
  const { createSimulation, advanceSimulation } = await loadModel();
  const original = createSimulation(), snapshot = structuredClone(original);
  const normal = advanceSimulation(original, 2);
  const fast = advanceSimulation({ ...original, speed: 2 }, 1);
  assert.deepEqual(original, snapshot);
  assert.deepEqual(fast.machines, normal.machines);
  assert.equal(normal.elapsed, 2);
  assert.equal(fast.elapsed, 2);
  assert.ok(normal.machines.L01.progress > 0);
  assert.ok(normal.machines.L03.progress > 0);
  assert.deepEqual(normal.machines.M03, original.machines.M03);
});

test('global pause and zero speed freeze all simulation time and machine state', async () => {
  const { createSimulation, advanceSimulation } = await loadModel();
  const active = advanceSimulation(createSimulation(), 3);
  const paused = { ...active, paused: true };
  assert.deepEqual(advanceSimulation(paused, 100), paused);
  const stopped = { ...active, speed: 0 };
  assert.deepEqual(advanceSimulation(stopped, 100), stopped);
  assert.ok(advanceSimulation({ ...paused, paused: false }, 1).elapsed > active.elapsed);
});

test('invalid delta and speed inputs safely leave the state unchanged', async () => {
  const { createSimulation, advanceSimulation } = await loadModel();
  const state = createSimulation();
  for (const delta of [-1, Number.NaN, Infinity, -Infinity, 0]) {
    assert.deepEqual(advanceSimulation(state, delta), state);
  }
  for (const speed of [-1, Number.NaN, Infinity, -Infinity]) {
    const invalid = { ...state, speed };
    assert.deepEqual(advanceSimulation(invalid, 1), invalid);
  }
  const overflow = { ...state, speed: 1e308 };
  assert.deepEqual(advanceSimulation(overflow, 1e308), overflow);
});

test('faults freeze progress and restore the previous running, setup, or idle status', async () => {
  const { createSimulation, advanceSimulation, setMachineFault } = await loadModel();
  for (const id of ['L01', 'L03', 'M03']) {
    const before = advanceSimulation(createSimulation(), 2);
    const original = structuredClone(before);
    const faulted = setMachineFault(before, id, true);
    assert.deepEqual(before, original);
    assert.equal(faulted.machines[id].status, 'fault');
    assert.equal(faulted.machines[id].progress, before.machines[id].progress);
    assert.deepEqual(faulted.events.at(-1), { id: 1, time: 2, assetId: id, kind: 'fault' });
    assert.deepEqual(setMachineFault(faulted, id, true), faulted);
    const waited = advanceSimulation(faulted, 5);
    assert.equal(waited.elapsed, 7);
    assert.deepEqual(waited.machines[id], faulted.machines[id]);
    const restored = setMachineFault(waited, id, false);
    assert.equal(restored.machines[id].status, before.machines[id].status);
    assert.equal(restored.machines[id].progress, before.machines[id].progress);
    assert.deepEqual(restored.events.at(-1), { id: 2, time: 7, assetId: id, kind: 'restore' });
    assert.deepEqual(setMachineFault(restored, id, false), restored);
    const resumed = advanceSimulation(restored, 1);
    if (id !== 'M03') assert.ok(resumed.machines[id].progress > restored.machines[id].progress);
    else assert.equal(resumed.machines[id].status, 'idle');
  }
  const initial = createSimulation();
  assert.deepEqual(setMachineFault(initial, 'RAW', true), initial);
  const unknownFault = { ...initial, machines: { ...initial.machines, L01: { ...initial.machines.L01, status: 'fault' } } };
  assert.equal(setMachineFault(unknownFault, 'L01', false).machines.L01.status, 'idle');
});

test('running demo cycles repeat, setup transitions once, and event IDs and timestamps are ordered', async () => {
  const { createSimulation, advanceSimulation } = await loadModel();
  const result = advanceSimulation(createSimulation(), 180);
  for (const id of ['L01', 'L02', 'L03', 'M01', 'M02']) {
    assert.equal(result.machines[id].status, 'running');
    assert.ok(result.machines[id].completedCycles >= 2, id);
    assert.ok(result.machines[id].progress >= 0 && result.machines[id].progress < 1, id);
    assert.equal(result.events.filter((event) => event.assetId === id && event.kind === 'cycle').length,
      result.machines[id].completedCycles);
  }
  assert.deepEqual(result.machines.M03, { status: 'idle', progress: 0, completedCycles: 0 });
  assert.equal(result.events.filter(({ assetId, kind }) => assetId === 'L03' && kind === 'setup').length, 1);
  result.events.forEach((event, index) => {
    assert.equal(event.id, index + 1);
    assert.ok(event.time >= 0 && event.time <= result.elapsed);
    if (index) assert.ok(event.time >= result.events[index - 1].time);
  });
});

test('the same elapsed time produces the same transitions across frame partitions', async () => {
  const { createSimulation, advanceSimulation } = await loadModel();
  const whole = advanceSimulation(createSimulation(), 180);
  let frames = createSimulation();
  for (let i = 0; i < 180; i++) frames = advanceSimulation(frames, 1);
  close(frames.elapsed, whole.elapsed);
  for (const id of machineIds) {
    assert.equal(frames.machines[id].status, whole.machines[id].status);
    assert.equal(frames.machines[id].completedCycles, whole.machines[id].completedCycles);
    close(frames.machines[id].progress, whole.machines[id].progress);
  }
  assert.equal(frames.events.length, whole.events.length);
  frames.events.forEach((event, index) => {
    const expected = whole.events[index];
    assert.equal(event.id, expected.id);
    assert.equal(event.assetId, expected.assetId);
    assert.equal(event.kind, expected.kind);
    close(event.time, expected.time);
  });
});
