/**
 * Vite raw-asset imports (test-side only): lets unit suites read product
 * surface files (index.html) as text without Node-specific types — the
 * repo's tsconfig stays dependency-free.
 */
declare module '*?raw' {
  const content: string;
  export default content;
}
