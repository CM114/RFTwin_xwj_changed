import { expect, test } from "@playwright/test";

async function openWorkshop(page: import("@playwright/test").Page) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/workshop.html?mode=demo");
  await expect(page.locator(".shop-brand strong")).toHaveText("精密加工车间", { timeout: 10_000 });
  await expect(page.getByTestId("workshop-stage")).toHaveAttribute("data-ready", "true");
}

test("workshop opens with a rendered factory and six selectable machine tools", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openWorkshop(page);
  await expect(page.locator("canvas")).toBeVisible();
  for (const id of ["L01", "L02", "L03", "M01", "M02", "M03"]) {
    await expect(page.getByTestId("asset-item-" + id)).toBeVisible();
  }
  await page.getByTestId("asset-item-L01").click();
  await expect(page.getByTestId("selected-id")).toHaveText("L01");
  await page.screenshot({ path: "test-results/workshop-desktop.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("world labels stay anchored and the complete workpiece route is visible", async ({ page }) => {
  await openWorkshop(page);
  await expect(page.getByTestId("workshop-stage")).toHaveAttribute("data-label-mode", "flat-world");
  await expect(page.locator(".machine-label, .scene-tag, .zone-sign")).toHaveCount(0);
  await expect(page.getByTestId("process-flow")).toContainText("原料");
  await expect(page.getByTestId("process-flow")).toContainText("车削");
  await expect(page.getByTestId("process-flow")).toContainText("加工中心");
  await expect(page.getByTestId("process-flow")).toContainText("去毛刺");
  await expect(page.getByTestId("process-flow")).toContainText("清洗");
  await expect(page.getByTestId("process-flow")).toContainText("尺寸检验");
  await expect(page.getByTestId("process-flow")).toContainText("成品");
});

test("selected machinery can be inspected in a focused close-up", async ({ page }) => {
  await openWorkshop(page);
  await page.getByTestId("asset-item-M01").click();
  const focus = page.getByRole("button", { name: "聚焦设备", exact: true });
  await focus.click();
  await expect(focus).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("workshop-stage")).toHaveAttribute("data-view-mode", "focus");
  await page.waitForTimeout(250);
  await page.screenshot({ path: "test-results/workshop-machine-focus.png", fullPage: true });
});

test("selecting an asset recenters the camera on its world position", async ({ page }) => {
  await openWorkshop(page);
  await page.getByTestId("asset-item-M02").click();
  const stage = page.getByTestId("workshop-stage");
  await expect(stage).toHaveAttribute("data-view-mode", "focus");
  await expect(stage).toHaveAttribute("data-focus-target", "-3,8");
  await expect.poll(async () => Number(await page.locator('canvas').getAttribute('data-focus-x'))).toBeCloseTo(0, 2);
  await expect.poll(async () => Number(await page.locator('canvas').getAttribute('data-focus-y'))).toBeCloseTo(0, 2);
});

test("a workpiece rides AMR01 along the transfer route", async ({ page }) => {
  await openWorkshop(page);
  await page.getByRole('button', { name: '重置模拟', exact: true }).click();
  await page.getByRole('button', { name: '暂停模拟', exact: true }).click();
  const stage = page.getByTestId("workshop-stage");
  await expect(stage).toHaveAttribute("data-carrier", "AMR01");
  await expect(page.getByTestId('carrier-stage')).toContainText('原料');
  await page.getByRole('button', { name: '下一工序', exact: true }).click();
  await expect(page.getByTestId('carrier-stage')).toContainText('数控车削');
  await page.getByRole('button', { name: '跟随工件', exact: true }).click();
  await expect(page.getByTestId('selected-id')).toHaveText('P001');
  const start = await stage.getAttribute("data-carrier-position");
  await page.getByRole('button', { name: '继续模拟', exact: true }).click();
  await expect(stage).not.toHaveAttribute("data-carrier-position", start ?? "");
  await expect(page.getByTestId("carrier-stage")).toContainText("AMR01");
});

test("the two tending robots expose their three-machine service cells", async ({ page }) => {
  await openWorkshop(page);
  await page.getByTestId("asset-item-R01").click();
  await expect(page.locator("[data-testid='selected-asset']")).toContainText("L01 / L02 / L03");
  await page.getByTestId("asset-item-R02").click();
  await expect(page.locator("[data-testid='selected-asset']")).toContainText("M01 / M02 / M03");
});

test('one part is handed off in sequence at every processing station', async ({ page }) => {
  await openWorkshop(page);
  await page.getByRole('button', { name: '重置模拟', exact: true }).click();
  await page.getByRole('button', { name: '暂停模拟', exact: true }).click();
  await page.getByRole('button', { name: '等轴视角', exact: true }).click();
  await page.screenshot({ path: 'test-results/workshop-flat-labels-overview.png', fullPage: true });
  for (const station of ['数控车削', '加工中心', '去毛刺', '清洗', '尺寸检验', '成品']) {
    await page.getByRole('button', { name: '下一工序', exact: true }).click();
    await expect(page.getByTestId('carrier-stage')).toContainText(station);
    await page.getByRole('button', { name: '继续模拟', exact: true }).click();
    await expect(page.getByTestId('workshop-stage')).toHaveAttribute('data-carrier-phase', 'unload', { timeout: 6000 });
    await page.getByRole('button', { name: '暂停模拟', exact: true }).click();
    if (station === '数控车削') {
      await page.getByTestId('asset-item-R01').click();
      await page.screenshot({ path: 'test-results/workshop-robot-handoff.png', fullPage: true });
    }
  }
  await page.getByRole('button', { name: '跟随工件', exact: true }).click();
  await expect.poll(async () => Math.abs(Number(await page.locator('canvas').getAttribute('data-focus-x')))).toBeLessThan(0.01);
});

test("machine fault and restoration update the shared scene state", async ({ page }) => {
  await openWorkshop(page);
  await page.getByTestId("asset-item-L01").click();
  await page.getByRole("button", { name: "注入故障", exact: true }).click();
  await expect(page.getByTestId("machine-state")).toHaveAttribute("data-status", "fault");
  await expect(page.getByTestId("event-log")).toContainText("L01");
  await page.getByRole("button", { name: "恢复设备", exact: true }).click();
  await expect(page.getByTestId("machine-state")).toHaveAttribute("data-status", "running");
});

test("pause freezes the simulation clock and reset restores initial state", async ({ page }) => {
  await openWorkshop(page);
  await page.getByRole("button", { name: "暂停模拟" }).click();
  const clock = page.getByTestId("sim-time");
  const paused = await clock.getAttribute("data-seconds");
  await page.waitForTimeout(600);
  expect(await clock.getAttribute("data-seconds")).toBe(paused);
  await page.getByRole("button", { name: "重置模拟" }).click();
  await expect(page.getByRole("button", { name: "暂停模拟" })).toBeVisible();
  await expect(clock).toHaveAttribute("data-seconds", "0");
});

test("camera, layers and English controls work without a backend", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openWorkshop(page);
  await page.getByRole("button", { name: "俯视平面" }).click();
  await expect(page.getByRole("button", { name: "俯视平面" })).toHaveAttribute("aria-pressed", "true");
  const flowToggle = page.getByRole("button", { name: "工件流程", exact: true });
  await expect(flowToggle).toHaveAttribute("aria-pressed", "true");
  await flowToggle.click();
  await expect(flowToggle).toHaveAttribute("aria-pressed", "false");
  await flowToggle.click();
  await expect(flowToggle).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "设备标签", exact: true }).click();
  await expect(page.getByTestId("scene-pick-L01")).toHaveCount(0);
  await page.getByRole("button", { name: "Switch to English" }).click();
  await expect(page.locator(".shop-brand strong")).toHaveText("Precision Machine Shop");
  await expect(page.getByRole("button", { name: "Pause simulation" })).toBeVisible();
  await page.screenshot({ path: "test-results/workshop-top-english.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("asset search and narrow layout remain usable", async ({ page }) => {
  await openWorkshop(page);
  await page.getByRole("searchbox").fill("M02");
  await expect(page.getByTestId("asset-item-M02")).toBeVisible();
  await expect(page.getByTestId("asset-item-L01")).toHaveCount(0);
  await page.getByTestId("asset-item-M02").click();
  await expect(page.getByTestId("selected-id")).toHaveText("M02");
  await page.setViewportSize({ width: 820, height: 1000 });
  await expect(page.locator("canvas")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/workshop-narrow.png", fullPage: true });
});
