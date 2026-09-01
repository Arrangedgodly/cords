#!/usr/bin/env node
/**
 * ARC-2 boundary gate — the liftable-core contract (PRODUCT.md "Positioning"):
 * src/sim/ is the headless cord-physics core and must never import three.js,
 * so the simulation can be lifted into the larger product untouched.
 *
 * Scans every source file under src/sim/ for three.js imports (static,
 * side-effect, type-only, dynamic, require) and exits 1 on any hit. Wired
 * into `npm run build` and `npm test`; CI-able as `npm run check:sim`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIM_DIR = fileURLToPath(new URL('../src/sim', import.meta.url));

// Matches `... from 'three'`, `import 'three'`, `import ... from "three/..."`,
// dynamic `import('three')`, and `require('three')` — with or without subpath.
const THREE_IMPORT =
  /(?:\bfrom\s*|\bimport\s*|\brequire\s*\(\s*)['"]three(?:\/[^'"]*)?['"]|\bimport\s*\(\s*['"]three(?:\/[^'"]*)?['"]/;

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

const files = listSourceFiles(SIM_DIR);
const violations = [];

for (const file of files) {
  const rel = relative(SIM_DIR, file);
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (THREE_IMPORT.test(line)) {
      violations.push(`  src/sim/${rel}:${i + 1}: ${line.trim()}`);
    }
  });
}

if (violations.length > 0) {
  console.error('check:sim FAILED — three.js import found in the liftable core (src/sim/):');
  for (const v of violations) console.error(v);
  console.error('\nsrc/sim/ must stay three-free — see the header of src/sim/types.ts.');
  process.exit(1);
}

console.log(
  `check:sim OK — src/sim/ is three-free (${files.length} file${files.length === 1 ? '' : 's'} scanned).`,
);
