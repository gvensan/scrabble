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
  await host.locator("aside .timer-card").waitFor();
  await host.getByRole("button", { name: "Fit", exact: true }).click();
  const boardOverflow = await host
    .locator(".online-board-scroll")
    .evaluate(
      (element) =>
        element.scrollWidth > element.clientWidth ||
        element.scrollHeight > element.clientHeight,
    );
  if (boardOverflow)
    throw new Error("Fit left scrollbars on the desktop board canvas.");

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
  const timerText = await host
    .locator("aside .timer-card strong")
    .textContent();
  if (!timerText?.match(/^\d+:\d{2}$/))
    throw new Error("The authoritative timer is not prominent in the sidebar.");
  await host.getByRole("button", { name: "Sound on" }).click();
  await host.getByRole("button", { name: "Sound off" }).click();

  await host.locator(".rack button:not(:disabled)").first().dragTo(center);
  if (
    await host.getByRole("dialog", { name: "Choose blank letter" }).isVisible()
  )
    await host.getByRole("button", { name: "A", exact: true }).click();
  await host.getByRole("button", { name: "Play", exact: true }).click();
  await host.getByText("That move cannot be played").waitFor();
  if ((await host.locator(".cell.invalid").count()) !== 1)
    throw new Error("Rejected move was not highlighted on the board.");
  await host.screenshot({
    path: "artifacts/screenshots/15-invalid-move-rollback-desktop.png",
    fullPage: true,
  });
  await host.setViewportSize({ width: 375, height: 812 });
  if (
    await host.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    )
  )
    throw new Error("Invalid-move controls cause phone page overflow.");
  await host.screenshot({
    path: "artifacts/screenshots/16-invalid-move-rollback-phone.png",
    fullPage: true,
  });
  await host.setViewportSize({ width: 1440, height: 900 });
  await host.getByRole("button", { name: "Dismiss move error" }).click();
  await host
    .getByText("That move cannot be played")
    .waitFor({ state: "hidden" });
  if ((await host.locator(".cell.pending").count()) !== 1)
    throw new Error("Dismissing the toast unexpectedly changed the draft.");
  await host.getByRole("button", { name: "Play", exact: true }).click();
  await host.getByText("That move cannot be played").waitFor();
  await host.getByRole("button", { name: "Reset move" }).click();
  if ((await host.locator(".cell.pending").count()) !== 0)
    throw new Error("Reset move did not return every provisional tile.");

  const hostAxe = await new AxeBuilder({ page: host }).analyze();
  const guestAxe = await new AxeBuilder({ page: guest }).analyze();
  if (hostAxe.violations.length || guestAxe.violations.length)
    throw new Error(
      `Axe violations: host=${hostAxe.violations.flatMap((item) => item.nodes.map((node) => `${item.id}:${node.target.join(" ")}`)).join(",") || "none"}, guest=${guestAxe.violations.flatMap((item) => item.nodes.map((node) => `${item.id}:${node.target.join(" ")}`)).join(",") || "none"}`,
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
      invalidMoveHighlight: true,
      rollback: true,
      sidebarTimer: true,
      soundToggle: true,
    }),
  );
} finally {
  await browser.close();
}
