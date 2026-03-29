/* MarkFlow v6 — Block-based WYSIWYG Markdown Editor with Tabs
 *
 * Entry point for the renderer process.
 * Manages file tabs, editor instance, toolbar, sidebar, source mode,
 * find/replace, context menu, and keyboard shortcuts.
 */

'use strict';

const { ipcRenderer } = require('electron');
const pathMod = require('path');
const Editor = require('./editor/Editor');
const { esc } = require('./editor/utils');

/* ========== DOM REFS ========== */
const $ = id => document.getElementById(id);
const editorPane = $('editorPane');
const sourcePane = $('sourcePane');
const sourceTA = $('sourceTA');
const sidebar = $('sidebar');
const outlineList = $('outlineList');
const findbar = $('findbar');
const wys = $('wysiwyg');
const tablist = $('tablist');
const contextMenu = $('contextMenu');

/* ========== STATE ========== */
let srcMode = false;
let currentFilePath = '';

/* ========== CREATE EDITOR ========== */
const editor = new Editor(wys, {
  onDirty: () => onEditorDirty(),
  onOutlineChange: (headings) => updateOutline(headings),
  onWordCountChange: (counts) => updateWordCount(counts),
});

/* ══════════════════════════════════════════════════════════════
 *  TAB SYSTEM
 * ══════════════════════════════════════════════════════════════ */

let tabs = [];       // Array of tab objects
let activeTabId = null;
let tabIdCounter = 0;

/**
 * Tab object structure:
 * {
 *   id: number,
 *   filePath: string,      // '' for untitled
 *   title: string,         // display name
 *   content: string,       // markdown content
 *   dirty: boolean,
 *   scrollTop: number,     // preserve scroll position
 *   srcMode: boolean,      // was in source mode?
 * }
 */

function createTab(filePath, content, activate) {
  // Check if file is already open
  if (filePath) {
    const existing = tabs.find(t => t.filePath === filePath);
    if (existing) {
      switchToTab(existing.id);
      return existing;
    }
  }

  const tab = {
    id: ++tabIdCounter,
    filePath: filePath || '',
    title: filePath ? pathMod.basename(filePath) : '未命名',
    content: content || '',
    dirty: false,
    scrollTop: 0,
    srcMode: false,
  };
  tabs.push(tab);
  renderTabs();
  if (activate !== false) switchToTab(tab.id);

  // Track recent file
  if (filePath) ipcRenderer.send('recent:add', filePath);

  return tab;
}

function getActiveTab() {
  return tabs.find(t => t.id === activeTabId) || null;
}

function switchToTab(tabId) {
  if (activeTabId === tabId) return;

  // Save current tab state
  saveCurrentTabState();

  activeTabId = tabId;
  const tab = getActiveTab();
  if (!tab) return;

  // Restore source mode state
  if (tab.srcMode && !srcMode) {
    _enterSourceSilent();
  } else if (!tab.srcMode && srcMode) {
    _leaveSourceSilent();
  }

  // Load content
  currentFilePath = tab.filePath;
  editor.currentFilePath = tab.filePath;

  if (srcMode) {
    sourceTA.value = tab.content;
  } else {
    editor.loadMarkdown(tab.content);
  }

  // Restore scroll
  requestAnimationFrame(() => {
    editorPane.scrollTop = tab.scrollTop;
  });

  // Update UI
  renderTabs();
  updateStatusBar();
  updateWindowTitle();
}

function saveCurrentTabState() {
  const tab = getActiveTab();
  if (!tab) return;

  tab.srcMode = srcMode;
  tab.scrollTop = editorPane.scrollTop;

  if (srcMode) {
    tab.content = sourceTA.value;
  } else {
    tab.content = editor.getMarkdown();
  }
}

function markTabDirty(tabId) {
  const tab = tabs.find(t => t.id === (tabId || activeTabId));
  if (!tab || tab.dirty) return;
  tab.dirty = true;
  renderTabs();
  updateWindowTitle();
  // Tell main process there are dirty tabs
  ipcRenderer.send('window:dirty', tabs.some(t => t.dirty));
}

function markTabClean(tabId) {
  const tab = tabs.find(t => t.id === (tabId || activeTabId));
  if (!tab) return;
  tab.dirty = false;
  renderTabs();
  updateWindowTitle();
  ipcRenderer.send('window:dirty', tabs.some(t => t.dirty));
}

async function closeTab(tabId) {
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return;

  // Save state if this is the active tab
  if (tab.id === activeTabId) saveCurrentTabState();

  // Prompt save if dirty
  if (tab.dirty) {
    const response = await showSaveDialog(tab.title);
    if (response === 2) return; // Cancel
    if (response === 0) { // Save
      const saved = await saveTab(tab.id);
      if (!saved) return; // Save failed or canceled
    }
  }

  // Remove tab
  const idx = tabs.indexOf(tab);
  tabs.splice(idx, 1);

  if (tabs.length === 0) {
    // Create a new empty tab
    createTab('', '', true);
    return;
  }

  // Switch to adjacent tab
  if (tab.id === activeTabId) {
    activeTabId = null; // Reset so switchToTab works
    const newIdx = Math.min(idx, tabs.length - 1);
    switchToTab(tabs[newIdx].id);
  } else {
    renderTabs();
  }
}

async function saveTab(tabId) {
  const tab = tabs.find(t => t.id === (tabId || activeTabId));
  if (!tab) return false;

  // Get current content
  if (tab.id === activeTabId) saveCurrentTabState();

  if (tab.filePath) {
    const result = await ipcRenderer.invoke('file:save', { filePath: tab.filePath, content: tab.content });
    if (result.success) {
      markTabClean(tab.id);
      return true;
    }
    return false;
  } else {
    return saveTabAs(tab.id);
  }
}

async function saveTabAs(tabId) {
  const tab = tabs.find(t => t.id === (tabId || activeTabId));
  if (!tab) return false;

  if (tab.id === activeTabId) saveCurrentTabState();

  const result = await ipcRenderer.invoke('file:save-as', {
    content: tab.content,
    defaultPath: tab.filePath || 'untitled.md'
  });

  if (result.success) {
    tab.filePath = result.path;
    tab.title = pathMod.basename(result.path);
    currentFilePath = result.path;
    editor.currentFilePath = result.path;
    markTabClean(tab.id);
    ipcRenderer.send('recent:add', result.path);
    renderTabs();
    updateStatusBar();
    return true;
  }
  return false;
}

/* ── Tab UI Rendering ── */

function renderTabs() {
  tablist.innerHTML = '';
  for (const tab of tabs) {
    const el = document.createElement('div');
    el.className = 'tab' + (tab.id === activeTabId ? ' active' : '');
    el.dataset.tabId = tab.id;

    const titleSpan = document.createElement('span');
    titleSpan.className = 'tab-title';
    titleSpan.textContent = tab.title;
    titleSpan.title = tab.filePath || tab.title;
    el.appendChild(titleSpan);

    if (tab.dirty) {
      const dot = document.createElement('span');
      dot.className = 'tab-dirty';
      dot.textContent = '\u25CF'; // ●
      el.appendChild(dot);
    }

    const closeBtn = document.createElement('button');
    closeBtn.className = 'tab-close';
    closeBtn.textContent = '\u2715'; // ✕
    closeBtn.title = '关闭';
    closeBtn.addEventListener('click', e => {
      e.stopPropagation();
      closeTab(tab.id);
    });
    el.appendChild(closeBtn);

    // Click to switch
    el.addEventListener('click', () => switchToTab(tab.id));

    // Middle-click to close
    el.addEventListener('auxclick', e => {
      if (e.button === 1) { e.preventDefault(); closeTab(tab.id); }
    });

    // Context menu on tab
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      showTabContextMenu(e, tab);
    });

    tablist.appendChild(el);
  }

  // Scroll active tab into view
  const activeEl = tablist.querySelector('.tab.active');
  if (activeEl) activeEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function showTabContextMenu(e, tab) {
  const items = [
    { label: '关闭', action: () => closeTab(tab.id) },
    { label: '关闭其他', action: () => {
      const others = tabs.filter(t => t.id !== tab.id).map(t => t.id);
      (async () => { for (const id of others) await closeTab(id); })();
    }},
    { label: '关闭右侧', action: () => {
      const idx = tabs.indexOf(tab);
      const right = tabs.slice(idx + 1).map(t => t.id);
      (async () => { for (const id of right) await closeTab(id); })();
    }},
    { sep: true },
    { label: tab.filePath ? '复制路径' : '(未保存)', action: () => {
      if (tab.filePath) navigator.clipboard.writeText(tab.filePath);
    }, disabled: !tab.filePath },
  ];
  showContextMenu(e.clientX, e.clientY, items);
}

/* ── Window Title ── */

function updateWindowTitle() {
  const tab = getActiveTab();
  if (!tab) return;
  const name = tab.title || '未命名';
  const dirty = tab.dirty ? ' \u25CF' : '';
  const title = `${name}${dirty} \u2014 MarkFlow`;
  ipcRenderer.send('window:title', title);
}

function updateStatusBar() {
  const tab = getActiveTab();
  $('stFile').textContent = tab ? (tab.title || '未命名') : '未命名';
  $('stMode').textContent = srcMode ? '源码' : '编辑';
}

/* ========== New Tab button ========== */
$('tabNew').addEventListener('click', () => createTab('', '', true));

/* ========== OUTLINE ========== */
function updateOutline(headings) {
  if (!headings.length) { outlineList.innerHTML = ''; return; }
  outlineList.innerHTML = headings.map((h, i) =>
    `<button class="oli l${h.level}" data-i="${i}">${esc(h.text)}</button>`
  ).join('');
  outlineList.querySelectorAll('.oli').forEach((b, i) => {
    b.addEventListener('click', () => {
      if (headings[i] && headings[i].el) {
        headings[i].el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  });
}

/* ========== WORD COUNT ========== */
function updateWordCount(counts) {
  $('wordcount').textContent = `${counts.chars} 字符 \u00B7 ${counts.words} 词`;
  $('stW').textContent = counts.chars + ' 字';
}

/* ========== RECENT FILES ========== */
async function loadRecentFiles() {
  const files = await ipcRenderer.invoke('recent:get');
  const list = $('recentList');
  list.innerHTML = '';
  for (const fp of (files || []).slice(0, 10)) {
    const btn = document.createElement('button');
    btn.className = 'recent-item';
    btn.title = fp;

    const name = document.createElement('span');
    name.className = 'recent-name';
    name.textContent = pathMod.basename(fp);
    btn.appendChild(name);

    const pathSpan = document.createElement('span');
    pathSpan.className = 'recent-path';
    pathSpan.textContent = pathMod.dirname(fp);
    btn.appendChild(pathSpan);

    btn.addEventListener('click', async () => {
      const result = await ipcRenderer.invoke('recent:open', fp);
      if (result.success) {
        createTab(result.path, result.content, true);
      }
    });
    list.appendChild(btn);
  }
}

/* ========== SOURCE MODE ========== */
function _enterSourceSilent() {
  editorPane.style.display = 'none';
  sourcePane.style.display = 'flex';
  srcMode = true;
  $('stMode').textContent = '源码';
  $('btnSrc').classList.add('on');
}

function _leaveSourceSilent() {
  editorPane.style.display = 'block';
  sourcePane.style.display = 'none';
  srcMode = false;
  $('stMode').textContent = '编辑';
  $('btnSrc').classList.remove('on');
}

function enterSource() {
  const md = editor.getMarkdown();
  sourceTA.value = md;
  _enterSourceSilent();
  sourceTA.focus();
}

function leaveSource() {
  const md = sourceTA.value;
  _leaveSourceSilent();
  editor.loadMarkdown(md);
  wys.focus();
}

function toggleSource() { srcMode ? leaveSource() : enterSource(); }

sourceTA.addEventListener('input', () => {
  onEditorDirty();
  $('stW').textContent = sourceTA.value.length + ' 字';
});

/* Source mode: paste image */
sourceTA.addEventListener('paste', e => {
  const items = e.clipboardData?.items;
  if (items) {
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const blob = item.getAsFile();
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = reader.result;
          if (currentFilePath) {
            try {
              const ext = item.type.split('/')[1] === 'jpeg' ? 'jpg' : (item.type.split('/')[1] || 'png');
              const filename = `image-${Date.now()}.${ext}`;
              const baseDir = pathMod.dirname(currentFilePath);
              const savedPath = await ipcRenderer.invoke('save:image', { data: base64, filename, baseDir });
              if (savedPath) {
                const pos = sourceTA.selectionStart;
                sourceTA.setRangeText(`\n![](${savedPath})\n`, pos, sourceTA.selectionEnd, 'end');
                return;
              }
            } catch (err) { /* fallthrough */ }
          }
          const pos = sourceTA.selectionStart;
          sourceTA.setRangeText(`\n![粘贴图片](${base64})\n`, pos, sourceTA.selectionEnd, 'end');
        };
        reader.readAsDataURL(blob);
        return;
      }
    }
  }
});

/* Source mode: keyboard shortcuts */
sourceTA.addEventListener('keydown', e => {
  const pos = sourceTA.selectionStart;
  const val = sourceTA.value;

  if (e.key === 'Tab') {
    e.preventDefault();
    if (e.shiftKey) {
      const ls = val.lastIndexOf('\n', pos - 1) + 1;
      const le = val.indexOf('\n', pos);
      const end = le === -1 ? val.length : le;
      const line = val.substring(ls, end);
      if (line.startsWith('    ')) sourceTA.setRangeText(line.substring(4), ls, end, 'start');
      else if (line.startsWith('  ')) sourceTA.setRangeText(line.substring(2), ls, end, 'start');
    } else {
      sourceTA.setRangeText('    ', pos, sourceTA.selectionEnd, 'end');
    }
    return;
  }

  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
    const ls = val.lastIndexOf('\n', pos - 1) + 1;
    const line = val.substring(ls, pos);

    // ``` + Enter -> code block
    const cm = line.match(/^(\s*)```(\w*)\s*$/);
    if (cm) {
      e.preventDefault();
      const indent = cm[1];
      const lang = cm[2];
      sourceTA.setRangeText('\n' + indent + '\n' + indent + '```', pos, pos, 'end');
      sourceTA.selectionStart = sourceTA.selectionEnd = pos + 1 + indent.length;
      onEditorDirty();
      if (!lang) {
        const editor_lp = editor.langPopup;
        setTimeout(() => {
          const rect = sourceTA.getBoundingClientRect();
          const lineNum = val.substring(0, ls).split('\n').length;
          const lh = parseFloat(getComputedStyle(sourceTA).lineHeight) || 22;
          const y = rect.top + lineNum * lh - sourceTA.scrollTop + lh;
          editor_lp.open(
            { getBoundingClientRect: () => ({ left: rect.left + 60, right: rect.left + 260, top: y, bottom: y + lh, width: 200, height: lh }) },
            editor.lastLang,
            newLang => {
              const lines = sourceTA.value.split('\n');
              const idx = val.substring(0, ls).split('\n').length - 1;
              if (lines[idx] !== undefined) {
                lines[idx] = indent + '```' + newLang;
                sourceTA.value = lines.join('\n');
                editor.lastLang = newLang;
                onEditorDirty();
              }
              sourceTA.focus();
            }
          );
        }, 50);
      } else {
        editor.lastLang = lang;
      }
      return;
    }

    // List continuations
    const ul = line.match(/^(\s*)([-*+])\s(.+)/);
    if (ul) { e.preventDefault(); sourceTA.setRangeText('\n' + ul[1] + ul[2] + ' ', pos, pos, 'end'); return; }
    const ulE = line.match(/^(\s*)([-*+])\s*$/);
    if (ulE) { e.preventDefault(); sourceTA.setRangeText('', ls, pos, 'end'); return; }

    const ol = line.match(/^(\s*)(\d+)\.\s(.+)/);
    if (ol) { e.preventDefault(); sourceTA.setRangeText('\n' + ol[1] + (+ol[2] + 1) + '. ', pos, pos, 'end'); return; }
    const olE = line.match(/^(\s*)\d+\.\s*$/);
    if (olE) { e.preventDefault(); sourceTA.setRangeText('', ls, pos, 'end'); return; }

    const tk = line.match(/^(\s*)- \[[ x]\]\s(.+)/);
    if (tk) { e.preventDefault(); sourceTA.setRangeText('\n' + tk[1] + '- [ ] ', pos, pos, 'end'); return; }
    const tkE = line.match(/^(\s*)- \[[ x]\]\s*$/);
    if (tkE) { e.preventDefault(); sourceTA.setRangeText('', ls, pos, 'end'); return; }

    const bq = line.match(/^(\s*>+\s)(.+)/);
    if (bq) { e.preventDefault(); sourceTA.setRangeText('\n' + bq[1], pos, pos, 'end'); return; }
    const bqE = line.match(/^(\s*)>\s*$/);
    if (bqE) { e.preventDefault(); sourceTA.setRangeText('', ls, pos, 'end'); return; }
  }
});

/* ========== CUSTOM SAVE DIALOG ========== */
function showSaveDialog(filename) {
  return new Promise(resolve => {
    $('sdTitle').textContent = `"${filename}" 有未保存的更改`;
    $('saveDialog').classList.add('show');

    const cleanup = result => {
      $('saveDialog').classList.remove('show');
      $('sdSave').onclick = null;
      $('sdDiscard').onclick = null;
      $('sdCancel').onclick = null;
      resolve(result);
    };
    $('sdSave').onclick = () => cleanup(0);
    $('sdDiscard').onclick = () => cleanup(1);
    $('sdCancel').onclick = () => cleanup(2);
  });
}

/* ========== DIRTY HANDLER ========== */
function onEditorDirty() {
  markTabDirty();
}

/* ========== FORMAT COMMANDS (dispatcher) ========== */
function fmt(cmd) {
  if (srcMode) { fmtSource(cmd); return; }
  editor.format(cmd);
}

function fmtSource(cmd) {
  sourceTA.focus();
  const s = sourceTA.selectionStart, e = sourceTA.selectionEnd, v = sourceTA.value, sel = v.substring(s, e);
  const wrap = (a, b) => { sourceTA.setRangeText(a + (sel || '文本') + b, s, e, 'select'); };
  const ins = t => { sourceTA.setRangeText(t, s, e, 'end'); };
  const pre = p => { const ls = v.lastIndexOf('\n', s - 1) + 1; sourceTA.setRangeText(p, ls, ls, 'end'); };

  switch (cmd) {
    case 'bold': wrap('**', '**'); break;
    case 'italic': wrap('*', '*'); break;
    case 'strike': wrap('~~', '~~'); break;
    case 'inlinecode': wrap('`', '`'); break;
    case 'h1': pre('# '); break;
    case 'h2': pre('## '); break;
    case 'h3': pre('### '); break;
    case 'ul': pre('- '); break;
    case 'ol': pre('1. '); break;
    case 'task': pre('- [ ] '); break;
    case 'quote': pre('> '); break;
    case 'code':
    case 'codeblock': ins('\n```\n\n```\n'); sourceTA.selectionStart = sourceTA.selectionEnd = s + 5; break;
    case 'table': ins('\n| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n|  |  |  |\n'); break;
    case 'link': wrap('[', '](https://)'); break;
    case 'image': editor.insertImageFromDialog(); break;
    case 'hr': ins('\n---\n'); break;
    case 'mathblock': ins('\n$$\n\n$$\n'); sourceTA.selectionStart = sourceTA.selectionEnd = s + 4; break;
    case 'mermaid': ins('\n```mermaid\ngraph TD\n    A[开始] --> B{判断}\n    B -->|是| C[结果1]\n    B -->|否| D[结果2]\n```\n'); break;
  }
  onEditorDirty();
}

/* ========== FIND & REPLACE (Typora-style) ========== */
let findMatches = [];
let findIndex = -1;
let replaceVisible = false;

function toggleFind() {
  const isOpen = findbar.classList.contains('show');
  if (isOpen) {
    findbar.classList.remove('show');
    clearFindHighlights();
  } else {
    findbar.classList.add('show');
    // Copy selection to search input
    const sel = srcMode
      ? sourceTA.value.substring(sourceTA.selectionStart, sourceTA.selectionEnd)
      : window.getSelection().toString();
    if (sel && sel.length < 200) $('fi').value = sel;
    $('fi').focus();
    $('fi').select();
    if ($('fi').value) performFind(false);
  }
}

function toggleReplace() {
  replaceVisible = !replaceVisible;
  $('replaceRow').style.display = replaceVisible ? 'flex' : 'none';
  $('ftoggle').classList.toggle('on', replaceVisible);
}

function clearFindHighlights() {
  findMatches = [];
  findIndex = -1;
  $('fc').textContent = '';
}

/**
 * performFind: scan for matches and update count.
 * @param {boolean} navigate - if true, scroll to first match (used on Enter/next/prev).
 *                             false = just count (used on every input keystroke).
 */
function performFind(navigate) {
  const q = $('fi').value;
  if (!q) { $('fc').textContent = ''; clearFindHighlights(); return; }

  if (srcMode) {
    // Count matches in source textarea
    let c = 0, idx = 0;
    const val = sourceTA.value;
    const ql = q.toLowerCase();
    const vl = val.toLowerCase();
    while ((idx = vl.indexOf(ql, idx)) !== -1) { c++; idx += q.length; }
    findMatches.length = c;
    $('fc').textContent = c ? `${c} 个` : '无结果';

    if (navigate && c > 0) {
      // Find next occurrence from current position
      const pos = sourceTA.selectionEnd || 0;
      let i = vl.indexOf(ql, pos);
      if (i === -1) i = vl.indexOf(ql); // wrap
      if (i !== -1) {
        sourceTA.focus();
        sourceTA.setSelectionRange(i, i + q.length);
      }
    }
  } else {
    // WYSIWYG mode: scan text nodes
    findMatches = [];
    const walker = document.createTreeWalker(wys, NodeFilter.SHOW_TEXT);
    const searchLower = q.toLowerCase();
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = node.textContent;
      let idx = 0;
      while ((idx = text.toLowerCase().indexOf(searchLower, idx)) !== -1) {
        findMatches.push({ node, offset: idx, length: q.length });
        idx += q.length;
      }
    }
    $('fc').textContent = findMatches.length ? `${findMatches.length} 个` : '无结果';

    if (navigate && findMatches.length > 0) {
      if (findIndex < 0) findIndex = 0;
      navigateToMatch(findIndex);
    }
  }
}

/**
 * Navigate to a specific match in WYSIWYG mode.
 * Does NOT steal focus from the find input.
 */
function navigateToMatch(idx) {
  if (idx < 0 || idx >= findMatches.length) return;
  const match = findMatches[idx];
  if (!match || !match.node.parentNode) return;

  try {
    const range = document.createRange();
    range.setStart(match.node, match.offset);
    range.setEnd(match.node, match.offset + match.length);

    // Scroll into view without stealing focus
    const el = match.node.parentElement;
    if (el) {
      const rect = range.getBoundingClientRect();
      const paneRect = editorPane.getBoundingClientRect();
      if (rect.top < paneRect.top || rect.bottom > paneRect.bottom) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }

    // Set selection in editor (but keep focus on find input)
    const wasFocused = document.activeElement;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    // Restore focus to find input if it was focused
    if (wasFocused && findbar.contains(wasFocused)) {
      wasFocused.focus();
    }
  } catch (e) { /* ignore invalid range */ }

  $('fc').textContent = `${idx + 1}/${findMatches.length}`;
}

function findNext() {
  if (srcMode) {
    const q = $('fi').value;
    if (!q) return;
    const ql = q.toLowerCase();
    const vl = sourceTA.value.toLowerCase();
    const pos = sourceTA.selectionEnd || 0;
    let i = vl.indexOf(ql, pos);
    if (i === -1) i = vl.indexOf(ql); // wrap
    if (i !== -1) {
      sourceTA.focus();
      sourceTA.setSelectionRange(i, i + q.length);
      // Refocus find input
      $('fi').focus();
    }
  } else {
    if (findMatches.length === 0) { performFind(true); return; }
    findIndex = (findIndex + 1) % findMatches.length;
    navigateToMatch(findIndex);
  }
}

function findPrev() {
  if (srcMode) {
    const q = $('fi').value;
    if (!q) return;
    const ql = q.toLowerCase();
    const vl = sourceTA.value.toLowerCase();
    const pos = Math.max(0, (sourceTA.selectionStart || 0) - 1);
    let i = vl.lastIndexOf(ql, pos);
    if (i === -1) i = vl.lastIndexOf(ql); // wrap
    if (i !== -1) {
      sourceTA.focus();
      sourceTA.setSelectionRange(i, i + q.length);
      $('fi').focus();
    }
  } else {
    if (findMatches.length === 0) { performFind(true); return; }
    findIndex = (findIndex - 1 + findMatches.length) % findMatches.length;
    navigateToMatch(findIndex);
  }
}

function replaceOne() {
  const q = $('fi').value, r = $('ri').value;
  if (!q) return;
  if (srcMode) {
    const ql = q.toLowerCase();
    const vl = sourceTA.value.toLowerCase();
    const i = vl.indexOf(ql, sourceTA.selectionStart);
    if (i !== -1) {
      sourceTA.setRangeText(r, i, i + q.length, 'end');
      onEditorDirty();
      performFind(false);
    }
  } else {
    // Replace current selection if it matches
    const sel = window.getSelection();
    if (sel.toString().toLowerCase() === q.toLowerCase()) {
      // Focus the editor briefly to allow execCommand
      const editable = sel.anchorNode?.parentElement?.closest('[contenteditable]');
      if (editable) editable.focus();
      document.execCommand('insertText', false, r);
      onEditorDirty();
    }
    // Re-scan and go to next
    performFind(false);
    if (findMatches.length > 0) {
      if (findIndex >= findMatches.length) findIndex = 0;
      navigateToMatch(findIndex);
    }
    $('fi').focus();
  }
}

function replaceAll() {
  const q = $('fi').value, r = $('ri').value;
  if (!q) return;
  if (srcMode) {
    sourceTA.value = sourceTA.value.split(q).join(r);
    onEditorDirty();
  } else {
    saveCurrentTabState();
    const tab = getActiveTab();
    if (tab) {
      tab.content = tab.content.split(q).join(r);
      editor.loadMarkdown(tab.content);
      onEditorDirty();
    }
  }
  performFind(false);
  $('fi').focus();
}

// Input handler — just count, don't navigate
$('fi').addEventListener('input', () => performFind(false));

// Keyboard in find input
$('fi').addEventListener('keydown', e => {
  e.stopPropagation(); // prevent global shortcuts from firing
  if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? findPrev() : findNext(); }
  if (e.key === 'Escape') { e.preventDefault(); toggleFind(); }
});

// Keyboard in replace input
$('ri').addEventListener('keydown', e => {
  e.stopPropagation(); // prevent global shortcuts from firing
  if (e.key === 'Enter') { e.preventDefault(); replaceOne(); }
  if (e.key === 'Escape') { e.preventDefault(); toggleFind(); }
});

$('fnx').addEventListener('click', findNext);
$('fpv').addEventListener('click', findPrev);
$('r1').addEventListener('click', replaceOne);
$('rall').addEventListener('click', replaceAll);
$('fclose').addEventListener('click', toggleFind);
$('ftoggle').addEventListener('click', toggleReplace);

/* ========== CONTEXT MENU ========== */
function showContextMenu(x, y, items) {
  contextMenu.innerHTML = '';
  for (const item of items) {
    if (item.sep) {
      const sep = document.createElement('div');
      sep.className = 'ctx-sep';
      contextMenu.appendChild(sep);
      continue;
    }
    const el = document.createElement('div');
    el.className = 'ctx-item';
    if (item.disabled) el.style.opacity = '0.4';

    const label = document.createElement('span');
    label.textContent = item.label;
    el.appendChild(label);

    if (item.key) {
      const key = document.createElement('span');
      key.className = 'ctx-key';
      key.textContent = item.key;
      el.appendChild(key);
    }

    if (!item.disabled) {
      el.addEventListener('click', () => {
        hideContextMenu();
        if (item.action) item.action();
      });
    }
    contextMenu.appendChild(el);
  }

  // Position
  contextMenu.style.left = x + 'px';
  contextMenu.style.top = y + 'px';
  contextMenu.classList.add('show');

  // Adjust if off-screen
  requestAnimationFrame(() => {
    const rect = contextMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) contextMenu.style.left = (x - rect.width) + 'px';
    if (rect.bottom > window.innerHeight) contextMenu.style.top = (y - rect.height) + 'px';
  });
}

function hideContextMenu() {
  contextMenu.classList.remove('show');
}

document.addEventListener('click', () => hideContextMenu());
document.addEventListener('contextmenu', e => {
  // Only show custom context menu in editor area
  if (!editorPane.contains(e.target) && !sourcePane.contains(e.target)) return;
  e.preventDefault();

  const inSource = srcMode;
  const sel = inSource ? sourceTA.value.substring(sourceTA.selectionStart, sourceTA.selectionEnd) : window.getSelection().toString();
  const hasSelection = sel.length > 0;

  const items = [
    { label: '剪切', key: 'Ctrl+X', action: () => document.execCommand('cut'), disabled: !hasSelection },
    { label: '复制', key: 'Ctrl+C', action: () => document.execCommand('copy'), disabled: !hasSelection },
    { label: '粘贴', key: 'Ctrl+V', action: () => document.execCommand('paste') },
    { label: '全选', key: 'Ctrl+A', action: () => document.execCommand('selectAll') },
    { sep: true },
    { label: '加粗', key: 'Ctrl+B', action: () => fmt('bold') },
    { label: '斜体', key: 'Ctrl+I', action: () => fmt('italic') },
    { label: '删除线', action: () => fmt('strike') },
    { label: '行内代码', key: 'Ctrl+`', action: () => fmt('inlinecode') },
    { sep: true },
    { label: '插入链接', key: 'Ctrl+K', action: () => fmt('link') },
    { label: '插入图片', key: 'Ctrl+Shift+I', action: () => fmt('image') },
    { label: '插入代码块', key: 'Ctrl+Shift+K', action: () => fmt('codeblock') },
    { label: '插入表格', action: () => fmt('table') },
  ];

  showContextMenu(e.clientX, e.clientY, items);
});

/* ========== THEME ========== */
function toggleTheme() {
  const isDark = document.body.classList.contains('dark');
  document.body.classList.toggle('dark', !isDark);
  document.body.classList.toggle('light', isDark);
  $('btnTh').textContent = isDark ? '\u2600' : '\uD83C\uDF19';
  editor.onThemeChange();
}

/* ========== TOOLBAR ========== */
document.querySelectorAll('.tb[data-c]').forEach(b =>
  b.addEventListener('click', () => fmt(b.dataset.c))
);
$('btnOL').addEventListener('click', () => sidebar.classList.toggle('hide'));
$('btnSrc').addEventListener('click', toggleSource);
$('btnTh').addEventListener('click', toggleTheme);

/* ========== KEYBOARD SHORTCUTS ========== */
document.addEventListener('keydown', e => {
  if (editor.langPopup.isOpen()) return;

  // Don't intercept typing in find/replace inputs (they have stopPropagation,
  // but handle the case where Ctrl shortcuts should still work globally)
  const inFindbar = findbar.contains(document.activeElement);
  if (inFindbar && !e.ctrlKey && !e.metaKey) return;

  const c = e.ctrlKey || e.metaKey;

  // When in findbar, only allow specific global shortcuts
  if (inFindbar && c) {
    // Allow Ctrl+F (toggle), Ctrl+H (toggle), Ctrl+W, Ctrl+Tab, Ctrl+S, Ctrl+N, Ctrl+O, Escape
    const allowed = ['f', 'h', 'w', 'Tab', 's', 'n', 'o'];
    if (!allowed.includes(e.key) && e.key !== 'Escape') return;
  }

  // Undo / Redo (intercept before browser)
  if (c && e.key === 'z' && !e.shiftKey) {
    if (!srcMode) {
      e.preventDefault();
      editor.undo();
      return;
    }
  }
  if (c && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
    if (!srcMode) {
      e.preventDefault();
      editor.redo();
      return;
    }
  }

  // Tab management
  if (c && e.key === 'n') { e.preventDefault(); createTab('', '', true); return; }
  if (c && e.key === 'w') { e.preventDefault(); closeTab(activeTabId); return; }
  if (c && e.key === 'Tab') {
    e.preventDefault();
    if (tabs.length > 1) {
      const idx = tabs.findIndex(t => t.id === activeTabId);
      const next = e.shiftKey
        ? (idx - 1 + tabs.length) % tabs.length
        : (idx + 1) % tabs.length;
      switchToTab(tabs[next].id);
    }
    return;
  }
  if (c && e.key === 's') {
    e.preventDefault();
    if (e.shiftKey) saveTabAs();
    else saveTab();
    return;
  }
  if (c && e.key === 'o') {
    e.preventDefault();
    openFileDialog();
    return;
  }

  if (c && e.key === 'b') { e.preventDefault(); fmt('bold'); }
  if (c && e.key === 'i' && !e.shiftKey) { e.preventDefault(); fmt('italic'); }
  if (c && e.key === '`') { e.preventDefault(); fmt('inlinecode'); }
  if (c && e.key === 'k') { e.preventDefault(); fmt('link'); }
  if (c && e.shiftKey && e.key === 'X') { e.preventDefault(); fmt('strike'); }
  if (c && e.shiftKey && e.key === 'K') { e.preventDefault(); fmt('codeblock'); }
  if (c && e.shiftKey && e.key === 'I') { e.preventDefault(); fmt('image'); }
  if (c && e.key === '1') { e.preventDefault(); fmt('h1'); }
  if (c && e.key === '2') { e.preventDefault(); fmt('h2'); }
  if (c && e.key === '3') { e.preventDefault(); fmt('h3'); }
  if (c && e.key === '\\') { e.preventDefault(); sidebar.classList.toggle('hide'); }
  if (c && e.key === '/') { e.preventDefault(); toggleSource(); }
  if (c && e.shiftKey && e.key === 'T') { e.preventDefault(); toggleTheme(); }
  if (c && (e.key === 'f' || e.key === 'h')) { e.preventDefault(); toggleFind(); }

  if (e.key === 'Escape') {
    if (editor.langPopup.isOpen()) editor.langPopup.close();
    else if (editor._blockEditor) editor._closeBlockEditor();
    else if (findbar.classList.contains('show')) toggleFind();
    else if (contextMenu.classList.contains('show')) hideContextMenu();
  }
  if (e.key === 'F11') { e.preventDefault(); ipcRenderer.send('toggle-fullscreen'); }
});

/* ========== OPEN FILE ========== */
async function openFileDialog() {
  const result = await ipcRenderer.invoke('dialog:open');
  if (result.canceled) return;
  for (const file of result.files) {
    createTab(file.path, file.content, true);
  }
}

/* ========== DRAG & DROP ========== */
let dropEl = null;

document.addEventListener('dragover', e => {
  e.preventDefault();
  if (!dropEl) {
    dropEl = document.createElement('div');
    dropEl.className = 'drop-overlay';
    dropEl.innerHTML = '<div class="drop-text">拖放文件到此处<br><small>.md .txt 文档 或 图片文件</small></div>';
    document.body.appendChild(dropEl);
  }
});

document.addEventListener('dragleave', e => {
  if (!e.relatedTarget && dropEl) { dropEl.remove(); dropEl = null; }
});

document.addEventListener('drop', e => {
  e.preventDefault();
  if (dropEl) { dropEl.remove(); dropEl = null; }

  if (e.dataTransfer.files.length) {
    for (const file of e.dataTransfer.files) {
      const ext = pathMod.extname(file.name).toLowerCase();

      // Markdown / text files → open in new tab
      if (['.md', '.markdown', '.txt'].includes(ext)) {
        if (file.path) {
          // Electron gives us the full path
          const content = require('fs').readFileSync(file.path, 'utf-8');
          createTab(file.path, content, true);
        } else {
          const reader = new FileReader();
          reader.onload = () => createTab('', reader.result, true);
          reader.readAsText(file);
        }
        continue;
      }

      // Image files
      if (editor.handleDrop(file)) continue;
    }
  }
});

/* Deselect images on click outside */
document.addEventListener('click', e => {
  if (!e.target.closest('.img-wrapper')) {
    wys.querySelectorAll('.img-wrapper.selected').forEach(w => w.classList.remove('selected'));
  }
});

/* ========== IPC HANDLERS ========== */

// Open file from main process (e.g. command line, drag to dock, open-with)
ipcRenderer.on('file:open-in-tab', (_, { content, path: fp }) => {
  if (content !== null) createTab(fp, content, true);
});

// Menu commands
ipcRenderer.on('cmd:new', () => createTab('', '', true));
ipcRenderer.on('cmd:open', () => openFileDialog());
ipcRenderer.on('cmd:save', () => saveTab());
ipcRenderer.on('cmd:save-as', () => saveTabAs());
ipcRenderer.on('cmd:close-tab', () => closeTab(activeTabId));

ipcRenderer.on('cmd:fmt', (_, c) => fmt(c));
ipcRenderer.on('cmd:source', toggleSource);
ipcRenderer.on('cmd:outline', () => sidebar.classList.toggle('hide'));
ipcRenderer.on('cmd:theme', toggleTheme);
ipcRenderer.on('cmd:find', toggleFind);

ipcRenderer.on('cmd:exporthtml', () => {
  saveCurrentTabState();
  const tab = getActiveTab();
  if (!tab) return;
  const marked = require('marked');
  const html = marked.parse(tab.content);
  ipcRenderer.invoke('export:html', {
    html: `<!DOCTYPE html><html><head><meta charset="UTF-8"><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css"><style>body{font-family:Georgia,serif;max-width:820px;margin:40px auto;padding:0 20px;color:#1e1f2e;line-height:1.8}h1,h2,h3{font-family:sans-serif}h1{border-bottom:2px solid #e0e2ec;padding-bottom:.3em}code{background:#f5f5fa;padding:2px 6px;border-radius:4px;font-family:monospace}pre{background:#f5f5fa;padding:16px;border-radius:8px;overflow-x:auto}pre code{background:none;padding:0}blockquote{border-left:4px solid #6366f1;background:#f5f5fa;padding:12px 20px}table{width:100%;border-collapse:collapse}th{background:#f0f1f5;padding:10px;border:1px solid #e0e2ec}td{padding:8px;border:1px solid #ecedf3}img{max-width:100%}hr{border:none;height:1px;background:#e0e2ec;margin:2em 0}a{color:#4f46e5}</style></head><body>${html}</body></html>`,
    defaultPath: tab.filePath || 'export'
  });
});

ipcRenderer.on('cmd:exportpdf', () => {
  const tab = getActiveTab();
  ipcRenderer.invoke('export:pdf', { defaultPath: tab?.filePath || 'export' });
});

// Close guard
ipcRenderer.on('app:before-close', async () => {
  // Try to close all dirty tabs
  for (const tab of [...tabs]) {
    if (tab.dirty) {
      if (tab.id !== activeTabId) switchToTab(tab.id);
      const response = await showSaveDialog(tab.title);
      if (response === 2) return; // Cancel → abort close
      if (response === 0) { // Save
        const saved = await saveTab(tab.id);
        if (!saved) return; // Save canceled → abort close
      }
    }
  }
  // All saved or discarded
  ipcRenderer.send('app:can-close');
});

/* ========== WELCOME CONTENT ========== */
const WELCOME = `# 欢迎使用 MarkFlow

一个免费的 **Typora 风格** Markdown 编辑器，所见即所得。

## 直接编辑

这个编辑器就像 Typora 一样——你看到的就是渲染后的文档，直接在上面编辑。点击任何位置开始输入，格式化会实时生效。

按 \`Ctrl+/\` 切换到**源码模式**查看和编辑原始 Markdown。

## 多标签页

支持同时打开多个文件！像浏览器一样使用标签切换：

- \`Ctrl+N\` 新建标签
- \`Ctrl+W\` 关闭标签
- \`Ctrl+Tab\` 切换下一个标签
- \`Ctrl+Shift+Tab\` 切换上一个标签
- 拖放 .md 文件自动在新标签中打开

## 代码高亮

\`\`\`javascript
function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}
console.log(fibonacci(10)); // 55
\`\`\`

\`\`\`python
def quicksort(arr):
    if len(arr) <= 1:
        return arr
    pivot = arr[len(arr) // 2]
    left = [x for x in arr if x < pivot]
    right = [x for x in arr if x > pivot]
    return quicksort(left) + [pivot] + quicksort(right)
\`\`\`

> 代码块右下角显示语言标签，**点击可以切换语言**

## 图片

支持插入图片：点击工具栏按钮、粘贴剪贴板图片、或拖放图片文件。

## 数学公式

行内: $E = mc^2$，$\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$

块级:

$$
\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}
$$

## Mermaid 图表

\`\`\`mermaid
graph TD
    A[编写 Markdown] --> B{选择模式}
    B -->|WYSIWYG| C[所见即所得]
    B -->|源码| D[Markdown 源码]
    C --> E[完成]
    D --> E
\`\`\`

## 超链接

点击在浏览器打开: [GitHub](https://github.com) · [Google](https://google.com)

## 列表

- 第一层
    - 第二层
        - 第三层
    - 另一个
- 回到第一层

1. 有序列表
    1. 嵌套
    2. 继续
2. 顶层

## 任务列表

- [x] WYSIWYG 编辑
- [x] 多标签页支持
- [x] 代码块语言选择
- [x] KaTeX 数学公式
- [x] Mermaid 图表
- [x] 右键菜单
- [x] 查找替换
- [x] 图片插入 (工具栏/粘贴/拖放)
- [x] 深色/浅色主题
- [x] Ctrl+Z 撤销 / Ctrl+Y 重做
- [x] 最近文件列表

## 表格

| 功能 | 快捷键 | 说明 |
| --- | --- | --- |
| 加粗 | Ctrl+B | **粗体** |
| 斜体 | Ctrl+I | *斜体* |
| 链接 | Ctrl+K | 超链接 |
| 图片 | Ctrl+Shift+I | 插入图片 |
| 源码 | Ctrl+/ | 切换模式 |
| 保存 | Ctrl+S | 保存文件 |
| 新标签 | Ctrl+N | 新建标签 |
| 关闭标签 | Ctrl+W | 关闭标签 |
| 切换标签 | Ctrl+Tab | 下一个标签 |

## 键盘快捷键

- \`Ctrl+B\` 加粗 · \`Ctrl+I\` 斜体 · \`Ctrl+K\` 链接
- \`Ctrl+1/2/3\` 标题1/2/3
- \`Ctrl+Shift+K\` 代码块 · \`Ctrl+Shift+I\` 插入图片
- \`Ctrl+/\` 源码模式 · \`Ctrl+\\\\\` 大纲
- \`Ctrl+Z\` 撤销 · \`Ctrl+Y\` 重做
- \`Ctrl+N\` 新标签 · \`Ctrl+W\` 关闭标签 · \`Ctrl+Tab\` 切换
- 输入 \`\`\`\` 后回车自动创建代码块
- 右键编辑区域打开上下文菜单

---

*MarkFlow v6 — 免费的 Typora 替代品*
`;

/* ========== INIT ========== */
// Configure marked for inline rendering
const markedModule = require('marked');
markedModule.setOptions({ gfm: true, breaks: true, smartLists: true });

// Create initial welcome tab
createTab('', WELCOME, true);

// Focus first editable block
setTimeout(() => {
  const first = editor.blocks.find(b => ['paragraph', 'heading'].includes(b.type));
  if (first) editor._focusBlock(first, 'start');
}, 100);

// Load recent files in sidebar
loadRecentFiles();
