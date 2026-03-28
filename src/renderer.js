/* MarkFlow v5 — Block-based WYSIWYG Markdown Editor
 *
 * Entry point for the renderer process.
 * Creates the Editor instance and bridges it with Electron IPC,
 * toolbar, sidebar, source mode, find/replace, and keyboard shortcuts.
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

/* ========== STATE ========== */
let srcMode = false;
let currentFilePath = '';

/* ========== CREATE EDITOR ========== */
const editor = new Editor(wys, {
  onDirty: () => ipcRenderer.send('dirty'),
  onOutlineChange: (headings) => updateOutline(headings),
  onWordCountChange: (counts) => updateWordCount(counts),
});

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
  $('wordcount').textContent = `${counts.chars} 字符 · ${counts.words} 词`;
  $('stW').textContent = counts.chars + ' 字';
}

/* ========== SOURCE MODE ========== */
function enterSource() {
  const md = editor.getMarkdown();
  sourceTA.value = md;
  editorPane.style.display = 'none';
  sourcePane.style.display = 'flex';
  srcMode = true;
  $('stMode').textContent = '源码';
  $('btnSrc').classList.add('on');
  sourceTA.focus();
}

function leaveSource() {
  const md = sourceTA.value;
  editorPane.style.display = 'block';
  sourcePane.style.display = 'none';
  srcMode = false;
  $('stMode').textContent = '编辑';
  $('btnSrc').classList.remove('on');
  editor.loadMarkdown(md);
  wys.focus();
}

function toggleSource() { srcMode ? leaveSource() : enterSource(); }

sourceTA.addEventListener('input', () => {
  ipcRenderer.send('dirty');
  $('stW').textContent = sourceTA.value.length + ' 字';
});

/* Source mode: paste image */
sourceTA.addEventListener('paste', e => {
  const items = e.clipboardData?.items;
  if (items) {
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        // Handle in source mode: insert markdown reference
        const blob = item.getAsFile();
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = reader.result;
          if (currentFilePath) {
            try {
              const ext = item.type.split('/')[1] === 'jpeg' ? 'jpg' : (item.type.split('/')[1] || 'png');
              const filename = `image-${Date.now()}.${ext}`;
              const savedPath = await ipcRenderer.invoke('save:image', { data: base64, filename });
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

    // ``` + Enter → code block
    const cm = line.match(/^(\s*)```(\w*)\s*$/);
    if (cm) {
      e.preventDefault();
      const indent = cm[1];
      const lang = cm[2];
      sourceTA.setRangeText('\n' + indent + '\n' + indent + '```', pos, pos, 'end');
      sourceTA.selectionStart = sourceTA.selectionEnd = pos + 1 + indent.length;
      ipcRenderer.send('dirty');
      if (!lang) {
        // Open language popup for source mode
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
                ipcRenderer.send('dirty');
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
    case 'codeblock': ins('\n```\n\n```\n'); sourceTA.selectionStart = sourceTA.selectionEnd = s + 5; break;
    case 'table': ins('\n| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n|  |  |  |\n'); break;
    case 'link': wrap('[', '](https://)'); break;
    case 'image': editor.insertImageFromDialog(); break;
    case 'hr': ins('\n---\n'); break;
    case 'mathblock': ins('\n$$\n\n$$\n'); sourceTA.selectionStart = sourceTA.selectionEnd = s + 4; break;
    case 'mermaid': ins('\n```mermaid\ngraph TD\n    A[开始] --> B{判断}\n    B -->|是| C[结果1]\n    B -->|否| D[结果2]\n```\n'); break;
  }
  ipcRenderer.send('dirty');
}

/* ========== FIND & REPLACE ========== */
function toggleFind() {
  findbar.classList.toggle('show');
  if (findbar.classList.contains('show')) $('fi').focus();
}

$('fi').addEventListener('input', () => {
  const q = $('fi').value;
  if (!q) { $('fc').textContent = '0'; return; }
  if (srcMode) {
    let c = 0, i = 0;
    while ((i = sourceTA.value.indexOf(q, i)) !== -1) { c++; i += q.length; }
    $('fc').textContent = c || '无';
  } else {
    window.getSelection().removeAllRanges();
    $('fc').textContent = window.find(q, false, false, true) ? '✓' : '无';
  }
});

$('fnx').addEventListener('click', () => { if (!srcMode) window.find($('fi').value); });
$('fpv').addEventListener('click', () => { if (!srcMode) window.find($('fi').value, false, true); });
$('r1').addEventListener('click', () => {
  if (srcMode) {
    const q = $('fi').value, r = $('ri').value;
    const i = sourceTA.value.indexOf(q);
    if (i !== -1) { sourceTA.setRangeText(r, i, i + q.length, 'end'); }
  }
});
$('rall').addEventListener('click', () => {
  if (srcMode) { sourceTA.value = sourceTA.value.split($('fi').value).join($('ri').value); }
});
$('fclose').addEventListener('click', toggleFind);

/* ========== THEME ========== */
function toggleTheme() {
  const isDark = document.body.classList.contains('dark');
  document.body.classList.toggle('dark', !isDark);
  document.body.classList.toggle('light', isDark);
  $('btnTh').textContent = isDark ? '☀' : '🌙';
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
  const c = e.ctrlKey || e.metaKey;

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
  }
  if (e.key === 'F11') { e.preventDefault(); ipcRenderer.send('toggle-fullscreen'); }
});

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
    const file = e.dataTransfer.files[0];
    const ext = pathMod.extname(file.name).toLowerCase();

    // Markdown / text files
    if (['.md', '.markdown', '.txt'].includes(ext)) {
      const reader = new FileReader();
      reader.onload = () => {
        if (srcMode) sourceTA.value = reader.result;
        else editor.loadMarkdown(reader.result);
      };
      reader.readAsText(file);
      return;
    }

    // Image files
    if (editor.handleDrop(file)) return;
  }
});

/* Deselect images on click outside */
document.addEventListener('click', e => {
  if (!e.target.closest('.img-wrapper')) {
    wys.querySelectorAll('.img-wrapper.selected').forEach(w => w.classList.remove('selected'));
  }
});

/* ========== IPC HANDLERS ========== */
ipcRenderer.on('file:open', (_, { content, path: fp }) => {
  currentFilePath = fp;
  editor.currentFilePath = fp;
  $('stFile').textContent = pathMod.basename(fp);
  if (srcMode) sourceTA.value = content;
  else editor.loadMarkdown(content);
});

ipcRenderer.on('file:new', () => {
  currentFilePath = '';
  editor.currentFilePath = '';
  $('stFile').textContent = '未命名';
  if (srcMode) sourceTA.value = '';
  else editor.loadMarkdown('');
});

ipcRenderer.on('file:get', () => {
  let md;
  if (srcMode) md = sourceTA.value;
  else md = editor.getMarkdown();
  ipcRenderer.send('file:content', md);
});

ipcRenderer.on('file:path', (_, fp) => {
  currentFilePath = fp;
  editor.currentFilePath = fp;
});

ipcRenderer.on('cmd:fmt', (_, c) => fmt(c));
ipcRenderer.on('cmd:source', toggleSource);
ipcRenderer.on('cmd:outline', () => sidebar.classList.toggle('hide'));
ipcRenderer.on('cmd:theme', toggleTheme);
ipcRenderer.on('cmd:find', toggleFind);

ipcRenderer.on('cmd:exporthtml', () => {
  let md;
  if (srcMode) md = sourceTA.value;
  else md = editor.getMarkdown();
  const marked = require('marked');
  const html = marked.parse(md);
  ipcRenderer.invoke('export:html', `<!DOCTYPE html><html><head><meta charset="UTF-8"><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css"><style>body{font-family:Georgia,serif;max-width:820px;margin:40px auto;padding:0 20px;color:#1e1f2e;line-height:1.8}h1,h2,h3{font-family:sans-serif}h1{border-bottom:2px solid #e0e2ec;padding-bottom:.3em}code{background:#f5f5fa;padding:2px 6px;border-radius:4px;font-family:monospace}pre{background:#f5f5fa;padding:16px;border-radius:8px;overflow-x:auto}pre code{background:none;padding:0}blockquote{border-left:4px solid #6366f1;background:#f5f5fa;padding:12px 20px}table{width:100%;border-collapse:collapse}th{background:#f0f1f5;padding:10px;border:1px solid #e0e2ec}td{padding:8px;border:1px solid #ecedf3}img{max-width:100%}hr{border:none;height:1px;background:#e0e2ec;margin:2em 0}a{color:#4f46e5}</style></head><body>${html}</body></html>`);
});

ipcRenderer.on('cmd:exportpdf', () => ipcRenderer.invoke('export:pdf'));

/* ========== INITIAL CONTENT ========== */
const WELCOME = `# 欢迎使用 MarkFlow ✨

一个免费的 **Typora 风格** Markdown 编辑器，所见即所得。

## 直接编辑

这个编辑器就像 Typora 一样——你看到的就是渲染后的文档，直接在上面编辑。点击任何位置开始输入，格式化会实时生效。

按 \`Ctrl+/\` 切换到**源码模式**查看和编辑原始 Markdown。

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

> 💡 代码块右下角显示语言标签，**点击可以切换语言**

## 图片

支持插入图片：点击工具栏 📷 按钮、粘贴剪贴板图片、或拖放图片文件。

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
- [x] 代码块语言选择
- [x] KaTeX 数学公式
- [x] Mermaid 图表
- [x] 图片插入 (工具栏/粘贴/拖放)
- [x] 深色/浅色主题
- [x] Ctrl+Z 撤销 / Ctrl+Y 重做
- [ ] 更多功能持续开发...

## 表格

| 功能 | 快捷键 | 说明 |
| --- | --- | --- |
| 加粗 | Ctrl+B | **粗体** |
| 斜体 | Ctrl+I | *斜体* |
| 链接 | Ctrl+K | 超链接 |
| 图片 | Ctrl+Shift+I | 插入图片 |
| 源码 | Ctrl+/ | 切换模式 |
| 保存 | Ctrl+S | 保存文件 |
| 撤销 | Ctrl+Z | 撤销操作 |
| 重做 | Ctrl+Y | 重做操作 |

## 键盘快捷键

- \`Ctrl+B\` 加粗 · \`Ctrl+I\` 斜体 · \`Ctrl+K\` 链接
- \`Ctrl+1/2/3\` 标题1/2/3
- \`Ctrl+Shift+K\` 代码块 · \`Ctrl+Shift+I\` 插入图片
- \`Ctrl+/\` 源码模式 · \`Ctrl+\\\\\` 大纲
- \`Ctrl+Z\` 撤销 · \`Ctrl+Y\` 重做
- 输入 \`\`\`\` 后回车自动创建代码块

---

*MarkFlow v5 — 免费的 Typora 替代品* 🎉
`;

/* ========== INIT ========== */
// Configure marked for inline rendering
const markedModule = require('marked');
markedModule.setOptions({ gfm: true, breaks: true, smartLists: true });

editor.loadMarkdown(WELCOME);
// Focus first editable block
setTimeout(() => {
  const first = editor.blocks.find(b => ['paragraph', 'heading'].includes(b.type));
  if (first) editor._focusBlock(first, 'start');
}, 100);
