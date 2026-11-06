export type Point3 = [number, number, number];
export type Policy = 'fifo' | 'reroute' | 'edd';
export interface ProductionOrder {
  id: string; part_type: string; quantity: number; due_seconds: number; completed: number;
  status: string; projected_finish: number | null; tardiness: number; affected: boolean;
}
export interface OrderInput { id: string; part_type: 'shaft' | 'sleeve'; quantity: number; due_seconds: number }
export interface ProductionPart {
  id: string; order_id: string; part_type: string; operation: string; stage_index: number; status: string;
  location: string; position: Point3; waiting_reason: string | null; assigned_machine: string | null;
  history: { time: number; event: string; resource: string }[];
}
export interface ProductionMachine {
  id: string; operation: string; status: 'idle' | 'setup' | 'running' | 'fault' | 'blocked' | 'waiting';
  part_id: string | null; progress: number; queue: string[]; fault_remaining: number;
}
export interface ProductionRobot {
  id: string; position: Point3; status: string; machine_id: string | null; part_id: string | null; tip: Point3 | null; utilization: number;
}
export interface ProductionAmr {
  id: string; position: Point3; heading: number; status: string; part_id: string | null; from_id: string | null; to_id: string | null;
  path: Point3[];
}
export interface ProductionMetrics {
  completed_parts: number; total_parts: number; wip: number; waiting_seconds: number; on_time_orders: number;
  tardy_seconds: number; robot_utilization: Record<string, number>;
}
export interface ProductionSnapshot {
  run_id: string; revision: number; elapsed: number; paused: boolean; speed: number; policy: Policy; complete: boolean;
  orders: ProductionOrder[]; parts: ProductionPart[]; machines: ProductionMachine[]; robots: ProductionRobot[]; amrs: ProductionAmr[];
  metrics: ProductionMetrics; bottlenecks: { resource: string; reason: string; waiting_parts: number; order_ids: string[] }[];
  events: { seq: number; time: number; kind: string; resource: string; part_id: string | null; message: string }[];
  assumptions: string[];
}
export interface Comparison {
  run_id: string; revision: number; state_hash: string; horizon_seconds: number;
  scenarios: { policy: Policy; metrics: ProductionMetrics; orders: ProductionOrder[]; complete: boolean; elapsed: number; explanation: string }[];
}

// A WebSocket is ordered across resets. HTTP replies from a prior run may arrive later.
export function acceptProductionSnapshot<T extends { run_id: string; revision: number }>(current: T | null, next: T, source: 'stream' | 'command'): T {
  if (!current) return next;
  if (current.run_id !== next.run_id) return source === 'stream' ? next : current;
  return next.revision >= current.revision ? next : current;
}

export const policyName = (policy: Policy, en: boolean) => ({
  fifo: en ? 'Wait for repair / FIFO' : '等待维修 · 先到先加工',
  reroute: en ? 'Compatible-machine reroute' : '兼容机床改派',
  edd: en ? 'Due-date priority + reroute' : '交期优先并改派',
})[policy];

export function productionAssetPose(snapshot: ProductionSnapshot, id: string) {
  const movable = snapshot.parts.find(item => item.id === id) ?? snapshot.amrs.find(item => item.id === id)
    ?? snapshot.robots.find(item => item.id === id);
  return movable ? { position: [movable.position[0], movable.position[2]] as [number, number], height: movable.position[1] } : undefined;
}
