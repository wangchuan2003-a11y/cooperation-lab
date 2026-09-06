import { test as base, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const test = base.extend<{ diagnostics: void }>({
  diagnostics: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      await use();
      expect(errors).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        ),
      ).toBeLessThanOrEqual(1);
    },
    { auto: true },
  ],
});

test("zero-noise games show the known payoffs and a matrix cell selects its real duel", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator('[data-noise="0"]').click();
  await page.locator("#rounds").press("Home");
  await page.locator("#left-strategy").selectOption("cooperate");
  await page.locator("#right-strategy").selectOption("cooperate");
  await expect(page.locator("#score-a")).toHaveText("60");
  await expect(page.locator("#score-b")).toHaveText("60");
  await expect(page.locator("#coop-a")).toHaveText("100.0%");
  await expect(page.locator(".track .flipped")).toHaveCount(0);
  const cell = page.locator(
    '#matrix button[data-left="tft"][data-right="defect"]',
  );
  await expect(cell).toHaveText("0.950");
  await cell.click();
  await expect(page.locator("#left-strategy")).toHaveValue("tft");
  await expect(page.locator("#right-strategy")).toHaveValue("defect");
  await expect(page.locator("#score-a")).toHaveText("19");
  await expect(page.locator("#score-b")).toHaveText("24");
  await expect(page.locator("#round-detail")).toContainText("本轮 0，累计 0");
  await page.locator("#inspect-round").press("End");
  await expect(page.locator("#round-detail")).toContainText("本轮 1，累计 19");
  await expect(page.locator("#round-detail")).toContainText("本轮 1，累计 24");
  await expect(page.locator("#score-chart")).toHaveAttribute(
    "aria-label",
    /累计 19 分.*累计 24 分/,
  );
});

test("execution noise changes actual actions while repeating a seed reproduces them", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#rounds").press("End");
  await page.locator("#left-strategy").selectOption("cooperate");
  await page.locator("#right-strategy").selectOption("cooperate");
  await page.locator('[data-noise="0"]').click();
  await expect(page.locator("#score-a")).toHaveText("900");
  await expect(page.locator("#score-b")).toHaveText("900");
  await expect(page.locator(".track .flipped")).toHaveCount(0);
  await page.locator('[data-noise="15"]').click();
  expect(await page.locator(".track .flipped").count()).toBeGreaterThan(0);
  expect(
    Number(await page.locator("#score-a").textContent()) +
      Number(await page.locator("#score-b").textContent()),
  ).toBeLessThan(1800);
  const actions = () =>
    page
      .locator(".track .action")
      .evaluateAll((cells) => cells.map((cell) => cell.className));
  const original = await actions();
  const matrix = await page.locator("#matrix tbody").textContent();
  await page.locator("#rerun").click();
  expect(await actions()).toEqual(original);
  await expect(page.locator("#matrix tbody")).toHaveText(matrix!);
  await page.locator("#seed").fill("43");
  await page.locator("#seed").press("Enter");
  expect(await actions()).not.toEqual(original);
  await page.locator("#seed").fill("42");
  await page.locator("#seed").press("Enter");
  expect(await actions()).toEqual(original);
});

test("a shared experiment preserves complete settings, selected duel, and calculated results", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#rounds").press("End");
  await page.locator('[data-noise="15"]').click();
  await page.locator("#seed").fill("2026");
  await page.locator("#seed").press("Enter");
  await page.locator("#left-strategy").selectOption("generous");
  await page.locator("#right-strategy").selectOption("grim");
  const totals = await page.locator("#score-a, #score-b").allTextContents();
  const matrix = await page.locator("#matrix tbody").textContent();
  await page.locator("#share").click();
  await expect(page).toHaveURL(/#v1\./);
  const shared = page.url();
  await page.goto("about:blank");
  await page.goto(shared);
  for (const [id, value] of [
    ["rounds", "300"],
    ["noise", "15"],
    ["seed", "2026"],
    ["left-strategy", "generous"],
    ["right-strategy", "grim"],
  ])
    await expect(page.locator(`#${id}`)).toHaveValue(value);
  expect(await page.locator("#score-a, #score-b").allTextContents()).toEqual(
    totals,
  );
  await expect(page.locator("#matrix tbody")).toHaveText(matrix!);
  await page.goto("/#v1.invalid");
  await expect(page.locator("#status")).toContainText("当前实验保持不变");
  expect(await page.locator("#score-a, #score-b").allTextContents()).toEqual(
    totals,
  );
});

test("CSV exports the selected duel's actual actions, scores, and all rounds", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator('[data-noise="0"]').click();
  await page.locator("#rounds").press("Home");
  await page.locator("#left-strategy").selectOption("tft");
  await page.locator("#right-strategy").selectOption("defect");
  const pending = page.waitForEvent("download");
  await page.locator("#export-csv").click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe("cooperation-42-tft-vs-defect.csv");
  expect(await download.failure()).toBeNull();
  const text = await readFile((await download.path())!, "utf8");
  expect(text.charCodeAt(0)).toBe(0xfeff);
  const rows = text
    .replace(/^\ufeff/, "")
    .trimEnd()
    .split(/\r?\n/)
    .map((row) => row.split(","));
  expect(rows).toHaveLength(21);
  expect(rows[0]).toHaveLength(13);
  expect(rows[1]).toEqual([
    "1",
    "tft",
    "defect",
    "C",
    "C",
    "0",
    "0",
    "0",
    "D",
    "D",
    "0",
    "5",
    "5",
  ]);
  expect(rows[20]).toEqual([
    "20",
    "tft",
    "defect",
    "D",
    "D",
    "0",
    "1",
    "19",
    "D",
    "D",
    "0",
    "1",
    "24",
  ]);
});

test("one forced mistake distinguishes recovery patterns without changing the main experiment", async ({
  page,
}) => {
  await page.goto("/");
  const matrix = await page.locator("#matrix tbody").textContent();
  const scores = await page.locator("#score-a, #score-b").allTextContents();
  await page.locator("#share").click();
  await expect(page).toHaveURL(/#v1\./);
  const sharedURL = page.url();
  await page.locator("#single-mistake > summary").click();
  await expect(page.locator("#mistake-baseline-count")).toHaveText("40");
  await expect(page.locator("#mistake-intervention-count")).toHaveText("4");
  await expect(page.locator("#mistake-recovery")).toHaveText(
    "观察窗口内未恢复",
  );
  await expect(page.locator(".mistake-action.forced")).toHaveCount(1);
  await expect(
    page.locator('#mistake-intervention-a [data-round="5"]'),
  ).toHaveClass(/\bd\b/);
  await expect(
    page.locator('#mistake-intervention-a [data-round="6"]'),
  ).toHaveClass(/\bc\b/);
  await page.locator("#mistake-pair").selectOption("grim");
  await page.locator("#mistake-run").click();
  await expect(page.locator("#mistake-intervention-count")).toHaveText("4");
  for (const side of ["a", "b"])
    await expect(
      page.locator(`#mistake-intervention-${side} [data-round="7"]`),
    ).toHaveClass(/\bd\b/);
  await page.locator("#mistake-pair").selectOption("wsls");
  await page.locator("#mistake-run").click();
  await expect(page.locator("#mistake-intervention-count")).toHaveText("38");
  await expect(page.locator("#mistake-recovery")).toHaveText("第 7 轮");
  for (const side of ["a", "b"])
    await expect(
      page.locator(`#mistake-intervention-${side} [data-round="7"]`),
    ).toHaveClass(/\bc\b/);
  await page.locator("#mistake-at").fill("30");
  await page.locator("#mistake-run").click();
  await expect(page.locator("#mistake-recovery")).toHaveText(
    "观察窗口内未恢复",
  );
  await expect(page.locator("#mistake-intervention-count")).toHaveText("38");
  await page.locator("#mistake-at").fill("40");
  await page.locator("#mistake-run").click();
  await expect(page.locator("#mistake-recovery")).toHaveText(
    "观察窗口不足，无法判定",
  );
  await expect(page.locator("#mistake-window")).toContainText(
    "干预后剩余 0 轮",
  );
  await expect(page.locator("#matrix tbody")).toHaveText(matrix!);
  expect(await page.locator("#score-a, #score-b").allTextContents()).toEqual(
    scores,
  );
  expect(page.url()).toBe(sharedURL);
});
