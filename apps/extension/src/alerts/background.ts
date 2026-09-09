import { readAlertToken, readInbox } from "./client.js";

export function installAlertBadge() {
  const name = "usc-opening-alerts";
  let active = false;
  const update = async () => {
    if (active) return;
    active = true;
    try {
      const token = await readAlertToken();
      const data = token ? await readInbox(token) : undefined;
      const count =
        data?.events.filter((e) =>
          ["review_required", "checking", "open"].includes(e.status),
        ).length ?? 0;
      await chrome.action.setBadgeText({ text: count ? String(count) : "" });
      await chrome.action.setBadgeBackgroundColor({ color: "#8f272b" });
      await chrome.action.setTitle({
        title: count
          ? `${count} reported course opening(s). Open USC Course Planner to review.`
          : "Open USC Course Planner",
      });
    } catch {
      await chrome.action.setBadgeText({ text: "!" });
      await chrome.action.setTitle({
        title:
          "Opening alert service unavailable. Start the local backend and reopen the planner.",
      });
    } finally {
      active = false;
    }
  };
  const schedule = () => {
    chrome.alarms.create(name, { periodInMinutes: 1 });
    void update();
  };
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === name) void update();
  });
  chrome.runtime.onStartup.addListener(schedule);
  chrome.runtime.onInstalled.addListener(schedule);
  schedule();
}
