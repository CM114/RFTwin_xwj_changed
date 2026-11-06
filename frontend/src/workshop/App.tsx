import { useEffect, useMemo, useState } from "react";
import { advanceSimulation, assetPose, ASSETS, createSimulation, PROCESS_DURATION, PROCESS_TIMELINE, processPose, robotPose, setMachineFault, WORKPIECE_ASSET } from "./model";
import type { Lang, SimulationState, WorkshopAsset } from "./model";
import { copy } from "./copy";
import type { Copy } from "./copy";
import { WorkshopScene } from "./Scene";

type Filter = "all" | "machines" | "flow";
type View = "orbit" | "top" | "focus";

function storedLanguage(): Lang {
  try {
    const saved = localStorage.getItem("workshop.lang");
    if (saved === "zh" || saved === "en") return saved;
    return "zh";
  } catch { return "zh"; }
}

const machineIds = new Set(["L01", "L02", "L03", "M01", "M02", "M03"]);
const robotServiceCell: Record<string, string> = { R01: "L01 / L02 / L03", R02: "M01 / M02 / M03" };
const statusClass: Record<string, string> = { running: "running", setup: "setup", idle: "idle", fault: "fault" };
const viewPreset: Record<View, View> = { orbit: "orbit", top: "top", focus: "focus" };

function machineFor(asset: WorkshopAsset | null, state: SimulationState) {
  if (!asset) return null;
  const id = machineIds.has(asset.id) ? asset.id : asset.kind === 'robot'
    ? robotPose(state.elapsed, asset.id === 'R01' ? 0 : 1).machineId : undefined;
  return id ? state.machines[id] ?? null : null;
}

function formattedTime(seconds: number) {
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600).toString().padStart(2, "0");
  const minutes = Math.floor((whole % 3600) / 60).toString().padStart(2, "0");
  const secs = (whole % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}:${secs}`;
}

function statusName(status: string | undefined, T: Copy) {
  return status && status in T ? T[status as keyof Copy] : T.idle;
}

export default function WorkshopApp() {
  const [lang, setLang] = useState<Lang>(storedLanguage);
  const T = copy[lang];
  const [simulation, setSimulation] = useState<SimulationState>(createSimulation);
  const [selectedId, setSelectedId] = useState<string | null>("L01");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [showLabels, setShowLabels] = useState(true);
  const [showRoutes, setShowRoutes] = useState(true);
  const [view, setView] = useState<View>("orbit");
  const [sceneReady, setSceneReady] = useState(false);

  useEffect(() => {
    try { localStorage.setItem("workshop.lang", lang); } catch { /* browser storage is optional */ }
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    document.title = lang === "zh" ? "精密加工车间 | Shopfloor" : "Precision Machine Shop | Shopfloor";
  }, [lang]);

  useEffect(() => {
    let previous = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const delta = Math.min(0.5, Math.max(0, (now - previous) / 1000));
      previous = now;
      setSimulation((current) => {
        const next = advanceSimulation(current, delta);
        return next === current || next.events.length <= 36 ? next : { ...next, events: next.events.slice(-36) };
      });
    }, 120);
    return () => window.clearInterval(timer);
  }, []);

  const selected = useMemo(() => selectedId === WORKPIECE_ASSET.id ? WORKPIECE_ASSET
    : ASSETS.find(({ id }) => id === selectedId) ?? null, [selectedId]);
  const selectedMachine = machineFor(selected, simulation);
  const filteredAssets = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return ASSETS.filter((asset) => {
      const matchesGroup = filter === "all" || (filter === "machines"
        ? machineIds.has(asset.id) || asset.kind === "robot"
        : ["amr", "buffer", "raw", "finished", "deburr", "washer", "inspection", "hold", "rework", "charger"].includes(asset.kind));
      const matchesText = !needle || `${asset.id} ${asset.name.zh} ${asset.name.en}`.toLocaleLowerCase().includes(needle);
      return matchesGroup && matchesText;
    });
  }, [filter, query]);
  const faultCount = Object.values(simulation.machines).filter(({ status }) => status === "fault").length;
  const carrierPose = processPose(simulation.elapsed);
  const selectedPose = selected ? assetPose(selected, simulation.elapsed) : null;
  const phaseNames = lang === 'zh'
    ? { load: '装载', unload: '卸载', process: '加工', transport: '运输', return: '空载返程', delivered: '入库完成' }
    : { load: 'Loading', unload: 'Unloading', process: 'Processing', transport: 'Transport', return: 'Empty return', delivered: 'Delivered' };
  const flowStages = lang === "zh"
    ? ["原料", "数控车削", "加工中心", "去毛刺", "清洗", "尺寸检验", "成品"]
    : ["Raw stock", "Turning", "Milling", "Deburr", "Wash", "Inspect", "Finished"];

  const selectAsset = (asset: WorkshopAsset) => { setSelectedId(asset.id); setView("focus"); };
  const reset = () => { setSimulation(createSimulation()); setSelectedId("L01"); setView("orbit"); };
  const nextStage = () => {
    const stageIndex = (carrierPose.stageIndex + 1) % 7;
    const nextStop = PROCESS_TIMELINE.find((phase) => phase.stageIndex === stageIndex && phase.kind === (stageIndex === 0 ? 'load' : 'unload'))!;
    let target = Math.max(0, nextStop.start - 2) + Math.floor(simulation.elapsed / PROCESS_DURATION) * PROCESS_DURATION;
    if (target <= simulation.elapsed) target += PROCESS_DURATION;
    setSimulation((current) => {
      const advanced = advanceSimulation({ ...current, paused: false, speed: 1 }, target - current.elapsed);
      return { ...advanced, paused: current.paused, speed: current.speed };
    });
  };
  const injectFault = () => {
    if (!selected || !machineIds.has(selected.id)) return;
    setSimulation((current) => setMachineFault(current, selected.id, true));
  };
  const restoreMachine = () => {
    if (!selected || !machineIds.has(selected.id)) return;
    setSimulation((current) => setMachineFault(current, selected.id, false));
  };

  return <main className="shop-app">
    <header className="shop-header">
      <a className="shop-brand" href="/" aria-label={lang === "zh" ? "返回智维工坊" : "Back to factory dashboard"}>
        <span className="shop-mark" aria-hidden="true">S</span>
        <span><strong>{T.title}</strong><small>{T.subtitle}</small></span>
      </a>
      <div className="shop-header-meta">
        <a className="mode-link" href="/workshop.html">{lang === 'zh' ? '生产仿真' : 'Production simulation'}</a>
        <span className="demo-status"><i />{T.demo}</span>
        <span className="header-separator" />
        <span className="shop-dimension">48 × 30 m <small>{T.floorSize}</small></span>
        <span className="header-separator" />
        <button className="lang-control" aria-label={lang === "zh" ? "Switch to English" : "切换为简体中文"}
          onClick={() => setLang(lang === "zh" ? "en" : "zh")}>{lang === "zh" ? "EN" : "中文"}</button>
      </div>
    </header>

    <section className="shop-workspace" aria-label={T.production}>
      <aside className="equipment-panel">
        <div className="panel-heading">
          <div><span className="eyebrow">ASSET DIRECTORY</span><h1>{T.machined}</h1></div>
          <span className="asset-total">{filteredAssets.length.toString().padStart(2, "0")}</span>
        </div>
        <label className="asset-search">
          <span aria-hidden="true">⌕</span>
          <input type="search" role="searchbox" value={query} onChange={(event) => setQuery(event.target.value)}
            placeholder={T.search} aria-label={T.search} />
          {query && <button onClick={() => setQuery("")} aria-label={T.clearSearch}>×</button>}
        </label>
        <div className="asset-filter" role="group" aria-label={T.machined}>
          {(["all", "machines", "flow"] as Filter[]).map((value) => <button key={value}
            className={filter === value ? "active" : ""} aria-pressed={filter === value} onClick={() => setFilter(value)}>
            {value === "all" ? (lang === "zh" ? "全部" : "All")
              : value === "machines" ? (lang === "zh" ? "机床" : "Machines") : (lang === "zh" ? "物流" : "Flow")}
          </button>)}
        </div>
        <div className="asset-list" role="list" aria-label={T.machined}>
          {filteredAssets.map((asset) => {
            const machine = machineFor(asset, simulation);
            return <button key={asset.id} role="listitem" data-testid={`asset-item-${asset.id}`}
              className={`asset-row${asset.id === selectedId ? " selected" : ""}`}
              onClick={() => selectAsset(asset)}>
              <span className={`asset-indicator kind-${asset.kind} ${statusClass[machine?.status ?? "idle"]}`} />
              <span className="asset-info"><strong>{asset.id}<small>{asset.name[lang]}</small></strong>
                <span className={`asset-state ${statusClass[machine?.status ?? "idle"]}`}>{statusName(machine?.status, T)}</span></span>
              <span className="asset-chevron" aria-hidden="true">›</span>
            </button>;
          })}
          {!filteredAssets.length && <p className="asset-empty">{lang === "zh" ? "没有匹配的设备" : "No matching equipment"}</p>}
        </div>
        <div className="equipment-foot"><span className="status-key"><i className="running" />{T.running}</span>
          <span className="status-key"><i className="setup" />{T.setup}</span>
          <span className="status-key"><i className="fault" />{T.fault}</span></div>
      </aside>

      <section className="factory-board" aria-label={T.live}>
        <div className="scene-topline">
          <div className="scene-kicker"><i />{T.live}<span>/</span>{sceneReady ? T.simulationOnly : "3D"}</div>
          <div className="scene-tools">
            <button className={showRoutes ? "pressed" : ""} aria-pressed={showRoutes}
              onClick={() => setShowRoutes((value) => !value)}><i className="tool-route" />{T.logistics}</button>
            <button className={showLabels ? "pressed" : ""} aria-pressed={showLabels}
              onClick={() => setShowLabels((value) => !value)}><i className="tool-label" />{T.labels}</button>
            <span className="scene-tool-divider" />
            <button className={view === "orbit" ? "pressed" : ""} aria-pressed={view === "orbit"}
              onClick={() => setView("orbit")}>{T.overview}</button>
            <button className={view === "focus" ? "pressed" : ""} aria-pressed={view === "focus"}
              onClick={() => setView("focus")}>{T.focus}</button>
            <button className={view === "top" ? "pressed" : ""} aria-pressed={view === "top"}
              onClick={() => setView("top")}>{T.top}</button>
          </div>
        </div>

        <div className="scene-canvas" data-testid="workshop-stage" data-ready={sceneReady} data-label-mode="flat-world"
          data-view-mode={view} data-focus-target={view === "focus" && selectedPose ? selectedPose.position.join(",") : undefined}
          data-carrier="AMR01" data-carrier-phase={carrierPose.phase} data-carrier-loaded={carrierPose.carrying}
          data-carrier-position={carrierPose.position.map((value) => value.toFixed(2)).join(",")}>
          <WorkshopScene lang={lang} state={simulation} selectedId={selectedId} onSelect={selectAsset}
            showLabels={showLabels} showRoutes={showRoutes} view={viewPreset[view]} focusPosition={selected?.position} copy={T}
            onReady={() => setSceneReady(true)} />
          {!sceneReady && <div className="scene-loading"><span className="loading-line" />3D</div>}
          <div className="scene-orientation" aria-hidden="true">
            <span>{T.north}</span><i /><small>E</small>
          </div>
          <div className="floor-tag"><span>01</span>{lang === "zh" ? "数控加工单元" : "CNC PRODUCTION UNIT"}</div>
          <div className="workpiece-controls">
            <strong>{lang === 'zh' ? '工件 P-001' : 'Part P-001'}</strong>
            <span>{flowStages[carrierPose.stageIndex]} · {phaseNames[carrierPose.phase]}</span>
            <button onClick={() => selectAsset(WORKPIECE_ASSET)}>{lang === 'zh' ? '跟随工件' : 'Follow part'}</button>
            <button onClick={nextStage}>{lang === 'zh' ? '下一工序' : 'Next operation'}</button>
          </div>
          <div className="scene-scale">{T.floorSize}<b>48 × 30 m</b></div>
        </div>

        <div className="scene-footer">
          <div className="process-flow" data-testid="process-flow" aria-label={T.materialFlow}>
            <span className="legend-label">{T.materialFlow}</span>
            <span className="carrier-status" data-testid="carrier-stage">
              {`AMR01 · ${phaseNames[carrierPose.phase]} → ${flowStages[carrierPose.stageIndex]}`}
            </span>
            <div>{flowStages.map((stage, index) => <span key={stage} className={`process-step${carrierPose.stageIndex === index ? ' active-step' : ''}`}>
              <i>{String(index + 1).padStart(2, "0")}</i>{stage}</span>)}</div>
          </div>
          <div className="scene-attribution">{T.secondary}</div>
        </div>
      </section>

      <aside className="inspector-panel">
        <div className="panel-heading inspector-heading">
          <div><span className="eyebrow">ASSET INSPECTOR</span><h2 data-testid="selected-id">{selected ? selected.id : T.selectAsset}</h2></div>
          {selectedMachine && <span className={`inspector-state ${statusClass[selectedMachine.status]}`}><i />{statusName(selectedMachine.status, T)}</span>}
        </div>
        {selected ? <div data-testid="selected-asset" className="inspector-content">
          <span className={`asset-kind-code kind-${selected.kind}`}>{selected.kind.toUpperCase()} · {selected.zone.toUpperCase()}</span>
          <h3>{selected.name[lang]}</h3>
          <dl className="inspector-data">
            <div><dt>{T.condition}</dt><dd data-testid="machine-state" data-status={selectedMachine?.status ?? "idle"}>
              <i className={`state-dot ${statusClass[selectedMachine?.status ?? "idle"]}`} />
              {selected.kind === 'workpiece' ? `${flowStages[carrierPose.stageIndex]} · ${phaseNames[carrierPose.phase]}` : statusName(selectedMachine?.status, T)}</dd></div>
            <div><dt>{T.zone}</dt><dd>{zoneName(selected.zone, lang)}</dd></div>
            {selectedMachine && <div><dt>{T.cycles}</dt><dd>{selectedMachine.completedCycles.toString().padStart(3, "0")}</dd></div>}
            {selected.kind === "amr" && <div><dt>{T.amr}</dt><dd>{selected.id === 'AMR01' ? '0.62 m/s' : '1.2 m/s'} · {lang === "zh" ? "演示路线" : "Demo route"}</dd></div>}
            {selected.kind === "robot" && <div><dt>{lang === "zh" ? "服务机床" : "Serves machines"}</dt><dd>{robotServiceCell[selected.id]}</dd></div>}
            <div><dt>{lang === "zh" ? "位置" : "Position"}</dt><dd>{selectedPose!.position[0].toFixed(1)}, {selectedPose!.position[1].toFixed(1)} m</dd></div>
          </dl>
          {machineIds.has(selected.id) && <div className="machine-actions">
            {selectedMachine?.status === "fault"
              ? <button className="action-restore" onClick={restoreMachine}>{T.restore}</button>
              : <button className="action-fault" onClick={injectFault}>{T.inject}</button>}
            <small>{lang === "zh" ? "仅改变本地演示状态" : "Changes local demo state only"}</small>
          </div>}
        </div> : <p className="select-prompt">{T.selectAsset}</p>}

        <div className="panel-heading events-heading">
          <div><span className="eyebrow">TIMELINE</span><h2>{T.faults}</h2></div>
          <span className={`event-count${faultCount ? " has-fault" : ""}`}>{faultCount || "—"}</span>
        </div>
        <div className="event-list" data-testid="event-log">
          {simulation.events.length ? [...simulation.events].reverse().slice(0, 8).map((event) => <div key={event.id} className={`event-entry ${event.kind}`}>
            <i /><span><strong>{eventName(event.kind, T)}</strong><small>{event.assetId}</small></span>
            <time>{formattedTime(event.time)}</time>
          </div>) : <div className="event-empty"><span className="event-empty-line" />{T.noFault}</div>}
        </div>

        <div className="inspector-ambient"><span>{lang === "zh" ? "工艺流程" : "PROCESS"}</span>
          <div>RAW <i /> CNC <i /> FINISH <i /> QC <i /> OUT</div></div>
      </aside>
    </section>

    <footer className="simulation-bar">
      <div className="simulation-clock">
        <span className="clock-icon" aria-hidden="true">◷</span>
        <span><small>{T.elapsed}</small><strong data-testid="sim-time" data-seconds={Math.floor(simulation.elapsed)}>{formattedTime(simulation.elapsed)}</strong></span>
      </div>
      <span className="simulation-divider" />
      <div className="simulation-actions">
        <button aria-label={simulation.paused ? T.resume : T.pause} title={simulation.paused ? T.resume : T.pause}
          onClick={() => setSimulation((current) => ({ ...current, paused: !current.paused }))}>
          <span className={`play-mark${simulation.paused ? " play" : ""}`} aria-hidden="true" />
          {simulation.paused ? T.resume : T.pause}</button>
        <button aria-label={T.reset} title={T.reset} onClick={reset}><span className="reset-mark" aria-hidden="true">↺</span>{T.reset}</button>
      </div>
      <span className="simulation-divider" />
      <span className="speed-label">{T.scale}</span>
      <div className="speed-select" role="group" aria-label={T.scale}>
        {[0, 1, 2, 5].map((speed) => <button key={speed} className={simulation.speed === speed ? "selected" : ""}
          aria-pressed={simulation.speed === speed} onClick={() => setSimulation((current) => ({ ...current, speed }))}>
          {speed === 0 ? "0×" : `${speed}×`}</button>)}
      </div>
      <span className="simulation-spacer" />
      <div className="running-total"><i />{Object.values(simulation.machines).filter(({ status }) => status === "running").length}
        <span>{lang === "zh" ? "台设备运行" : "machines running"}</span></div>
      <span className="simulation-divider" />
      <span className="shift-label">{T.shift} <b>06:00 — 14:00</b></span>
    </footer>
  </main>;
}

function zoneName(zone: WorkshopAsset["zone"], lang: Lang) {
  const zh: Record<WorkshopAsset["zone"], string> = {
    raw: "原料区", turning: "数控车削", milling: "加工中心", post: "后处理",
    quality: "质量检验", finished: "成品区", support: "设备支持", logistics: "物流通道",
  };
  const en: Record<WorkshopAsset["zone"], string> = {
    raw: "Raw stock", turning: "CNC turning", milling: "Machining centers", post: "Post-process",
    quality: "Quality control", finished: "Finished goods", support: "Shop support", logistics: "Logistics",
  };
  return (lang === "zh" ? zh : en)[zone];
}

function eventName(kind: string, T: Copy) {
  switch (kind) {
    case "fault": return T.faultEvent;
    case "restore": return T.restoreEvent;
    case "setup": return T.setupEvent;
    case "cycle": return T.cycleDone;
    default: return kind;
  }
}
