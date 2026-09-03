#!/usr/bin/env node
/**
 * ARC-2 boundary gate — the liftable-core contract (PRODUCT.md "Positioning"):
 * src/sim/ is the headless cord-physics core and must never import a renderer
 * or touch the DOM/canvas, so the simulation can be lifted into the larger
 * product untouched.
 *
 * 2D PIVOT (town-hall Revision 2): three.js is GONE from the project, and the
 * gate grew the second half of the house rule — no DOM/canvas access of any
 * kind (document/window/HTMLCanvasElement/navigator/storage/rAF/getContext/
 * element queries) inside src/sim/.
 *
 * Scans every source file under src/sim/ for:
 *   - three.js imports (static, side-effect, type-only, dynamic, require)
 *   - DOM/canvas API usage in CODE (comments and string literals are
 *     stripped first, so prose like "the settle window." never trips it)
 *
 * Exits 1 on any hit. Wired into `npm run build` and `npm test`; CI-able as
 * `npm run check:sim`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIM_DIR = fileURLToPath(new URL('../src/sim', import.meta.url));

// Matches `... from 'three'`, `import 'three'`, `import ... from "three/..."`,
// dynamic `import('three')`, and `require('three')` — with or without subpath.
const THREE_IMPORT =
  /(?:\bfrom\s*|\bimport\s*|\brequire\s*\(\s*)['"]three(?:\/[^'"]*)?['"]|\bimport\s*\(\s*['"]three(?:\/[^'"]*)?['"]/;

// DOM/canvas access patterns, checked against CODE ONLY (comments/strings
// stripped): the browser globals a renderer-facing module would touch.
const DOM_PATTERNS = [
  [/\bdocument\s*\./, 'document access'],
  [/\bwindow\s*\./, 'window access'],
  [/\bglobalThis\s*\.\s*(?:document|window)\b/, 'globalThis DOM access'],
  [/\bHTMLCanvasElement\b/, 'HTMLCanvasElement'],
  [/\bnavigator\b/, 'navigator'],
  [/\blocalStorage\b|\bsessionStorage\b/, 'web storage'],
  [/\brequestAnimationFrame\b|\bcancelAnimationFrame\b/, 'animation-frame API'],
  [/\bgetContext\s*\(/, 'canvas getContext'],
  [/\bgetElementById\s*\(|\bquerySelector(?:All)?\s*\(/, 'element query'],
  [/\bcreateElement\s*\(/, 'createElement'],
];

const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

function listSourceFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...listSourceFiles(full));
    } else if (SOURCE_EXTS.has(extname(entry.name).toLowerCase())) {
      found.push(full);
    }
  }
  return found;
}

/**
 * Blanks comments and string-literal CONTENTS (structure and newlines kept,
 * so line numbers survive). The DOM patterns then see only real code: prose
 * like "the settle window." or a string mentioning document.* never trips
 * the gate, while every actual access does.
 */
function stripCommentsAndStrings(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let mode = 'code'; // code | line | block | squote | dquote | template
  while (i < n) {
    const c = src[i];
    const next = i + 1 < n ? src[i + 1] : '';
    if (mode === 'code') {
      if (c === '/' && next === '/') {
        mode = 'line';
        out += '  ';
        i += 2;
      } else if (c === '/' && next === '*') {
        mode = 'block';
        out += '  ';
        i += 2;
      } else if (c === "'") {
        mode = 'squote';
        out += ' ';
        i += 1;
      } else if (c === '"') {
        mode = 'dquote';
        out += ' ';
        i += 1;
      } else if (c === '`') {
        mode = 'template';
        out += ' ';
        i += 1;
      } else {
        out += c;
        i += 1;
      }
    } else if (mode === 'line') {
      if (c === '\n') {
        out += '\n';
        mode = 'code';
      } else {
        out += ' ';
      }
      i += 1;
    } else if (mode === 'block') {
      if (c === '*' && next === '/') {
        out += '  ';
        mode = 'code';
        i += 2;
      } else {
        out += c === '\n' ? '\n' : ' ';
        i += 1;
      }
    } else {
      // Inside a string literal: blank the content, keep structure.
      const quote = mode === 'squote' ? "'" : mode === 'dquote' ? '"' : '`';
      if (c === '\\') {
        out += '  ';
        i += 2;
      } else if (c === quote) {
        out += quote;
        mode = 'code';
        i += 1;
      } else {
        out += c === '\n' ? '\n' : ' ';
        i += 1;
      }
    }
  }
  return out;
}

const files = listSourceFiles(SIM_DIR);
const violations = [];

for (const file of files) {
  const rel = relative(SIM_DIR, file);
  const raw = readFileSync(file, 'utf8');
  const lines = raw.split('\n');

  // three.js import scan — on the RAW text (import statements are code; the
  // raw scan keeps the v1 gate's exact behavior).
  lines.forEach((line, i) => {
    if (THREE_IMPORT.test(line)) {
      violations.push(`  src/sim/${rel}:${i + 1}: three.js import — ${line.trim()}`);
    }
  });

  // DOM/canvas scan — on the comment/string-stripped CODE.
  const code = stripCommentsAndStrings(raw);
  const codeLines = code.split('\n');
  for (const [pattern, label] of DOM_PATTERNS) {
    codeLines.forEach((line, i) => {
      if (pattern.test(line)) {
        violations.push(`  src/sim/${rel}:${i + 1}: ${label} — ${lines[i]?.trim() ?? ''}`);
      }
    });
  }
}

if (violations.length > 0) {
  console.error('check:sim FAILED — renderer/DOM boundary broken in the liftable core (src/sim/):');
  for (const v of violations) console.error(v);
  console.error('\nsrc/sim/ must stay renderer- and DOM-free — see the header of src/sim/types.ts.');
  process.exit(1);
}

console.log(
  `check:sim OK — src/sim/ is renderer-free and DOM-free (${files.length} file${files.length === 1 ? '' : 's'} scanned).`,
);
