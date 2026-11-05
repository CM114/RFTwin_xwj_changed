export type Vec2 = [number, number];
export type Lang = 'zh' | 'en';

export type AssetKind =
  | 'lathe'
  | 'mill'
  | 'robot'
  | 'amr'
  | 'workpiece'
  | 'raw'
  | 'deburr'
  | 'washer'
  | 'inspection'
  | 'buffer'
  | 'hold'
  | 'rework'
  | 'finished'
  | 'tooling'
  | 'maintenance'
  | 'charger';

export interface WorkshopAsset {
  id: string;
  name: { zh: string; en: string };
  kind: AssetKind;
  position: Vec2;
  footprint: Vec2;
  zone: 'raw' | 'turning' | 'milling' | 'post' | 'quality' | 'finished' | 'support' | 'logistics';
}

export interface MachineAsset extends WorkshopAsset {
  kind: 'lathe' | 'mill';
}

export type MachineStatus = 'running' | 'setup' | 'idle' | 'fault';
type RecoverableMachineStatus = Exclude<MachineStatus, 'fault'>;

export interface MachineSimulation {
  status: MachineStatus;
  progress: number;
  completedCycles: number;
}

export type MachineModel = MachineSimulation;

export interface SimulationEvent {
  id: number;
  time: number;
  assetId: string;
  kind: 'fault' | 'restore' | 'cycle' | 'setup';
}

export interface SimulationState {
  elapsed: number;
  paused: boolean;
  speed: number;
  machines: Record<string, MachineSimulation>;
  events: SimulationEvent[];
  _faultRecovery?: Record<string, RecoverableMachineStatus>;
}

export const FLOOR = { width: 48, depth: 30 } as const;

const asset = <Kind extends AssetKind>(
  id: string,
  zh: string,
  en: string,
  kind: Kind,
  position: Vec2,
  footprint: Vec2,
  zone: WorkshopAsset['zone'],
): Omit<WorkshopAsset, 'kind'> & { kind: Kind } => ({ id, name: { zh, en }, kind, position, footprint, zone });

export const MACHINES: MachineAsset[] = [
  { ...asset('L01', '车床 01', 'Lathe 01', 'lathe', [-12, -8], [4.5, 4.5], 'turning') },
  { ...asset('L02', '车床 02', 'Lathe 02', 'lathe', [-3, -8], [4.5, 4.5], 'turning') },
  { ...asset('L03', '车床 03', 'Lathe 03', 'lathe', [6, -8], [4.5, 4.5], 'turning') },
  { ...asset('M01', '加工中心 01', 'Mill 01', 'mill', [-12, 8], [4.5, 4.5], 'milling') },
  { ...asset('M02', '加工中心 02', 'Mill 02', 'mill', [-3, 8], [4.5, 4.5], 'milling') },
  { ...asset('M03', '加工中心 03', 'Mill 03', 'mill', [6, 8], [4.5, 4.5], 'milling') },
];

const nonMachineAssets: WorkshopAsset[] = [
  asset('R01', '车削单元上下料机器人', 'Turning-cell tending robot', 'robot', [-12, -4.8], [1.6, 1.6], 'turning'),
  asset('R02', '加工中心单元上下料机器人', 'Mill-cell tending robot', 'robot', [-12, 4.8], [1.6, 1.6], 'milling'),
  asset('AMR01', '工件转运车 01', 'Workpiece carrier 01', 'amr', [-16, -8], [1.7, 1.2], 'logistics'),
  asset('AMR02', '搬运车 02', 'AMR 02', 'amr', [21, 1.2], [1.7, 1.2], 'logistics'),
  asset('RAW', '原料区', 'Raw stock', 'raw', [-20, -8], [5, 7], 'raw'),
  asset('FG', '成品区', 'Finished goods', 'finished', [20, -8], [5, 5], 'finished'),
  asset('D01', '去毛刺工位', 'Deburring', 'deburr', [14, 8], [3, 3], 'post'),
  asset('W01', '清洗工位', 'Washing', 'washer', [20, 8], [3, 3], 'post'),
  asset('Q01', '尺寸检测', 'Dimensional inspection', 'inspection', [13, -8], [4, 4], 'quality'),
  asset('HOLD', '质量暂存', 'Quality hold', 'hold', [13, -12], [3, 2], 'quality'),
  asset('REWORK', '返工工位', 'Rework station', 'rework', [8, -12], [3, 2], 'quality'),
  asset('TOOL', '刀具间', 'Tool room', 'tooling', [-20, 8], [5, 4], 'support'),
  asset('MAINT', '维修工位', 'Maintenance', 'maintenance', [-20, 12], [4, 2], 'support'),
  asset('CH01', '充电位 01', 'Charging pad 01', 'charger', [-20, 3.8], [2, 2], 'support'),
  asset('CH02', '充电位 02', 'Charging pad 02', 'charger', [-17, 3.8], [2, 2], 'support'),
  asset('B01', '在制品缓存 01', 'WIP buffer 01', 'buffer', [-6, -3.3], [3, 1], 'logistics'),
  asset('B02', '在制品缓存 02', 'WIP buffer 02', 'buffer', [3, -3.3], [3, 1], 'logistics'),
  asset('B03', '在制品缓存 03', 'WIP buffer 03', 'buffer', [10, 3.8], [3, 1.6], 'logistics'),
  asset('B04', '在制品缓存 04', 'WIP buffer 04', 'buffer', [17, -3.8], [3, 1.6], 'logistics'),
];

export const ASSETS: WorkshopAsset[] = [...MACHINES, ...nonMachineAssets];
export const WORKPIECE_ASSET: WorkshopAsset = asset('P001', '跟踪工件 P-001', 'Tracked part P-001',
  'workpiece', [-16, -8], [0.85, 0.5], 'logistics');

export const ROBOT_CELLS = [
  { id: 'R01', machineIds: ['L01', 'L02', 'L03'], trackZ: -4.8 },
  { id: 'R02', machineIds: ['M01', 'M02', 'M03'], trackZ: 4.8 },
] as const;

export const AMR_PATH: Vec2[] = [
  [-21, -1.2],
  [21, -1.2],
  [21, 1.2],
  [-21, 1.2],
  [-21, -1.2],
];

export const PROCESS_STAGES = [
  { id: 'RAW', position: [-16, -8] as Vec2 },
  { id: 'L01', position: [-12, -3] as Vec2 },
  { id: 'M01', position: [-12, 3] as Vec2 },
  { id: 'D01', position: [14, 4.8] as Vec2 },
  { id: 'W01', position: [20, 4.8] as Vec2 },
  { id: 'Q01', position: [13, -4.7] as Vec2 },
  { id: 'FG', position: [20, -4.1] as Vec2 },
] as const;

export const PROCESS_PATH: Vec2[] = [
  [-16, -8], [-16, -1.2], [-12, -1.2], [-12, -3],
  [-12, -1.2], [-12, 1.2], [-12, 3], [-12, 1.2],
  [14, 1.2], [14, 4.8], [14, 1.2], [20, 1.2], [20, 4.8],
  [20, 1.2], [21, 1.2], [21, -1.2], [13, -1.2], [13, -4.7],
  [13, -1.2], [21, -1.2], [21, -4.1], [20, -4.1],
  [21, -4.1], [21, -1.2], [-16, -1.2], [-16, -8],
];

export const PROCESS_SPEED = 0.62;

const ROBOT_DWELL_SECONDS = 8;
const ROBOT_TRAVEL_SECONDS = 6;

export function robotPose(elapsed: number, index: number): { position: Vec2; machineId: string } {
  const cell = ROBOT_CELLS[((Number.isFinite(index) ? Math.floor(index) : 0) % ROBOT_CELLS.length + ROBOT_CELLS.length) % ROBOT_CELLS.length];
  const machineIds = cell.machineIds;
  const safeElapsed = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
  const stageIndex = cell.id === 'R01' ? 1 : 2;
  const begin = PROCESS_TIMELINE.find((phase) => phase.stageIndex === stageIndex && phase.kind === 'transport')!.start;
  const last = PROCESS_TIMELINE.find((phase) => phase.stageIndex === stageIndex && phase.kind === 'load')!;
  const end = last.start + last.duration;
  const time = safeElapsed % PROCESS_DURATION;
  const basePose = (localTime: number) => {
    const slot = Math.floor(localTime / ROBOT_DWELL_SECONDS) % machineIds.length;
    const current = MACHINES.find(({ id }) => id === machineIds[slot])!;
    const previous = localTime < ROBOT_DWELL_SECONDS ? current
      : MACHINES.find(({ id }) => id === machineIds[(slot + machineIds.length - 1) % machineIds.length])!;
    const progress = Math.min(1, (localTime % ROBOT_DWELL_SECONDS) / ROBOT_TRAVEL_SECONDS);
    const eased = progress * progress * (3 - 2 * progress);
    return { position: [previous.position[0] + (current.position[0] - previous.position[0]) * eased, cell.trackZ] as Vec2,
      machineId: current.id };
  };
  const idleTime = time >= end ? time - end : safeElapsed >= PROCESS_DURATION ? time + PROCESS_DURATION - end : time;
  if (time >= begin && time < end) {
    const priorTime = safeElapsed >= PROCESS_DURATION ? begin + PROCESS_DURATION - end : begin;
    const previousX = basePose(priorTime).position[0];
    const progress = Math.min(1, (time - begin) / ROBOT_TRAVEL_SECONDS);
    const eased = progress * progress * (3 - 2 * progress);
    return { position: [previousX + (-12 - previousX) * eased, cell.trackZ], machineId: machineIds[0] };
  }
  return basePose(idleTime);
}

export function assetPose(asset: WorkshopAsset, elapsed: number): { position: Vec2; height: number } {
  if (asset.kind === 'workpiece') {
    const [x, y, z] = processPose(elapsed).workpiecePosition;
    return { position: [x, z], height: y };
  }
  if (asset.id === 'AMR01') return { position: processPose(elapsed).position, height: 0.65 };
  if (asset.id === 'AMR02') return { position: amrPose(elapsed, 1).position, height: 0.65 };
  if (asset.kind === 'robot') return { position: robotPose(elapsed, asset.id === 'R01' ? 0 : 1).position, height: 1.3 };
  return { position: asset.position, height: asset.kind === 'lathe' || asset.kind === 'mill' ? 1.5 : 0.8 };
}

const MACHINE_IDS = MACHINES.map(({ id }) => id);
const machineIdSet = new Set(MACHINE_IDS);
const SETUP_SECONDS = 18;
const CYCLE_SECONDS: Record<string, number> = {
  L01: 24,
  L02: 28,
  L03: 32,
  M01: 30,
  M02: 36,
  M03: 40,
};
const TIME_EPSILON = 1e-9;
const AMR_ROUTE_LENGTH = AMR_PATH.slice(1).reduce(
  (total, point, pointIndex) => total + Math.hypot(
    point[0] - AMR_PATH[pointIndex][0],
    point[1] - AMR_PATH[pointIndex][1],
  ),
  0,
);
export type ProcessPhaseKind = 'load' | 'transport' | 'unload' | 'process' | 'return' | 'delivered';
export interface ProcessPhase {
  start: number;
  duration: number;
  stageIndex: number;
  kind: ProcessPhaseKind;
  from: Vec2;
  to: Vec2;
}

export const PROCESS_TIMELINE: ProcessPhase[] = [];
let processTime = 0;
function appendPhase(kind: ProcessPhaseKind, stageIndex: number, duration: number, from: Vec2, to: Vec2 = from) {
  PROCESS_TIMELINE.push({ kind, stageIndex, duration, from, to, start: processTime });
  processTime += duration;
}
appendPhase('load', 0, 3, PROCESS_PATH[0]);
let lastStage = 0;
for (let index = 1; index < PROCESS_PATH.length; index++) {
  const from = PROCESS_PATH[index - 1], to = PROCESS_PATH[index];
  const nextStage = PROCESS_STAGES.findIndex(({ position }) => position[0] === to[0] && position[1] === to[1]);
  appendPhase(lastStage === 6 ? 'return' : 'transport', Math.min(6, lastStage + 1),
    Math.hypot(to[0] - from[0], to[1] - from[1]) / PROCESS_SPEED, from, to);
  if (nextStage > lastStage) {
    lastStage = nextStage;
    appendPhase('unload', lastStage, 3, to);
    if (lastStage < 6) {
      appendPhase('process', lastStage, 5, to);
      appendPhase('load', lastStage, 3, to);
    } else appendPhase('delivered', lastStage, 3, to);
  }
}
export const PROCESS_DURATION = processTime;

export function processWorkPosition(stageIndex: number): [number, number, number] {
  const station = ASSETS.find(({ id }) => id === PROCESS_STAGES[stageIndex].id)!;
  return [station.position[0], stageIndex === 0 || stageIndex === 6 ? 0.9 : 1.55, station.position[1]];
}

export function createSimulation(): SimulationState {
  const machines: Record<string, MachineSimulation> = {};
  for (const id of MACHINE_IDS) {
    machines[id] = {
      status: id === 'L03' ? 'setup' : id === 'M03' ? 'idle' : 'running',
      progress: 0,
      completedCycles: 0,
    };
  }
  return { elapsed: 0, paused: false, speed: 1, machines, events: [] };
}

function eventTime(time: number, endTime: number): number {
  return Math.min(endTime, Math.round(time * 1e9) / 1e9);
}

export function advanceSimulation(state: SimulationState, deltaSeconds: number): SimulationState {
  if (
    state.paused
    || !Number.isFinite(deltaSeconds)
    || deltaSeconds <= 0
    || !Number.isFinite(state.speed)
    || state.speed < 0
    || !Number.isFinite(state.elapsed)
  ) return state;

  const simulatedDelta = deltaSeconds * state.speed;
  const endTime = state.elapsed + simulatedDelta;
  if (!Number.isFinite(simulatedDelta) || !Number.isFinite(endTime) || simulatedDelta <= 0) return state;
  if (state.speed === 0) return state;

  const machines = { ...state.machines };
  const transitions: Omit<SimulationEvent, 'id'>[] = [];

  for (const id of MACHINE_IDS) {
    const current = state.machines[id];
    if (!current || (current.status !== 'setup' && current.status !== 'running')) continue;

    const next = { ...current };
    machines[id] = next;
    const cycleSeconds = CYCLE_SECONDS[id];
    let remaining = simulatedDelta;
    let cursor = state.elapsed;

    if (next.status === 'setup') {
      const setupRemaining = (1 - next.progress) * SETUP_SECONDS;
      if (remaining + TIME_EPSILON < setupRemaining) {
        next.progress = Math.max(0, (next.progress * SETUP_SECONDS + remaining) / SETUP_SECONDS);
        continue;
      }

      remaining = Math.max(0, remaining - setupRemaining);
      cursor += setupRemaining;
      next.status = 'running';
      next.progress = 0;
      transitions.push({ time: eventTime(cursor, endTime), assetId: id, kind: 'setup' });
    }

    const accumulated = next.progress * cycleSeconds + remaining;
    const cycles = Math.floor((accumulated + TIME_EPSILON) / cycleSeconds);
    if (cycles > 0) {
      const firstCycle = cycleSeconds * (1 - next.progress);
      for (let cycle = 0; cycle < cycles; cycle++) {
        transitions.push({
          time: eventTime(cursor + firstCycle + cycle * cycleSeconds, endTime),
          assetId: id,
          kind: 'cycle',
        });
      }
      next.completedCycles += cycles;
    }
    next.progress = Math.max(0, Math.min(1 - Number.EPSILON, (accumulated - cycles * cycleSeconds) / cycleSeconds));
  }

  transitions.sort((a, b) => a.time - b.time || a.assetId.localeCompare(b.assetId) || a.kind.localeCompare(b.kind));
  let nextEventId = (state.events.at(-1)?.id ?? 0) + 1;
  const events = state.events.concat(transitions.map((event) => ({ ...event, id: nextEventId++ })));
  return { ...state, elapsed: endTime, machines, events };
}

export function setMachineFault(state: SimulationState, id: string, fault: boolean): SimulationState {
  if (!machineIdSet.has(id)) return state;
  const machine = state.machines[id];
  if (!machine) return state;

  if (fault) {
    if (machine.status === 'fault') return state;
    const faultRecovery = { ...state._faultRecovery, [id]: machine.status };
    const events = state.events.concat({
      id: (state.events.at(-1)?.id ?? 0) + 1,
      time: state.elapsed,
      assetId: id,
      kind: 'fault' as const,
    });
    return {
      ...state,
      machines: { ...state.machines, [id]: { ...machine, status: 'fault' } },
      _faultRecovery: faultRecovery,
      events,
    };
  }

  if (machine.status !== 'fault') return state;
  const { [id]: recoveryStatus = 'idle', ...faultRecovery } = state._faultRecovery ?? {};
  const events = state.events.concat({
    id: (state.events.at(-1)?.id ?? 0) + 1,
    time: state.elapsed,
    assetId: id,
    kind: 'restore' as const,
  });
  const nextState: SimulationState = {
    ...state,
    machines: { ...state.machines, [id]: { ...machine, status: recoveryStatus } },
    events,
  };
  if (Object.keys(faultRecovery).length) nextState._faultRecovery = faultRecovery;
  else delete nextState._faultRecovery;
  return nextState;
}

export function amrPose(elapsed: number, index: number): { position: Vec2; heading: number } {
  const safeElapsed = Number.isFinite(elapsed) ? elapsed : 0;
  const safeIndex = Number.isFinite(index) ? Math.floor(index) : 0;
  const phase = ((safeIndex % 2) + 2) % 2 * AMR_ROUTE_LENGTH / 2;
  const traveled = safeElapsed * 1.2 + phase;
  let distance = Number.isFinite(traveled) ? traveled % AMR_ROUTE_LENGTH : 0;
  if (distance < 0) distance += AMR_ROUTE_LENGTH;

  for (let segment = 1; segment < AMR_PATH.length; segment++) {
    const from = AMR_PATH[segment - 1];
    const to = AMR_PATH[segment];
    const dx = to[0] - from[0];
    const dz = to[1] - from[1];
    const segmentLength = Math.hypot(dx, dz);
    if (distance < segmentLength - TIME_EPSILON || segment === AMR_PATH.length - 1) {
      const along = Math.min(segmentLength, Math.max(0, distance));
      return {
        position: [from[0] + dx * along / segmentLength, from[1] + dz * along / segmentLength],
        heading: Math.atan2(dz, dx),
      };
    }
    if (distance <= segmentLength + TIME_EPSILON) {
      distance = 0;
      continue;
    }
    distance -= segmentLength;
  }

  return { position: [...AMR_PATH[0]], heading: 0 };
}

export function processPose(elapsed: number) {
  const safeElapsed = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
  const raw = safeElapsed % PROCESS_DURATION;
  const time = PROCESS_DURATION - raw < 1e-8 ? 0 : raw;
  const phase = PROCESS_TIMELINE.find(({ start, duration }) => time < start + duration - 1e-9) ?? PROCESS_TIMELINE[0];
  const progress = Math.max(0, Math.min(1, (time - phase.start) / phase.duration));
  const moving = phase.kind === 'transport' || phase.kind === 'return';
  const position: Vec2 = moving ? [
    phase.from[0] + (phase.to[0] - phase.from[0]) * progress,
    phase.from[1] + (phase.to[1] - phase.from[1]) * progress,
  ] : [...phase.from];
  const deck: [number, number, number] = [position[0], 0.79, position[1]];
  const working = processWorkPosition(phase.stageIndex);
  const carrying = phase.kind === 'transport';
  let workpiecePosition: [number, number, number] = deck;
  if (phase.kind === 'process' || phase.kind === 'delivered' || phase.kind === 'return') workpiecePosition = working;
  else if (phase.kind === 'load' || phase.kind === 'unload') {
    const from = phase.kind === 'load' ? working : deck;
    const to = phase.kind === 'load' ? deck : working;
    workpiecePosition = [
      from[0] + (to[0] - from[0]) * progress,
      from[1] + (to[1] - from[1]) * progress + Math.sin(progress * Math.PI) * 1.1,
      from[2] + (to[2] - from[2]) * progress,
    ];
  }
  return { position, heading: moving ? Math.atan2(phase.to[1] - phase.from[1], phase.to[0] - phase.from[0]) : 0,
    stageIndex: phase.stageIndex, carrying, phase: phase.kind, phaseProgress: progress, workpiecePosition,
    cycle: Math.floor(safeElapsed / PROCESS_DURATION) };
}
