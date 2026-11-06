import type { Lang } from "./model";

export const copy = {
  zh: {
    title: "机加工车间数字孪生与生产调度仿真系统", subtitle: "可视化生产仿真", demo: "仿真演示", live: "车间总览",
    machined: "加工设备", logistics: "工件流程", labels: "设备标签", faults: "异常事件",
    overview: "等轴视角", focus: "聚焦设备", top: "俯视平面", fit: "车间总览", search: "查找设备或区域",
    running: "运行中", setup: "准备中", idle: "待机", fault: "故障停机",
    selectAsset: "选择设备查看详情", production: "加工现场", shift: "模拟班次",
    elapsed: "模拟时间", scale: "倍速", pause: "暂停模拟", resume: "继续模拟",
    reset: "重置模拟", inject: "注入故障", restore: "恢复设备", noFault: "当前无设备故障",
    simulationOnly: "示例状态 · 不连接真实设备", units: "台", hours: "小时",
    zone: "区域", machine: "加工设备", cycles: "模拟循环", condition: "设备状态",
    eventHistory: "事件记录", cycleDone: "模拟循环完成", faultEvent: "模拟故障",
    restoreEvent: "设备恢复", setupEvent: "准备完成", clearSearch: "清除搜索",
    amr: "物流小车", resetView: "重置视角", robots: "上下料机械臂", floorSize: "车间占地",
    materialFlow: "工件流向", north: "北", secondary: "工艺与设备为演示设定",
  },
  en: {
    title: "Precision Machine Shop", subtitle: "Interactive production simulation", demo: "SIMULATION",
    live: "SHOP FLOOR", machined: "Equipment", logistics: "Workpiece flow", labels: "Asset labels",
    faults: "Fault events", overview: "Isometric", focus: "Focus asset", top: "Top view", fit: "Fit factory",
    search: "Search equipment or zone", running: "Running", setup: "Setup", idle: "Idle",
    fault: "Faulted", selectAsset: "Select equipment for details", production: "Machine shop",
    shift: "Simulated shift", elapsed: "Simulation time", scale: "Speed", pause: "Pause simulation",
    resume: "Resume simulation", reset: "Reset simulation", inject: "Inject fault", restore: "Restore machine",
    noFault: "No active machine faults", simulationOnly: "Example state · No real equipment connection",
    units: "units", hours: "hours", zone: "Zone", machine: "Machine", cycles: "Simulated cycles",
    condition: "Equipment status", eventHistory: "Event log", cycleDone: "Demo cycle completed",
    faultEvent: "Simulated fault", restoreEvent: "Machine restored", setupEvent: "Setup complete",
    clearSearch: "Clear search", amr: "Mobile robots", resetView: "Reset view",
    robots: "Machine-tending robots", floorSize: "Floor area", materialFlow: "Material flow",
    north: "N", secondary: "Illustrative process and equipment model",
  },
} as const;

export type Copy = typeof copy[Lang];
