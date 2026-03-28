'use strict';

const marked = require('marked');
const hljs = require('highlight.js');
const pathMod = require('path');
const { esc, debounce, genId, setCursorStart, setCursorEnd, isAtStart, isAtEnd, getCursorOffset, setCursorOffset, closest, getEditableIn } = require('./utils');
const { createBlock, parseMarkdown, blocksToMarkdown } = require('./parser');
const History = require('./history');
const LangPopup = require('./langpopup');

/**
 * MarkFlow Editor — Block-based WYSIWYG Markdown editor.
 *
 * Architecture (inspired by MarkText/muya):
 * - The document is an ordered array of Block objects.
 * - Each block renders to ONE top-level DOM element in the container.
 * - Editing happens per-block. No full document re-render during editing.
 * - Pattern detection (###, ```, etc.) transforms blocks in-place at the cursor position.
 * - Undo/redo uses markdown snapshots (full re-render on restore).
 */
class Editor {
  constructor(container, opts = {}) {
    this.container = container; // #wysiwyg
    this.blocks = [];
    this.history = new History({ debounceMs: 600 });
    this.langPopup = new LangPopup();
    this.lastLang = '';
    this.currentFilePath = '';
    this._blockEditor = null; // overlay editor for math/mermaid
    this._mmCounter = 0;

    // Callbacks
    this.onDirty = opts.onDirty || (() => {});
    this.onOutlineChange = opts.onOutlineChange || (() => {});
    this.onWordCountChange = opts.onWordCountChange || (() => {});

    this._init();
  }

  /* ==================== INITIALIZATION ==================== */

  _init() {
    // Don't make the container contenteditable — each block has its own
    this.container.removeAttribute('contenteditable');

    this.container.addEventListener('keydown', e => this._onKeydown(e));
    this.container.addEventListener('input', () => this._onInput());
    this.container.addEventListener('paste', e => this._onPaste(e));

    // Click on container below content → focus last block or create paragraph
    this.container.addEventListener('click', e => {
      if (e.target === this.container) {
        this._ensureTrailingParagraph();
        const last = this.blocks[this.blocks.length - 1];
        if (last) this._focusBlock(last, 'end');
      }
    });
  }

  /* ==================== MARKDOWN LOAD/SAVE ==================== */

  loadMarkdown(md) {
    this.blocks = parseMarkdown(md);
    this._renderAll();
    this.history.clear();
    this.history.push(md);
    this._notifyOutline();
    this._notifyWordCount();
  }

  getMarkdown() {
    this._syncAllBlocks();
    return blocksToMarkdown(this.blocks);
  }

  /* ==================== FULL RENDER (used on load and undo/redo) ==================== */

  _renderAll() {
    this.container.innerHTML = '';
    for (const block of this.blocks) {
      const el = this._createBlockDOM(block);
      this.container.appendChild(el);
    }
    this._ensureTrailingParagraph();
    this._renderMermaid();
    this._bindBlockInteractions();
  }

  /* ==================== BLOCK → DOM ==================== */

  _createBlockDOM(block) {
    let el;

    switch (block.type) {
      case 'paragraph':
        el = document.createElement('p');
        el.setAttribute('contenteditable', 'true');
        el.innerHTML = this._renderInline(block.content) || '<br>';
        break;

      case 'heading':
        el = document.createElement('h' + (block.meta.level || 1));
        el.setAttribute('contenteditable', 'true');
        el.innerHTML = this._renderInline(block.content) || '<br>';
        break;

      case 'code': {
        el = document.createElement('pre');
        el.setAttribute('data-lang', block.meta.lang || '');

        const copyBtn = document.createElement('button');
        copyBtn.className = 'copy-btn';
        copyBtn.textContent = '复制';
        copyBtn.setAttribute('contenteditable', 'false');
        copyBtn.addEventListener('click', e => {
          e.preventDefault(); e.stopPropagation();
          const code = el.querySelector('code');
          if (code) {
            navigator.clipboard.writeText(code.textContent);
            copyBtn.textContent = '已复制!';
            setTimeout(() => copyBtn.textContent = '复制', 1200);
          }
        });

        const code = document.createElement('code');
        code.className = 'hljs';
        code.setAttribute('contenteditable', 'true');
        code.setAttribute('spellcheck', 'false');
        code.textContent = block.content;
        this._highlightCode(code, block.meta.lang);

        // Real-time syntax highlighting while typing (debounced)
        const rehighlight = debounce(() => {
          const lang = block.meta.lang || el.getAttribute('data-lang') || '';
          if (!lang) return;
          const plain = code.textContent;
          block.content = plain;
          const offset = getCursorOffset(code);
          this._highlightCode(code, lang);
          setCursorOffset(code, offset);
        }, 300);

        code.addEventListener('input', () => rehighlight());
        // Also highlight on blur for good measure
        code.addEventListener('blur', () => {
          block.content = code.textContent;
          this._highlightCode(code, block.meta.lang || el.getAttribute('data-lang') || '');
        });

        const badge = document.createElement('span');
        badge.className = 'lang-badge';
        badge.setAttribute('contenteditable', 'false');
        badge.setAttribute('data-lang', block.meta.lang || '');
        badge.textContent = block.meta.lang || 'text';
        badge.addEventListener('click', e => {
          e.preventDefault(); e.stopPropagation();
          this.langPopup.open(badge, block.meta.lang || '', newLang => {
            block.meta.lang = newLang;
            this.lastLang = newLang;
            badge.textContent = newLang || 'text';
            badge.setAttribute('data-lang', newLang);
            el.setAttribute('data-lang', newLang);
            // Re-highlight with new language
            block.content = code.textContent;
            this._highlightCode(code, newLang);
            this._markDirty();
            // Re-focus the code element
            setTimeout(() => setCursorEnd(code), 50);
          });
        });

        el.appendChild(copyBtn);
        el.appendChild(code);
        el.appendChild(badge);
        break;
      }

      case 'list': {
        // Render list using marked for correct HTML generation
        const html = marked.parse(block.content);
        const wrapper = document.createElement('div');
        wrapper.innerHTML = html;
        el = wrapper.firstElementChild; // should be <ul> or <ol>
        if (!el || (el.tagName !== 'UL' && el.tagName !== 'OL')) {
          el = document.createElement('ul');
          el.innerHTML = html;
        }
        // Make list items editable
        el.querySelectorAll('li').forEach(li => li.setAttribute('contenteditable', 'true'));
        // Bind checkboxes
        el.querySelectorAll('input[type=checkbox]').forEach(cb => {
          cb.addEventListener('change', () => {
            this._syncBlockFromDOM(block);
            this._markDirty();
          });
        });
        break;
      }

      case 'blockquote': {
        el = document.createElement('blockquote');
        // Render inner content
        const innerHtml = this._renderInline(block.content);
        el.innerHTML = '<p>' + (innerHtml || '<br>') + '</p>';
        el.querySelector('p').setAttribute('contenteditable', 'true');
        break;
      }

      case 'table': {
        const html = marked.parse(block.content);
        const wrapper = document.createElement('div');
        wrapper.innerHTML = html;
        el = wrapper.querySelector('table');
        if (!el) {
          el = document.createElement('table');
          el.innerHTML = '<tbody><tr><td>&nbsp;</td></tr></tbody>';
        }
        // Make cells editable
        el.querySelectorAll('th, td').forEach(cell => cell.setAttribute('contenteditable', 'true'));
        break;
      }

      case 'hr':
        el = document.createElement('hr');
        break;

      case 'math': {
        el = document.createElement('div');
        el.className = 'math-block';
        el.setAttribute('contenteditable', 'false');
        try {
          if (typeof katex !== 'undefined') {
            el.innerHTML = katex.renderToString(block.content.trim(), { displayMode: true, throwOnError: false });
          } else {
            el.innerHTML = '<code>' + esc(block.content.trim()) + '</code>';
          }
        } catch (e) {
          el.innerHTML = '<code>' + esc(block.content.trim()) + '</code>';
        }
        el.innerHTML += '<div class="block-actions"><button class="block-edit-btn" title="编辑">编辑</button><button class="block-del-btn" title="删除">✕</button></div>';
        el.querySelector('.block-edit-btn').addEventListener('click', e => {
          e.stopPropagation();
          this._openBlockEditor(block, 'math');
        });
        el.querySelector('.block-del-btn').addEventListener('click', e => {
          e.stopPropagation();
          this._saveSnapshot();
          const next = this._nextBlock(block);
          this._removeBlock(block);
          this._ensureTrailingParagraph();
          if (next) this._focusBlock(next, 'start');
          else this._focusBlock(this.blocks[this.blocks.length - 1], 'start');
          this._markDirty();
        });
        break;
      }

      case 'mermaid': {
        el = document.createElement('div');
        el.className = 'mermaid-box';
        el.setAttribute('contenteditable', 'false');
        const b64 = btoa(unescape(encodeURIComponent(block.content)));
        el.setAttribute('data-mermaid', b64);
        el.innerHTML = '<div class="mmd"></div><div class="block-actions"><button class="block-edit-btn" title="编辑">编辑</button><button class="block-del-btn" title="删除">✕</button></div>';
        el.querySelector('.block-edit-btn').addEventListener('click', e => {
          e.stopPropagation();
          this._openBlockEditor(block, 'mermaid');
        });
        el.querySelector('.block-del-btn').addEventListener('click', e => {
          e.stopPropagation();
          this._saveSnapshot();
          const next = this._nextBlock(block);
          this._removeBlock(block);
          this._ensureTrailingParagraph();
          if (next) this._focusBlock(next, 'start');
          else this._focusBlock(this.blocks[this.blocks.length - 1], 'start');
          this._markDirty();
        });
        break;
      }

      case 'image': {
        el = document.createElement('div');
        el.className = 'img-wrapper';
        el.setAttribute('contenteditable', 'false');

        // ── Build the Typora-style editable markdown bar ──
        const imgBar = document.createElement('div');
        imgBar.className = 'img-bar';

        const buildBarMarkdown = () => {
          let md = `![${block.meta.alt || ''}](${block.meta.src || ''}`;
          if (block.meta.title) md += ` "${block.meta.title}"`;
          md += ')';
          if (block.meta.link) md = `[${md}](${block.meta.link})`;
          return md;
        };

        const barInput = document.createElement('input');
        barInput.className = 'img-bar-input';
        barInput.type = 'text';
        barInput.value = buildBarMarkdown();
        barInput.spellcheck = false;

        const applyBarEdit = () => {
          const val = barInput.value.trim();
          // Parse: [![alt](src "title")](link) or ![alt](src "title")
          const linkedMatch = val.match(/^\[!\[([^\]]*)\]\(([^)\s]*)(?:\s+"([^"]*)")?\)\]\(([^)]*)\)$/);
          const simpleMatch = val.match(/^!\[([^\]]*)\]\(([^)\s]*)(?:\s+"([^"]*)")?\)$/);
          if (linkedMatch) {
            block.meta.alt = linkedMatch[1] || '';
            block.meta.src = linkedMatch[2] || '';
            block.meta.title = linkedMatch[3] || '';
            block.meta.link = linkedMatch[4] || '';
          } else if (simpleMatch) {
            block.meta.alt = simpleMatch[1] || '';
            block.meta.src = simpleMatch[2] || '';
            block.meta.title = simpleMatch[3] || '';
            block.meta.link = '';
          } else {
            return; // Invalid format, don't update
          }
          // Re-render image
          this._saveSnapshot();
          const newBlock = this._replaceBlock(block, 'image', '', block.meta);
          this._markDirty();
        };

        barInput.addEventListener('keydown', e => {
          if (e.key === 'Enter') { e.preventDefault(); applyBarEdit(); }
          if (e.key === 'Escape') { e.preventDefault(); barInput.value = buildBarMarkdown(); barInput.blur(); }
        });
        barInput.addEventListener('blur', () => {
          // Apply if changed
          if (barInput.value.trim() !== buildBarMarkdown()) applyBarEdit();
        });

        imgBar.appendChild(barInput);
        el.appendChild(imgBar);

        // ── Resolve image src for display ──
        let src = block.meta.src;
        if (src && !src.startsWith('http') && !src.startsWith('data:') && !src.startsWith('file:') && this.currentFilePath) {
          const dir = pathMod.dirname(this.currentFilePath);
          src = 'file:///' + pathMod.resolve(dir, src).replace(/\\/g, '/');
        } else if (src && !src.startsWith('http') && !src.startsWith('data:') && !src.startsWith('file:') && src.startsWith('/')) {
          src = 'file:///' + src.replace(/\\/g, '/');
        }

        const imgEl = document.createElement('img');
        imgEl.src = src || '';
        imgEl.alt = block.meta.alt || '';
        if (block.meta.title) imgEl.title = block.meta.title;
        imgEl.loading = 'lazy';
        imgEl.addEventListener('error', () => el.classList.add('img-error'));
        el.appendChild(imgEl);

        // Caption
        const caption = document.createElement('span');
        caption.className = 'img-caption';
        caption.textContent = block.meta.alt || block.meta.title || '图片';
        el.appendChild(caption);

        // Delete button
        const delBtn = document.createElement('button');
        delBtn.className = 'img-del';
        delBtn.title = '删除图片';
        delBtn.textContent = '✕';
        delBtn.addEventListener('click', e => {
          e.preventDefault(); e.stopPropagation();
          this._removeBlock(block);
          this._markDirty();
        });
        el.appendChild(delBtn);

        // Click to select
        imgEl.addEventListener('click', e => {
          e.stopPropagation();
          this.container.querySelectorAll('.img-wrapper.selected').forEach(w => w.classList.remove('selected'));
          el.classList.add('selected');
        });

        // Double-click linked image to open URL
        if (block.meta.link) {
          imgEl.addEventListener('dblclick', e => {
            e.stopPropagation();
            const { ipcRenderer } = require('electron');
            ipcRenderer.send('open-url', block.meta.link);
          });
          imgEl.style.cursor = 'pointer';
        }
        break;
      }

      default:
        el = document.createElement('p');
        el.setAttribute('contenteditable', 'true');
        el.textContent = block.content;
    }

    el.dataset.blockId = String(block.id);
    block.el = el;
    return el;
  }

  /* ==================== INLINE MARKDOWN RENDERING ==================== */

  _renderInline(text) {
    if (!text) return '';
    let s = text;
    // Inline math $...$
    s = s.replace(/(?<!\$)\$(?!\$)([^\n$]+?)(?<!\$)\$(?!\$)/g, (_, f) => {
      try {
        if (typeof katex !== 'undefined')
          return katex.renderToString(f.trim(), { displayMode: false, throwOnError: false });
      } catch (e) { /* fallthrough */ }
      return '<code>' + esc(f.trim()) + '</code>';
    });
    // Footnote references
    s = s.replace(/\[\^(\d+)\]/g, (_, id) => `<sup><a href="#fn-${id}">[${id}]</a></sup>`);
    return marked.parseInline(s);
  }

  _highlightCode(codeEl, lang) {
    if (!lang || !codeEl.textContent.trim()) return;
    try {
      const text = codeEl.textContent;
      if (hljs.getLanguage(lang)) {
        codeEl.innerHTML = hljs.highlight(text, { language: lang }).value;
      } else {
        codeEl.innerHTML = hljs.highlightAuto(text).value;
      }
    } catch (e) {
      // Keep plain text on error
    }
  }

  /* ==================== BLOCK OPERATIONS ==================== */

  _findBlock(id) {
    return this.blocks.find(b => b.id === id);
  }

  _findBlockByEl(el) {
    if (!el) return null;
    const id = el.dataset?.blockId;
    if (id) return this._findBlock(parseInt(id));
    // Walk up to find a block element
    let node = el;
    while (node && node !== this.container) {
      if (node.dataset?.blockId) return this._findBlock(parseInt(node.dataset.blockId));
      node = node.parentElement;
    }
    return null;
  }

  _findBlockFromNode(node) {
    let n = node;
    if (n && n.nodeType === 3) n = n.parentElement;
    while (n && n !== this.container) {
      if (n.dataset?.blockId) return this._findBlock(parseInt(n.dataset.blockId));
      n = n.parentElement;
    }
    return null;
  }

  _blockIndex(block) {
    return this.blocks.indexOf(block);
  }

  _prevBlock(block) {
    const idx = this._blockIndex(block);
    return idx > 0 ? this.blocks[idx - 1] : null;
  }

  _nextBlock(block) {
    const idx = this._blockIndex(block);
    return idx >= 0 && idx < this.blocks.length - 1 ? this.blocks[idx + 1] : null;
  }

  /**
   * Insert a new block after the given block (or at start if null).
   * Returns the new block.
   */
  _insertBlockAfter(afterBlock, type, content, meta) {
    const newBlock = createBlock(type, content || '', meta || {});
    const el = this._createBlockDOM(newBlock);

    if (afterBlock) {
      const idx = this._blockIndex(afterBlock);
      this.blocks.splice(idx + 1, 0, newBlock);
      afterBlock.el.insertAdjacentElement('afterend', el);
    } else {
      this.blocks.unshift(newBlock);
      this.container.insertBefore(el, this.container.firstChild);
    }

    this._bindBlockInteractions(el);
    return newBlock;
  }

  /**
   * Remove a block from the document.
   */
  _removeBlock(block) {
    const idx = this._blockIndex(block);
    if (idx < 0) return;
    this.blocks.splice(idx, 1);
    if (block.el && block.el.parentElement) {
      block.el.remove();
    }
    block.el = null;
  }

  /**
   * Replace a block with a new block of different type.
   * The new block is inserted at the same position.
   */
  _replaceBlock(oldBlock, type, content, meta) {
    const newBlock = createBlock(type, content || '', meta || {});
    const el = this._createBlockDOM(newBlock);

    const idx = this._blockIndex(oldBlock);
    if (idx >= 0) {
      this.blocks[idx] = newBlock;
      if (oldBlock.el && oldBlock.el.parentElement) {
        oldBlock.el.replaceWith(el);
      }
    }
    oldBlock.el = null;

    this._bindBlockInteractions(el);
    return newBlock;
  }

  _ensureTrailingParagraph() {
    if (this.blocks.length === 0 || this.blocks[this.blocks.length - 1].type !== 'paragraph') {
      const block = createBlock('paragraph', '');
      const el = this._createBlockDOM(block);
      this.blocks.push(block);
      this.container.appendChild(el);
    }
  }

  _focusBlock(block, position) {
    if (!block || !block.el) return;
    const editable = getEditableIn(block.el);
    if (!editable) return;
    editable.focus();
    if (position === 'start') setCursorStart(editable);
    else if (position === 'end') setCursorEnd(editable);
  }

  /* ==================== SYNC BLOCK CONTENT FROM DOM ==================== */

  _syncBlockFromDOM(block) {
    if (!block.el) return;

    switch (block.type) {
      case 'paragraph': {
        const text = block.el.textContent || '';
        // Don't update if it's just <br> placeholder
        if (text.trim() || block.content.trim()) {
          block.content = text;
        }
        break;
      }
      case 'heading': {
        block.content = block.el.textContent || '';
        break;
      }
      case 'code': {
        const code = block.el.querySelector('code');
        if (code) block.content = code.textContent || '';
        break;
      }
      case 'list': {
        // Extract list markdown from DOM
        block.content = this._extractListMd(block.el);
        break;
      }
      case 'blockquote': {
        const p = block.el.querySelector('p, [contenteditable]');
        block.content = p ? p.textContent : '';
        break;
      }
      case 'table': {
        block.content = this._extractTableMd(block.el);
        break;
      }
      // math, mermaid, image, hr — content is not editable inline
    }
  }

  _syncAllBlocks() {
    for (const block of this.blocks) {
      this._syncBlockFromDOM(block);
    }
  }

  _extractListMd(el) {
    const lines = [];
    function processItems(container, indent) {
      const items = container.querySelectorAll(':scope > li');
      const ordered = container.tagName === 'OL';
      let num = 1;
      items.forEach(li => {
        const prefix = indent + (ordered ? (num++) + '.' : '-') + ' ';
        const cb = li.querySelector(':scope > input[type=checkbox]');
        let text = '';
        li.childNodes.forEach(n => {
          if (n === cb) return;
          if (n.nodeType === 3) text += n.textContent;
          else if (n.tagName === 'UL' || n.tagName === 'OL') return; // handle nested separately
          else text += n.textContent;
        });
        text = text.trim();
        if (cb) {
          lines.push(indent + '- [' + (cb.checked ? 'x' : ' ') + '] ' + text);
        } else {
          lines.push(prefix + text);
        }
        // Nested lists
        const nested = li.querySelector(':scope > ul, :scope > ol');
        if (nested) processItems(nested, indent + '    ');
      });
    }
    processItems(el, '');
    return lines.join('\n');
  }

  _extractTableMd(el) {
    const rows = [];
    const ths = el.querySelectorAll('thead th');
    if (ths.length) {
      rows.push('| ' + Array.from(ths).map(h => h.textContent.trim()).join(' | ') + ' |');
      rows.push('| ' + Array.from(ths).map(() => '---').join(' | ') + ' |');
    }
    el.querySelectorAll('tbody tr').forEach(tr => {
      const cells = tr.querySelectorAll('td');
      if (cells.length) {
        rows.push('| ' + Array.from(cells).map(c => c.textContent.trim()).join(' | ') + ' |');
      }
    });
    return rows.join('\n');
  }

  /* ==================== EVENT HANDLERS ==================== */

  _onInput() {
    this._markDirty();
    this._fastFenceCheck();
    this._debouncedPatternCheck();
    this._notifyWordCount();
  }

  // Fast check (50ms) specifically for ``` auto-suggestion
  _fastFenceCheck = debounce(() => {
    const block = this._getActiveBlock();
    if (!block || block.type !== 'paragraph') return;
    const text = (block.el.textContent || '').replace(/\u200B/g, '');
    const fenceMatch = text.match(/^`{3,}$/);
    if (fenceMatch && !this.langPopup.isOpen()) {
      this.langPopup.open(block.el, this.lastLang, selectedLang => {
        this._saveSnapshot();
        if (selectedLang === 'mermaid') {
          const defaultContent = 'graph TD\n    A[开始] --> B{判断}\n    B -->|是| C[结果1]\n    B -->|否| D[结果2]';
          const newBlock = this._replaceBlock(block, 'mermaid', defaultContent);
          this._insertBlockAfter(newBlock, 'paragraph');
          setTimeout(() => this._renderMermaid(), 50);
        } else {
          const newBlock = this._replaceBlock(block, 'code', '', { lang: selectedLang });
          this.lastLang = selectedLang;
          this._insertBlockAfter(newBlock, 'paragraph');
          setTimeout(() => {
            const code = newBlock.el.querySelector('code');
            if (code) { code.focus(); setCursorStart(code); }
          }, 60);
        }
        this._markDirty();
      });
    }
  }, 50)

  _debouncedPatternCheck = debounce(() => {
    const block = this._getActiveBlock();
    if (!block || block.type !== 'paragraph') return;

    const text = (block.el.textContent || '').replace(/\u200B/g, '');

    // Skip if fence check already handled this
    if (/^`{3,}$/.test(text)) return;

    // Auto-convert heading pattern (# text) while typing
    const hm = text.match(/^(#{1,6})\s+(.*)/);
    if (hm && hm[2].trim()) {
      this._saveSnapshot();
      const content = hm[2];
      const level = hm[1].length;
      const newBlock = this._replaceBlock(block, 'heading', content, { level });
      this._focusBlock(newBlock, 'end');
      this._notifyOutline();
      return;
    }

    // Auto-convert HR pattern (--- or *** or ___)
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(text.trim()) && text.trim().length >= 3) {
      this._saveSnapshot();
      const newBlock = this._replaceBlock(block, 'hr');
      const para = this._insertBlockAfter(newBlock, 'paragraph');
      this._focusBlock(para, 'start');
      return;
    }
  }, 400)

  _onPaste(e) {
    // Handle image paste
    const items = e.clipboardData?.items;
    if (items) {
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          this._handleImagePaste(item);
          return;
        }
      }
    }

    // For all text pastes: insert as plain text to avoid HTML corruption
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    if (text) {
      document.execCommand('insertText', false, text);
    }
  }

  /* ==================== KEYDOWN HANDLER ==================== */

  _onKeydown(e) {
    // Don't interfere when language popup is open
    if (this.langPopup.isOpen()) return;

    switch (e.key) {
      case 'Enter': this._handleEnter(e); break;
      case 'Backspace': this._handleBackspace(e); break;
      case 'Delete': this._handleDelete(e); break;
      case 'Tab': this._handleTab(e); break;
    }
  }

  /* ────── ENTER ────── */

  _handleEnter(e) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const block = this._getActiveBlock();
    if (!block) return;

    // ══ CODE BLOCK: insert newline ══
    if (block.type === 'code') {
      e.preventDefault();
      const code = block.el.querySelector('code');
      if (code) {
        // Ensure cursor is in code element
        if (!code.contains(sel.anchorNode)) setCursorEnd(code);
        document.execCommand('insertText', false, '\n');
      }
      return;
    }

    // ══ PARAGRAPH: check for block patterns ══
    if (block.type === 'paragraph') {
      const text = (block.el.textContent || '').replace(/\u200B/g, '').trim();

      // ``` code block pattern
      const codeMatch = text.match(/^`{3,}(\w*)$/);
      if (codeMatch) {
        e.preventDefault();
        this._saveSnapshot();
        const lang = codeMatch[1] || '';

        // Special case: ```mermaid creates a mermaid block
        if (lang === 'mermaid') {
          const defaultContent = 'graph TD\n    A[开始] --> B{判断}\n    B -->|是| C[结果1]\n    B -->|否| D[结果2]';
          const newBlock = this._replaceBlock(block, 'mermaid', defaultContent);
          this._insertBlockAfter(newBlock, 'paragraph');
          // Render mermaid diagram
          setTimeout(() => this._renderMermaid(), 50);
          this._markDirty();
          return;
        }

        // Replace current paragraph with code block AT THIS POSITION
        const newBlock = this._replaceBlock(block, 'code', '', { lang: lang || this.lastLang || '' });
        if (lang) this.lastLang = lang;

        // Focus the code element
        setTimeout(() => {
          const code = newBlock.el.querySelector('code');
          if (code) {
            code.focus();
            setCursorStart(code);
          }
          // If no language specified, open language popup
          if (!lang) {
            const badge = newBlock.el.querySelector('.lang-badge');
            if (badge) {
              this.langPopup.open(badge, this.lastLang, newLang => {
                newBlock.meta.lang = newLang;
                this.lastLang = newLang;
                badge.textContent = newLang || 'text';
                badge.setAttribute('data-lang', newLang);
                newBlock.el.setAttribute('data-lang', newLang);
                this._markDirty();
                // Re-focus code after language selection
                setTimeout(() => {
                  const c = newBlock.el.querySelector('code');
                  if (c) { c.focus(); setCursorStart(c); }
                }, 50);
              });
            }
          }
        }, 60);

        // Insert a new paragraph after the code block
        this._insertBlockAfter(newBlock, 'paragraph');
        this._markDirty();
        return;
      }

      // Heading pattern (# text)
      const headingMatch = text.match(/^(#{1,6})\s+(.*)/);
      if (headingMatch) {
        e.preventDefault();
        this._saveSnapshot();
        const level = headingMatch[1].length;
        const content = headingMatch[2];
        const newHeading = this._replaceBlock(block, 'heading', content, { level });
        // Create new paragraph after heading
        const para = this._insertBlockAfter(newHeading, 'paragraph');
        this._focusBlock(para, 'start');
        this._markDirty();
        this._notifyOutline();
        return;
      }

      // Blockquote pattern (> text)
      const bqMatch = text.match(/^>\s?(.*)/);
      if (bqMatch) {
        e.preventDefault();
        this._saveSnapshot();
        const newBlock = this._replaceBlock(block, 'blockquote', bqMatch[1] || '');
        this._focusBlock(newBlock, 'end');
        this._markDirty();
        return;
      }

      // Unordered list pattern (- text, * text, + text)
      const ulMatch = text.match(/^([-*+])\s(.*)/);
      if (ulMatch) {
        e.preventDefault();
        this._saveSnapshot();
        const item = ulMatch[2];
        const md = '- ' + item;
        const newBlock = this._replaceBlock(block, 'list', md, { ordered: false, task: false });
        // Focus last list item
        setTimeout(() => {
          const li = newBlock.el.querySelector('li:last-child');
          if (li) setCursorEnd(li);
        }, 50);
        this._markDirty();
        return;
      }

      // Ordered list pattern (1. text)
      const olMatch = text.match(/^(\d+)\.\s(.*)/);
      if (olMatch) {
        e.preventDefault();
        this._saveSnapshot();
        const md = olMatch[1] + '. ' + olMatch[2];
        const newBlock = this._replaceBlock(block, 'list', md, { ordered: true, task: false });
        setTimeout(() => {
          const li = newBlock.el.querySelector('li:last-child');
          if (li) setCursorEnd(li);
        }, 50);
        this._markDirty();
        return;
      }

      // Task list pattern (- [ ] text or - [x] text)
      const taskMatch = text.match(/^-\s\[([ x])\]\s(.*)/);
      if (taskMatch) {
        e.preventDefault();
        this._saveSnapshot();
        const md = '- [' + taskMatch[1] + '] ' + taskMatch[2];
        const newBlock = this._replaceBlock(block, 'list', md, { ordered: false, task: true });
        setTimeout(() => {
          const li = newBlock.el.querySelector('li:last-child');
          if (li) setCursorEnd(li);
        }, 50);
        this._markDirty();
        return;
      }

      // Math block pattern ($$)
      if (text === '$$') {
        e.preventDefault();
        this._saveSnapshot();
        const newBlock = this._replaceBlock(block, 'math', 'E = mc^2');
        this._insertBlockAfter(newBlock, 'paragraph');
        this._openBlockEditor(newBlock, 'math');
        this._markDirty();
        return;
      }

      // Default: split paragraph at cursor position
      if (!e.shiftKey) {
        e.preventDefault();
        this._splitParagraph(block);
        return;
      }
      // Shift+Enter: insert <br> (let browser handle)
      return;
    }

    // ══ HEADING: Enter creates new paragraph after ══
    if (block.type === 'heading') {
      e.preventDefault();
      this._saveSnapshot();
      this._syncBlockFromDOM(block);
      const para = this._insertBlockAfter(block, 'paragraph');
      this._focusBlock(para, 'start');
      this._markDirty();
      return;
    }

    // ══ LIST: handle Enter in list items ══
    if (block.type === 'list') {
      const li = closest(sel.anchorNode, n => n.nodeName === 'LI');
      if (li && !li.textContent.trim()) {
        // Empty list item → end the list
        e.preventDefault();
        this._saveSnapshot();
        li.remove();
        // If list is now empty, remove it
        if (!block.el.querySelectorAll('li').length) {
          const para = this._replaceBlock(block, 'paragraph');
          this._focusBlock(para, 'start');
        } else {
          this._syncBlockFromDOM(block);
          const para = this._insertBlockAfter(block, 'paragraph');
          this._focusBlock(para, 'start');
        }
        this._markDirty();
        return;
      }
      // Non-empty list item: let browser create new li
      return;
    }

    // ══ BLOCKQUOTE: Enter ══
    if (block.type === 'blockquote') {
      const p = block.el.querySelector('p, [contenteditable]');
      if (p && !p.textContent.trim()) {
        // Empty blockquote → convert to paragraph
        e.preventDefault();
        this._saveSnapshot();
        const para = this._replaceBlock(block, 'paragraph');
        this._focusBlock(para, 'start');
        this._markDirty();
        return;
      }
      // Non-empty: let browser handle (adds new line in blockquote)
      return;
    }

    // ══ TABLE: Tab between cells, Enter adds row ══
    if (block.type === 'table') {
      // Let browser handle
      return;
    }
  }

  /* ────── SPLIT PARAGRAPH ────── */

  _splitParagraph(block) {
    const el = block.el;
    const offset = getCursorOffset(el);
    const fullText = el.textContent || '';

    const before = fullText.substring(0, offset);
    const after = fullText.substring(offset);

    // Update current block with text before cursor
    block.content = before;
    el.innerHTML = this._renderInline(before) || '<br>';

    // Create new paragraph with text after cursor
    const newPara = this._insertBlockAfter(block, 'paragraph', after);
    this._focusBlock(newPara, 'start');
    this._markDirty();
  }

  /* ────── BACKSPACE ────── */

  _handleBackspace(e) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;

    // If there's a selection, let browser handle
    if (!sel.getRangeAt(0).collapsed) return;

    const block = this._getActiveBlock();
    if (!block) return;

    // ══ CODE BLOCK ══
    if (block.type === 'code') {
      const code = block.el.querySelector('code');
      const text = (code?.textContent || '').replace(/\u200B/g, '');

      // Empty code block → delete it
      if (!text.trim()) {
        e.preventDefault();
        this._saveSnapshot();
        const prev = this._prevBlock(block);
        this._removeBlock(block);
        this._ensureTrailingParagraph();
        if (prev) this._focusBlock(prev, 'end');
        else this._focusBlock(this.blocks[0], 'start');
        this._markDirty();
        return;
      }
      // Not empty: let browser handle
      return;
    }

    // ══ PARAGRAPH ══
    if (block.type === 'paragraph') {
      if (isAtStart(block.el)) {
        const prev = this._prevBlock(block);
        if (!prev) return; // nothing before

        e.preventDefault();
        this._saveSnapshot();

        // Merge with previous paragraph
        if (prev.type === 'paragraph') {
          this._syncBlockFromDOM(prev);
          this._syncBlockFromDOM(block);
          const prevLen = prev.content.length;
          prev.content += block.content;
          prev.el.innerHTML = this._renderInline(prev.content) || '<br>';
          this._removeBlock(block);
          setCursorOffset(prev.el, prevLen);
          this._markDirty();
          return;
        }

        // Merge with previous heading
        if (prev.type === 'heading') {
          this._syncBlockFromDOM(prev);
          this._syncBlockFromDOM(block);
          const prevLen = prev.content.length;
          prev.content += block.content;
          prev.el.innerHTML = this._renderInline(prev.content) || '<br>';
          this._removeBlock(block);
          setCursorOffset(prev.el, prevLen);
          this._markDirty();
          return;
        }

        // Delete previous HR
        if (prev.type === 'hr') {
          this._removeBlock(prev);
          this._markDirty();
          return;
        }

        // Delete previous image
        if (prev.type === 'image') {
          this._removeBlock(prev);
          this._markDirty();
          return;
        }

        // Previous is code block: focus it
        if (prev.type === 'code') {
          // If current paragraph is empty, delete it and focus code
          if (!block.el.textContent.trim()) {
            this._removeBlock(block);
          }
          this._focusBlock(prev, 'end');
          this._markDirty();
          return;
        }

        // Previous is math/mermaid: delete it
        if (prev.type === 'math' || prev.type === 'mermaid') {
          this._removeBlock(prev);
          this._markDirty();
          return;
        }

        // Default: focus previous block
        this._focusBlock(prev, 'end');
        return;
      }
      // Not at start: let browser handle
      return;
    }

    // ══ HEADING: at start → convert to paragraph ══
    if (block.type === 'heading' && isAtStart(block.el)) {
      e.preventDefault();
      this._saveSnapshot();
      this._syncBlockFromDOM(block);
      const para = this._replaceBlock(block, 'paragraph', block.content);
      this._focusBlock(para, 'start');
      this._markDirty();
      this._notifyOutline();
      return;
    }

    // ══ BLOCKQUOTE: at start → convert to paragraph ══
    if (block.type === 'blockquote') {
      const p = block.el.querySelector('[contenteditable]');
      if (p && isAtStart(p)) {
        e.preventDefault();
        this._saveSnapshot();
        this._syncBlockFromDOM(block);
        const para = this._replaceBlock(block, 'paragraph', block.content);
        this._focusBlock(para, 'start');
        this._markDirty();
        return;
      }
      return;
    }

    // ══ LIST: empty item → unindent or end list ══
    if (block.type === 'list') {
      const li = closest(sel.anchorNode, n => n.nodeName === 'LI');
      if (li && !li.textContent.trim() && isAtStart(li)) {
        e.preventDefault();
        this._saveSnapshot();
        const prevLi = li.previousElementSibling;
        li.remove();
        if (!block.el.querySelectorAll('li').length) {
          // List empty → replace with paragraph
          const para = this._replaceBlock(block, 'paragraph');
          this._focusBlock(para, 'start');
        } else if (prevLi) {
          setCursorEnd(prevLi);
        }
        this._syncBlockFromDOM(block);
        this._markDirty();
        return;
      }
      // Let browser handle normal backspace in list items
      return;
    }
  }

  /* ────── DELETE ────── */

  _handleDelete(e) {
    const sel = window.getSelection();
    if (!sel.rangeCount || !sel.getRangeAt(0).collapsed) return;

    const block = this._getActiveBlock();
    if (!block) return;

    const editable = getEditableIn(block.el);
    if (!editable) return;

    if (isAtEnd(editable)) {
      const next = this._nextBlock(block);
      if (!next) return;

      e.preventDefault();
      this._saveSnapshot();

      // Delete next block if it's non-content (hr, image, math, mermaid)
      if (['hr', 'image', 'math', 'mermaid'].includes(next.type)) {
        this._removeBlock(next);
        this._markDirty();
        return;
      }

      // Merge next paragraph/heading into current
      if (next.type === 'paragraph' || next.type === 'heading') {
        this._syncBlockFromDOM(block);
        this._syncBlockFromDOM(next);
        if (block.type === 'paragraph' || block.type === 'heading') {
          const offset = (block.el.textContent || '').length;
          block.content += next.content;
          block.el.innerHTML = this._renderInline(block.content) || '<br>';
          this._removeBlock(next);
          setCursorOffset(block.el, offset);
          this._markDirty();
        }
        return;
      }
    }
  }

  /* ────── TAB ────── */

  _handleTab(e) {
    const block = this._getActiveBlock();
    if (!block) return;

    e.preventDefault();

    // Code block: insert spaces
    if (block.type === 'code') {
      document.execCommand('insertText', false, '    ');
      return;
    }

    // List: indent/outdent
    if (block.type === 'list') {
      if (e.shiftKey) document.execCommand('outdent');
      else document.execCommand('indent');
      return;
    }

    // Default: insert spaces
    document.execCommand('insertText', false, '    ');
  }

  /* ==================== ACTIVE BLOCK ==================== */

  _getActiveBlock() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return null;
    return this._findBlockFromNode(sel.anchorNode);
  }

  /* ==================== HISTORY / UNDO / REDO ==================== */

  _saveSnapshot() {
    this._syncAllBlocks();
    const md = blocksToMarkdown(this.blocks);
    this.history.flush(md);
  }

  _saveSnapshotDebounced() {
    this._syncAllBlocks();
    this.history.pushDebounced(blocksToMarkdown(this.blocks));
  }

  undo() {
    // Flush any pending save first
    this._syncAllBlocks();
    this.history.flush(blocksToMarkdown(this.blocks));

    // Preserve scroll position
    const scrollEl = this.container.parentElement;
    const scrollTop = scrollEl ? scrollEl.scrollTop : 0;

    const md = this.history.undo();
    if (md !== null) {
      this.blocks = parseMarkdown(md);
      this._renderAll();
      this._notifyOutline();
      this._notifyWordCount();

      // Restore scroll position instead of jumping to a block
      if (scrollEl) {
        requestAnimationFrame(() => { scrollEl.scrollTop = scrollTop; });
      }
    }
  }

  redo() {
    // Preserve scroll position
    const scrollEl = this.container.parentElement;
    const scrollTop = scrollEl ? scrollEl.scrollTop : 0;

    const md = this.history.redo();
    if (md !== null) {
      this.blocks = parseMarkdown(md);
      this._renderAll();
      this._notifyOutline();
      this._notifyWordCount();

      // Restore scroll position
      if (scrollEl) {
        requestAnimationFrame(() => { scrollEl.scrollTop = scrollTop; });
      }
    }
  }

  /* ==================== DIRTY / NOTIFY ==================== */

  _markDirty() {
    this.onDirty();
    this._saveSnapshotDebounced();
    this._notifyOutline();
    this._notifyWordCount();
  }

  _notifyOutline() {
    const headings = [];
    for (const b of this.blocks) {
      if (b.type === 'heading' && b.el) {
        headings.push({
          level: b.meta.level,
          text: b.el.textContent || b.content,
          el: b.el
        });
      }
    }
    this.onOutlineChange(headings);
  }

  _notifyWordCount() {
    let text = '';
    for (const b of this.blocks) {
      if (b.el) text += b.el.textContent + ' ';
    }
    const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const en = (text.match(/[a-zA-Z0-9]+/g) || []).length;
    this.onWordCountChange({
      chars: text.trim().length,
      words: cjk + en,
      cjk,
      en
    });
  }

  /* ==================== MERMAID RENDERING ==================== */

  async _renderMermaid() {
    if (typeof mermaid === 'undefined') return;
    const dk = document.body.classList.contains('dark');
    try {
      mermaid.initialize({ startOnLoad: false, theme: dk ? 'dark' : 'default', securityLevel: 'loose' });
    } catch (e) { return; }

    for (const box of this.container.querySelectorAll('.mermaid-box:not([data-done])')) {
      const b64 = box.getAttribute('data-mermaid');
      if (!b64) continue;
      let code;
      try { code = decodeURIComponent(escape(atob(b64))); } catch (e) { continue; }
      const target = box.querySelector('.mmd');
      if (!target) continue;
      const id = 'mm' + (++this._mmCounter);
      try {
        const { svg } = await mermaid.render(id, code);
        target.innerHTML = svg;
        box.setAttribute('data-done', '1');
      } catch (err) {
        target.innerHTML = `<div class="mermaid-err">Mermaid 错误:\n${esc(err.message)}</div>`;
        box.setAttribute('data-done', '1');
      }
    }
  }

  /* ==================== BLOCK EDITOR (math/mermaid) ==================== */

  _openBlockEditor(block, type) {
    this._closeBlockEditor();

    const editorDiv = document.createElement('div');
    editorDiv.className = 'block-editor';
    editorDiv.setAttribute('contenteditable', 'false');
    editorDiv.innerHTML = `
      <div class="block-editor-header">
        <span>${type === 'mermaid' ? 'Mermaid 图表' : '数学公式'}</span>
        <div class="block-editor-actions">
          <button class="block-editor-save" title="保存 (Ctrl+Enter)">确定</button>
          <button class="block-editor-cancel" title="取消 (Esc)">取消</button>
        </div>
      </div>
      <textarea class="block-editor-textarea" spellcheck="false">${esc(block.content)}</textarea>
    `;

    // Position over the block
    const pane = this.container.parentElement;
    pane.style.position = 'relative';

    if (block.el) {
      editorDiv.style.position = 'absolute';
      editorDiv.style.left = (block.el.offsetLeft - 4) + 'px';
      editorDiv.style.top = (block.el.offsetTop - 4) + 'px';
      editorDiv.style.width = (block.el.offsetWidth + 8) + 'px';
      editorDiv.style.minHeight = Math.max((block.el.offsetHeight || 100) + 8, 200) + 'px';
    }

    pane.appendChild(editorDiv);
    this._blockEditor = editorDiv;

    const textarea = editorDiv.querySelector('.block-editor-textarea');
    textarea.focus();
    textarea.style.height = Math.max(200, (block.el?.offsetHeight || 100)) + 'px';

    const save = () => {
      this._saveSnapshot();
      block.content = textarea.value;
      // Re-render the block
      const newBlock = this._replaceBlock(block, block.type, block.content, block.meta);
      this._closeBlockEditor();
      this._renderMermaid();
      this._markDirty();
    };

    editorDiv.querySelector('.block-editor-save').addEventListener('click', save);
    editorDiv.querySelector('.block-editor-cancel').addEventListener('click', () => this._closeBlockEditor());

    textarea.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); this._closeBlockEditor(); }
      if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); save(); }
      if (e.key === 'Tab') {
        e.preventDefault();
        textarea.setRangeText('    ', textarea.selectionStart, textarea.selectionEnd, 'end');
      }
    });
  }

  _closeBlockEditor() {
    if (this._blockEditor) {
      this._blockEditor.remove();
      this._blockEditor = null;
    }
  }

  /* ==================== IMAGE HANDLING ==================== */

  async insertImageFromDialog() {
    const { ipcRenderer } = require('electron');
    const filePath = await ipcRenderer.invoke('dialog:image');
    if (!filePath) return;

    let imgRef;
    if (this.currentFilePath) {
      const dir = pathMod.dirname(this.currentFilePath);
      imgRef = pathMod.relative(dir, filePath).replace(/\\/g, '/');
    } else {
      imgRef = filePath.replace(/\\/g, '/');
    }

    this._insertImage(imgRef, '');
  }

  _insertImage(src, alt) {
    this._saveSnapshot();
    const block = this._getActiveBlock();
    const imgBlock = createBlock('image', '', { src, alt });
    const el = this._createBlockDOM(imgBlock);

    if (block) {
      const idx = this._blockIndex(block);
      this.blocks.splice(idx + 1, 0, imgBlock);
      block.el.insertAdjacentElement('afterend', el);
    } else {
      this.blocks.push(imgBlock);
      this.container.appendChild(el);
    }

    this._ensureTrailingParagraph();
    this._markDirty();
  }

  async _handleImagePaste(item) {
    const { ipcRenderer } = require('electron');
    const blob = item.getAsFile();
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result;
      if (this.currentFilePath) {
        try {
          const ext = item.type.split('/')[1] === 'jpeg' ? 'jpg' : (item.type.split('/')[1] || 'png');
          const filename = `image-${Date.now()}.${ext}`;
          const savedPath = await ipcRenderer.invoke('save:image', { data: base64, filename });
          if (savedPath) {
            this._insertImage(savedPath, '');
            return;
          }
        } catch (e) { /* fall through to base64 */ }
      }
      this._insertImage(base64, '粘贴图片');
    };
    reader.readAsDataURL(blob);
  }

  /* ==================== FORMAT COMMANDS ==================== */

  format(cmd) {
    this._closeBlockEditor();
    const block = this._getActiveBlock();

    switch (cmd) {
      case 'bold':
        this.container.focus();
        document.execCommand('bold');
        break;
      case 'italic':
        this.container.focus();
        document.execCommand('italic');
        break;
      case 'strike':
        this.container.focus();
        document.execCommand('strikethrough');
        break;
      case 'inlinecode': {
        const sel = window.getSelection();
        if (sel.rangeCount) {
          const range = sel.getRangeAt(0);
          const text = range.toString();
          if (text) {
            const code = document.createElement('code');
            code.textContent = text;
            range.deleteContents();
            range.insertNode(code);
            range.setStartAfter(code);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
          } else {
            document.execCommand('insertHTML', false, '<code>code</code>');
          }
        }
        break;
      }
      case 'h1': this._convertToHeading(1); break;
      case 'h2': this._convertToHeading(2); break;
      case 'h3': this._convertToHeading(3); break;
      case 'ul': {
        if (block && block.type === 'paragraph') {
          this._saveSnapshot();
          const text = block.el.textContent || '';
          const md = '- ' + (text || '列表项');
          const newBlock = this._replaceBlock(block, 'list', md, { ordered: false });
          setTimeout(() => {
            const li = newBlock.el.querySelector('li');
            if (li) setCursorEnd(li);
          }, 30);
          this._markDirty();
        } else {
          document.execCommand('insertUnorderedList');
        }
        break;
      }
      case 'ol': {
        if (block && block.type === 'paragraph') {
          this._saveSnapshot();
          const text = block.el.textContent || '';
          const md = '1. ' + (text || '列表项');
          const newBlock = this._replaceBlock(block, 'list', md, { ordered: true });
          setTimeout(() => {
            const li = newBlock.el.querySelector('li');
            if (li) setCursorEnd(li);
          }, 30);
          this._markDirty();
        } else {
          document.execCommand('insertOrderedList');
        }
        break;
      }
      case 'task': {
        this._saveSnapshot();
        const text = block ? (block.el.textContent || '') : '';
        const md = '- [ ] ' + (text || '任务');
        if (block && block.type === 'paragraph') {
          const newBlock = this._replaceBlock(block, 'list', md, { ordered: false, task: true });
          setTimeout(() => {
            const li = newBlock.el.querySelector('li');
            if (li) setCursorEnd(li);
          }, 30);
        } else {
          const active = this._getActiveBlock();
          this._insertBlockAfter(active, 'list', md, { ordered: false, task: true });
        }
        this._markDirty();
        break;
      }
      case 'quote': {
        if (block && block.type === 'paragraph') {
          this._saveSnapshot();
          const text = block.el.textContent || '';
          const newBlock = this._replaceBlock(block, 'blockquote', text || '引用');
          this._focusBlock(newBlock, 'end');
          this._markDirty();
        }
        break;
      }
      case 'codeblock': {
        this._saveSnapshot();
        const active = this._getActiveBlock();
        let newBlock;
        if (active && active.type === 'paragraph' && !active.el.textContent.trim()) {
          // Replace empty paragraph
          newBlock = this._replaceBlock(active, 'code', '', { lang: this.lastLang || '' });
        } else {
          // Insert after current block
          newBlock = this._insertBlockAfter(active, 'code', '', { lang: this.lastLang || '' });
        }
        this._ensureTrailingParagraph();

        // Focus and open language popup
        setTimeout(() => {
          const code = newBlock.el.querySelector('code');
          if (code) { code.focus(); setCursorStart(code); }
          const badge = newBlock.el.querySelector('.lang-badge');
          if (badge) {
            // Scroll into view first
            newBlock.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(() => {
              this.langPopup.open(badge, this.lastLang, newLang => {
                newBlock.meta.lang = newLang;
                this.lastLang = newLang;
                badge.textContent = newLang || 'text';
                badge.setAttribute('data-lang', newLang);
                newBlock.el.setAttribute('data-lang', newLang);
                this._markDirty();
                setTimeout(() => {
                  const c = newBlock.el.querySelector('code');
                  if (c) { c.focus(); setCursorStart(c); }
                }, 50);
              });
            }, 200);
          }
        }, 60);
        this._markDirty();
        break;
      }
      case 'table': {
        this._saveSnapshot();
        const md = '| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n|  |  |  |';
        const active = this._getActiveBlock();
        const newBlock = this._insertBlockAfter(active, 'table', md);
        setTimeout(() => {
          const cell = newBlock.el.querySelector('td');
          if (cell) { cell.focus(); setCursorStart(cell); }
        }, 30);
        this._markDirty();
        break;
      }
      case 'link': {
        const sel = window.getSelection();
        const text = sel.toString() || '链接文本';
        document.execCommand('insertHTML', false, `<a href="https://" class="ext-link">${esc(text)}</a>`);
        break;
      }
      case 'image':
        this.insertImageFromDialog();
        break;
      case 'hr': {
        this._saveSnapshot();
        const active = this._getActiveBlock();
        const hr = this._insertBlockAfter(active, 'hr');
        this._insertBlockAfter(hr, 'paragraph');
        this._focusBlock(this._nextBlock(hr), 'start');
        this._markDirty();
        break;
      }
      case 'mathblock': {
        this._saveSnapshot();
        const active = this._getActiveBlock();
        const mb = this._insertBlockAfter(active, 'math', 'E = mc^2');
        this._insertBlockAfter(mb, 'paragraph');
        this._openBlockEditor(mb, 'math');
        this._markDirty();
        break;
      }
      case 'mermaid': {
        this._saveSnapshot();
        const active = this._getActiveBlock();
        const content = 'graph TD\n    A[开始] --> B{判断}\n    B -->|是| C[结果1]\n    B -->|否| D[结果2]';
        const mm = this._insertBlockAfter(active, 'mermaid', content);
        this._insertBlockAfter(mm, 'paragraph');
        this._renderMermaid();
        this._markDirty();
        break;
      }
    }
    this._markDirty();
  }

  _convertToHeading(level) {
    const block = this._getActiveBlock();
    if (!block) return;
    this._saveSnapshot();

    if (block.type === 'heading') {
      // Change heading level
      block.meta.level = level;
      this._syncBlockFromDOM(block);
      const newBlock = this._replaceBlock(block, 'heading', block.content, { level });
      this._focusBlock(newBlock, 'end');
    } else if (block.type === 'paragraph') {
      this._syncBlockFromDOM(block);
      const newBlock = this._replaceBlock(block, 'heading', block.content, { level });
      this._focusBlock(newBlock, 'end');
    }
    this._notifyOutline();
    this._markDirty();
  }

  /* ==================== EXTERNAL LINK HANDLING ==================== */

  _bindBlockInteractions(scopeEl) {
    const scope = scopeEl || this.container;
    scope.querySelectorAll('a.ext-link, a[href^="http"]').forEach(a => {
      a.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        const { ipcRenderer } = require('electron');
        ipcRenderer.send('open-url', a.getAttribute('href'));
      });
    });
  }

  /* ==================== THEME CHANGE ==================== */

  onThemeChange() {
    // Re-render mermaid diagrams with new theme
    this.container.querySelectorAll('.mermaid-box').forEach(b => b.removeAttribute('data-done'));
    this._renderMermaid();
  }

  /* ==================== DRAG & DROP IMAGE ==================== */

  handleDrop(file) {
    const ext = pathMod.extname(file.name).toLowerCase();

    if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico'].includes(ext)) {
      const imgPath = file.path;
      if (imgPath) {
        let ref;
        if (this.currentFilePath) {
          const dir = pathMod.dirname(this.currentFilePath);
          ref = pathMod.relative(dir, imgPath).replace(/\\/g, '/');
        } else {
          ref = imgPath.replace(/\\/g, '/');
        }
        this._insertImage(ref, '');
      } else {
        const reader = new FileReader();
        reader.onload = () => this._insertImage(reader.result, file.name);
        reader.readAsDataURL(file);
      }
      return true;
    }
    return false;
  }
}

module.exports = Editor;
