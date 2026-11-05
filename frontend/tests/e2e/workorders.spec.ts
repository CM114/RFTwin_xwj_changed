import { expect, test, type Page, type Route } from "@playwright/test";

type Order = {
  id: number; source_id: string; event_type: string; severity: string;
  cell_id: string | null; status: "OPEN" | "IN_PROGRESS" | "COMPLETED";
  assignee: string | null; note: string | null; created_sim_time: string;
  completed_sim_time: string | null; repair_seconds: number | null;
  fault_active: boolean; current_run: boolean;
};

const firstOrder = (): Order => ({
  id: 42, source_id: "R-01", event_type: "TOOL_FAILURE", severity: "critical",
  cell_id: "CELL-WELDING", status: "OPEN", assignee: null, note: null,
  created_sim_time: "2025-01-01T10:00:00", completed_sim_time: null,
  repair_seconds: null, fault_active: true, current_run: true,
});

async function openOffline(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem("twin.lang", "en"));
  await page.route("**/api/health", (route) => route.fulfill({ status: 503, body: "offline" }));
  await page.goto("/");
  await expect(page.locator(".live")).toContainText("LOCAL DEMO", { timeout: 20_000 });
}

async function connect(page: Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as any).__twin;
    const run = store.getState().runId as string;
    store.setState({ mode: "LIVE", connected: true });
    return run;
  });
}

function respondWithOrders(route: Route, runId: string, orders: Order[]) {
  const summary = {
    open: orders.filter((o) => o.status === "OPEN").length,
    in_progress: orders.filter((o) => o.status === "IN_PROGRESS").length,
    completed: orders.filter((o) => o.status === "COMPLETED").length,
    average_repair_sec: orders.some((o) => o.repair_seconds != null) ? 120 : null,
  };
  return route.fulfill({ json: { session_id: "SESSION-1", run_id: runId, orders, summary } });
}

test("work orders explain offline mode in both languages without requesting fabricated data", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/work-orders**", async (route) => { requests++; await route.abort(); });
  await openOffline(page);
  await page.getByRole("tab", { name: "Work Orders" }).click();
  await expect(page.locator(".panel.center h2")).toHaveText("Work Orders");
  await expect(page.getByText("Disconnected — work orders require a connected live simulation.")).toBeVisible();
  await expect(page.getByText(/simulated remaining time/i)).toBeVisible();
  await expect(page.getByTestId("wo-summary-open")).toHaveCount(0);
  expect(requests).toBe(0);
  await page.locator("[data-testid=langsw] button", { hasText: "中" }).click();
  await expect(page.getByRole("tab", { name: "維護工單" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("未連線 — 工單需要已連線的即時模擬。" )).toBeVisible();
  await page.getByRole("button", { name: "返回 3D" }).click();
  await expect(page.getByRole("tab", { name: "3D 工廠" })).toHaveAttribute("aria-selected", "true");
});

test("connected work orders refresh after start and completion and compare simulated durations", async ({ page }) => {
  await openOffline(page);
  let runId = "";
  const orders = [firstOrder()];
  const posts: { path: string; body: unknown }[] = [];
  let gets = 0;
  await page.route("**/api/work-orders**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET") { gets++; await respondWithOrders(route, runId, orders); return; }
    posts.push({ path, body: request.postDataJSON() });
    if (path.endsWith("/start")) { orders[0].status = "IN_PROGRESS"; orders[0].assignee = "Ada"; }
    if (path.endsWith("/complete")) {
      orders[0].status = "COMPLETED"; orders[0].note = "Replaced tool";
      orders[0].completed_sim_time = "2025-01-01T10:02:00"; orders[0].repair_seconds = 120;
    }
    if (path.endsWith("/compare")) {
      await route.fulfill({ json: { branch_from: { run_id: runId, seq: 7 }, horizon_min: 15,
        options: [{ duration_sec: 30, good_units: 100, downtime_sec: 30, energy_kwh_total: 12.5 },
          { duration_sec: 90, good_units: 95, downtime_sec: 90, energy_kwh_total: 12.1 }] } });
      return;
    }
    await route.fulfill({ json: orders[0] });
  });
  runId = await connect(page);
  await page.getByRole("tab", { name: "Work Orders" }).click();
  await expect(page.getByTestId("wo-summary-open")).toContainText("1");
  await expect(page.getByTestId("wo-detail")).toContainText("TOOL_FAILURE");
  await expect(page.getByTestId("wo-detail")).toContainText("R-01");
  await expect(page.getByText(/simulated remaining time/i)).toBeVisible();
  await page.getByLabel("Assignee").fill("Ada");
  await page.getByRole("button", { name: "Start work order" }).click();
  await expect(page.getByTestId("wo-summary-in-progress")).toContainText("1");
  await expect(page.getByTestId("wo-detail")).toContainText("Ada");
  await page.getByLabel("Option A remaining seconds").fill("30");
  await page.getByLabel("Option B remaining seconds").fill("90");
  await page.getByLabel("Horizon (minutes)").fill("15");
  await page.getByRole("button", { name: "Compare repairs" }).click();
  await expect(page.getByTestId("wo-comparison")).toContainText("100");
  await expect(page.getByTestId("wo-comparison")).toContainText("12.5");
  await page.getByLabel("Completion note").fill("Replaced tool");
  await page.getByRole("button", { name: "Complete work order" }).click();
  await expect(page.getByTestId("wo-summary-completed")).toContainText("1");
  await expect(page.getByTestId("wo-detail")).toContainText("Replaced tool");
  await expect(page.getByText("Work order completed; the simulated device is still recovering.")).toBeVisible();
  expect(gets).toBeGreaterThanOrEqual(3);
  expect(posts).toEqual([
    { path: "/api/work-orders/42/start", body: { assignee: "Ada" } },
    { path: "/api/work-orders/42/compare", body: { duration_a_sec: 30, duration_b_sec: 90, horizon_min: 15 } },
    { path: "/api/work-orders/42/complete", body: { note: "Replaced tool" } },
  ]);
  await page.getByRole("button", { name: "Locate in 3D" }).click();
  await expect(page.getByRole("tab", { name: "3D Factory" })).toHaveAttribute("aria-selected", "true");
  expect(await page.evaluate(() => (window as any).__twin.getState().selectedRobot)).toBe("R-01");
});

test("API errors are visible and a lost connection hides stale work orders and actions", async ({ page }) => {
  await openOffline(page);
  let runId = "";
  let failGet = true;
  await page.route("**/api/work-orders**", async (route) => {
    if (route.request().method() === "GET") {
      if (failGet) await route.fulfill({ status: 503, json: { detail: "maintenance unavailable" } });
      else await respondWithOrders(route, runId, [firstOrder()]);
    } else await route.fulfill({ status: 409, json: { detail: "already assigned" } });
  });
  runId = await connect(page);
  await page.getByRole("tab", { name: "Work Orders" }).click();
  await expect(page.getByRole("alert")).toContainText("503");
  await expect(page.getByRole("alert")).toContainText("maintenance unavailable");
  failGet = false;
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByTestId("wo-detail")).toContainText("R-01");
  await page.getByLabel("Assignee").fill("Ada");
  await page.getByRole("button", { name: "Start work order" }).click();
  await expect(page.getByRole("alert")).toContainText("409");
  await expect(page.getByRole("alert")).toContainText("already assigned");
  await page.evaluate(() => (window as any).__twin.setState({ mode: "RECONNECTING", connected: false }));
  await expect(page.getByText("Disconnected — work orders require a connected live simulation.")).toBeVisible();
  await expect(page.getByTestId("wo-detail")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start work order" })).toHaveCount(0);
});

test("historical non-robot orders cannot be changed and return to 3D without selecting a robot", async ({ page }) => {
  await openOffline(page);
  let runId = "";
  const history = { ...firstOrder(), id: 43, source_id: "C-03", current_run: false, fault_active: false };
  await page.route("**/api/work-orders**", (route) => respondWithOrders(route, runId, [history]));
  runId = await connect(page);
  const selectedBefore = await page.evaluate(() => (window as any).__twin.getState().selectedRobot);
  await page.getByRole("tab", { name: "Work Orders" }).click();
  await expect(page.getByTestId("wo-detail")).toContainText("C-03");
  await expect(page.getByText("Previous run", { exact: true })).toBeVisible();
  await expect(page.getByText("Unknown (previous run)")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start work order" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Compare repairs" })).toBeDisabled();
  await page.getByRole("button", { name: "Return to 3D" }).click();
  await expect(page.getByRole("tab", { name: "3D Factory" })).toHaveAttribute("aria-selected", "true");
  expect(await page.evaluate(() => (window as any).__twin.getState().selectedRobot)).toBe(selectedBefore);
});

test("a write completing after leaving the view does not refresh an unmounted view", async ({ page }) => {
  await openOffline(page);
  let runId = "";
  let gets = 0;
  let started = false;
  let release = () => {};
  let finish = () => {};
  const finished = new Promise<void>((resolve) => { finish = resolve; });
  await page.route("**/api/work-orders**", async (route) => {
    if (route.request().method() === "GET") {
      gets++;
      await respondWithOrders(route, runId, [firstOrder()]);
    } else {
      started = true;
      await new Promise<void>((resolve) => { release = resolve; });
      await route.fulfill({ json: {} });
      finish();
    }
  });
  runId = await connect(page);
  await page.getByRole("tab", { name: "Work Orders" }).click();
  await expect(page.getByTestId("wo-detail")).toContainText("R-01");
  await page.getByLabel("Assignee").fill("Ada");
  await page.getByRole("button", { name: "Start work order" }).click();
  await expect.poll(() => started).toBe(true);
  await page.getByRole("button", { name: "Locate in 3D" }).click();
  release();
  await finished;
  await page.waitForTimeout(1000);
  expect(gets).toBe(1);
});

test("a response from a different run is rejected rather than shown as current", async ({ page }) => {
  await openOffline(page);
  await page.route("**/api/work-orders**", (route) => respondWithOrders(route, "OLD-RUN", [firstOrder()]));
  await connect(page);
  await page.getByRole("tab", { name: "Work Orders" }).click();
  await expect(page.getByRole("alert")).toContainText("response belongs to run OLD-RUN");
  await expect(page.getByTestId("wo-detail")).toHaveCount(0);
  await expect(page.getByTestId("wo-summary-open")).toHaveCount(0);
});
