'use strict';

const { genId } = require('./utils');

/**
 * Markdown block-level parser.
 * Splits a markdown string into an array of block objects.
 *
 * Each block: { id, type, content, meta }
 *   type: 'paragraph' | 'heading' | 'code' | 'math' | 'mermaid' |
 *         'list' | 'blockquote' | 'table' | 'hr' | 'image'
 *   content: raw text (without block-level markers for heading/blockquote)
 *   meta: { level, lang, ordered, task, src, alt, title }
 */

function createBlock(type, content, meta) {
  return { id: genId(), type, content: content || '', meta: meta || {} };
}

/**
 * Parse a markdown string into blocks.
 */
function parseMarkdown(mdStr) {
  const blocks = [];
  if (!mdStr || !mdStr.trim()) return blocks;

  const lines = mdStr.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Skip blank lines between blocks
    if (line.trim() === '') { i++; continue; }

    // ──── Heading ────
    const hm = line.match(/^(#{1,6})\s+(.*)/);
    if (hm) {
      blocks.push(createBlock('heading', hm[2], { level: hm[1].length }));
      i++;
      continue;
    }

    // ──── Fenced code block ────
    const cm = line.match(/^(`{3,})(\w*)\s*$/);
    if (cm) {
      const fence = cm[1];
      const lang = cm[2] || '';
      const codeLines = [];
      i++;
      const closeRe = new RegExp('^' + fence + '\\s*$');
      while (i < lines.length && !closeRe.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // skip closing fence

      if (lang === 'mermaid') {
        blocks.push(createBlock('mermaid', codeLines.join('\n')));
      } else {
        blocks.push(createBlock('code', codeLines.join('\n'), { lang }));
      }
      continue;
    }

    // ──── Math block $$ ────
    if (line.trim() === '$$') {
      const mathLines = [];
      i++;
      while (i < lines.length && lines[i].trim() !== '$$') {
        mathLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // skip closing $$
      blocks.push(createBlock('math', mathLines.join('\n')));
      continue;
    }

    // ──── HR ────
    if (/^(\s*)([-*_])\s*\2\s*\2[\s\2]*$/.test(line) && line.trim().length >= 3) {
      blocks.push(createBlock('hr'));
      i++;
      continue;
    }

    // ──── Linked image [![alt](img)](url) ────
    const linkedImgMatch = line.match(/^\s*\[!\[([^\]]*)\]\(([^)\s]*)(?:\s+"([^"]*)")?\)\]\(([^)]*)\)\s*$/);
    if (linkedImgMatch) {
      blocks.push(createBlock('image', '', {
        alt: linkedImgMatch[1] || '',
        src: linkedImgMatch[2] || '',
        title: linkedImgMatch[3] || '',
        link: linkedImgMatch[4] || ''
      }));
      i++;
      continue;
    }

    // ──── Standalone image ────
    const imgMatch = line.match(/^\s*!\[([^\]]*)\]\(([^)\s]*)(?:\s+"([^"]*)")?\)\s*$/);
    if (imgMatch) {
      blocks.push(createBlock('image', '', {
        alt: imgMatch[1] || '',
        src: imgMatch[2] || '',
        title: imgMatch[3] || ''
      }));
      i++;
      continue;
    }

    // ──── Table ────
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const tableLines = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        tableLines.push(lines[i]);
        i++;
      }
      blocks.push(createBlock('table', tableLines.join('\n')));
      continue;
    }

    // ──── Raw HTML block ────
    // Detect block-level HTML tags like <p align="center">, <div>, etc.
    const htmlTagM = line.match(/^<([a-zA-Z][a-zA-Z0-9]*)/);
    if (htmlTagM) {
      const tag = htmlTagM[1].toLowerCase();
      const blockTags = ['p','div','table','thead','tbody','tr','th','td','pre','script','style',
        'details','summary','section','article','header','footer','nav','aside','main',
        'figure','figcaption','blockquote','h1','h2','h3','h4','h5','h6','ul','ol','dl','dt','dd'];
      if (blockTags.includes(tag)) {
        const htmlLines = [line];
        const closingRe = new RegExp('</' + tag + '\\s*>', 'i');
        if (!closingRe.test(line)) {
          i++;
          while (i < lines.length) {
            htmlLines.push(lines[i]);
            if (closingRe.test(lines[i])) { i++; break; }
            i++;
          }
        } else {
          i++;
        }
        blocks.push(createBlock('html', htmlLines.join('\n')));
        continue;
      }
    }

    // ──── Blockquote ────
    if (/^>\s?/.test(line)) {
      const bqLines = [];
      while (i < lines.length && (/^>\s?/.test(lines[i]) || (lines[i].trim() !== '' && bqLines.length > 0 && !/^(#{1,6}\s|```|>\s?|\$\$|[-*+]\s|\d+\.\s|\|)/.test(lines[i])))) {
        bqLines.push(lines[i]);
        i++;
      }
      // Strip leading > from each line
      const inner = bqLines.map(l => l.replace(/^>\s?/, '')).join('\n');
      blocks.push(createBlock('blockquote', inner));
      continue;
    }

    // ──── List (unordered, ordered, task) ────
    if (/^\s*([-*+]|\d+\.)\s/.test(line)) {
      const isOrdered = /^\s*\d+\./.test(line);
      const isTask = /^\s*[-*+]\s\[[ x]\]/.test(line);
      const listLines = [];

      while (i < lines.length) {
        const l = lines[i];
        // Check if this is a list item
        const isListItem = /^\s*([-*+]|\d+\.)\s/.test(l);
        if (isListItem) {
          // Stop if the list style changes (e.g. unordered → ordered)
          const thisOrdered = /^\s*\d+\./.test(l);
          const thisTask = /^\s*[-*+]\s\[[ x]\]/.test(l);
          if (listLines.length > 0 && (thisOrdered !== isOrdered || thisTask !== isTask)) {
            // Only break if this is a top-level item (no indent)
            if (!/^\s{2,}/.test(l)) break;
          }
          listLines.push(l);
          i++;
        } else if (/^\s{2,}\S/.test(l) && listLines.length > 0) {
          // Indented continuation of previous item
          listLines.push(l);
          i++;
        } else if (l.trim() === '' && i + 1 < lines.length) {
          // Blank line: check if next line continues same type of list
          const next = lines[i + 1];
          const nextIsItem = /^\s*([-*+]|\d+\.)\s/.test(next);
          if (nextIsItem) {
            const nextOrdered = /^\s*\d+\./.test(next);
            const nextTask = /^\s*[-*+]\s\[[ x]\]/.test(next);
            if (nextOrdered === isOrdered && nextTask === isTask) {
              listLines.push(l);
              i++;
              continue;
            }
          }
          break;
        } else {
          break;
        }
      }
      blocks.push(createBlock('list', listLines.join('\n'), { ordered: isOrdered, task: isTask }));
      continue;
    }

    // ──── Paragraph (default) ────
    const paraLines = [];
    while (i < lines.length) {
      const l = lines[i];
      if (l.trim() === '') break;
      // Break on block-level elements
      if (/^(#{1,6}\s|`{3,}|>\s?|\$\$\s*$)/.test(l)) break;
      if (/^\s*([-*+]|\d+\.)\s/.test(l)) break;
      if (/^\s*\|/.test(l) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) break;
      if (/^(\s*)([-*_])\s*\2\s*\2[\s\2]*$/.test(l) && l.trim().length >= 3) break;
      if (/^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(l)) break;
      paraLines.push(l);
      i++;
    }
    if (paraLines.length) {
      blocks.push(createBlock('paragraph', paraLines.join('\n')));
    } else {
      // Safety: skip a line we couldn't parse to avoid infinite loop
      i++;
    }
  }

  return blocks;
}

/**
 * Serialize an array of blocks back to markdown.
 */
function blocksToMarkdown(blocks) {
  return blocks.map(b => {
    switch (b.type) {
      case 'paragraph': return b.content;
      case 'heading': return '#'.repeat(b.meta.level || 1) + ' ' + b.content;
      case 'code': return '```' + (b.meta.lang || '') + '\n' + b.content + '\n```';
      case 'mermaid': return '```mermaid\n' + b.content + '\n```';
      case 'math': return '$$\n' + b.content + '\n$$';
      case 'list': return b.content;
      case 'html': return b.content;
      case 'blockquote': return b.content.split('\n').map(l => '> ' + l).join('\n');
      case 'table': return b.content;
      case 'hr': return '---';
      case 'image': {
        const alt = b.meta.alt || '';
        const src = b.meta.src || '';
        const title = b.meta.title ? ` "${b.meta.title}"` : '';
        const imgMd = `![${alt}](${src}${title})`;
        return b.meta.link ? `[${imgMd}](${b.meta.link})` : imgMd;
      }
      default: return b.content;
    }
  }).join('\n\n');
}

module.exports = { createBlock, parseMarkdown, blocksToMarkdown };
