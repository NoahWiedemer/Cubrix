// Deterministic tool sequences as the agent would send them (no API needed): every entry
// is one model, built through the real commands. Used by tests/agentBuilds.test.ts and,
// in the dev build, for screenshots: (await import("/scripts/e2e/agent-builds.mjs")).run(window.__cubrix, "esp32")
const metal = "#b9c0c5";
const gold = "#d9b24c";
const dark = "#1c1e20";
export const BUILDS = {
  esp32: {
    name: "ESP32 DevKit",
    steps: [
      ["object.delete", { all: true }],
      ["shapes.createMany", {
        groupName: "ESP32 DevKit",
        shapes: [
          { type: "box", name: "Platine", params: { width: 54.4, depth: 27.9, height: 1.6 }, position: [0, 0, 5.9], color: "#1f6b45", material: "glossy",
            edges: [{ kind: "fillet", size: 1.2, filter: "vertical" }], holes: [{ at: [[-25.2, -11.95], [-25.2, 11.95], [25.2, -11.95], [25.2, 11.95]], diameter: 2.5 }] },
          { type: "box", name: "WROOM Modul", params: { width: 25.5, depth: 18, height: 0.8 }, on: "Platine", position: [12.2, 0, 0], color: dark },
          { type: "box", name: "Antennenfeld", params: { width: 6.2, depth: 18, height: 0.82 }, on: "Platine", position: [22.05, 0, 0], color: "#14563a", material: "glossy" },
          { type: "box", name: "Blechschirm", params: { width: 17.6, depth: 16, height: 2.4 }, on: "WROOM Modul", position: [-3.3, 0, 0], color: metal, material: "metal", edges: [{ kind: "chamfer", size: 0.3, filter: "top" }] },
          { type: "box", name: "Micro-USB", params: { width: 5.6, depth: 8, height: 2.9 }, on: "Platine", position: [-24.2, 0, 0], color: metal, material: "metal", edges: [{ kind: "fillet", size: 0.5, filter: "x" }] },
          { type: "box", name: "USB-UART", params: { width: 5, depth: 5, height: 1 }, on: "Platine", position: [-13, 0, 0], color: dark, edges: [{ kind: "chamfer", size: 0.2, filter: "top" }] },
          { type: "box", name: "Spannungsregler", params: { width: 6.5, depth: 3.5, height: 1.6 }, on: "Platine", position: [-4, -6, 0], color: dark },
          { type: "box", name: "Taster EN", params: { width: 3.6, depth: 2.6, height: 1.4 }, on: "Platine", position: [-21, -8, 0], color: metal, material: "metal" },
          { type: "box", name: "Taster BOOT", params: { width: 3.6, depth: 2.6, height: 1.4 }, on: "Platine", position: [-21, 8, 0], color: metal, material: "metal" },
          { type: "cylinder", name: "Knopf EN", params: { diameter: 1.6, height: 0.6 }, on: "Taster EN", position: [0, 0, 0], color: "#2a2c2f" },
          { type: "cylinder", name: "Knopf BOOT", params: { diameter: 1.6, height: 0.6 }, on: "Taster BOOT", position: [0, 0, 0], color: "#2a2c2f" },
          { type: "box", name: "LED", params: { width: 1.6, depth: 0.8, height: 0.5 }, on: "Platine", position: [-11, 8, 0], color: "#d8443b", material: "glossy" },
          { type: "box", name: "Leiste A", params: { width: 38.1, depth: 2.54, height: 2.5 }, on: "Platine", position: [0, -11.43, 0], color: "#2a2c2f" },
          { type: "box", name: "Leiste B", params: { width: 38.1, depth: 2.54, height: 2.5 }, on: "Platine", position: [0, 11.43, 0], color: "#2a2c2f" },
          { type: "box", name: "Pin A", params: { width: 0.64, depth: 0.64, height: 11 }, on: "Platine", position: [-17.78, -11.43, -7.5], repeat: { count: 15, step: [2.54, 0, 0] }, color: gold, material: "metal" },
          { type: "box", name: "Pin B", params: { width: 0.64, depth: 0.64, height: 11 }, on: "Platine", position: [-17.78, 11.43, -7.5], repeat: { count: 15, step: [2.54, 0, 0] }, color: gold, material: "metal" },
        ],
      }],
    ],
  },
  enclosure: {
    name: "Gehäuse 80×50×25",
    steps: [
      ["object.delete", { all: true }],
      ["shapes.createMany", {
        groupName: "Gehäuse",
        shapes: [
          { type: "box", name: "Unterteil", params: { width: 80, depth: 50, height: 25 }, position: [0, -32, 0], color: "#2a2c2f", edges: [{ kind: "fillet", size: 4, filter: "vertical" }] },
          { type: "box", name: "Deckel", params: { width: 80, depth: 50, height: 3 }, position: [0, 32, 2], color: "#6ee7c5", material: "glossy", edges: [{ kind: "fillet", size: 4, filter: "vertical" }, { kind: "chamfer", size: 0.6, filter: "top" }],
            holes: [{ at: [[-34, -19], [34, -19], [-34, 19], [34, 19]], diameter: 3.4, head: "countersink", headDiameter: 6.4 }] },
        ],
      }],
      ["named.shell", { name: "Unterteil", thickness: 2, open: "top" }],
      ["named.pocket", { name: "Unterteil", face: "front", shape: "rect", u: 0, v: 2, width: 12, height: 6, radius: 1, depth: 3 }],
      ["named.pocket", { name: "Deckel", face: "bottom", mode: "add", width: 75.6, height: 45.6, radius: 2, depth: 2 }],
    ],
  },
  keychain: {
    name: "Schlüsselanhänger",
    steps: [
      ["object.delete", { all: true }],
      ["sketch.roundedRect", { width: 60, depth: 28, r: 7, height: 4, name: "Anhänger" }],
      ["named.hole", { name: "Anhänger", at: [[-23, 0]], diameter: 5 }],
      ["named.edges", { name: "Anhänger", kind: "fillet", size: 1, filter: "top" }],
      ["named.color", { name: "Anhänger", color: "#2f6fd6", material: "silk" }],
      ["named.text", { name: "Anhänger", text: "CUBRIX", size: 7, depth: 0.8, position: [4, 0] }],
    ],
  },
};

/** Runs a build. `api` = { execute, useApp }. Steps "named.*" address a part by its name. */
export async function run(api, key) {
  const { execute, useApp } = api;
  const doc = () => useApp.getState().nodes[useApp.getState().currentId].doc;
  const find = (name, list = doc().features) => {
    for (const f of list) {
      if (f.name === name) return f;
      const hit = f.children ? find(name, f.children) : null;
      if (hit) return hit;
    }
    return null;
  };
  const must = async (id, p) => {
    await api.settle?.(doc());
    const ok = await execute(id, p, { source: "ai" });
    if (ok === false) throw new Error(`${id} fehlgeschlagen`);
  };
  for (const [cmd, p] of BUILDS[key].steps) {
    if (cmd === "object.delete") {
      const ids = doc().features.map((f) => f.id);
      if (ids.length) await must("object.delete", { ids });
    } else if (cmd.startsWith("named.")) {
      const { name, ...rest } = p;
      const id = find(name)?.id;
      if (!id) throw new Error(`${name} nicht gefunden`);
      const what = cmd.slice(6);
      if (what === "shell") await must("object.shell", { id, ...rest });
      else if (what === "pocket") await must("object.pocket", { id, ...rest });
      else if (what === "hole") await must("object.hole", { id, ...rest });
      else if (what === "edges") await must(`edges.${rest.kind}`, { id, size: rest.size, filter: rest.filter });
      else if (what === "color") {
        await must("object.setColor", { ids: [id], color: rest.color });
        await must("object.setMaterial", { ids: [id], material: rest.material });
      } else if (what === "text") await must("text.create", { mode: "emboss", targetId: id, text: rest.text, size: rest.size, depth: rest.depth, ...(rest.position ? { position: [...rest.position, 0] } : {}) });
    } else await must(cmd, p);
  }
  await must("document.rename", { name: BUILDS[key].name });
}
