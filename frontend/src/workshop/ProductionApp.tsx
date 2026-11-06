import { useEffect, useMemo, useState } from 'react';
import { WorkshopScene } from './Scene';
import { ASSETS, createSimulation, WORKPIECE_ASSET } from './model';
import type { Lang, WorkshopAsset } from './model';
import { copy } from './copy';
import { policyName, productionAssetPose } from './production';
import type { Comparison, OrderInput } from './production';
import { useProduction, workshopRequest } from './useProduction';

const labels: Record<string, [string, string]> = {
  raw: ['原料', 'Raw stock'], turning: ['数控车削', 'Turning'], milling: ['加工中心', 'Milling'],
  deburr: ['去毛刺', 'Deburr'], wash: ['清洗', 'Wash'], inspection: ['尺寸检验', 'Inspection'], finished: ['成品', 'Finished'],
  idle: ['待机', 'Idle'], setup: ['换型准备', 'Setup'], running: ['加工中', 'Running'], fault: ['故障停机', 'Faulted'],
  blocked: ['下游阻塞', 'Blocked'], waiting: ['等待资源', 'Waiting'], processing: ['加工中', 'Processing'],
  transport: ['运输中', 'Transport'], transporting: ['运输中', 'Transport'], loading: ['装载中', 'Loading'],
  unloading: ['卸载中', 'Unloading'], delivered: ['已交付', 'Delivered'], complete: ['已完成', 'Complete'],
  completed: ['已完成', 'Complete'], queued: ['排队中', 'Queued'], ready: ['待安排', 'Ready'],
  released: ['已投放', 'Released'], in_progress: ['生产中', 'In progress'], pickup: ['前往取料', 'Approaching pickup'],
  awaiting_pickup: ['等待取料', 'Awaiting pickup'], awaiting_unload: ['等待下料', 'Awaiting unload'], waiting_transport: ['等待转运', 'Awaiting transport'],
  released_event: ['订单投料', 'Released'], transport_assigned: ['分配转运任务', 'Transport assigned'], picked_up: ['已取料', 'Picked up'],
  setup_started: ['换型开始', 'Setup started'], processing_started: ['加工开始', 'Processing started'], operation_completed: ['工序完成', 'Operation completed'],
  load_started: ['机械臂上料', 'Robot loading'], load_completed: ['上料完成', 'Loading complete'], unload_started: ['机械臂下料', 'Robot unloading'], unload_completed: ['下料完成', 'Unloading complete'],
  reroute_requested: ['请求改派转运', 'Reroute requested'], policy_applied: ['派工策略更新', 'Policy updated'], restore: ['设备恢复', 'Machine restored'],
  shaft: ['阶梯轴 · 车削＋铣削', 'Stepped shaft · turn + mill'], sleeve: ['轴套 · 车削路线', 'Sleeve · turning route'],
};
const display = (value: string, en: boolean) => labels[value]?.[en ? 1 : 0] ?? value;
const reasonText = (value: string | null | undefined, en: boolean) => {
  if (!value || en) return value;
  const reasons: Record<string, string> = {
    'Awaiting AMR and turning input capacity': '等待搬运车及车削工位接收',
    'Awaiting AMR and downstream capacity': '等待搬运车及下游工位接收',
    'Robot handoff held by machine fault': '设备故障，上下料交接暂停',
    'Awaiting machine / tending robot': '等待机床或上下料机械臂',
    'Downstream input queues full': '下游输入缓存已满',
    'Both AMRs busy': '两台搬运车均在执行任务',
    'AMR waiting for reserved aisle segments': '等待物流通道释放',
    'Assigned AMR approaching': '已分配搬运车，正在前往取料',
    'Awaiting physical reroute by AMR': '等待搬运车转运至兼容机床',
    'Machine fault: processing / handoff paused': '设备故障，加工或上下料暂停',
    'Finite input / tending capacity': '输入缓存或上下料能力受限',
  };
  return reasons[value] ?? value.replace(/ input queue full$/, ' 输入缓存已满');
};
const seconds = (value: number) => `${Math.floor(Math.max(0, value) / 60).toString().padStart(2, '0')}:${Math.floor(Math.max(0, value) % 60).toString().padStart(2, '0')}`;

export default function ProductionApp() {
  const [lang, setLang] = useState<Lang>(() => { try { return localStorage.getItem('workshop.lang') === 'en' ? 'en' : 'zh'; } catch { return 'zh'; } });
  const en = lang === 'en';
  const { snapshot: data, connected, pending, error, setError, command, retry } = useProduction();
  const [selectedId, setSelectedId] = useState('P001');
  const [orderId, setOrderId] = useState<string | null>(null);
  const [view, setView] = useState<'orbit' | 'top' | 'focus'>('orbit');
  const [ready, setReady] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const [showRoutes, setShowRoutes] = useState(true);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [comparing, setComparing] = useState(false);
  const [settings, setSettings] = useState(false);
  const [orders, setOrders] = useState<OrderInput[]>([]);
  const [settingsRun, setSettingsRun] = useState<string | null>(null);
  const [duration, setDuration] = useState(300);
  const [horizon, setHorizon] = useState(1800);
  const disabled = !connected || pending || comparing;
  const part = data?.parts.find(item => item.id === selectedId);
  const machine = data?.machines.find(item => item.id === selectedId);
  const selectedOrder = data?.orders.find(item => item.id === (part?.order_id ?? orderId));
  const selected = part ? { ...WORKPIECE_ASSET, id: part.id } : ASSETS.find(item => item.id === selectedId);
  const focus = data ? productionAssetPose(data, selectedId) : undefined;
  const legacy = useMemo(() => {
    const state = createSimulation();
    if (!data) return state;
    state.elapsed = data.elapsed; state.paused = data.paused; state.speed = data.speed;
    for (const item of data.machines) state.machines[item.id] = {
      status: item.status === 'running' ? 'running' : item.status === 'setup' ? 'setup' : item.status === 'fault' ? 'fault' : 'idle',
      progress: item.progress, completedCycles: data.parts.filter(p => p.history.some(h => h.resource === item.id && /complete/i.test(h.event))).length,
    };
    return state;
  }, [data]);
  useEffect(() => {
    document.documentElement.lang = en ? 'en' : 'zh-CN';
    document.title = en ? 'Machining Production Twin' : '精密加工车间 · 生产流程与异常应对';
    try { localStorage.setItem('workshop.lang', lang); } catch { /* optional storage */ }
  }, [lang, en]);
  useEffect(() => {
    if (settings && data && settingsRun !== data.run_id) setSettings(false);
  }, [data, settings, settingsRun]);
  const openSettings = () => {
    if (!data) return;
    setOrders(data.orders.map(item => ({ id: item.id, part_type: item.part_type as 'shaft' | 'sleeve', quantity: item.quantity, due_seconds: item.due_seconds })));
    setSettingsRun(data.run_id); setSettings(true);
  };
  useEffect(() => {
    if (comparison && data && (comparison.run_id !== data.run_id || comparison.revision !== data.revision)) setComparison(null);
  }, [data, comparison]);
  const select = (asset: WorkshopAsset) => { setSelectedId(asset.id); setView('focus'); };
  const mutate = async (path: string, body: unknown) => { setComparison(null); return command(path, body); };
  const compare = async () => {
    if (disabled) return;
    setComparing(true); setError('');
    try {
      const paused = await command('control', { paused: true });
      if (!paused) return;
      setComparison(await workshopRequest<Comparison>('compare', { horizon_seconds: horizon }));
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setComparing(false); }
  };
  const reset = async (custom = false) => {
    const next = await mutate('reset', custom ? { orders } : {});
    if (next) { setSettings(false); setOrderId(null); setSelectedId('P001'); setView('orbit'); setOrders(next.orders.map(item => ({ id: item.id, part_type: item.part_type as 'shaft' | 'sleeve', quantity: item.quantity, due_seconds: item.due_seconds }))); }
  };
  const progress = data ? data.metrics.completed_parts / Math.max(1, data.metrics.total_parts) : 0;
  const shownParts = data?.parts.filter(item => !orderId || item.order_id === orderId) ?? [];

  return <main className="production-app" data-testid="production-app">
    <header className="production-header">
      <a className="shop-brand" href="/"><span className="shop-mark">S</span><span><strong>{en ? 'Machining Production Twin' : '精密加工车间'}</strong><small>{en ? 'ORDER FLOW / DISTURBANCE RESPONSE' : '订单流转 / 资源协同 / 异常应对'}</small></span></a>
      <nav><span className={`production-connection ${connected ? 'online' : ''}`} data-testid="production-connection" data-connected={connected}><i />{connected ? (en ? 'SIMULATION CONNECTED' : '仿真引擎已连接') : (en ? 'DISCONNECTED' : '仿真引擎未连接')}</span>
        <a className="mode-link" href="/workshop.html?mode=demo">{en ? 'Scene demo' : '场景演示'}</a>
        <button onClick={() => setLang(en ? 'zh' : 'en')} aria-label={en ? '切换为简体中文' : 'Switch to English'}>{en ? '中文' : 'EN'}</button></nav>
    </header>
    {!connected && <div className="production-notice" role="status"><span>{en ? 'Waiting for backend. Production stays frozen. Start the backend to use orders and recovery comparison.' : '等待后端连接，生产画面保持最后状态。启动后端后可使用订单生产与恢复方案对比。'}</span><button onClick={retry}>{en ? 'Retry' : '重新连接'}</button></div>}
    {error && <div className="production-error" role="alert">{en ? 'Operation failed: ' : '操作未完成：'}{error}<button onClick={() => setError('')}>×</button></div>}
    <section className="production-kpis" aria-label={en ? 'Production metrics' : '生产指标'}>
      <div><small>{en ? 'DELIVERED PARTS' : '已交付工件'}</small><strong>{data?.metrics.completed_parts ?? '—'} <em>/ {data?.metrics.total_parts ?? '—'}</em></strong><span className="production-progress"><i style={{ width: `${progress * 100}%` }} /></span></div>
      <div><small>{en ? 'WORK IN PROGRESS' : '在制工件'}</small><strong>{data?.metrics.wip ?? '—'} <em>{en ? 'parts' : '件'}</em></strong><span>{en ? 'Released, not yet delivered' : '已投放、尚未入库'}</span></div>
      <div><small>{en ? 'ACCUMULATED WAIT' : '累计等待时间'}</small><strong>{data ? Math.round(data.metrics.waiting_seconds) : '—'} <em>s</em></strong><span>{en ? 'Sum across all parts' : '所有工件等待时间之和'}</span></div>
      <div><small>{en ? 'ON-TIME COMPLETED ORDERS' : '按期完成订单'}</small><strong>{data?.metrics.on_time_orders ?? '—'} <em>/ {data?.orders.length ?? '—'}</em></strong><span>{en ? 'Only completed orders counted' : '仅统计已经完成的订单'}</span></div>
      <div><small>{en ? 'DISPATCH POLICY' : '当前派工策略'}</small><strong className="policy-value" data-testid="production-policy">{data ? policyName(data.policy, en) : '—'}</strong><span>{en ? 'Preset simulation parameters' : '示例参数 · 非真实产能预测'}</span></div>
    </section>
    <section className="production-workspace">
      <aside className="production-left">
        <div className="production-section-title"><span><small>PRODUCTION ORDERS</small><h1>{en ? 'Orders & parts' : '订单与工件'}</h1></span><button onClick={openSettings} disabled={disabled}>{en ? 'Order settings' : '订单设置'}</button></div>
        <div data-testid="production-orders" className="production-orders">{data?.orders.map(item => <button key={item.id} data-order={item.id} data-testid={`order-${item.id}`} className={`${orderId === item.id ? 'selected' : ''} ${item.affected ? 'affected' : ''}`} onClick={() => { setOrderId(item.id === orderId ? null : item.id); const first = data.parts.find(p => p.order_id === item.id && p.status !== 'complete' && p.status !== 'completed'); if (first) { setSelectedId(first.id); setView('focus'); } }}>
          <span><b>{item.id}</b><strong>{item.completed} / {item.quantity}</strong></span><small>{display(item.part_type, en)}</small>
          <span className="order-due">{en ? 'Due' : '交期'} {seconds(item.due_seconds)}<em>{item.tardiness > 0 ? `${en ? 'Late' : '已延期'} ${Math.round(item.tardiness)}s` : item.affected ? (en ? 'Fault affected' : '受故障影响') : display(item.status, en)}</em></span>
          <span className="production-progress"><i style={{ width: `${item.completed / item.quantity * 100}%` }} /></span>
        </button>)}</div>
        <div className="part-list-title"><span>{orderId ?? (en ? 'All parts' : '全部工件')}</span>{orderId && <button onClick={() => setOrderId(null)}>{en ? 'Show all' : '显示全部'}</button>}</div>
        <div className="production-parts">{shownParts.map(item => <button key={item.id} data-testid={`production-part-${item.id}`} className={selectedId === item.id ? 'selected' : ''} onClick={() => { setSelectedId(item.id); setView('focus'); }}><span><b>{item.id}</b><small>{item.order_id}</small></span><span>{display(item.operation, en)}<small>{item.location} · {display(item.status, en)}</small></span></button>)}</div>
        <div className="production-robot-summary">{data?.robots.map(robot => <div key={robot.id}><span>{robot.id} · {en ? 'handling' : '上下料'}</span><b>{(robot.utilization * 100).toFixed(0)}%</b><small>{robot.machine_id ?? (en ? 'Idle' : '待机')}</small></div>)}</div>
      </aside>
      <section className="factory-board production-board">
        <div className="scene-topline"><div className="scene-kicker"><i />{en ? 'SHOP FLOOR' : '加工现场'}<span>/</span>{en ? 'SIMULATION' : '软件仿真'}</div><div className="scene-tools">
          <button aria-pressed={showRoutes} onClick={() => setShowRoutes(value => !value)}>{en ? 'Routes' : '工件流程'}</button><button aria-pressed={showLabels} onClick={() => setShowLabels(value => !value)}>{en ? 'Labels' : '设备标签'}</button>
          <button onClick={() => setView('orbit')}>{en ? 'Overview' : '等轴视角'}</button><button onClick={() => setView('top')}>{en ? 'Top' : '俯视平面'}</button></div></div>
        <div className="scene-canvas" data-testid="production-stage" data-selected={selectedId} data-ready={ready}>
          {data && <WorkshopScene lang={lang} state={legacy} production={data} selectedId={selectedId} onSelect={select} showLabels={showLabels} showRoutes={showRoutes} view={view} focusPosition={focus?.position ?? selected?.position} copy={copy[lang]} onReady={() => setReady(true)} />}
          {!data && <div className="production-awaiting"><b>{en ? 'Production engine' : '生产仿真引擎'}</b><p>{en ? 'Waiting for a shared production snapshot' : '正在等待统一生产状态'}</p><a className="mode-link" href="/workshop.html?mode=demo">{en ? 'Open scene demo →' : '查看场景演示 →'}</a></div>}
          {data && <div className="production-scene-caption"><strong>{part ? `${part.id} / ${part.order_id}` : selectedId}</strong><span>{part ? `${display(part.operation, en)} · ${display(part.status, en)}` : display(machine?.status ?? 'idle', en)}</span><small>{reasonText(part?.waiting_reason, en) ?? (en ? 'Select a part to follow its actual location' : '点击工件跟随实际位置')}</small></div>}
        </div>
        <div className="production-route">{['raw', 'turning', 'milling', 'deburr', 'wash', 'inspection', 'finished'].map((stage, i) => <span key={stage} className={part?.stage_index === i ? 'active' : ''}><i>{i + 1}</i>{display(stage, en)}</span>)}</div>
      </section>
      <aside className="production-right">
        <div className="production-section-title"><span><small>RESOURCE / PART TRACE</small><h2>{en ? 'Selection & impact' : '工件追踪与影响'}</h2></span></div>
        <label className="production-asset-label">{en ? 'Inspect resource' : '查看设备'}<select value={ASSETS.some(a => a.id === selectedId) ? selectedId : ''} data-testid="production-asset-select" onChange={event => { setSelectedId(event.target.value); setView('focus'); }}><option value="">{en ? 'Select equipment' : '选择设备'}</option>{ASSETS.map(asset => <option key={asset.id} value={asset.id}>{asset.id} · {asset.name[lang]}</option>)}</select></label>
        {part && <div className="production-trace" data-testid="part-trace"><h3>{part.id}<small>{part.order_id}</small></h3><dl><div><dt>{en ? 'Operation' : '当前工序'}</dt><dd>{display(part.operation, en)}</dd></div><div><dt>{en ? 'Location' : '实际位置'}</dt><dd>{part.location}</dd></div><div><dt>{en ? 'Next resource' : '分配设备'}</dt><dd>{part.assigned_machine ?? '—'}</dd></div><div><dt>{en ? 'Order due' : '订单交期'}</dt><dd>{seconds(selectedOrder?.due_seconds ?? 0)}</dd></div></dl><p className="wait-reason">{reasonText(part.waiting_reason, en) ?? (en ? 'No waiting reason' : '当前无等待原因')}</p><ol>{part.history.slice(-7).reverse().map((entry, i) => <li key={i}><time>{seconds(entry.time)}</time><span>{display(entry.event === 'released' ? 'released_event' : entry.event, en)}<small>{entry.resource}</small></span></li>)}</ol></div>}
        {machine && <div className="production-machine"><h3>{machine.id}<span data-testid="production-machine-status" className={machine.status}>{display(machine.status, en)}</span></h3><p>{en ? 'Current part' : '当前工件'} <b>{machine.part_id ?? '—'}</b></p><p>{en ? 'Input queue' : '等待队列'} <b>{machine.queue.join(', ') || '—'}</b></p><span className="production-progress"><i style={{ width: `${machine.progress * 100}%` }} /></span>
          {/^([LM]0[123])$/.test(machine.id) && <><label>{en ? 'Repair duration (s)' : '预计维修时长（秒）'}<input type="number" min={1} max={3600} value={duration} onChange={event => setDuration(Number(event.target.value))} /></label>
          <button className={machine.status === 'fault' ? 'production-primary' : 'production-danger'} disabled={disabled || !Number.isFinite(duration) || duration < 1 || duration > 3600} onClick={() => void mutate('fault', { machine_id: machine.id, duration_seconds: duration, active: machine.status !== 'fault' })}>{machine.status === 'fault' ? (en ? 'Restore machine' : '恢复设备') : (en ? 'Inject fault' : '注入故障')}</button>
          <small>{en ? 'Loaded / processing parts stay on their machine.' : '已上机工件留在原设备，等待维修后继续。'}</small></>}</div>}
        {!part && !machine && <div className="production-resource"><h3>{selectedId}</h3><p>{selected?.name[lang]}</p>{data?.amrs.filter(item => item.id === selectedId).map(item => <p key={item.id}>{item.from_id ?? '—'} → {item.to_id ?? '—'}<br />{display(item.status, en)} · {item.part_id ?? (en ? 'Empty' : '空载')}</p>)}</div>}
        <div className="production-section-title"><span><small>FLOW DIAGNOSIS</small><h2>{en ? 'Queues & bottlenecks' : '等待与瓶颈线索'}</h2></span></div>
        <div className="production-bottlenecks">{data?.bottlenecks.length ? data.bottlenecks.slice(0, 4).map((item, i) => <button key={`${item.resource}-${i}`} onClick={() => { if (ASSETS.some(asset => asset.id === item.resource)) { setSelectedId(item.resource); setView('focus'); } }}><strong>{item.resource}<b>{item.waiting_parts} {en ? 'waiting' : '件等待'}</b></strong><p>{reasonText(item.reason, en)}</p><small>{item.order_ids.join(' / ')}</small></button>) : <p>{en ? 'No queues currently detected' : '当前未检测到排队'}</p>}</div>
        <div className="production-recovery"><label>{en ? 'Comparison horizon (s)' : '方案预测窗口（秒）'}<input type="number" min={60} max={3600} step={60} value={horizon} onChange={event => setHorizon(Number(event.target.value))} /></label><button className="production-primary" disabled={disabled || !Number.isFinite(horizon) || horizon < 60 || horizon > 3600} onClick={() => void compare()}>{comparing ? (en ? 'Simulating branches…' : '正在仿真比较…') : (en ? 'Compare recovery plans' : '比较恢复方案')}</button><small>{en ? 'Pauses production. All plans start from the same snapshot.' : '比较前暂停生产，三个方案从同一状态开始。'}</small></div>
      </aside>
    </section>
    <footer className="production-controls"><div className="production-clock"><small>{en ? 'SIMULATED TIME' : '仿真时间'}</small><strong data-testid="production-time" data-seconds={data ? Math.floor(data.elapsed) : 0}>{seconds(data?.elapsed ?? 0)}</strong></div>
      <button className="production-primary" disabled={disabled || !data || data.complete} onClick={() => void mutate('control', { paused: !data?.paused })}>{data?.paused !== false ? (en ? 'Start production' : '开始生产') : (en ? 'Pause production' : '暂停生产')}</button>
      <button disabled={disabled} onClick={() => void mutate('control', { advance_seconds: 60 })}>{en ? 'Advance 60s' : '推进60秒'}</button><button disabled={disabled} onClick={() => void reset()}>{en ? 'Reset production' : '重置生产'}</button>
      <label>{en ? 'Speed' : '倍速'}<select aria-label={en ? 'Production speed' : '生产倍速'} disabled={disabled} value={data?.speed ?? 1} onChange={event => void mutate('control', { speed: Number(event.target.value) })}>{[1, 2, 5, 10].map(value => <option key={value} value={value}>{value}×</option>)}</select></label>
      <span className="production-disclaimer">{data?.complete ? (en ? 'All orders delivered' : '全部订单已交付') : (en ? 'Simulated orders and timings · no real equipment connected' : '订单与节拍为仿真设定 · 未连接真实设备')}</span>
    </footer>
    {comparison && <div className="production-modal-backdrop"><section className="production-modal" role="dialog" aria-modal="true" aria-label={en ? 'Recovery comparison' : '恢复方案比较'} data-testid="recovery-comparison"><div className="production-modal-heading"><div><small>ISOLATED WHAT-IF SIMULATION</small><h2>{en ? 'Recovery plans, from one snapshot' : '同一生产状态，比较三种恢复方案'}</h2></div><button onClick={() => setComparison(null)} aria-label={en ? 'Close comparison' : '关闭方案比较'}>×</button></div><p>{en ? 'Simulation horizon' : '仿真窗口'} {comparison.horizon_seconds}s · {en ? 'Live production stays paused. Results depend on preset parameters.' : '现场保持暂停，比较结果取决于当前示例参数。'}</p>
      <div className="comparison-cards">{comparison.scenarios.map(scenario => <article key={scenario.policy} data-policy={scenario.policy}><h3>{policyName(scenario.policy, en)}</h3><small>{scenario.complete ? (en ? 'All orders completed in horizon' : '窗口内全部订单完成') : (en ? 'Some orders unfinished in horizon' : '窗口结束仍有订单未完成')}</small><dl><div><dt>{en ? 'Delivered' : '交付工件'}</dt><dd>{scenario.metrics.completed_parts} / {scenario.metrics.total_parts}</dd></div><div><dt>{en ? 'On-time orders' : '按期完成订单'}</dt><dd>{scenario.metrics.on_time_orders}</dd></div><div><dt>{en ? 'Total tardiness' : '累计延期'}</dt><dd>{Math.round(scenario.metrics.tardy_seconds)}s</dd></div><div><dt>{en ? 'Part waiting' : '工件累计等待'}</dt><dd>{Math.round(scenario.metrics.waiting_seconds)}s</dd></div></dl><p>{en ? scenario.explanation : scenario.policy === 'fifo' ? '保留已分配队列，等待维修完成，按先到顺序继续加工。' : scenario.policy === 'reroute' ? '将尚未上机的任务通过搬运车转移到兼容机床，计入额外运输及换型；已上机工件留在原处。' : '优先安排交期较近的订单，并对可转移任务执行兼容机床改派；其他订单可能等待更久。'}</p><ul>{scenario.orders.map(order => <li key={order.id}><b>{order.id}</b><span>{order.completed}/{order.quantity} · {order.projected_finish == null ? (en ? 'unfinished' : '未完成') : seconds(order.projected_finish)}</span></li>)}</ul><button className="production-primary" data-testid={`apply-${scenario.policy}`} disabled={disabled} onClick={async () => { const next = await command('apply', { policy: scenario.policy, run_id: comparison.run_id, revision: comparison.revision }); if (next) setComparison(null); }}>{en ? 'Apply policy' : '应用此策略'}</button></article>)}</div><p className="comparison-footnote">{en ? 'Applying changes pending dispatch only; loaded and processing parts remain on their machines. A partial horizon is not proof of final delivery.' : '策略应用影响后续派工，已上机工件不会转移；预测窗口内未完成的订单不能据此认定最终交期。'}</p></section></div>}
    {settings && <div className="production-modal-backdrop"><form className="production-modal order-settings" role="dialog" aria-modal="true" aria-label={en ? 'Order settings' : '订单设置'} onSubmit={event => { event.preventDefault(); void reset(true); }}><div className="production-modal-heading"><div><small>SIMULATION INPUT</small><h2>{en ? 'Order settings' : '订单设置'}</h2></div><button type="button" onClick={() => setSettings(false)} aria-label={en ? 'Close settings' : '关闭设置'}>×</button></div><p>{en ? 'Changing orders resets the shared simulation. Due times are seconds from production start.' : '按设置重新开始会重置共享生产状态。交期为从生产开始计算的仿真秒数。'}</p>{orders.map((order, i) => <fieldset key={order.id}><legend>{order.id}</legend><label>{en ? 'Part family' : '零件类型'}<select value={order.part_type} onChange={event => setOrders(current => current.map((o, j) => j === i ? { ...o, part_type: event.target.value as OrderInput['part_type'] } : o))}><option value="shaft">{display('shaft', en)}</option><option value="sleeve">{display('sleeve', en)}</option></select></label><label>{en ? 'Quantity' : '数量'}<input aria-label={`${order.id} ${en ? 'quantity' : '数量'}`} type="number" min={1} max={40} required value={order.quantity} onChange={event => setOrders(current => current.map((o, j) => j === i ? { ...o, quantity: Number(event.target.value) } : o))} /></label><label>{en ? 'Due (seconds)' : '交期秒数'}<input aria-label={`${order.id} ${en ? 'due seconds' : '交期秒数'}`} type="number" min={1} max={86400} required value={order.due_seconds} onChange={event => setOrders(current => current.map((o, j) => j === i ? { ...o, due_seconds: Number(event.target.value) } : o))} /></label></fieldset>)}<button className="production-primary" disabled={disabled} type="submit">{en ? 'Restart with these orders' : '按设置重新开始'}</button></form></div>}
  </main>;
}
