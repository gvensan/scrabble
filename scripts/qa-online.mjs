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
  await host.getByRole("button", { name: /Create a game/ }).click();
  await host.getByRole("button", { name: /Invite friends online/ }).click();
  await host.getByRole("button", { name: "21 × 21" }).click();
  await host.getByRole("button", { name: "2 min" }).click();
  await host.getByRole("button", { name: "Candy" }).click();
  await host.getByRole("button", { name: /Create invite link/ }).click();
  await host.getByText(/^Room [A-Z0-9]+$/).waitFor();
  const roomCode = (
    await host.getByText(/^Room [A-Z0-9]+$/).textContent()
  ).split(" ")[1];
  const inviteLink = await host
    .getByRole("textbox", { name: "Invite link" })
    .inputValue();
  if (!inviteLink.endsWith(`?room=${roomCode}`))
    throw new Error(`Invite link ${inviteLink} does not carry the room code.`);

  await guest.goto(`${base}/?room=${roomCode}`);
  await guest.getByLabel("Nickname").fill("Lin");
  await guest.getByRole("button", { name: "Join room" }).click();
  await guest.getByRole("heading", { name: "Gather your players" }).waitFor();
  await host.locator(".roster").getByText("Lin", { exact: true }).waitFor();
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
  await host.locator("aside .turn-card").getByText("Your turn").waitFor();
  // The waiting player sees who is up, and cannot touch letters or moves.
  await guest
    .locator("aside .turn-card")
    .getByText(/^Ada is playing$/)
    .waitFor();
  if (
    !(await guest
      .locator(".rack button")
      .evaluateAll((tiles) => tiles.every((tile) => tile.disabled))) ||
    !(await guest.getByRole("button", { name: "Pass" }).isDisabled()) ||
    !(await guest.getByRole("button", { name: "Exchange" }).isDisabled())
  )
    throw new Error("Off-turn controls are not locked.");
  const sidebarFits = await host
    .locator("aside.online-side")
    .evaluate((aside) => aside.scrollHeight <= aside.clientHeight + 1);
  if (!sidebarFits) throw new Error("The game sidebar needs scrolling.");
  const scoreboardLast = await host
    .locator("aside.online-side")
    .evaluate(
      (aside) =>
        aside
          .querySelector(".side-tools")
          ?.compareDocumentPosition(aside.querySelector(".match-status")) ===
        Node.DOCUMENT_POSITION_FOLLOWING,
    );
  if (!scoreboardLast)
    throw new Error("The scoreboard is not below the zoom controls.");
  await host.getByRole("button", { name: "Rules of play" }).click();
  await host
    .getByRole("dialog", { name: "Rules of play" })
    .getByText(/WordSoHard word list/)
    .waitFor();
  await host.keyboard.press("Escape");
  await host
    .getByRole("dialog", { name: "Rules of play" })
    .waitFor({ state: "detached" });
  await host.locator("aside .match-status").getByText("Turn 1").waitFor();
  if ((await host.locator("aside .score-list > div").count()) !== 2)
    throw new Error("The sidebar scoreboard does not list every participant.");
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
  const timerText = await host.locator("aside .turn-card strong").textContent();
  if (!timerText?.match(/^\d+:\d{2}$/))
    throw new Error("The authoritative timer is not prominent in the sidebar.");
  // The host's sound button opens settings, including the room's voice switch.
  await host.getByRole("button", { name: "Sound settings" }).click();
  await host.getByLabel("Voice chat for this room").waitFor();
  await host.getByLabel("Game sounds").uncheck();
  await host.getByLabel("Game sounds").check();
  await host.keyboard.press("Escape");

  await host.locator(".rack button:not(:disabled)").first().dragTo(center);
  if (
    await host.getByRole("dialog", { name: "Choose blank letter" }).isVisible()
  )
    await host.getByRole("button", { name: "A", exact: true }).click();
  await host.locator(".score-preview").waitFor();
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
  await host.locator('.cell[tabindex="0"]').focus();
  const startCol = await host.evaluate(() =>
    Number(document.activeElement?.getAttribute("data-col")),
  );
  await host.keyboard.press("ArrowRight");
  if (
    (await host.evaluate(() =>
      Number(document.activeElement?.getAttribute("data-col")),
    )) !==
    startCol + 1
  )
    throw new Error("Arrow keys do not move focus across the board.");

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

  // Six passes end the game, with a warning first and an explanation after.
  for (let turn = 0; turn < 6; turn += 1) {
    const actor = turn % 2 === 0 ? host : guest;
    await actor.getByRole("button", { name: "Pass", exact: true }).click();
    await actor.getByRole("button", { name: "Pass turn" }).click();
    if (turn === 0)
      await guest.locator(".last-play").getByText("Ada passed.").waitFor();
    if (turn === 3) await host.locator(".scoreless-warning").waitFor();
  }
  // Everyone gets the ending explained and acknowledges it.
  for (const page of [host, guest])
    await page.getByRole("button", { name: "OK, see the results" }).click();
  await host.getByText("Finished after six scoreless turns.").waitFor();
  await guest.getByText("Finished after six scoreless turns.").waitFor();
  // The results page: leaderboard and moments tabs, then the final board.
  await host.getByRole("tab", { name: "Leaderboard" }).waitFor();
  await guest.getByRole("tab", { name: "Moments" }).click();
  await guest.getByRole("img", { name: /The final board/ }).waitFor();
  const summaryPage = await host.context().newPage();
  await summaryPage.goto(`${base}/?game=${roomCode}`);
  await summaryPage
    .getByRole("tab", { name: "Leaderboard" })
    .waitFor({ timeout: 15_000 });
  await summaryPage.close();
  if (await host.getByRole("button", { name: /rematch/i }).count())
    throw new Error("The results screen still offers a rematch.");

  const closerContext = await browser.newContext();
  const leaverContext = await browser.newContext();
  const closer = await closerContext.newPage();
  const leaver = await leaverContext.newPage();
  await closer.goto(base);
  await closer.getByPlaceholder("What should friends call you?").fill("Host");
  await closer.getByRole("button", { name: /Create a game/ }).click();
  await closer.getByRole("button", { name: /Create invite link/ }).click();
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
  await closer.getByRole("button", { name: "Lock room" }).click();
  await closer.getByRole("button", { name: "Unlock room" }).waitFor();
  // A locked room shows why before asking for a nickname, then opens the
  // join form by itself once the host unlocks.
  await leaver.goto(`${base}/?room=${closeCode}`);
  await leaver.getByRole("heading", { name: "This room is locked" }).waitFor();
  await closer.getByRole("button", { name: "Unlock room" }).click();
  await leaver.getByLabel("Nickname").waitFor({ timeout: 15_000 });
  await leaver.getByLabel("Nickname").fill("Late");
  await leaver.getByRole("button", { name: "Join room" }).click();
  await closer.locator(".roster").getByText("Late", { exact: true }).waitFor();
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
      lockRoom: true,
      invalidMoveHighlight: true,
      rollback: true,
      sidebarTimer: true,
      soundToggle: true,
      scoreEstimate: true,
      boardArrowKeys: true,
      lastPlayAnnounced: true,
      sixPassEnding: true,
      scorelessWarning: true,
      summaryPage: true,
      inviteLink: true,
    }),
  );
} finally {
  await browser.close();
}
