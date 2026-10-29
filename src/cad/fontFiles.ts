// Bundled font files (latin subset covers ÄÖÜß), relative to node_modules/@fontsource.
const FILES: Record<string, string> = {
  "inter-400": "inter/files/inter-latin-400-normal.woff",
  "inter-700": "inter/files/inter-latin-700-normal.woff",
  "roboto-slab-400": "roboto-slab/files/roboto-slab-latin-400-normal.woff",
  "roboto-slab-700": "roboto-slab/files/roboto-slab-latin-700-normal.woff",
  "roboto-mono-400": "roboto-mono/files/roboto-mono-latin-400-normal.woff",
  "roboto-mono-700": "roboto-mono/files/roboto-mono-latin-700-normal.woff",
};

export const fontFile = (name: string) => FILES[name];
