
const GROUP_HEX = {
  grey: "#777777", blue: "#1E90FF", red: "#E74C3C", yellow: "#F1C40F",
  green: "#2ECC71", pink: "#FF69B4", purple: "#9B59B6", cyan: "#00BCD4",
  orange: "#FF8C00"
};

function isTabEligible(tab) {
  try {
    if (!tab || !tab.url) return false;
    const u = new URL(tab.url);
    return ["http:", "https:", "file:"].includes(u.protocol);
  } catch { return false; }
}

function safeSend(tabId, payload) {
  return new Promise(async (resolve) => {
    try { await chrome.tabs.sendMessage(tabId, payload); } catch (e) { /* ignore */ }
    resolve();
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "rename-tab", title: "Rename tab…", contexts: ["page"] });
  chrome.contextMenus.create({ id: "rename-tab-group", title: "Rename tab group…", contexts: ["page"] });
  chrome.contextMenus.create({ id: "hide-banner-once", title: "Hide top banner (until reload)", contexts: ["page"] });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id || !isTabEligible(tab)) return;
  if (info.menuItemId === "rename-tab") {
    await safeSend(tab.id, { type: "SHOW_RENAME_OVERLAY" });
  }
  if (info.menuItemId === "rename-tab-group") {
    if (!tab.groupId || tab.groupId === -1) return; // not in a group
    const group = await chrome.tabGroups.get(tab.groupId);
    await safeSend(tab.id, { type: "SHOW_GROUP_RENAME_OVERLAY", groupId: tab.groupId, currentTitle: group.title || "" });
  }
  if (info.menuItemId === "hide-banner-once") {
    await safeSend(tab.id, { type: "HIDE_BANNER_ONCE" });
  }
});

async function groupColorHex(groupId) {
  if (!groupId || groupId === -1) return null;
  const group = await chrome.tabGroups.get(groupId);
  return GROUP_HEX[group.color] || "#777777";
}

async function bannerTextForTab(tab) {
  if (!tab.groupId || tab.groupId === -1) return null;
  const group = await chrome.tabGroups.get(tab.groupId);
  const tabsInGroup = await chrome.tabs.query({ groupId: tab.groupId });
  const count = tabsInGroup.length;
  const title = tab.title || ""; // reflects document.title
  const groupName = group.title || "";
  return `${groupName} — ${count} tabs — ${title}`.trim();
}

async function handleTabEvent(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!isTabEligible(tab)) return;

    const hex = await groupColorHex(tab.groupId);
    if (hex) {
      const text = await bannerTextForTab(tab);
      await safeSend(tabId, { type: "SHOW_CONTEXT_BANNER", groupTitle: text, groupColor: hex });
      await safeSend(tabId, { type: "SET_FAVICON_COLOR", hex });
    } else {
      await safeSend(tabId, { type: "HIDE_CONTEXT_BANNER" });
      await safeSend(tabId, { type: "REVERT_FAVICON" });
    }
  } catch (e) { /* ignore */ }
}

// Tab lifecycle
chrome.tabs.onActivated.addListener(({ tabId }) => handleTabEvent(tabId));
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "complete" || changeInfo.title) handleTabEvent(tabId);
});
chrome.tabs.onMoved.addListener((tabId) => handleTabEvent(tabId));
chrome.tabs.onAttached.addListener((tabId) => handleTabEvent(tabId));
chrome.tabs.onDetached.addListener((tabId) => handleTabEvent(tabId));
chrome.tabs.onCreated.addListener((tab) => { if (tab.id) handleTabEvent(tab.id); });

// Group lifecycle
chrome.tabGroups.onUpdated.addListener(async (group) => {
  const tabs = await chrome.tabs.query({ groupId: group.id });
  for (const t of tabs) await handleTabEvent(t.id);
});
chrome.tabGroups.onCreated.addListener(async (group) => {
  const tabs = await chrome.tabs.query({ groupId: group.id });
  for (const t of tabs) await handleTabEvent(t.id);
});
chrome.tabGroups.onMoved.addListener(async (group) => {
  const tabs = await chrome.tabs.query({ groupId: group.id });
  for (const t of tabs) await handleTabEvent(t.id);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { renamePrefs = {} } = await chrome.storage.session.get("renamePrefs");
  if (renamePrefs[tabId]) { delete renamePrefs[tabId]; await chrome.storage.session.set({ renamePrefs }); }
});

// Messages from content
chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
  if (msg?.type === "SET_RENAME_PREFS" && sender?.tab?.id) {
    const { renamePrefs = {} } = await chrome.storage.session.get("renamePrefs");
    renamePrefs[sender.tab.id] = msg.prefs;
    await chrome.storage.session.set({ renamePrefs });
  }
  if (msg?.type === "SET_GROUP_TITLE" && typeof msg.groupId === "number") {
    try { await chrome.tabGroups.update(msg.groupId, { title: msg.title || "" }); sendResponse({ ok: true }); }
    catch (e) { sendResponse({ ok: false, error: String(e) }); }
    return true;
  }
  if (msg?.type === "TAB_TITLE_CHANGED" && sender?.tab?.id) {
    await handleTabEvent(sender.tab.id);
  }
  if (msg?.type === "REQUEST_REFRESH" && sender?.tab?.id) {
    await handleTabEvent(sender.tab.id);
  }
});
