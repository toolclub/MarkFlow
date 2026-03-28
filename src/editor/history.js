'use strict';

/**
 * Undo/Redo history using markdown snapshots.
 * Inspired by MarkText/muya's ContentState history.
 *
 * Design: each snapshot is a full markdown string.
 * On undo/redo, the editor re-renders from the snapshot.
 * Snapshots are debounced (not saved on every keystroke).
 */
class History {
  constructor(opts = {}) {
    this.maxSize = opts.maxSize || 300;
    this.stack = [];
    this.pointer = -1;
    this._debounceTimer = null;
    this._debounceMs = opts.debounceMs || 600;
  }

  /** Save a snapshot immediately */
  push(mdString) {
    // Discard any redo states ahead of pointer
    if (this.pointer < this.stack.length - 1) {
      this.stack = this.stack.slice(0, this.pointer + 1);
    }
    // Don't push duplicate
    if (this.stack.length && this.stack[this.stack.length - 1] === mdString) return;
    this.stack.push(mdString);
    if (this.stack.length > this.maxSize) {
      this.stack.shift();
    }
    this.pointer = this.stack.length - 1;
  }

  /** Debounced push — call frequently, only saves after pause */
  pushDebounced(mdString) {
    clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => this.push(mdString), this._debounceMs);
  }

  /** Flush any pending debounced push immediately */
  flush(mdString) {
    clearTimeout(this._debounceTimer);
    if (mdString !== undefined) this.push(mdString);
  }

  undo() {
    if (this.pointer <= 0) return null;
    this.pointer--;
    return this.stack[this.pointer];
  }

  redo() {
    if (this.pointer >= this.stack.length - 1) return null;
    this.pointer++;
    return this.stack[this.pointer];
  }

  canUndo() { return this.pointer > 0; }
  canRedo() { return this.pointer < this.stack.length - 1; }

  clear() {
    clearTimeout(this._debounceTimer);
    this.stack = [];
    this.pointer = -1;
  }
}

module.exports = History;
