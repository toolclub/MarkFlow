const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let win;
let filePath = null;
let dirty = false;

function createWindow() {
  win = new BrowserWindow({
    width: 1100, height: 780, minWidth: 500, minHeight: 350,
    webPreferences: { nodeIntegration: true, contextIsolation: false, spellcheck: true },
    show: false
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => { win.show(); const fp = argFile(); if (fp) open(fp); });
  win.on('close', async e => {
    if (!dirty) return;
    e.preventDefault();
    const r = await dialog.showMessageBox(win, { type: 'warning', buttons: ['保存','不保存','取消'], message: '文件有未保存的更改' });
    if (r.response === 0) { if (await save()) win.destroy(); }
    else if (r.response === 1) win.destroy();
  });
  buildMenu();
}

function argFile() {
  for (const a of process.argv.slice(app.isPackaged ? 1 : 2))
    if (a && !a.startsWith('-') && fs.existsSync(a) && /\.(md|markdown|txt)$/i.test(a)) return path.resolve(a);
  return null;
}

app.on('open-file', (e, p) => { e.preventDefault(); win ? open(p) : app.once('ready', () => setTimeout(() => open(p), 300)); });
const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();
else app.on('second-instance', (_, argv) => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); const f = argv.find(a => !a.startsWith('-') && fs.existsSync(a) && /\.(md|markdown|txt)$/i.test(a)); if (f) open(f); }
});

function open(fp) {
  try { const c = fs.readFileSync(fp, 'utf-8'); filePath = fp; dirty = false; win.webContents.send('file:open', { content: c, path: fp }); title(); }
  catch (e) { dialog.showErrorBox('打开失败', e.message); }
}

async function save() {
  if (!filePath) return saveAs();
  return new Promise(res => {
    win.webContents.send('file:get');
    ipcMain.once('file:content', (_, c) => {
      try { fs.writeFileSync(filePath, c, 'utf-8'); dirty = false; title(); res(true); }
      catch (e) { dialog.showErrorBox('保存失败', e.message); res(false); }
    });
  });
}

async function saveAs() {
  const r = await dialog.showSaveDialog(win, { defaultPath: filePath || 'untitled.md', filters: [{ name: 'Markdown', extensions: ['md'] }, { name: '所有文件', extensions: ['*'] }] });
  if (r.canceled) return false;
  filePath = r.filePath; return save();
}

function title() { win.setTitle(`${filePath ? path.basename(filePath) : '未命名'}${dirty ? ' ●' : ''} — MarkFlow`); }
ipcMain.on('dirty', () => { dirty = true; title(); });
ipcMain.on('open-url', (_, u) => shell.openExternal(u));

ipcMain.handle('dialog:open', async () => {
  const r = await dialog.showOpenDialog(win, { filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }], properties: ['openFile'] });
  if (!r.canceled) open(r.filePaths[0]);
});

ipcMain.handle('dialog:image', async () => {
  const r = await dialog.showOpenDialog(win, {
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'] }],
    properties: ['openFile']
  });
  if (r.canceled || !r.filePaths.length) return null;
  return r.filePaths[0];
});

ipcMain.handle('save:image', async (_, { data, filename }) => {
  if (!filePath) return null;
  const dir = path.dirname(filePath);
  const imgDir = path.join(dir, 'images');
  if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });
  const dest = path.join(imgDir, filename);
  const base64 = data.replace(/^data:image\/\w+;base64,/, '');
  fs.writeFileSync(dest, Buffer.from(base64, 'base64'));
  return 'images/' + filename;
});

ipcMain.handle('export:html', async (_, html) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: (filePath || 'export').replace(/\.\w+$/, '.html'), filters: [{ name: 'HTML', extensions: ['html'] }] });
  if (!r.canceled) fs.writeFileSync(r.filePath, html, 'utf-8');
});

ipcMain.handle('export:pdf', async () => {
  const r = await dialog.showSaveDialog(win, { defaultPath: (filePath || 'export').replace(/\.\w+$/, '.pdf'), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (!r.canceled) { const d = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' }); fs.writeFileSync(r.filePath, d); }
});

function buildMenu() {
  const m = process.platform === 'darwin';
  const tpl = [
    ...(m ? [{ label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    { label: '文件', submenu: [
      { label: '新建', accelerator: 'CmdOrCtrl+N', click: () => { filePath = null; dirty = false; win.webContents.send('file:new'); title(); } },
      { label: '打开', accelerator: 'CmdOrCtrl+O', click: async () => {
        const r = await dialog.showOpenDialog(win, { filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }], properties: ['openFile'] });
        if (!r.canceled && r.filePaths.length) open(r.filePaths[0]);
      }},
      { type: 'separator' },
      { label: '保存', accelerator: 'CmdOrCtrl+S', click: save },
      { label: '另存为', accelerator: 'CmdOrCtrl+Shift+S', click: saveAs },
      { type: 'separator' },
      { label: '导出 HTML', accelerator: 'CmdOrCtrl+Shift+E', click: () => win.webContents.send('cmd:exporthtml') },
      { label: '导出 PDF', click: () => win.webContents.send('cmd:exportpdf') },
      { type: 'separator' },
      { role: 'quit', label: '退出' },
    ]},
    { label: '编辑', submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      { type: 'separator' },
      { label: '查找', accelerator: 'CmdOrCtrl+F', click: () => win.webContents.send('cmd:find') },
    ]},
    { label: '段落', submenu: [
      { label: '标题1', accelerator: 'CmdOrCtrl+1', click: () => win.webContents.send('cmd:fmt', 'h1') },
      { label: '标题2', accelerator: 'CmdOrCtrl+2', click: () => win.webContents.send('cmd:fmt', 'h2') },
      { label: '标题3', accelerator: 'CmdOrCtrl+3', click: () => win.webContents.send('cmd:fmt', 'h3') },
      { type: 'separator' },
      { label: '代码块', accelerator: 'CmdOrCtrl+Shift+K', click: () => win.webContents.send('cmd:fmt', 'code') },
      { label: '数学公式', click: () => win.webContents.send('cmd:fmt', 'mathblock') },
      { label: '表格', click: () => win.webContents.send('cmd:fmt', 'table') },
      { label: '分割线', click: () => win.webContents.send('cmd:fmt', 'hr') },
      { label: 'Mermaid', click: () => win.webContents.send('cmd:fmt', 'mermaid') },
    ]},
    { label: '格式', submenu: [
      { label: '加粗', accelerator: 'CmdOrCtrl+B', click: () => win.webContents.send('cmd:fmt', 'bold') },
      { label: '斜体', accelerator: 'CmdOrCtrl+I', click: () => win.webContents.send('cmd:fmt', 'italic') },
      { label: '删除线', click: () => win.webContents.send('cmd:fmt', 'strike') },
      { label: '行内代码', accelerator: 'CmdOrCtrl+`', click: () => win.webContents.send('cmd:fmt', 'inlinecode') },
      { label: '超链接', accelerator: 'CmdOrCtrl+K', click: () => win.webContents.send('cmd:fmt', 'link') },
      { label: '插入图片', accelerator: 'CmdOrCtrl+Shift+I', click: () => win.webContents.send('cmd:fmt', 'image') },
    ]},
    { label: '视图', submenu: [
      { label: '源码模式', accelerator: 'CmdOrCtrl+/', click: () => win.webContents.send('cmd:source') },
      { label: '大纲', accelerator: 'CmdOrCtrl+\\', click: () => win.webContents.send('cmd:outline') },
      { label: '主题', accelerator: 'CmdOrCtrl+Shift+T', click: () => win.webContents.send('cmd:theme') },
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

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
