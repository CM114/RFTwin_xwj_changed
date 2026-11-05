import { expect, test } from "@playwright/test";

async function openWorkshop(page: import("@playwright/test").Page) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/workshop.html");
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
  await page.getByTestId("scene-pick-L01").click();
  await expect(page.getByTestId("selected-id")).toHaveText("L01");
  await page.screenshot({ path: "test-results/workshop-desktop.png", fullPage: true });
  expect(errors).toEqual([]);
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
  await page.getByRole("button", { name: "物流路线", exact: true }).click();
  await expect(page.getByRole("button", { name: "物流路线", exact: true })).toHaveAttribute("aria-pressed", "true");
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
