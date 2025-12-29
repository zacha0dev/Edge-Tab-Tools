
// --- Favicon helpers
function getFaviconLinks() {
  const rels = ["icon", "shortcut icon"];
  return rels.map(rel => document.querySelector(`link[rel="${rel}"]`)).filter(Boolean);
}
function setFaviconDataUrl(dataUrl) {
  const rels = ["icon", "shortcut icon"];
  for (const rel of rels) {
    let link = document.querySelector(`link[rel="${rel}"]`);
    if (!link) { link = document.createElement("link"); link.rel = rel; document.head.appendChild(link); }
    link.href = dataUrl;
  }
}
function circleSvgDataUrl(hex = "#777", size = 64) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">\n    <circle cx="${size/2}" cy="${size/2}" r="${size/2}" fill="${hex}"/>\n  </svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}
(function cacheOriginalFaviconOnce() {
  const links = getFaviconLinks();
  if (links.length > 0 && !window.__edgeTabToolsOriginalFavicon) {
    window.__edgeTabToolsOriginalFavicon = links[0].href;
  }
})();

// --- Context banner (matches group color, offsets page)
function ensureBanner() {
  let b = document.getElementById('ett-banner');
  if (!b) {
    b = document.createElement('div');
    b.id = 'ett-banner';
    b.innerHTML = `<span id=\"ett-banner-text\"></span><button id=\"ett-menu-btn\" aria-label=\"Banner menu\">⋯</button><div id=\"ett-menu\" hidden></div>`;
    document.body.appendChild(b);
  }
  return b;
}

function buildMenu() {
  const m = document.getElementById('ett-menu');
  if (!m) return null;
  m.innerHTML = `
    <div class=\"ett-menu-item\" id=\"ett-menu-rename-tab\">Rename tab…</div>
    <div class=\"ett-menu-item\" id=\"ett-menu-rename-group\">Rename tab group…</div>
    <div class=\"ett-menu-item\" id=\"ett-menu-hide-once\">Hide banner until reload</div>
  `;
  // Actions
  m.querySelector('#ett-menu-rename-tab').onclick = () => { hideMenu(); showRenameOverlay(); };
  m.querySelector('#ett-menu-rename-group').onclick = () => {
    try {
      chrome.runtime.sendMessage({ type: 'REQUEST_REFRESH' }, () => {});
    } catch {}
    // We don't know groupId here; ask SW to refresh and then open overlay via context menu path
    // Fallback: send a message to SW to trigger SHOW_GROUP_RENAME_OVERLAY via active tab lookup
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.groupId && tab.groupId !== -1) {
        const group = await chrome.tabGroups.get(tab.groupId);
        chrome.runtime.sendMessage({ type: 'SHOW_GROUP_RENAME_OVERLAY', groupId: tab.groupId, currentTitle: group.title || '' });
      }
    })();
  };
  m.querySelector('#ett-menu-hide-once').onclick = () => { hideBannerOnce(); };
  return m;
}

function positionMenu(x, y) {
  const m = document.getElementById('ett-menu');
  if (!m) return;
  m.style.left = x + 'px';
  m.style.top = y + 'px';
}
function showMenu() { const m = document.getElementById('ett-menu'); if (m) m.hidden = false; }
function hideMenu() { const m = document.getElementById('ett-menu'); if (m) m.hidden = true; }

function showBanner(text, color) {
  if (window.__ettBannerHidden) return; // hidden until reload
  const b = ensureBanner();
  const t = b.querySelector('#ett-banner-text');
  const btn = b.querySelector('#ett-menu-btn');
  const m = buildMenu();
  t.textContent = text || '';
  b.style.background = color || 'rgba(25,25,25,.92)';
  b.style.display = text ? 'block' : 'none';
  // Offset page
  requestAnimationFrame(() => {
    const h = b.offsetHeight || 0;
    document.body.style.paddingTop = text ? (h + 'px') : '0px';
  });
  // Menu button (far right)
  btn.onclick = (ev) => { ev.stopPropagation(); hideMenu(); showMenu(); positionMenu(ev.clientX - 180, ev.clientY + 8); };
  // Right-click on banner opens same menu
  b.addEventListener('contextmenu', (ev) => { ev.preventDefault(); hideMenu(); showMenu(); positionMenu(ev.clientX, ev.clientY); }, { once: true });
  // Click outside closes menu
  document.addEventListener('click', (ev) => { const m2 = document.getElementById('ett-menu'); if (m2 && !m2.hidden) hideMenu(); }, { once: true });
}

function hideBanner() {
  const b = document.getElementById('ett-banner');
  if (b) b.style.display = 'none';
  document.body.style.paddingTop = '0px';
}
function hideBannerOnce() {
  window.__ettBannerHidden = true; // resets on reload
  hideBanner();
}

// --- Overlay builders (tab/group rename via page menu)
function makeOverlay(titleText, placeholder, saveCb) {
  const existing = document.getElementById("ett-overlay");
  if (existing) { existing.querySelector("input[type='text']").focus(); return; }
  const wrap = document.createElement("div");
  wrap.id = "ett-overlay";
  wrap.innerHTML = `
    <div class=\"ett-card\">
      <div class=\"ett-row\">
        <label class=\"ett-label\">${titleText}</label>
        <input class=\"ett-input\" type=\"text\" placeholder=\"${placeholder}\">
      </div>
      <div class=\"ett-row ett-flags\">
        <label><input id=\"ett-flag-refresh\" type=\"checkbox\"> Clear on refresh</label>
        <label><input id=\"ett-flag-close\" type=\"checkbox\"> Clear on close</label>
        <label title=\"Remember for this exact URL\"><input id=\"ett-flag-persist\" type=\"checkbox\"> Persist for this URL</label>
      </div>
      <div class=\"ett-actions\">
        <button id=\"ett-save\">Apply</button>
        <button id=\"ett-cancel\">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  const input = wrap.querySelector(".ett-input");
  input.value = "";
  input.focus();
  wrap.querySelector("#ett-cancel").onclick = () => wrap.remove();
  wrap.querySelector("#ett-save").onclick = async () => { await saveCb(input.value.trim(), wrap); };
}

function showRenameOverlay() {
  makeOverlay("Tab display name", document.title, async (name, wrap) => {
    const prefs = {
      clearOnRefresh: wrap.querySelector("#ett-flag-refresh").checked,
      clearOnClose: wrap.querySelector("#ett-flag-close").checked,
      persistForUrl: wrap.querySelector("#ett-flag-persist").checked
    };
    if (name) {
      document.title = name;
      const urlKey = location.origin + location.pathname;
      const store = await chrome.storage.local.get("customTitles");
      const customTitles = store.customTitles || {};
      if (prefs.persistForUrl) customTitles[urlKey] = name; else delete customTitles[urlKey];
      await chrome.storage.local.set({ customTitles });
      try { chrome.runtime.sendMessage({ type: "TAB_TITLE_CHANGED" }); } catch {}
    }
    chrome.runtime.sendMessage({ type: "SET_RENAME_PREFS", prefs });
    wrap.remove();
  });
}

function showGroupRenameOverlay(groupId, currentTitle) {
  makeOverlay("Tab group name", currentTitle || "", async (newTitle, wrap) => {
    const resp = await new Promise((resolve) => {
      try { chrome.runtime.sendMessage({ type: "SET_GROUP_TITLE", groupId, title: newTitle }, (r) => resolve(r)); }
      catch (e) { resolve({ ok: false, error: String(e) }); }
    });
    wrap.remove();
  });
}

// Reapply persisted title on load
(async function reapplyIfPersisted() {
  const urlKey = location.origin + location.pathname;
  const { customTitles = {} } = await chrome.storage.local.get("customTitles");
  if (customTitles[urlKey]) document.title = customTitles[urlKey];
})();

// Messages from SW
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "SHOW_RENAME_OVERLAY") showRenameOverlay();
  if (msg?.type === "SHOW_GROUP_RENAME_OVERLAY") showGroupRenameOverlay(msg.groupId, msg.currentTitle);
  if (msg?.type === "SET_FAVICON_COLOR") setFaviconDataUrl(circleSvgDataUrl(msg.hex));
  if (msg?.type === "REVERT_FAVICON") {
    const original = window.__edgeTabToolsOriginalFavicon;
    if (original) setFaviconDataUrl(original);
    else { const links = getFaviconLinks(); for (const l of links) l.remove(); }
  }
  if (msg?.type === "SHOW_CONTEXT_BANNER") showBanner(msg.groupTitle || "", msg.groupColor);
  if (msg?.type === "HIDE_CONTEXT_BANNER" || msg?.type === "HIDE_BANNER_ONCE") hideBannerOnce();
});
