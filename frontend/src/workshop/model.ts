export type Vec2 = [number, number];
export type Lang = 'zh' | 'en';

export type AssetKind =
  | 'lathe'
  | 'mill'
  | 'robot'
  | 'amr'
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
  asset('R01', '上下料机器人 01', 'Tending Robot 01', 'robot', [-12, -3.8], [1.6, 1.6], 'turning'),
  asset('R02', '上下料机器人 02', 'Tending Robot 02', 'robot', [-12, 3.8], [1.6, 1.6], 'milling'),
  asset('AMR01', '搬运车 01', 'AMR 01', 'amr', [-21, -1.2], [1.7, 1.2], 'logistics'),
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
  asset('B01', '在制品缓存 01', 'WIP buffer 01', 'buffer', [-6, -3.8], [3, 1.6], 'logistics'),
  asset('B02', '在制品缓存 02', 'WIP buffer 02', 'buffer', [3, -3.8], [3, 1.6], 'logistics'),
  asset('B03', '在制品缓存 03', 'WIP buffer 03', 'buffer', [10, 3.8], [3, 1.6], 'logistics'),
  asset('B04', '在制品缓存 04', 'WIP buffer 04', 'buffer', [17, -3.8], [3, 1.6], 'logistics'),
];

export const ASSETS: WorkshopAsset[] = [...MACHINES, ...nonMachineAssets];

export const AMR_PATH: Vec2[] = [
  [-21, -1.2],
  [21, -1.2],
  [21, 1.2],
  [-21, 1.2],
  [-21, -1.2],
];

export const PROCESS_STAGES = [
  { id: 'RAW', position: [-20, -8] as Vec2 },
  { id: 'L01', position: [-12, -8] as Vec2 },
  { id: 'M01', position: [-12, 8] as Vec2 },
  { id: 'D01', position: [14, 8] as Vec2 },
  { id: 'W01', position: [20, 8] as Vec2 },
  { id: 'Q01', position: [13, -8] as Vec2 },
  { id: 'FG', position: [20, -8] as Vec2 },
] as const;

export const PROCESS_PATH: Vec2[] = [
  [-20, -8], [-12, -8], [-15, -8], [-15, 8], [-12, 8],
  [-12, 13], [14, 13], [14, 8], [20, 8], [22, 8],
  [22, 0], [13, 0], [13, -8], [20, -8],
];

export const PROCESS_SPEED = 0.62;

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
const PROCESS_ROUTE_LENGTH = PROCESS_PATH.slice(1).reduce(
  (total, point, pointIndex) => total + Math.hypot(
    point[0] - PROCESS_PATH[pointIndex][0],
    point[1] - PROCESS_PATH[pointIndex][1],
  ),
  0,
);

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

export function processPose(elapsed: number): { position: Vec2; heading: number } {
  const safeElapsed = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
  const traveled = (safeElapsed * PROCESS_SPEED) % PROCESS_ROUTE_LENGTH;
  let distance = traveled < 1e-8 ? 0 : traveled;

  for (let segment = 1; segment < PROCESS_PATH.length; segment++) {
    const from = PROCESS_PATH[segment - 1];
    const to = PROCESS_PATH[segment];
    const dx = to[0] - from[0];
    const dz = to[1] - from[1];
    const length = Math.hypot(dx, dz);
    if (distance <= length || segment === PROCESS_PATH.length - 1) {
      const along = Math.min(length, Math.max(0, distance));
      return {
        position: [from[0] + dx * along / length, from[1] + dz * along / length],
        heading: Math.atan2(dz, dx),
      };
    }
    distance -= length;
  }

  return { position: [...PROCESS_PATH[0]], heading: 0 };
}
