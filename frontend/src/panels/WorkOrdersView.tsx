import { useEffect, useRef, useState } from "react";
import { apiUrl } from "../config";
import { useT, type TKey } from "../i18n";
import { useTwin } from "../state/store";
import "./workorders.css";

type WorkOrderStatus = "OPEN" | "IN_PROGRESS" | "COMPLETED";
interface WorkOrder {
  id: number;
  source_id: string;
  event_type: string;
  severity: string;
  cell_id: string | null;
  status: WorkOrderStatus;
  assignee: string | null;
  note: string | null;
  created_sim_time: string;
  completed_sim_time: string | null;
  repair_seconds: number | null;
  fault_active: boolean;
  current_run: boolean;
}
interface WorkOrdersResponse {
  session_id: string;
  run_id: string;
  orders: WorkOrder[];
  summary: { open: number; in_progress: number; completed: number; average_repair_sec: number | null };
}
interface ComparisonResponse {
  branch_from: { run_id: string; seq: number };
  horizon_min: number;
  options: { duration_sec: number; good_units: number; downtime_sec: number; energy_kwh_total: number }[];
}
type LoadError = { kind: "request"; message: string } | { kind: "invalid" }
  | { kind: "run"; response: string; current: string };

/** Work orders must use the real API, never the local-demo fixture router. */
async function request<T>(path: string, body?: object, signal?: AbortSignal, expectJson = true): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const text = await response.text();
    let detail = text;
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === "object" && "detail" in parsed) {
        const value = parsed.detail;
        detail = typeof value === "string" ? value : JSON.stringify(value);
      }
    } catch { /* Non-JSON error bodies are still useful to the operator. */ }
    throw new Error(`HTTP ${response.status}${detail ? `: ${detail.slice(0, 500)}` : ""}`);
  }
  return expectJson ? await response.json() as T : undefined as T;
}

const statusKeys: Record<WorkOrderStatus, TKey> = {
  OPEN: "wo.open", IN_PROGRESS: "wo.inProgress", COMPLETED: "wo.completed",
};

export function WorkOrdersView() {
  const T = useT();
  const mode = useTwin((s) => s.mode);
  const connected = useTwin((s) => s.connected);
  const runId = useTwin((s) => s.runId);
  const setView = useTwin((s) => s.setView);
  const selectRobot = useTwin((s) => s.selectRobot);
  const online = mode === "LIVE" && connected;
  const [data, setData] = useState<WorkOrdersResponse | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [assignee, setAssignee] = useState("");
  const [note, setNote] = useState("");
  const [durationA, setDurationA] = useState("60");
  const [durationB, setDurationB] = useState("120");
  const [horizon, setHorizon] = useState("15");
  const [comparison, setComparison] = useState<{ orderId: number; result: ComparisonResponse } | null>(null);
  const refresh = useRef<((showLoading?: boolean) => Promise<void>) | null>(null);
  const epoch = useRef(0);
  const busyRef = useRef(false);

  useEffect(() => {
    const currentEpoch = ++epoch.current;
    let active = true;
    let serial = 0;
    let controller: AbortController | null = null;
    const valid = () => {
      const state = useTwin.getState();
      return active && epoch.current === currentEpoch && state.mode === "LIVE" && state.connected && state.runId === runId;
    };
    setData(null);
    setSelectedId(null);
    setComparison(null);
    setLoadError(null);
    setActionError(null);
    setBusy(false);
    busyRef.current = false;
    refresh.current = null;
    if (!online || !runId) {
      setLoading(false);
      return () => { active = false; epoch.current++; };
    }
    const load = async (showLoading = false) => {
      const requestNumber = ++serial;
      controller?.abort();
      controller = new AbortController();
      if (showLoading) { setLoading(true); setData(null); }
      try {
        const next = await request<WorkOrdersResponse>("/api/work-orders", undefined, controller.signal);
        if (!valid() || requestNumber !== serial) return;
        if (!next || typeof next.run_id !== "string" || typeof next.session_id !== "string"
          || !Array.isArray(next.orders) || !next.summary || typeof next.summary !== "object") {
          setData(null); setLoadError({ kind: "invalid" }); return;
        }
        if (next.run_id !== runId) {
          setData(null); setLoadError({ kind: "run", response: next.run_id, current: runId }); return;
        }
        setData(next);
        setLoadError(null);
      } catch (error) {
        if (!valid() || requestNumber !== serial || (error instanceof Error && error.name === "AbortError")) return;
        setData(null);
        setLoadError({ kind: "request", message: error instanceof Error ? error.message : String(error) });
      } finally {
        if (valid() && requestNumber === serial) setLoading(false);
      }
    };
    refresh.current = load;
    void load(true);
    const timer = window.setInterval(() => { if (!busyRef.current) void load(); }, 5000);
    return () => { active = false; epoch.current++; controller?.abort(); window.clearInterval(timer); };
  }, [online, runId]);

  // Do not render data from an earlier connection/run, even before an effect cleanup runs.
  const currentData = online && runId && data?.run_id === runId ? data : null;
  const selected = currentData?.orders.find((order) => order.id === selectedId) ?? currentData?.orders[0] ?? null;
  const validContext = (expectedRun: string | null, expectedEpoch: number) => {
    const state = useTwin.getState();
    return epoch.current === expectedEpoch && state.mode === "LIVE" && state.connected && state.runId === expectedRun;
  };
  const changeSelection = (id: number) => {
    setSelectedId(id); setComparison(null); setActionError(null); setAssignee(""); setNote("");
  };
  const goTo3d = () => {
    if (selected?.source_id.startsWith("R-")) selectRobot(selected.source_id);
    else setView("3d");
  };
  const act = async (kind: "start" | "complete" | "compare") => {
    if (!selected || !selected.current_run || busyRef.current || !online || !runId || !validContext(runId, epoch.current)) return;
    const a = Number(durationA), b = Number(durationB), h = Number(horizon);
    if ((kind === "start" && (selected.status !== "OPEN" || !assignee.trim()))
      || (kind === "complete" && selected.status !== "IN_PROGRESS")
      || (kind === "compare" && (!selected.fault_active || ![a, b, h].every((n) => Number.isFinite(n) && n > 0)))) return;
    const actionEpoch = epoch.current;
    const orderId = selected.id;
    busyRef.current = true;
    setBusy(true);
    setActionError(null);
    try {
      const path = `/api/work-orders/${orderId}/${kind}`;
      if (kind === "compare") {
        const result = await request<ComparisonResponse>(path, { duration_a_sec: a, duration_b_sec: b, horizon_min: h });
        if (validContext(runId, actionEpoch)) setComparison({ orderId, result });
      } else {
        await request<void>(path, kind === "start" ? { assignee: assignee.trim() } : { note: note.trim() }, undefined, false);
        if (validContext(runId, actionEpoch)) {
          setComparison(null);
          await refresh.current?.(true);
        }
      }
    } catch (error) {
      if (validContext(runId, actionEpoch)) setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      if (validContext(runId, actionEpoch)) { busyRef.current = false; setBusy(false); }
    }
  };

  const canCompare = !!selected?.current_run && !!selected.fault_active
    && [durationA, durationB, horizon].every((value) => value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) > 0);
  const loadErrorText = loadError?.kind === "request" ? loadError.message
    : loadError?.kind === "run" ? T("wo.runMismatch", loadError)
    : loadError?.kind === "invalid" ? T("wo.invalidResponse") : null;
  const visibleComparison = selected && comparison?.orderId === selected.id ? comparison.result : null;

  return (
    <div className="workorders">
      <div className="wo-topline">
        <span className={online ? "wo-live" : "wo-offline"}>{online ? T("wo.live") : T("wo.offline")}</span>
        <button type="button" onClick={goTo3d}>{T(selected?.source_id.startsWith("R-") ? "wo.locate" : "wo.return")}</button>
      </div>
      <p className="wo-explain">{T("wo.explain")}</p>
      {online && !runId && <p>{T("wo.waitRun")}</p>}
      {online && runId && <>
        {loadErrorText && <div className="wo-error" role="alert">{T("wo.error", { error: loadErrorText })}
          <button type="button" onClick={() => void refresh.current?.(true)}>{T("wo.retry")}</button></div>}
        {actionError && <div className="wo-error" role="alert">{T("wo.error", { error: actionError })}</div>}
        {loading && <p>{T("wo.loading")}</p>}
        {currentData && <>
          <p className="wo-session">{T("wo.session", { session: currentData.session_id, run: currentData.run_id })}</p>
          <div className="wo-summary">
            <div data-testid="wo-summary-open"><span>{T("wo.open")}</span><b>{currentData.summary.open}</b></div>
            <div data-testid="wo-summary-in-progress"><span>{T("wo.inProgress")}</span><b>{currentData.summary.in_progress}</b></div>
            <div data-testid="wo-summary-completed"><span>{T("wo.completed")}</span><b>{currentData.summary.completed}</b></div>
            <div><span>{T("wo.average")}</span><b>{currentData.summary.average_repair_sec == null ? "—" : T("wo.seconds", { n: currentData.summary.average_repair_sec })}</b></div>
          </div>
          {currentData.orders.length === 0 ? <p>{T("wo.none")}</p> : <div className="wo-columns">
            <section className="wo-list" aria-label={T("wo.orders")}>
              {currentData.orders.map((order) => <button key={order.id} type="button"
                className={selected?.id === order.id ? "selected" : ""} aria-pressed={selected?.id === order.id}
                onClick={() => changeSelection(order.id)}>
                <b>#{order.id} · {order.source_id}</b><span>{order.event_type}</span>
                <small>{T(statusKeys[order.status])}</small>
              </button>)}
            </section>
            {selected && <section className="wo-detail" data-testid="wo-detail">
              <h3>{T("wo.details")} · #{selected.id}</h3>
              <dl>
                <dt>{T("wo.source")}</dt><dd>{selected.source_id}</dd>
                <dt>{T("wo.event")}</dt><dd>{selected.event_type}</dd>
                <dt>{T("wo.severity")}</dt><dd>{selected.severity}</dd>
                <dt>{T("wo.cell")}</dt><dd>{selected.cell_id ?? "—"}</dd>
                <dt>{T("wo.status")}</dt><dd>{T(statusKeys[selected.status])}</dd>
                <dt>{T("wo.fault")}</dt><dd>{T(!selected.current_run ? "wo.unknownFault" : selected.fault_active ? "wo.active" : "wo.resolved")}</dd>
                <dt>{T("wo.assignee")}</dt><dd>{selected.assignee ?? "—"}</dd>
                <dt>{T("wo.note")}</dt><dd>{selected.note ?? "—"}</dd>
                <dt>{T("wo.created")}</dt><dd>{selected.created_sim_time}</dd>
                <dt>{T("wo.closed")}</dt><dd>{selected.completed_sim_time ?? "—"}</dd>
                <dt>{T("wo.repair")}</dt><dd>{selected.repair_seconds == null ? "—" : T("wo.seconds", { n: selected.repair_seconds })}</dd>
              </dl>
              <p className="wo-context">{T(selected.current_run ? "wo.currentRun" : "wo.previousRun")}</p>
              {!selected.current_run && <p className="wo-hint">{T("wo.historical")}</p>}
              {selected.current_run && selected.status === "COMPLETED" && selected.fault_active &&
                <p className="wo-hint">{T("wo.recoveryPending")}</p>}
              <div className="wo-actions">
                <label>{T("wo.assignee")}<input value={assignee} onChange={(event) => setAssignee(event.target.value)} disabled={busy || !selected.current_run || selected.status !== "OPEN"} /></label>
                <button type="button" onClick={() => void act("start")}
                  disabled={busy || !selected.current_run || selected.status !== "OPEN" || !assignee.trim()}>{T("wo.start")}</button>
                <label>{T("wo.note")}<textarea value={note} onChange={(event) => setNote(event.target.value)} disabled={busy || !selected.current_run || selected.status !== "IN_PROGRESS"} /></label>
                <button type="button" onClick={() => void act("complete")}
                  disabled={busy || !selected.current_run || selected.status !== "IN_PROGRESS"}>{T("wo.complete")}</button>
              </div>
              <section className="wo-compare">
                <h3>{T("wo.compareTitle")}</h3>
                {!selected.current_run || !selected.fault_active ? <p className="wo-hint">{T("wo.compareUnavailable")}</p> : null}
                <div className="wo-inputs">
                  <label>{T("wo.optionA")}<input type="number" min="0" step="any" value={durationA} onChange={(event) => setDurationA(event.target.value)} /></label>
                  <label>{T("wo.optionB")}<input type="number" min="0" step="any" value={durationB} onChange={(event) => setDurationB(event.target.value)} /></label>
                  <label>{T("wo.horizon")}<input type="number" min="0" step="any" value={horizon} onChange={(event) => setHorizon(event.target.value)} /></label>
                </div>
                <button type="button" onClick={() => void act("compare")} disabled={busy || !canCompare}>{T("wo.compare")}</button>
                {busy && <span className="wo-busy" role="status">{T("wo.busy")}</span>}
                {visibleComparison && <div className="wo-results" data-testid="wo-comparison">
                  <p>{T("wo.comparisonBranch", { run: visibleComparison.branch_from.run_id, seq: visibleComparison.branch_from.seq, horizon: visibleComparison.horizon_min })}</p>
                  <table><thead><tr><th>{T("wo.duration")}</th><th>{T("wo.good")}</th><th>{T("wo.downtime")}</th><th>{T("wo.energy")}</th></tr></thead>
                    <tbody>{visibleComparison.options.map((option, index) => <tr key={index}>
                      <td>{option.duration_sec}</td><td>{option.good_units}</td><td>{option.downtime_sec}</td><td>{option.energy_kwh_total}</td>
                    </tr>)}</tbody></table>
                </div>}
              </section>
            </section>}
          </div>}
        </>}
      </>}
    </div>
  );
}
