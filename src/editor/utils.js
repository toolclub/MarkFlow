'use strict';

/* ========== HTML Escape ========== */
function esc(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ========== Debounce ========== */
function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* ========== ID Generator ========== */
let _idCounter = 0;
function genId() { return ++_idCounter; }

/* ========== Cursor Utilities ========== */

/** Set cursor to the start of an element */
function setCursorStart(el) {
  const sel = window.getSelection();
  const r = document.createRange();
  if (el.firstChild) {
    if (el.firstChild.nodeType === 3) r.setStart(el.firstChild, 0);
    else r.setStartBefore(el.firstChild);
  } else {
    r.setStart(el, 0);
  }
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

/** Set cursor to the end of an element */
function setCursorEnd(el) {
  const sel = window.getSelection();
  const r = document.createRange();
  if (el.lastChild && el.lastChild.nodeType === 3) {
    r.setStart(el.lastChild, el.lastChild.textContent.length);
  } else if (el.lastChild) {
    r.setStartAfter(el.lastChild);
  } else {
    r.setStart(el, 0);
  }
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

/** Check if cursor is at start of element */
function isAtStart(el) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return false;
  const range = sel.getRangeAt(0);
  if (!range.collapsed) return false;
  const tr = document.createRange();
  tr.setStart(el, 0);
  tr.setEnd(range.startContainer, range.startOffset);
  return tr.toString().length === 0;
}

/** Check if cursor is at end of element */
function isAtEnd(el) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return false;
  const range = sel.getRangeAt(0);
  if (!range.collapsed) return false;
  const tr = document.createRange();
  tr.setStart(range.endContainer, range.endOffset);
  if (el.lastChild) tr.setEndAfter(el.lastChild);
  else tr.setEnd(el, el.childNodes.length);
  return tr.toString().length === 0;
}

/** Get character offset of cursor within element (plain text offset) */
function getCursorOffset(el) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return 0;
  const range = sel.getRangeAt(0);
  const pre = document.createRange();
  pre.setStart(el, 0);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString().length;
}

/** Set cursor at a character offset within an element (plain text offset) */
function setCursorOffset(el, offset) {
  const sel = window.getSelection();
  const range = document.createRange();

  function walk(node, remaining) {
    if (node.nodeType === 3) {
      if (remaining <= node.textContent.length) {
        range.setStart(node, remaining);
        range.collapse(true);
        return -1; // done
      }
      return remaining - node.textContent.length;
    }
    for (let i = 0; i < node.childNodes.length; i++) {
      remaining = walk(node.childNodes[i], remaining);
      if (remaining < 0) return -1;
    }
    return remaining;
  }

  const r = walk(el, offset);
  if (r >= 0) {
    // offset beyond content → set to end
    setCursorEnd(el);
    return;
  }
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Find the closest ancestor matching a test function */
function closest(node, test) {
  let n = node;
  while (n) {
    if (test(n)) return n;
    n = n.parentElement;
  }
  return null;
}

/** Get the editable element within a block's DOM */
function getEditableIn(el) {
  if (!el) return null;
  // For code blocks: the <code> element
  if (el.tagName === 'PRE') return el.querySelector('code[contenteditable="true"]');
  // For blockquotes: the inner <p>
  if (el.tagName === 'BLOCKQUOTE') return el.querySelector('[contenteditable="true"]');
  // For elements that are directly editable
  if (el.getAttribute('contenteditable') === 'true') return el;
  // For wrappers: find the first editable child
  return el.querySelector('[contenteditable="true"]') || null;
}

module.exports = { esc, debounce, genId, setCursorStart, setCursorEnd, isAtStart, isAtEnd, getCursorOffset, setCursorOffset, closest, getEditableIn };
