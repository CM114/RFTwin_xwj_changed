/** Real frontend + backend workflow; opt in with E2E_LIVE=1 and TWIN_PORT. */
import { expect, test } from "@playwright/test";

test.skip(!process.env.E2E_LIVE, "needs a live simulation backend");

test("injected conveyor fault becomes a work order and can be repaired", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem("twin.lang", "en"));
  await page.goto("/");
  await expect(page.locator(".live")).toContainText("LIVE", { timeout: 60_000 });
  await page.getByRole("button", { name: "Inject", exact: true }).click();
  await page.getByRole("button", { name: /C-03 Conveyor Jam/ }).click();
  await expect(page.getByText(/C-03 Conveyor Jam injected/)).toBeVisible();

  await page.getByRole("tab", { name: "Work Orders" }).click();
  await expect(page.getByTestId("wo-detail")).toContainText("C-03");
  await expect(page.getByTestId("wo-detail")).toContainText("Active");
  await page.getByLabel("Assignee").fill("Demo technician");
  await page.getByRole("button", { name: "Start work order" }).click();
  await expect(page.getByTestId("wo-detail")).toContainText("Demo technician");
  await page.getByLabel("Option A remaining seconds").fill("30");
  await page.getByLabel("Option B remaining seconds").fill("90");
  await page.getByLabel("Horizon (minutes)").fill("5");
  await page.getByRole("button", { name: "Compare repairs" }).click();
  await expect(page.getByTestId("wo-comparison")).toBeVisible({ timeout: 60_000 });
  await page.getByLabel("Completion note").fill("Cleared simulated jam");
  await page.getByRole("button", { name: "Complete work order" }).click();
  await expect(page.getByTestId("wo-detail")).toContainText("Cleared simulated jam");
  await expect(page.getByTestId("wo-detail")).toContainText("No longer active");
  const snapshot = await (await page.request.get("/api/runs/LIVE-001/snapshot")).json();
  expect(snapshot.state.conveyors.find((c: { conveyor_id: string }) => c.conveyor_id === "C-03").status).toBe("RUNNING");
  await page.getByRole("button", { name: "Return to 3D" }).click();
  await expect(page.getByRole("tab", { name: "3D Factory" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".c3d canvas")).toBeVisible();
});
