const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let win;

/* ══════════ Multi-tab state ══════════
 * Tab state is managed by the renderer. Main process provides file I/O services.
 * The renderer tells main when dirty state changes for the window title / close guard.
 */
let anyDirty = false;
let windowTitle = 'MarkFlow';

function createWindow() {
  const iconPath = path.join(__dirname, '..', 'build', 'icon.png');
  win = new BrowserWindow({
    width: 1100, height: 780, minWidth: 500, minHeight: 350,
    webPreferences: { nodeIntegration: true, contextIsolation: false, spellcheck: true },
    show: false, frame: true,
    title: 'MarkFlow',
    icon: fs.existsSync(iconPath) ? iconPath : undefined
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => {
    win.show();
    const fp = argFile();
    if (fp) win.webContents.send('file:open-in-tab', { content: readFileSafe(fp), path: fp });
  });
  win.on('close', async e => {
    if (!anyDirty) return;
    e.preventDefault();
    // Ask renderer how many tabs are dirty
    win.webContents.send('app:before-close');
  });
  buildMenu();
}

function readFileSafe(fp) {
  try { return fs.readFileSync(fp, 'utf-8'); }
  catch (e) { dialog.showErrorBox('打开失败', e.message); return null; }
}

function argFile() {
  for (const a of process.argv.slice(app.isPackaged ? 1 : 2))
    if (a && !a.startsWith('-') && fs.existsSync(a) && /\.(md|markdown|txt)$/i.test(a)) return path.resolve(a);
  return null;
}

app.on('open-file', (e, p) => {
  e.preventDefault();
  if (win) {
    const content = readFileSafe(p);
    if (content !== null) win.webContents.send('file:open-in-tab', { content, path: p });
  } else {
    app.once('ready', () => setTimeout(() => {
      const content = readFileSafe(p);
      if (content !== null) win.webContents.send('file:open-in-tab', { content, path: p });
    }, 300));
  }
});

const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();
else app.on('second-instance', (_, argv) => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
    const f = argv.find(a => !a.startsWith('-') && fs.existsSync(a) && /\.(md|markdown|txt)$/i.test(a));
    if (f) {
      const content = readFileSafe(f);
      if (content !== null) win.webContents.send('file:open-in-tab', { content, path: f });
    }
  }
});

/* ══════════ IPC: File Operations ══════════ */

// Read a file and send content back
ipcMain.handle('file:read', async (_, filePath) => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return { success: true, content, path: filePath };
  } catch (e) {
    dialog.showErrorBox('打开失败', e.message);
    return { success: false };
  }
});

// Save content to a specific file path
ipcMain.handle('file:save', async (_, { filePath, content }) => {
  try {
    fs.writeFileSync(filePath, content, 'utf-8');
    return { success: true, path: filePath };
  } catch (e) {
    dialog.showErrorBox('保存失败', e.message);
    return { success: false };
  }
});

// Save As dialog + save
ipcMain.handle('file:save-as', async (_, { content, defaultPath }) => {
  const r = await dialog.showSaveDialog(win, {
    defaultPath: defaultPath || 'untitled.md',
    filters: [{ name: 'Markdown', extensions: ['md'] }, { name: '所有文件', extensions: ['*'] }]
  });
  if (r.canceled) return { success: false, canceled: true };
  try {
    fs.writeFileSync(r.filePath, content, 'utf-8');
    return { success: true, path: r.filePath };
  } catch (e) {
    dialog.showErrorBox('保存失败', e.message);
    return { success: false };
  }
});

// Open file dialog
ipcMain.handle('dialog:open', async () => {
  const r = await dialog.showOpenDialog(win, {
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
    properties: ['openFile', 'multiSelections']
  });
  if (r.canceled || !r.filePaths.length) return { canceled: true, files: [] };
  const files = [];
  for (const fp of r.filePaths) {
    try {
      const content = fs.readFileSync(fp, 'utf-8');
      files.push({ path: fp, content });
    } catch (e) {
      dialog.showErrorBox('打开失败', e.message);
    }
  }
  return { canceled: false, files };
});

// Open file dialog for images
ipcMain.handle('dialog:image', async () => {
  const r = await dialog.showOpenDialog(win, {
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'] }],
    properties: ['openFile']
  });
  if (r.canceled || !r.filePaths.length) return null;
  return r.filePaths[0];
});

// Save image to disk
ipcMain.handle('save:image', async (_, { data, filename, baseDir }) => {
  if (!baseDir) return null;
  const imgDir = path.join(baseDir, 'images');
  if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });
  const dest = path.join(imgDir, filename);
  const base64 = data.replace(/^data:image\/\w+;base64,/, '');
  fs.writeFileSync(dest, Buffer.from(base64, 'base64'));
  return 'images/' + filename;
});

// Export HTML
ipcMain.handle('export:html', async (_, { html, defaultPath }) => {
  const r = await dialog.showSaveDialog(win, {
    defaultPath: (defaultPath || 'export').replace(/\.\w+$/, '.html'),
    filters: [{ name: 'HTML', extensions: ['html'] }]
  });
  if (!r.canceled) fs.writeFileSync(r.filePath, html, 'utf-8');
});

// Export PDF
ipcMain.handle('export:pdf', async (_, { defaultPath }) => {
  const r = await dialog.showSaveDialog(win, {
    defaultPath: (defaultPath || 'export').replace(/\.\w+$/, '.pdf'),
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (!r.canceled) {
    const d = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
    fs.writeFileSync(r.filePath, d);
  }
});

// Ask user to confirm unsaved changes for a single tab
ipcMain.handle('dialog:unsaved', async (_, { filename }) => {
  const r = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['保存', '不保存', '取消'],
    message: `"${filename}" 有未保存的更改`,
    detail: '是否在关闭前保存？'
  });
  return r.response; // 0=save, 1=discard, 2=cancel
});

/* ══════════ IPC: Window State ══════════ */

ipcMain.on('window:title', (_, title) => {
  windowTitle = title;
  if (win) win.setTitle(title);
});

ipcMain.on('window:dirty', (_, isDirty) => {
  anyDirty = isDirty;
});

// Renderer confirms it's safe to close
ipcMain.on('app:can-close', () => {
  anyDirty = false;
  if (win) win.destroy();
});

ipcMain.on('open-url', (_, u) => shell.openExternal(u));

ipcMain.on('toggle-fullscreen', () => {
  if (win) win.setFullScreen(!win.isFullScreen());
});

/* ══════════ Recent Files ══════════ */
let recentFiles = [];
const recentFilePath = path.join(app.getPath('userData'), 'recent-files.json');

function loadRecentFiles() {
  try {
    if (fs.existsSync(recentFilePath)) {
      recentFiles = JSON.parse(fs.readFileSync(recentFilePath, 'utf-8'));
      // Filter out files that no longer exist
      recentFiles = recentFiles.filter(f => fs.existsSync(f));
    }
  } catch (e) { recentFiles = []; }
}

function saveRecentFiles() {
  try { fs.writeFileSync(recentFilePath, JSON.stringify(recentFiles.slice(0, 20)), 'utf-8'); }
  catch (e) { /* ignore */ }
}

ipcMain.on('recent:add', (_, filePath) => {
  recentFiles = recentFiles.filter(f => f !== filePath);
  recentFiles.unshift(filePath);
  recentFiles = recentFiles.slice(0, 20);
  saveRecentFiles();
});

ipcMain.handle('recent:get', () => recentFiles);

ipcMain.handle('recent:open', async (_, filePath) => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return { success: true, content, path: filePath };
  } catch (e) {
    // Remove from recent if it doesn't exist
    recentFiles = recentFiles.filter(f => f !== filePath);
    saveRecentFiles();
    return { success: false };
  }
});

/* ══════════ Menu ══════════ */

function buildMenu() {
  const m = process.platform === 'darwin';
  const send = (ch, ...args) => win.webContents.send(ch, ...args);
  const tpl = [
    ...(m ? [{ label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    { label: '文件', submenu: [
      { label: '新建', accelerator: 'CmdOrCtrl+N', click: () => send('cmd:new') },
      { label: '打开', accelerator: 'CmdOrCtrl+O', click: () => send('cmd:open') },
      { type: 'separator' },
      { label: '保存', accelerator: 'CmdOrCtrl+S', click: () => send('cmd:save') },
      { label: '另存为', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('cmd:save-as') },
      { type: 'separator' },
      { label: '关闭标签', accelerator: 'CmdOrCtrl+W', click: () => send('cmd:close-tab') },
      { type: 'separator' },
      { label: '导出 HTML', accelerator: 'CmdOrCtrl+Shift+E', click: () => send('cmd:exporthtml') },
      { label: '导出 PDF', click: () => send('cmd:exportpdf') },
      { type: 'separator' },
      { role: 'quit', label: '退出' },
    ]},
    { label: '编辑', submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      { type: 'separator' },
      { label: '查找', accelerator: 'CmdOrCtrl+F', click: () => send('cmd:find') },
    ]},
    { label: '段落', submenu: [
      { label: '标题1', accelerator: 'CmdOrCtrl+1', click: () => send('cmd:fmt', 'h1') },
      { label: '标题2', accelerator: 'CmdOrCtrl+2', click: () => send('cmd:fmt', 'h2') },
      { label: '标题3', accelerator: 'CmdOrCtrl+3', click: () => send('cmd:fmt', 'h3') },
      { type: 'separator' },
      { label: '代码块', accelerator: 'CmdOrCtrl+Shift+K', click: () => send('cmd:fmt', 'code') },
      { label: '数学公式', click: () => send('cmd:fmt', 'mathblock') },
      { label: '表格', click: () => send('cmd:fmt', 'table') },
      { label: '分割线', click: () => send('cmd:fmt', 'hr') },
      { label: 'Mermaid', click: () => send('cmd:fmt', 'mermaid') },
    ]},
    { label: '格式', submenu: [
      { label: '加粗', accelerator: 'CmdOrCtrl+B', click: () => send('cmd:fmt', 'bold') },
      { label: '斜体', accelerator: 'CmdOrCtrl+I', click: () => send('cmd:fmt', 'italic') },
      { label: '删除线', click: () => send('cmd:fmt', 'strike') },
      { label: '行内代码', accelerator: 'CmdOrCtrl+`', click: () => send('cmd:fmt', 'inlinecode') },
      { label: '超链接', accelerator: 'CmdOrCtrl+K', click: () => send('cmd:fmt', 'link') },
      { label: '插入图片', accelerator: 'CmdOrCtrl+Shift+I', click: () => send('cmd:fmt', 'image') },
    ]},
    { label: '视图', submenu: [
      { label: '源码模式', accelerator: 'CmdOrCtrl+/', click: () => send('cmd:source') },
      { label: '大纲', accelerator: 'CmdOrCtrl+\\', click: () => send('cmd:outline') },
      { label: '主题', accelerator: 'CmdOrCtrl+Shift+T', click: () => send('cmd:theme') },
      { type: 'separator' },
      { label: '专注模式', accelerator: 'F11', click: () => win.setFullScreen(!win.isFullScreen()) },
      { type: 'separator' },
      { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' },
      { type: 'separator' },
      { role: 'toggleDevTools' },
    ]},
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

loadRecentFiles();
app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
