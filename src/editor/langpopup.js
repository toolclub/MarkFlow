'use strict';

const { esc } = require('./utils');

/* ========== Language definitions ========== */
const LANGS = [
  { n: 'JavaScript', id: 'javascript', x: '.js' },
  { n: 'TypeScript', id: 'typescript', x: '.ts' },
  { n: 'Python', id: 'python', x: '.py' },
  { n: 'Java', id: 'java', x: '.java' },
  { n: 'C', id: 'c', x: '.c' },
  { n: 'C++', id: 'cpp', x: '.cpp' },
  { n: 'C#', id: 'csharp', x: '.cs' },
  { n: 'Go', id: 'go', x: '.go' },
  { n: 'Rust', id: 'rust', x: '.rs' },
  { n: 'Swift', id: 'swift', x: '.swift' },
  { n: 'Kotlin', id: 'kotlin', x: '.kt' },
  { n: 'Ruby', id: 'ruby', x: '.rb' },
  { n: 'PHP', id: 'php', x: '.php' },
  { n: 'HTML', id: 'html', x: '.html' },
  { n: 'CSS', id: 'css', x: '.css' },
  { n: 'SCSS', id: 'scss', x: '.scss' },
  { n: 'SQL', id: 'sql', x: '.sql' },
  { n: 'Shell', id: 'bash', x: '.sh' },
  { n: 'PowerShell', id: 'powershell', x: '.ps1' },
  { n: 'JSON', id: 'json', x: '.json' },
  { n: 'YAML', id: 'yaml', x: '.yml' },
  { n: 'XML', id: 'xml', x: '.xml' },
  { n: 'Markdown', id: 'markdown', x: '.md' },
  { n: 'Dockerfile', id: 'dockerfile', x: '' },
  { n: 'Lua', id: 'lua', x: '.lua' },
  { n: 'R', id: 'r', x: '.r' },
  { n: 'Scala', id: 'scala', x: '.scala' },
  { n: 'Dart', id: 'dart', x: '.dart' },
  { n: 'Haskell', id: 'haskell', x: '.hs' },
  { n: 'LaTeX', id: 'latex', x: '.tex' },
  { n: 'Diff', id: 'diff', x: '.diff' },
  { n: 'GraphQL', id: 'graphql', x: '.gql' },
  { n: 'Mermaid', id: 'mermaid', x: '' },
  { n: 'Plain Text', id: 'plaintext', x: '.txt' },
];

/**
 * Language selection popup.
 * Positioned near the anchor element (e.g. a lang-badge or code block).
 */
class LangPopup {
  constructor() {
    this.el = document.getElementById('langPopup');
    this.input = document.getElementById('langInput');
    this.listEl = document.getElementById('langList');

    this._callback = null;
    this._filtered = [];
    this._idx = 0;
    this._onDocClick = null;

    this._bindEvents();
  }

  isOpen() {
    return this.el.classList.contains('show');
  }

  /**
   * Open the popup near the anchor element.
   * @param {Element|{getBoundingClientRect}} anchor - element to position near
   * @param {string} query - initial search query (e.g. last used language)
   * @param {function} callback - called with selected language id
   */
  open(anchor, query, callback) {
    this._callback = callback;
    this._idx = 0;

    // Get anchor position BEFORE showing popup
    const rect = anchor.getBoundingClientRect();

    this.el.classList.add('show');

    // Position: prefer showing above the anchor, near where it is
    const popW = 220, popH = 300;
    let left = rect.right - popW;
    let top = rect.top - popH - 4;

    // If above goes off screen, show below
    if (top < 4) top = rect.bottom + 4;
    // If below ALSO goes off screen, just put at top
    if (top + popH > window.innerHeight) top = 4;

    // Keep within viewport horizontally
    if (left < 4) left = 4;
    if (left + popW > window.innerWidth) left = window.innerWidth - popW - 8;

    this.el.style.left = left + 'px';
    this.el.style.top = top + 'px';

    this.input.value = query || '';
    this._filter(query || '');
    requestAnimationFrame(() => this.input.focus());

    // Close on outside click (delayed to avoid closing immediately)
    setTimeout(() => {
      this._onDocClick = (e) => {
        if (this.isOpen() && !this.el.contains(e.target)) this.close();
      };
      document.addEventListener('mousedown', this._onDocClick);
    }, 50);
  }

  close() {
    this.el.classList.remove('show');
    this._callback = null;
    if (this._onDocClick) {
      document.removeEventListener('mousedown', this._onDocClick);
      this._onDocClick = null;
    }
  }

  _select(lang) {
    const cb = this._callback;
    this.close();
    if (cb && lang) cb(lang.id);
  }

  _filter(q) {
    // Escape special regex chars to prevent issues with inputs like {}
    const safe = (q || '').toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '');
    this._filtered = safe
      ? LANGS.filter(l => l.n.toLowerCase().includes(safe) || l.id.includes(safe))
      : LANGS.slice();
    if (!this._filtered.length) this._filtered = LANGS.slice();
    this._idx = 0;
    this._renderList();
  }

  _renderList() {
    this.listEl.innerHTML = this._filtered.map((l, i) =>
      `<div class="lang-opt${i === this._idx ? ' active' : ''}" data-i="${i}"><span>${esc(l.n)}</span><span class="ext">${esc(l.x)}</span></div>`
    ).join('');
    const active = this.listEl.querySelector('.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  _bindEvents() {
    this.input.addEventListener('input', () => this._filter(this.input.value));

    this.input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') {
        e.preventDefault(); e.stopPropagation();
        this._idx = Math.min(this._idx + 1, this._filtered.length - 1);
        this._renderList();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault(); e.stopPropagation();
        this._idx = Math.max(this._idx - 1, 0);
        this._renderList();
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault(); e.stopPropagation();
        this._select(this._filtered[this._idx]);
      } else if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        this.close();
      }
    });

    this.listEl.addEventListener('mousedown', e => {
      const opt = e.target.closest('.lang-opt');
      if (opt) {
        e.preventDefault();
        this._select(this._filtered[parseInt(opt.dataset.i)]);
      }
    });
  }
}

module.exports = LangPopup;
