import { expect, test, type Page } from '@playwright/test';

// Isolated synthetic UI fixtures. These requests never reach a production engine.
const snapshot = () => ({
  run_id: 'synthetic-active', revision: 2, elapsed: 120, paused: true, speed: 1, policy: 'fifo', complete: false,
  orders: [
    { id: 'SYNTHETIC-A', part_type: 'shaft', quantity: 4, due_seconds: 900, completed: 0, status: 'in_progress', projected_finish: null, tardiness: 0, affected: false, historically_affected: true },
    { id: 'SYNTHETIC-DONE', part_type: 'sleeve', quantity: 1, due_seconds: 900, completed: 1, status: 'completed', projected_finish: 100, tardiness: 0, affected: false, historically_affected: true },
  ],
  parts: Array.from({ length: 5 }, (_, i) => ({ id: `P00${i + 1}`, order_id: i === 4 ? 'SYNTHETIC-DONE' : 'SYNTHETIC-A', part_type: 'shaft', operation: i === 4 ? 'finished' : 'turning', stage_index: i === 4 ? 6 : 1, status: i === 4 ? 'completed' : 'queued', location: i === 4 ? 'FG' : 'L01', position: i === 4 ? [20, .6, -8] : [-12 + i * .4, .5, -8], waiting_reason: null, assigned_machine: 'L01', historically_affected: true, history: [{ time: 0, event: 'released', resource: 'RAW' }] })),
  machines: [{ id: 'L01', operation: 'turning', status: 'idle', part_id: null, progress: 0, queue: ['P001', 'P002'], incoming: ['P003'], output: ['P004'], fault_remaining: 0 }],
  robots: ['R01', 'R02'].map((id, i) => ({ id, position: [-12, .5, i ? 4.8 : -4.8], status: 'idle', machine_id: null, part_id: null, tip: null, utilization: 0 })),
  amrs: ['AMR01', 'AMR02'].map((id, i) => ({ id, position: [-16 + i * 3, .35, 1.2], heading: 0, status: i ? 'waiting_traffic' : 'pickup_transfer', loaded: false, part_id: i ? null : 'P003', from_id: 'RAW', to_id: 'L01', path: [] })),
  metrics: { completed_parts: 1, total_parts: 5, wip: 4, waiting_seconds: 30, on_time_orders: 1, tardy_seconds: 0, robot_utilization: {} },
  bottlenecks: [{ resource: 'L01', reason: 'Finite input / tending capacity', waiting_parts: 4, queued_parts: 2, incoming_parts: 1, awaiting_dispatch_parts: 1, order_ids: ['SYNTHETIC-A'] }],
  events: [], assumptions: [], storage_error: 'Synthetic disk full',
});

async function isolateProduction(page: Page, failHistory = false, paused = true) {
  let active = { ...snapshot(), paused };
  const summary = { run_id: 'synthetic-saved', created_at: '2026-11-06T00:00:00Z', updated_at: '2026-11-06T00:05:00Z', archived: true, source_run_id: null, elapsed: 120, revision: 2, policy: 'fifo', paused: true, complete: false, completed_parts: 1, total_parts: 5, event_count: 2 };
  const events = [{ seq: 1, time: 12, kind: 'fault', resource: 'L01', part_id: 'P001', message: 'Synthetic saved fault detail' }, { seq: 2, time: 42, kind: 'restore', resource: 'L01', part_id: null, message: 'Synthetic saved repair detail' }];
  const sockets: { send(data: string): void }[] = [];
  await page.addInitScript(() => localStorage.setItem('workshop.lang', 'zh'));
  await page.routeWebSocket(/\/ws\/workshop$/, socket => {
    sockets.push(socket); socket.send(JSON.stringify(active));
    const heartbeat = setInterval(() => { try { socket.send(JSON.stringify(active)); } catch { clearInterval(heartbeat); } }, 1000);
    socket.onClose(() => clearInterval(heartbeat));
  });
  await page.route('**/api/workshop/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/snapshot')) return route.fulfill({ json: active });
    if (path.endsWith('/runs')) return route.fulfill(failHistory ? { status: 503, json: { detail: 'Synthetic storage unavailable' } } : { json: { current_run_id: active.run_id, runs: [summary] } });
    if (path.endsWith('/runs/synthetic-saved/restore')) {
      active = { ...snapshot(), run_id: 'synthetic-restored', elapsed: 120 };
      await route.fulfill({ json: active });
      sockets.forEach(socket => socket.send(JSON.stringify(active)));
      return;
    }
    if (path.endsWith('/runs/synthetic-saved')) return route.fulfill({ json: { run: summary, snapshot: snapshot(), events } });
    return route.fulfill({ status: 404, json: { detail: 'Unconfigured synthetic request' } });
  });
  await page.goto('/workshop.html');
  await expect(page.getByTestId('production-connection')).toHaveAttribute('data-connected', 'true');
}

test('production distinguishes history, physical queue counts and empty carrier assignment', async ({ page }) => {
  await isolateProduction(page);
  await expect(page.getByTestId('production-storage-error')).toContainText('Synthetic disk full');
  await expect(page.getByTestId('production-storage-error')).toContainText('保存失败');
  await expect(page.getByTestId('production-storage-error')).toContainText('生产已暂停');
  await expect(page.getByTestId('order-SYNTHETIC-A')).toContainText('曾受故障影响');
  await expect(page.getByTestId('order-SYNTHETIC-A')).not.toContainText('当前受故障影响');
  await expect(page.getByTestId('order-SYNTHETIC-DONE')).toContainText('已完成');
  await expect(page.getByTestId('order-SYNTHETIC-DONE')).toContainText('曾受故障影响');
  await page.getByTestId('production-asset-select').selectOption('L01');
  await expect(page.getByTestId('machine-queue')).toContainText('2');
  await expect(page.getByTestId('machine-queue')).toContainText('P001, P002');
  await expect(page.getByTestId('machine-incoming')).toContainText('P003');
  await expect(page.getByTestId('machine-output')).toContainText('P004');
  await expect(page.getByTestId('bottleneck-L01')).toContainText('合计 4');
  await expect(page.getByTestId('bottleneck-L01')).toContainText('排队 2');
  await expect(page.getByTestId('bottleneck-L01')).toContainText('在途 1');
  await expect(page.getByTestId('bottleneck-L01')).toContainText('待转运 1');
  await page.getByTestId('production-asset-select').selectOption('AMR01');
  await expect(page.getByTestId('amr-state')).toContainText('空载');
  await expect(page.getByTestId('amr-state')).toContainText('取料交接中');
  await page.getByTestId('production-asset-select').selectOption('AMR02');
  await expect(page.getByTestId('amr-state')).toContainText('等待通道');
  await page.screenshot({ path: 'test-results/workshop-hardening-state.png', fullPage: true });
});

test('production records show durable events and restore into a new paused run', async ({ page }) => {
  await isolateProduction(page);
  await page.getByRole('button', { name: '生产记录', exact: true }).click();
  const history = page.getByRole('dialog', { name: '生产记录', exact: true });
  await expect(history).toContainText('synthetic-saved');
  await expect(history).toContainText('1 / 5');
  await expect(history).toContainText('Synthetic saved fault detail');
  await expect(history).toContainText('Synthetic saved repair detail');
  await expect(history).toContainText('替换当前生产状态');
  await page.screenshot({ path: 'test-results/workshop-hardening-records.png', fullPage: true });
  await history.getByRole('button', { name: '恢复此记录并替换当前生产', exact: true }).click();
  await expect(history).toHaveCount(0);
  await expect(page.getByTestId('production-app')).toHaveAttribute('data-run-id', 'synthetic-restored');
  await expect(page.getByRole('button', { name: '开始生产', exact: true })).toBeVisible();
});

test('production records expose storage failures without persistence success claims', async ({ page }) => {
  await isolateProduction(page, true);
  await page.getByRole('button', { name: '生产记录', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '生产记录', exact: true }).getByRole('alert')).toContainText('Synthetic storage unavailable');
});

test('running storage failure does not falsely claim production has paused', async ({ page }) => {
  await isolateProduction(page, false, false);
  await expect(page.getByRole('button', { name: '暂停生产', exact: true })).toBeVisible();
  await expect(page.getByTestId('production-storage-error')).toContainText('保存失败');
  await expect(page.getByTestId('production-storage-error')).not.toContainText('生产已暂停');
  await page.getByRole('button', { name: 'Switch to English' }).click();
  await expect(page.getByTestId('production-storage-error')).toContainText('Saving failed');
  await expect(page.getByTestId('production-storage-error')).not.toContainText('production is paused');
});
