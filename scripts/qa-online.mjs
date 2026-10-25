import { chromium } from "playwright-core";
import AxeBuilder from "@axe-core/playwright";

const base = process.env.SQUABBLE_WEB_URL ?? "http://127.0.0.1:5174";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
    : {}),
});
const hostContext = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const guestContext = await browser.newContext({
  viewport: { width: 375, height: 812 },
});
const host = await hostContext.newPage();
const guest = await guestContext.newPage();

try {
  await host.goto(base);
  await host.getByPlaceholder("What should friends call you?").fill("Ada");
  await host.getByRole("button", { name: "Play online with friends" }).click();
  await host.getByRole("button", { name: "Create online room" }).click();
  await host.getByRole("button", { name: "21 × 21" }).click();
  await host.getByRole("button", { name: "2 min" }).click();
  await host.getByRole("button", { name: "Candy" }).click();
  await host.getByRole("button", { name: "Create room" }).click();
  await host.getByText(/^Room [A-Z0-9]+$/).waitFor();
  const roomCode = (
    await host.getByText(/^Room [A-Z0-9]+$/).textContent()
  ).split(" ")[1];

  await guest.goto(`${base}/?room=${roomCode}`);
  await guest.getByLabel("Nickname").fill("Lin");
  await guest.getByRole("button", { name: "Join room" }).click();
  await guest.getByRole("heading", { name: "Gather your players" }).waitFor();
  await guest.getByRole("button", { name: "I'm ready" }).click();
  await host.getByRole("button", { name: "I'm ready" }).click();
  const start = host.getByRole("button", { name: "Start game" });
  await start.waitFor({ state: "visible" });
  await start.click();

  await host.locator(".rack button").first().waitFor();
  await guest.locator(".rack button").first().waitFor();
  if ((await host.locator(".cell").count()) !== 441)
    throw new Error("Expected a 21×21 board.");
  if ((await host.locator(".rack button").count()) !== 7)
    throw new Error("Host rack is not private and complete.");
  if ((await guest.locator(".rack button").count()) !== 7)
    throw new Error("Guest rack is not private and complete.");
  await host.locator("header .timer").waitFor();

  const center = host.locator(".cell").nth(10 * 21 + 10);
  await host.locator(".rack button").first().dragTo(center);
  if (
    await host.getByRole("dialog", { name: "Choose blank letter" }).isVisible()
  )
    await host.getByRole("button", { name: "A", exact: true }).click();
  if ((await host.locator(".cell.pending").count()) !== 1)
    throw new Error("Drag placement did not create a draft.");
  const nextCell = host.locator(".cell").nth(10 * 21 + 11);
  await host.locator(".rack button:not(:disabled)").first().dragTo(nextCell);
  if (
    await host.getByRole("dialog", { name: "Choose blank letter" }).isVisible()
  )
    await host.getByRole("button", { name: "A", exact: true }).click();
  if ((await host.locator(".cell.pending").count()) !== 2)
    throw new Error("Second drag placement did not extend the draft.");
  await host.getByRole("button", { name: "Recall last placed tile" }).click();
  if ((await host.locator(".cell.pending").count()) !== 1)
    throw new Error("Recall did not pop only the latest placement.");
  await host.getByRole("button", { name: "Recall last placed tile" }).click();
  if ((await host.locator(".cell.pending").count()) !== 0)
    throw new Error("Second recall did not pop the previous placement.");

  const hostAxe = await new AxeBuilder({ page: host }).analyze();
  const guestAxe = await new AxeBuilder({ page: guest }).analyze();
  if (hostAxe.violations.length || guestAxe.violations.length)
    throw new Error(
      `Axe violations: host=${hostAxe.violations.length}, guest=${guestAxe.violations.length}`,
    );
  const overflow = await guest.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );
  if (overflow) throw new Error("Phone viewport has horizontal page overflow.");

  await host.screenshot({
    path: "artifacts/screenshots/13-online-21-candy-desktop.png",
    fullPage: true,
  });
  await guest.screenshot({
    path: "artifacts/screenshots/14-online-21-candy-phone.png",
    fullPage: true,
  });

  const closerContext = await browser.newContext();
  const leaverContext = await browser.newContext();
  const closer = await closerContext.newPage();
  const leaver = await leaverContext.newPage();
  await closer.goto(base);
  await closer.getByPlaceholder("What should friends call you?").fill("Host");
  await closer
    .getByRole("button", { name: "Play online with friends" })
    .click();
  await closer.getByRole("button", { name: "Create online room" }).click();
  await closer.getByRole("button", { name: "Create room" }).click();
  await closer.getByText(/^Room [A-Z0-9]+$/).waitFor();
  const closeCode = (
    await closer.getByText(/^Room [A-Z0-9]+$/).textContent()
  ).split(" ")[1];
  await leaver.goto(`${base}/?room=${closeCode}`);
  await leaver.getByLabel("Nickname").fill("Mina");
  await leaver.getByRole("button", { name: "Join room" }).click();
  await closer.getByText("Mina", { exact: true }).waitFor();
  await leaver.getByRole("button", { name: "Leave room" }).click();
  await closer.getByText("Mina", { exact: true }).waitFor({ state: "hidden" });
  await closer.getByRole("button", { name: "Close lobby" }).click();
  await closer.getByRole("heading", { name: "Reconnecting…" }).waitFor();
  await closerContext.close();
  await leaverContext.close();

  console.log(
    JSON.stringify({
      roomCode,
      boardCells: 441,
      racks: [7, 7],
      axeViolations: 0,
      phoneOverflow: false,
      lobbyLeave: true,
      hostClose: true,
    }),
  );
} finally {
  await browser.close();
}
