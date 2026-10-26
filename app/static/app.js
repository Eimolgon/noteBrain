"use strict";
(() => {
  const app = { tree: null, index: null, open: [], active: null, editors: new Map(), zen: false, typewriter: false, tableSort: "title", tableDirection: 1, editorOverrides: { numbers: "style", wrap: "style" } };
  const $ = (selector) => document.querySelector(selector);
  const api = async (url, options = {}) => {
    const response = await fetch(url, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || response.statusText);
    return data;
  };
  const send = (url, method, data) => api(url, {
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
  });
  const styles = [
    { name: "Standard", numbers: true, wrap: true },
    { name: "Code", numbers: true, wrap: false },
    { name: "Text", numbers: false, wrap: true },
  ];
  const palettes = {
    slate: { bg: "#101419", panel: "#171d24", panel2: "#202832", text: "#dce4ec", muted: "#8795a3", accent: "#8a9cff", border: "#2a3440" },
    midnight: { bg: "#0d1020", panel: "#141a2c", panel2: "#1c2540", text: "#e0e7ff", muted: "#9ba9cc", accent: "#79b8ff", border: "#303b5b" },
    forest: { bg: "#101713", panel: "#18221b", panel2: "#223027", text: "#dce9df", muted: "#91a495", accent: "#88c999", border: "#304235" },
    paper: { bg: "#f5f0e6", panel: "#fffaf0", panel2: "#eee7d9", text: "#332f2a", muted: "#797166", accent: "#a05b36", border: "#d8cfbf" },
    nord: { bg: "#2E3440", panel: "#3B4252", panel2: "#434C5E", text: "#ECEFF4", muted: "#AEB9CA", accent: "#88C0D0", border: "#4C566A" },
    dracula: { bg: "#282A36", panel: "#343746", panel2: "#44475A", text: "#F8F8F2", muted: "#B8B8C7", accent: "#BD93F9", border: "#4C4F64" },
    "solarized-dark": { bg: "#002B36", panel: "#073642", panel2: "#0B4652", text: "#EEE8D5", muted: "#93A1A1", accent: "#2AA198", border: "#164C57" },
    "solarized-light": { bg: "#FDF6E3", panel: "#EEE8D5", panel2: "#E5DEC9", text: "#586E75", muted: "#839496", accent: "#268BD2", border: "#D6CFBB" },
    "rose-pine": { bg: "#191724", panel: "#1F1D2E", panel2: "#26233A", text: "#E0DEF4", muted: "#908CAA", accent: "#EBBCBA", border: "#393552" },
    everforest: { bg: "#2B3339", panel: "#333C43", panel2: "#3A464C", text: "#D3C6AA", muted: "#9DA9A0", accent: "#A7C080", border: "#4A555B" },
  };
  const currentStyle = () => styles[Number(localStorage.getItem("vault-style") || 0) % styles.length];
  function effectiveEditorOption(key, style = currentStyle()) {
    const override = app.editorOverrides[key];
    if (override === "on") return true;
    if (override === "off") return false;
    return !!style[key];
  }
  function loadEditorSettings() {
    try { const saved = JSON.parse(localStorage.getItem("vault-editor-settings") || "{}");
      app.editorOverrides = { numbers: ["style", "on", "off"].includes(saved.numbers) ? saved.numbers : "style", wrap: ["style", "on", "off"].includes(saved.wrap) ? saved.wrap : "style" };
    } catch (_) { app.editorOverrides = { numbers: "style", wrap: "style" }; }
  }
  const shortcutDefaults = { zen: "z", typewriter: "t", style: "s", help: "h" };
  function getShortcuts() {
    try { const saved = JSON.parse(localStorage.getItem("vault-shortcuts") || "{}"); return Object.fromEntries(Object.entries(shortcutDefaults).map(([k,v]) => [k, /^[a-z]$/i.test(saved[k] || "") ? saved[k].toLowerCase() : v])); }
    catch (_) { return { ...shortcutDefaults }; }
  }
  function updateShortcutHelp() { const keys=getShortcuts(); for (const key of Object.keys(keys)) { const label=$(`#help-shortcut-${key}`); if(label) label.textContent=`Alt+${keys[key].toUpperCase()}`; }
    $("#toggle-zen").title=`Zen · Alt+${keys.zen.toUpperCase()}`; $("#typewriter-toggle").title=`Typewriter · Alt+${keys.typewriter.toUpperCase()}`; $("#style-cycle").title=`Style · Alt+${keys.style.toUpperCase()}`; $("#help-button").title=`Help · Alt+${keys.help.toUpperCase()}`;
  }
  function applyStyle(index) {
    index = (index + styles.length) % styles.length;
    localStorage.setItem("vault-style", index);
    $("#style-cycle").textContent = styles[index].name;
    for (const item of app.editors.values()) {
      item.cm.setOption("lineNumbers", app.zen ? false : effectiveEditorOption("numbers", styles[index]));
      item.cm.setOption("lineWrapping", app.zen || effectiveEditorOption("wrap", styles[index]));
      item.cm.refresh();
    }
  }
  function applyPalette(name) {
    const colors = palettes[name] || palettes.slate;
    for (const [key, value] of Object.entries(colors)) document.documentElement.style.setProperty(`--${key}`, value);
    localStorage.setItem("vault-palette", name);
    document.documentElement.style.colorScheme = name.endsWith("light") || name === "paper" ? "light" : "dark";
    $("#color-mode").textContent = name.endsWith("light") || name === "paper" ? "☀" : "◐";
    $("#palette-select").value = name;
    for (const item of app.editors.values()) {
      item.cm.setOption("theme", document.documentElement.style.colorScheme === "light" ? "default" : "material-darker");
      item.cm.refresh();
    }
  }
  function applyFont(size) {
    document.documentElement.style.setProperty("--editor-font-size", `${size}px`);
    localStorage.setItem("vault-font-size", size);
    $("#font-size-label").textContent = `${size} px`;
    resizeActiveEditor();
  }
  const icon = (kind) => {
    const paths = {
      folder: "M1.5 5h5l1.3 1.5h6.7v6H1.5z M1.5 5V3.7h4.2L7 5",
      md: "M3 1.8h6l3 3v9.4H3z M9 1.8v3h3 M5 8h5 M5 10h5 M5 12h3",
      txt: "M3 1.8h6l3 3v9.4H3z M9 1.8v3h3 M5 8h6 M5 10h6 M5 12h6",
      tex: "M3 1.8h6l3 3v9.4H3z M9 1.8v3h3 M5 8h6 M8 8v5 M6 13h4",
      plus: "M8 3v10 M3 8h10", folderPlus: "M1.5 5h5l1.3 1.5h6.7v6H1.5z M1.5 5V3.7h4.2L7 5 M9 7.5v4 M7 9.5h4",
      trash: "M2.5 4.5h11 M6 2.5h4 M4 4.5l.6 9h6.8l.6-9 M6.5 6.5v4.5 M9.5 6.5v4.5", pdf: "M3 1.5h6l3 3v10H3z M9 1.5v3h3 M4.5 8h7 M4.5 10h7 M4.5 12h4",
      table: "M2 2.5h12v11H2z M2 6h12 M2 9.5h12 M6 2.5v11 M10 2.5v11",
      save: "M2.5 2.5h9l2 2v9h-11z M5 2.5v4h5v-4 M5 13.5v-4h6v4",
      refresh: "M12.5 5.5A5 5 0 1 0 13 9 M12.5 2.5v3h-3", book: "M2.5 2.5h4a2 2 0 0 1 2 2v9a2 2 0 0 0-2-2h-4z M13.5 2.5h-3a2 2 0 0 0-2 2v9a2 2 0 0 1 2-2h3z",
    };
    return `<svg class="icon ${kind}" viewBox="0 0 16 16" aria-hidden="true"><path d="${paths[kind] || paths.md}"/></svg>`;
  };
  function setupActionIcons() {
    const actions = {"#new-note":"plus", "#new-folder-button":"folderPlus", "#delete-note":"trash", "#open-table":"table", "#save-note":"save", "#export-pdf":"pdf", "#reindex":"refresh", "#compile-refs":"book"};
    for (const [selector, kind] of Object.entries(actions)) $(selector).innerHTML = icon(kind);
  }
  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);
  function fillFilter(selector, values, label) {
    const select = $(selector), old = select.value; select.replaceChildren(new Option(`${label}: all`, ""));
    Object.keys(values).forEach((value) => select.add(new Option(value, value))); select.value = old;
  }
  function renderFilters() {
    [["#filter-tag", "tags", "Tag"], ["#filter-status", "statuses", "Status"], ["#filter-category", "categories", "Category"], ["#filter-topic", "topics", "Topic"]]
      .forEach(([selector, key, label]) => fillFilter(selector, app.index[key], label));
  }
  function makeEditor(path, content) {
    const host = document.createElement("div"); host.className = "editor-instance"; host.dataset.path = path; $("#editor-host").append(host);
    const style = currentStyle();
    const cm = CodeMirror(host, { value: content, mode: "markdown", theme: document.documentElement.style.colorScheme === "light" ? "default" : "material-darker", keyMap: "vim", lineNumbers: app.zen ? false : effectiveEditorOption("numbers", style), lineWrapping: app.zen || effectiveEditorOption("wrap", style), readOnly: false, scrollbarStyle: app.zen ? null : "native", extraKeys: { "Ctrl-S": () => saveFile(path), "Cmd-S": () => saveFile(path), "Ctrl-C": "copy", "Cmd-C": "copy" } });
    cm.on("cursorActivity", () => { if (app.active === path) { updateCursor(cm); updateTypewriter(cm); } });
    cm.on("vim-mode-change", (event) => { if (app.active === path) $("#vim-mode").textContent = (event.mode || "normal").toUpperCase(); });
    cm.on("change", () => { const item = app.editors.get(path); if (item) { item.dirty = true; item.revision += 1; renderTabs(); } if (app.active === path) renderPreview(); });
    app.editors.set(path, { cm, host, dirty: false, revision: 0, typewriterLine: null }); return cm;
  }
  async function openFile(path) {
    if (app.open.includes(path)) { activate(path); return; }
    const data = await api(`/api/file?path=${encodeURIComponent(path)}`);
    app.open.push(path); makeEditor(path, data.content); renderTabs(); activate(path);
  }
  function renderTabs() {
    const bar = $("#tabbar"); bar.replaceChildren();
    app.open.forEach((path) => { const tab = document.createElement("div"); tab.className = `tab${path === app.active ? " active" : ""}`;
      const label = document.createElement("button"); label.type = "button"; label.textContent = path.split("/").pop(); label.onclick = () => activate(path); tab.append(label);
      if (app.editors.get(path)?.dirty) { const dot = document.createElement("i"); dot.textContent = "•"; tab.append(dot); }
      const close = document.createElement("button"); close.type = "button"; close.className = "close"; close.textContent = "×"; close.onclick = (event) => { event.stopPropagation(); closeTab(path); }; tab.append(close); bar.append(tab);
    });
  }
  function activate(path) {
    app.active = path || null;
    for (const [key, item] of app.editors) {
      const active = key === app.active;
      item.host.style.display = active ? "block" : "none";
      item.host.classList.toggle("is-active", active);
    }
    renderTabs();
    $("#current-file").textContent = path || "No file";
    resizeActiveEditor();
    renderPreview();
  }
  function closeTab(path) {
    const item = app.editors.get(path); if (!item) return;
    if (item.dirty && !confirm(`Discard unsaved changes in ${path}?`)) return;
    item.host.remove(); app.editors.delete(path); app.open = app.open.filter((p) => p !== path);
    if (app.active === path) activate(app.open.at(-1) || ""); else renderTabs();
  }
  function updateCursor(cm) { const c = cm.getCursor(); $("#cursor-pos").textContent = `Ln ${c.line + 1}, Col ${c.ch + 1}`; }
  function updateTypewriter(cm) {
    const item = app.editors.get(app.active); if (!item) return;
    if (item.typewriterLine) { try { cm.removeLineClass(item.typewriterLine, "text", "tw-current"); } catch (_) {} item.typewriterLine = null; }
    if (app.typewriter) { item.typewriterLine = cm.getLineHandle(cm.getCursor().line); if (item.typewriterLine) cm.addLineClass(item.typewriterLine, "text", "tw-current"); }
  }
  function setTypewriter(enabled) { app.typewriter = !!enabled; localStorage.setItem("vault-typewriter", app.typewriter ? "1" : "0"); document.body.classList.toggle("typewriter", app.typewriter); $("#typewriter-toggle").classList.toggle("active", app.typewriter); const item = app.editors.get(app.active); if (item) updateTypewriter(item.cm); }
  function setZen(enabled) {
    app.zen = !!enabled;
    document.body.classList.toggle("zen", app.zen);
    document.documentElement.classList.toggle("zen", app.zen);
    const style = currentStyle();
    for (const item of app.editors.values()) {
      item.cm.setOption("lineNumbers", app.zen ? false : effectiveEditorOption("numbers", style));
      item.cm.setOption("lineWrapping", app.zen ? true : effectiveEditorOption("wrap", style));
      item.cm.setOption("scrollbarStyle", app.zen ? null : "native");
    }
    $("#toggle-zen").classList.toggle("active", app.zen);
    resizeActiveEditor();
  }
  let resizeFrame = 0;
  function resizeActiveEditor() {
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      const item = app.editors.get(app.active);
      if (!item) return;
      // CodeMirror measures its parent; refresh after the browser has applied grid/Zen changes.
      item.cm.refresh();
      if (app.typewriter) updateTypewriter(item.cm);
    });
  }
  function toggleLeft(forceClose = false) {
    const shouldClose = forceClose || !document.body.classList.contains("no-left");
    document.body.classList.toggle("no-left", shouldClose);
    // Let CSS grid retain the original five explicit tracks; hidden grid items must
    // not be display:none or the remaining columns auto-place into the wrong tracks.
    requestAnimationFrame(() => { resizeActiveEditor(); });
  }
  async function saveFile(path) {
    const item = app.editors.get(path);
    if (!item) return false;
    try {
      // If the user keeps typing while a request is in flight, save again rather
      // than incorrectly marking newer, unsent editor contents as saved.
      do {
        const revision = item.revision;
        const content = item.cm.getValue();
        await send("/api/file", "PUT", { path, content });
        if (app.editors.get(path) !== item) return true;
        if (revision === item.revision) item.dirty = false;
        else item.dirty = true;
        renderTabs();
      } while (item.dirty && app.editors.get(path) === item);
      $("#save-state").textContent = "Saved";
      await reindex();
      return true;
    } catch (error) {
      $("#save-state").textContent = `Save failed: ${error.message}`;
      alert(`Could not save ${path}: ${error.message}`);
      return false;
    }
  }
  async function createFolder() {
    const parent = prompt("Parent folder (relative to the vault; leave empty for the vault root):", "");
    if (parent === null) return;
    const name = prompt("New folder name:");
    if (name === null || !name.trim()) return;
    const path = [parent.trim().replace(/\/+$/, ""), name.trim()].filter(Boolean).join("/");
    try { await send("/api/mkdir", "POST", {path}); await reindex(); }
    catch (error) { alert(`Could not create folder: ${error.message}`); }
  }
  async function deleteActiveNote() {
    const path = app.active;
    if (!path || !/\.(md|markdown)$/i.test(path)) { alert("Open a Markdown note before deleting."); return; }
    const item = app.editors.get(path);
    if (item?.dirty) { alert("This note has unsaved changes. Save it before deleting; deletion is blocked to protect your edits."); return; }
    if (!confirm(`Permanently delete this Markdown note?\n\n${path}\n\nThis cannot be undone.`)) return;
    try {
      await send("/api/delete", "POST", {path});
      closeTab(path);
      await reindex();
      $("#save-state").textContent = "Note deleted";
    } catch (error) { alert(`Could not delete ${path}: ${error.message}`); }
  }
  let mathQueue = Promise.resolve();
  function resolveNoteTarget(target, sourcePath = app.active) {
    const notes = app.index?.notes || [];
    const raw = String(target || "").trim().replace(/\\/g, "/");
    if (!raw) return null;
    const clean = raw.replace(/[?#].*$/, "").replace(/^\.\//, "");
    const key = clean.toLocaleLowerCase();
    const byPath = new Map(notes.map((note) => [note.path.toLocaleLowerCase(), note.path]));
    const candidates = [];
    if (clean.startsWith("/")) candidates.push(clean.slice(1));
    else {
      if (sourcePath) candidates.push(`${sourcePath.includes("/") ? sourcePath.slice(0, sourcePath.lastIndexOf("/")) + "/" : ""}${clean}`);
      candidates.push(clean);
    }
    for (const candidate of [...candidates]) {
      const normalized = candidate.split("/").reduce((parts, part) => { if (!part || part === ".") return parts; if (part === "..") parts.pop(); else parts.push(part); return parts; }, []).join("/");
      for (const path of [normalized, ...(/\.(md|markdown)$/i.test(normalized) ? [] : [`${normalized}.md`, `${normalized}.markdown`])]) {
        if (byPath.has(path.toLocaleLowerCase())) return byPath.get(path.toLocaleLowerCase());
      }
    }
    const matches = notes.filter((note) => [note.path, note.name, note.title, note.id, note.path.replace(/\.(md|markdown)$/i, ""), note.name.replace(/\.(md|markdown)$/i, "")].some((value) => value && value.toLocaleLowerCase() === key));
    return matches.length ? matches[0].path : null;
  }
  function prepareWikiLinks(markdown) {
    return markdown.replace(/\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g, (_whole, target, heading, label) => {
      const href = `#vault-note=${encodeURIComponent(target.trim())}${heading ? `&heading=${encodeURIComponent(heading.trim())}` : ""}`;
      return `[${(label || target).trim().replace(/([\\[\]])/g, "\\$1")}](${href})`;
    });
  }
  function handlePreviewLink(event) {
    const anchor = event.target.closest?.("a[href]");
    if (!anchor || !$("#right-content").contains(anchor)) return;
    const href = anchor.getAttribute("href") || "";
    let target = null;
    if (href.startsWith("#vault-note=")) {
      event.preventDefault();
      const name = href.slice("#vault-note=".length).split("&")[0];
      let decoded = name;
      try { decoded = decodeURIComponent(name); } catch (_) {}
      target = resolveNoteTarget(decoded);
    } else {
      try {
        const base = new URL(`http://vault.local/${app.active || ""}`);
        const url = new URL(href, base);
        const isLocalApp = url.hostname === "vault.local" || ((url.hostname === "127.0.0.1" || url.hostname === "localhost") && (!window.location.port || url.port === window.location.port));
        if (isLocalApp && /\.(md|markdown)$/i.test(url.pathname)) {
          const path = decodeURIComponent(url.pathname.replace(/^\//, ""));
          target = resolveNoteTarget(path, "");
          if (!target) target = resolveNoteTarget(path, app.active);
          if (target) event.preventDefault();
        }
      } catch (_) {}
    }
    if (target) openFile(target).catch((error) => alert(`Could not open linked note: ${error.message}`));
  }
  function renderPreview() { const host = $("#right-content"), mode = $("#right-mode").value; host.replaceChildren();
    if (!app.active) { host.textContent = "No file open"; return; }
    if (mode === "preview") { const source = app.editors.get(app.active)?.cm.getValue() || ""; const rendered = marked.parse(prepareWikiLinks(source)); host.innerHTML = window.DOMPurify ? window.DOMPurify.sanitize(rendered) : escapeHtml(rendered); if (window.MathJax?.typesetPromise) mathQueue = mathQueue.then(() => MathJax.typesetPromise([host])).catch(console.error); return; }
    const note = app.index.notes.find((x) => x.path === app.active); if (!note) return;
    if (mode === "references") { const pre = document.createElement("pre"); pre.textContent = JSON.stringify(note.references, null, 2); host.append(pre); }
    else note.backlinks.forEach((path) => { const button = document.createElement("button"); button.textContent = path; button.onclick = () => openFile(path); host.append(button); });
  }
  async function exportActivePdf() {
    if (!app.active) { alert("Open a note before exporting to PDF."); return; }
    const item=app.editors.get(app.active); if(!item) return;
    const button=$("#export-pdf"); button.disabled=true; button.title="Exporting PDF…";
    try {
      const result=await send("/api/export-pdf","POST",{filename:app.active.split("/").pop(),content:item.cm.getValue()});
      const binary=atob(result.pdf_base64), bytes=new Uint8Array(binary.length);
      for(let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
      const url=URL.createObjectURL(new Blob([bytes],{type:"application/pdf"}));
      const link=document.createElement("a"); link.href=url; link.download=result.filename; document.body.append(link); link.click(); link.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
      $("#save-state").textContent="PDF exported";
    } catch(error) { alert(`Could not export PDF: ${error.message}`); }
    finally { button.disabled=false; button.title="Export current note to PDF"; }
  }
  function debounce(fn, delay) { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); }; }
  async function runSearch() { const params = new URLSearchParams({ q: $("#search").value, tag: $("#filter-tag").value, status: $("#filter-status").value, category: $("#filter-category").value, topic: $("#filter-topic").value });
    try { const data = await api(`/api/search?${params}`), host = $("#search-results"); host.replaceChildren(); if (![...params.values()].some(Boolean)) return;
      const count = document.createElement("div"); count.textContent = `${data.count} results`; host.append(count);
      data.results.forEach((note) => { const button = document.createElement("button"); button.className = "file"; button.textContent = `${note.title} — ${note.path}`; button.onclick = () => openFile(note.path); host.append(button); });
    } catch (error) { $("#search-results").textContent = `Search error: ${error.message}`; }
  }
  async function loadData() { [app.tree, app.index] = await Promise.all([api("/api/tree"), api("/api/index")]); renderTree(); renderFilters(); }
  function renderTree() { const host = $("#file-tree"); host.replaceChildren();
    function build(node, depth = 0) { if (node.type === "directory") { const details = document.createElement("details"); details.open = false; details.className = `folder depth-${Math.min(depth, 5)}`; const summary = document.createElement("summary"); summary.innerHTML = `${icon("folder")}<span>${escapeHtml(node.name)}</span>`; details.append(summary); node.children.forEach((child) => details.append(build(child, depth + 1))); return details; }
      const button = document.createElement("button"); button.className = "file"; button.title = node.path; const ext = node.name.split(".").pop().toLowerCase(); button.innerHTML = `${icon(ext === "tex" ? "tex" : ext === "txt" ? "txt" : "md")}<span>${escapeHtml(node.name)}</span>`; button.onclick = () => openFile(node.path); button.draggable = true; button.ondragstart = (e) => e.dataTransfer.setData("text/plain", node.path); return button; }
    app.tree.children.forEach((node) => host.append(build(node)));
  }
  function renderFilters() { [["#filter-tag", "tags", "Tag"], ["#filter-status", "statuses", "Status"], ["#filter-category", "categories", "Category"], ["#filter-topic", "topics", "Topic"]].forEach(([id, key, label]) => { const el = $(id), value = el.value; el.replaceChildren(new Option(`${label}: all`, "")); Object.keys(app.index[key]).forEach((x) => el.add(new Option(x, x))); el.value = value; }); }
  function mergeGeneratedBacklinks(current, canonical) {
    const blockPattern = /^<!-- AUTO-BACKLINKS:START -->\s*[\s\S]*?^<!-- AUTO-BACKLINKS:END -->[ \t]*(?:\n|$)/m;
    const match = canonical.match(blockPattern);
    const currentHasBlock = blockPattern.test(current);
    if (!match && !currentHasBlock) return current;
    const authored = current.replace(blockPattern, "").replace(/\n+$/, "");
    const block = match ? match[0].trimEnd() : "";
    return (authored ? authored + (block ? "\n\n" : "\n") : "") + (block ? block + "\n" : "");
  }
  async function syncOpenEditorBacklinkBlocks() {
    // The server owns the generated block; merge only that block into open buffers,
    // preserving any unrelated unsaved edits the user has made in other tabs.
    for (const [path, item] of app.editors) {
      try {
        const canonical = await api(`/api/file?path=${encodeURIComponent(path)}`);
        const merged = mergeGeneratedBacklinks(item.cm.getValue(), canonical.content);
        if (merged !== item.cm.getValue()) {
          const wasDirty = item.dirty;
          item.cm.setValue(merged);
          item.dirty = wasDirty;
        }
      } catch (error) {
        console.warn(`Could not refresh generated backlinks for ${path}:`, error);
      }
    }
    renderTabs();
  }
  async function reindex() {
    const result = await send("/api/reindex", "POST", {});
    await syncOpenEditorBacklinkBlocks();
    [app.tree, app.index] = await Promise.all([api("/api/tree"), api("/api/index")]);
    renderTree(); renderFilters(); await runSearch(); renderPreview();
    return result;
  }
  function tableFilterValues() {
    const fields = [["#table-tag-filter", "tags", "All tags"], ["#table-topic-filter", "topics", "All topics"], ["#table-status-filter", "statuses", "All statuses"], ["#table-category-filter", "categories", "All categories"], ["#table-author-filter", "authors", "All authors"], ["#table-participant-filter", "participants", "All participants"], ["#table-keyword-filter", "keywords", "All keywords"]];
    fields.forEach(([selector,key,label]) => { const el=$(selector), old=el.value; el.replaceChildren(new Option(label,"")); Object.keys(app.index[key] || {}).forEach(v=>el.add(new Option(v,v))); el.value=old; });
  }
  function renderNotesTable() {
    const filters = {tags:$("#table-tag-filter").value,topic:$("#table-topic-filter").value,status:$("#table-status-filter").value,category:$("#table-category-filter").value,authors:$("#table-author-filter").value,participants:$("#table-participant-filter").value,keywords:$("#table-keyword-filter").value};
    const values = (value, field) => String(value || "").split(field === "authors" ? /\s+and\s+|;/i : /[,;]/).map(v=>v.trim().toLocaleLowerCase()).filter(Boolean);
    const rows = (app.index?.notes || []).filter(note => Object.entries(filters).every(([field,value]) => !value || (field === "tags" ? note.tags.map(v=>v.toLocaleLowerCase()).includes(value.toLocaleLowerCase()) : values(note[field],field).includes(value.toLocaleLowerCase()))));
    const key=app.tableSort;
    rows.sort((a,b)=>String(key==="tags"?a.tags.join(", "):a[key]||"").localeCompare(String(key==="tags"?b.tags.join(", "):b[key]||""),undefined,{numeric:true,sensitivity:"base"})*app.tableDirection);
    const body=$("#notes-table tbody"); body.replaceChildren();
    rows.forEach(note=>{ const tr=document.createElement("tr"); ["title","path","date","category","topic","status","priority","authors","participants","keywords","tags"].forEach(field=>{ const td=document.createElement("td");
      if(field==="title"){const button=document.createElement("button");button.type="button";button.className="table-note-link";button.textContent=note.title||note.name;button.onclick=()=>{$("#table-dialog").close();openFile(note.path);};td.append(button);}
      else td.textContent=field==="tags"?note.tags.join(", "):(note[field]||""); tr.append(td); }); body.append(tr); });
    $("#table-result-count").textContent=`${rows.length} notes`;
  }
  function openNotesTable() { tableFilterValues(); renderNotesTable(); $("#table-dialog").showModal(); }
  async function compileReferences() {
    const result=await send("/api/collect-bibtex","POST",{});
    const output=$("#refs-output"); output.hidden=false;
    output.textContent=`Wrote ${result.path}\nUnique entries: ${result.count}\nEntries found: ${result.found}\nDuplicates removed: ${result.duplicates}` + (result.conflicts.length ? `\nConflicting duplicate keys (first occurrence kept):\n${result.conflicts.map(c=>`${c.key}: kept ${c.kept_from}; ignored ${c.duplicate_from}`).join("\n")}` : "");
    $("#ref-count").textContent=result.count;
  }
  async function bind() {
    setupActionIcons();
    $("#right-content").addEventListener("click", handlePreviewLink);
    $("#toggle-left").onclick = () => toggleLeft(); $("#collapse-left").onclick = () => toggleLeft(true);
    $("#collapse-right").onclick = () => document.body.classList.add("no-right"); $("#toggle-preview").onclick = () => document.body.classList.toggle("no-right"); $("#right-mode").onchange = renderPreview;
    $("#toggle-zen").onclick = () => setZen(!app.zen); $("#typewriter-toggle").onclick = () => setTypewriter(!app.typewriter);
    $("#style-cycle").onclick = () => applyStyle(Number(localStorage.getItem("vault-style") || 0) + 1);
    $("#color-mode").onclick = () => applyPalette(localStorage.getItem("vault-palette") === "paper" ? "slate" : "paper");
    $("#help-button").onclick = () => $("#help-dialog").showModal();
    $("#settings-btn").onclick = () => {
      $("#palette-select").value=localStorage.getItem("vault-palette")||"slate"; $("#font-size").value=localStorage.getItem("vault-font-size")||14; $("#font-size-label").textContent=`${$("#font-size").value} px`;
      $("#line-numbers").value=app.editorOverrides.numbers; $("#line-wrapping").value=app.editorOverrides.wrap;
      const keys=getShortcuts(); for(const key of Object.keys(keys)) $(`#shortcut-${key}`).value=keys[key]; $("#settings-dialog").showModal();
    };
    $("#font-size").oninput = () => { $("#font-size-label").textContent = `${$("#font-size").value} px`; };
    $("#apply-settings").onclick = (e) => {
      e.preventDefault();
      const shortcutKeys=["zen","typewriter","style","help"], proposed={};
      for(const key of shortcutKeys){const value=$(`#shortcut-${key}`).value.trim().toLowerCase(); if(!/^[a-z]$/.test(value)){alert("Shortcuts must be a single letter (A–Z). Settings were not changed.");return;} proposed[key]=value;}
      if(new Set(Object.values(proposed)).size!==shortcutKeys.length){alert("Each Alt shortcut must use a different letter. Settings were not changed.");return;}
      applyPalette($("#palette-select").value); applyFont($("#font-size").value);
      app.editorOverrides={numbers:$("#line-numbers").value,wrap:$("#line-wrapping").value}; localStorage.setItem("vault-editor-settings",JSON.stringify(app.editorOverrides));
      localStorage.setItem("vault-shortcuts",JSON.stringify(proposed)); updateShortcutHelp(); applyStyle(Number(localStorage.getItem("vault-style")||0));
      $("#settings-dialog").close();
    };
    $("#new-folder-button").onclick = createFolder;
    $("#delete-note").onclick = deleteActiveNote;
    $("#open-table").onclick = openNotesTable;
    ["#table-tag-filter","#table-topic-filter","#table-status-filter","#table-category-filter","#table-author-filter","#table-participant-filter","#table-keyword-filter"].forEach(id=>$(id).onchange=renderNotesTable);
    document.querySelectorAll("#notes-table [data-sort]").forEach((button) => button.addEventListener("click", () => {
      const key = button.dataset.sort;
      app.tableDirection = app.tableSort === key ? -app.tableDirection : 1;
      app.tableSort = key;
      renderNotesTable();
    }));
    $("#new-note").onclick = async () => { try { const templates = await api("/api/templates"), select = $("#new-template"); select.replaceChildren(new Option("Empty", "")); templates.forEach((t) => select.add(new Option(t.name, t.path))); $("#new-note-form").reset(); $("#new-folder").value = "info"; $("#new-note-dialog").showModal(); } catch (error) { alert(`Could not load templates: ${error.message}`); } };
    $("#cancel-create").onclick = (e) => { e.preventDefault(); $("#new-note-dialog").close("cancel"); };
    $("#new-note-form").onsubmit = async (e) => { e.preventDefault(); let name = $("#new-filename").value.trim(); if (!name) { $("#new-filename").reportValidity(); return; } if (!/\.[^/]+$/.test(name)) name += ".md"; const folder = $("#new-folder").value.trim().replace(/\/$/, ""); try { const data = await send("/api/create", "POST", { path: `${folder ? folder + "/" : ""}${name}`, template: $("#new-template").value }); $("#new-note-dialog").close("created"); await reindex(); openFile(data.path); } catch (error) { alert(`Could not create note: ${error.message}`); } };
    $("#save-note").onclick = () => { if (app.active) saveFile(app.active); }; $("#export-pdf").onclick = exportActivePdf;
    $("#search").addEventListener("input", debounce(runSearch, 180)); ["#filter-tag", "#filter-status", "#filter-category", "#filter-topic"].forEach((id) => $(id).addEventListener("change", runSearch));
    $("#reindex").onclick = async () => { try { const result=await reindex(); alert(`Regenerated ${result.path} (${result.count} notes).`); } catch(e) { alert(`Reindex failed: ${e.message}`); } }; $("#compile-refs").onclick = () => compileReferences().catch((e) => alert(`Reference collection failed: ${e.message}`));
    $("#editor-host").ondragover = (e) => e.preventDefault(); $("#editor-host").ondrop = (e) => { e.preventDefault(); const path = e.dataTransfer.getData("text/plain"); if (path) openFile(path); };
    $("#right-content").ondragover = (e) => e.preventDefault(); $("#right-content").ondrop = (e) => { e.preventDefault(); const path = e.dataTransfer.getData("text/plain"); if (path) openFile(path); };
    document.querySelectorAll(".resizer").forEach((handle) => { let startX, initial; handle.addEventListener("pointerdown", (e) => { e.preventDefault(); startX = e.clientX; const prop = handle.dataset.target === "left" ? "--left-width" : "--right-width"; initial = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(prop)) || 260; handle.setPointerCapture(e.pointerId); }); handle.addEventListener("pointermove", (e) => { if (!handle.hasPointerCapture(e.pointerId)) return; const left = handle.dataset.target === "left", delta = e.clientX - startX, width = Math.max(180, Math.min(700, left ? initial + delta : initial - delta)); document.documentElement.style.setProperty(left ? "--left-width" : "--right-width", `${width}px`); resizeActiveEditor(); }); handle.addEventListener("pointerup", (e) => { if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId); }); });
    if (window.ResizeObserver) {
      const observer = new ResizeObserver(() => resizeActiveEditor());
      observer.observe($("#workspace"));
      observer.observe($("#center-panel"));
      observer.observe($("#editor-host"));
    }
    window.addEventListener("resize", resizeActiveEditor);
    window.addEventListener("beforeunload", (event) => {
      if ([...app.editors.values()].some((item) => item.dirty)) { event.preventDefault(); event.returnValue = ""; }
    });
    document.addEventListener("keydown", (e) => {
      const inField=e.target instanceof HTMLElement&&(e.target.matches("input,textarea,select")||e.target.isContentEditable), keys=getShortcuts(), key=e.key.toLowerCase();
      if((e.ctrlKey||e.metaKey)&&key==="s"){e.preventDefault();if(app.active)saveFile(app.active);return;}
      if(e.altKey&&!e.ctrlKey&&!e.metaKey){
        if(key===keys.zen){e.preventDefault();setZen(!app.zen);}
        else if(key===keys.typewriter){e.preventDefault();setTypewriter(!app.typewriter);}
        else if(key===keys.style){e.preventDefault();applyStyle(Number(localStorage.getItem("vault-style")||0)+1);}
        else if(key===keys.help&&!inField){e.preventDefault();$("#help-dialog").showModal();}
      }
    });
  }
  async function start() { loadEditorSettings(); [app.tree, app.index] = await Promise.all([api("/api/tree"), api("/api/index")]); renderTree(); renderFilters(); await bind(); updateShortcutHelp(); applyPalette(localStorage.getItem("vault-palette") || "slate"); applyFont(localStorage.getItem("vault-font-size") || 14); applyStyle(Number(localStorage.getItem("vault-style") || 0)); setTypewriter(localStorage.getItem("vault-typewriter") === "1"); }
  start().catch((e) => { console.error(e); alert(`Vault startup failed: ${e.message}`); });
})();