import { useCallback, useEffect, useRef, useState } from 'react';
import { apiUrl, wsUrl } from '../config';
import type { ProductionSnapshot } from './production';
import { acceptProductionSnapshot } from './production';

export async function workshopRequest<T>(path: string, body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(apiUrl('/api/workshop/' + path), {
      method: body === undefined ? 'GET' : 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(typeof data.detail === 'string' ? data.detail : `HTTP ${response.status}`);
    }
    return await response.json() as T;
  } finally { window.clearTimeout(timeout); }
}

export function useProduction() {
  const [snapshot, setSnapshot] = useState<ProductionSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const alive = useRef(true);
  const busy = useRef(false);
  const accept = useCallback((next: ProductionSnapshot, source: 'stream' | 'command' = 'stream') => {
    if (!next || typeof next.run_id !== 'string' || !Array.isArray(next.parts) || !Array.isArray(next.orders)) return;
    setSnapshot(current => acceptProductionSnapshot(current, next, source));
  }, []);
  useEffect(() => {
    alive.current = true;
    let stopped = false;
    let socket: WebSocket | null = null;
    let timer: number | undefined;
    let lastMessage = performance.now();
    const connect = async () => {
      try {
        const initial = await workshopRequest<ProductionSnapshot>('snapshot');
        if (stopped) return;
        accept(initial); setError(''); lastMessage = performance.now();
        socket = new WebSocket(wsUrl() + '/workshop');
        socket.onmessage = event => {
          if (stopped) return;
          try {
            accept(JSON.parse(event.data)); lastMessage = performance.now(); setConnected(true);
          } catch { setConnected(false); }
        };
        socket.onclose = () => {
          if (stopped) return;
          setConnected(false); timer = window.setTimeout(connect, 2500);
        };
        socket.onerror = () => socket?.close();
      } catch {
        if (stopped) return;
        setConnected(false); timer = window.setTimeout(connect, 2500);
      }
    };
    void connect();
    const watchdog = window.setInterval(() => {
      if (performance.now() - lastMessage > 6000) { setConnected(false); socket?.close(); }
    }, 1000);
    return () => { stopped = true; alive.current = false; window.clearTimeout(timer); window.clearInterval(watchdog); socket?.close(); };
  }, [attempt, accept]);
  const command = useCallback(async (path: string, body: unknown) => {
    if (busy.current) return null;
    busy.current = true; setPending(true); setError('');
    try {
      const next = await workshopRequest<ProductionSnapshot>(path, body);
      if (alive.current) accept(next, 'command');
      return next;
    } catch (failure) {
      if (alive.current) setError(failure instanceof Error ? failure.message : String(failure));
      return null;
    } finally { busy.current = false; if (alive.current) setPending(false); }
  }, [accept]);
  return { snapshot, connected, pending, error, setError, command, retry: () => setAttempt(value => value + 1) };
}
