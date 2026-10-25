import { chromium } from "playwright-core";

const base = process.env.SQUABBLE_WEB_URL ?? "http://127.0.0.1:5174";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
    : {}),
});

async function assertViewportLocked(page, screen, viewport) {
  const result = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
    clientWidth: document.documentElement.clientWidth,
    clientHeight: document.documentElement.clientHeight,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    htmlOverflow: getComputedStyle(document.documentElement).overflow,
    bodyOverflow: getComputedStyle(document.body).overflow,
  }));
  if (
    result.width > result.clientWidth ||
    result.height > result.clientHeight ||
    result.scrollX !== 0 ||
    result.scrollY !== 0 ||
    result.htmlOverflow !== "hidden" ||
    result.bodyOverflow !== "hidden"
  )
    throw new Error(
      `${screen} escapes the ${viewport} viewport: ${JSON.stringify(result)}`,
    );
}

async function exercise(viewport, suffix) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.goto(base);
  await assertViewportLocked(page, "welcome", suffix);
  await page.screenshot({
    path: `artifacts/screenshots/17-welcome-${suffix}.png`,
  });

  await page.getByPlaceholder("What should friends call you?").fill("Ada");
  await page.getByRole("button", { name: /Create a local game/ }).click();
  await assertViewportLocked(page, "settings", suffix);
  await page.screenshot({
    path: `artifacts/screenshots/18-settings-${suffix}.png`,
  });

  await page.getByRole("button", { name: /Continue to lobby/ }).click();
  await assertViewportLocked(page, "local lobby", suffix);
  await page.screenshot({
    path: `artifacts/screenshots/19-lobby-${suffix}.png`,
  });

  await page.goto(base);
  await page.getByRole("button", { name: "Play online with friends" }).click();
  await page.getByRole("button", { name: "Create online room" }).click();
  await assertViewportLocked(page, "online setup", suffix);
  await page.screenshot({
    path: `artifacts/screenshots/20-online-setup-${suffix}.png`,
  });
  await context.close();
}

try {
  await exercise({ width: 1440, height: 900 }, "desktop");
  await exercise({ width: 375, height: 812 }, "phone");
  console.log(
    JSON.stringify({
      screens: ["welcome", "settings", "local lobby", "online setup"],
      viewports: ["desktop", "phone"],
      documentOverflow: false,
    }),
  );
} finally {
  await browser.close();
}
