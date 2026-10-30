// Agentic loop: the model sees every registered command as a tool, plus a few
// meta tools (model JSON, screenshot, scripts). All changes go through the
// command registry with source "ai", grouped per response in the history.
import { logError } from "../core/errorLog";
import { markModeling } from "./run";
import { execute, getCommand, listCommands, toToolDefinition } from "../core/commands";
import { getDoc, useApp } from "../core/store";
import { geometryKey, isSolid, type Feature, type Transform } from "../core/document";
import * as THREE from "three";
import { getGeometry, settleGeometry, useMeshes } from "../cad/kernel";
import { worldBox, worldTransform } from "../core/bounds";
import { HELP_TOPICS } from "../help/topics";
import type { Effort } from "./models";
import { runTurn, type Block, type Message, type Provider, type ToolSpec, type Transport } from "./providers";

/** Command ids contain dots, tool names may not. */
export const toolName = (id: string) => id.replace(/\./g, "__");
export const commandId = (name: string) => name.replace(/__/g, ".");

const HIDDEN = new Set(["file.new", "file.open", "file.openRecent", "file.import", "history.redoAlt", "selection.clear", "app.settings", "app.checkUpdates", "help.shortcuts"]);

export function buildTools(): ToolSpec[] {
  const commands = listCommands()
    .filter((c) => !HIDDEN.has(c.id) && !c.id.startsWith("workspace.") && !c.id.startsWith("sketch.tool."))
    .map((c) => {
      const t = toToolDefinition(c);
      return { ...t, name: toolName(c.id) };
    });
  return [
    ...commands,
    { name: "get_model", description: "Gibt das aktuelle Modell als JSON zurück: Objekte mit IDs, Typ, Maßen, Position, Drehung, Bounding-Box (mm) sowie Auswahl und Drucker.", input_schema: { type: "object", properties: {} } },
    { name: "get_screenshot", description: "Liefert ein Bild des aktuellen Viewports, um das Ergebnis zu prüfen.", input_schema: { type: "object", properties: {} } },
    {
      name: "measure",
      description: "Misst Objekte: mit a Maße und Bounding-Box, mit a und b zusätzlich Abstand je Achse (negativ = Überlappung) und Mittelpunkt-Abstand. a/b = ID oder Name.",
      input_schema: { type: "object", properties: { a: { type: "string" }, b: { type: "string" } }, required: ["a"] },
    },
    {
      name: "check_model",
      description: "Selbstprüfung nach dem Bauen: wartet auf den CAD-Kern und meldet Fehler beim Berechnen, schwebende Teile, Teile außerhalb des Bauraums, unter dem Bett und Überlappungen zwischen eigenständigen Objekten.",
      input_schema: { type: "object", properties: {} },
    },
    { name: "list_commands", description: "Listet alle Befehle mit Beschreibung.", input_schema: { type: "object", properties: {} } },
    {
      name: "run_script",
      description: "Führt mehrere Befehle nacheinander aus. steps: [{command: 'primitive.box', params: {...}}, …]. Bricht beim ersten Fehler ab.",
      input_schema: {
        type: "object",
        properties: { steps: { type: "array", items: { type: "object", properties: { command: { type: "string" }, params: { type: "object" } }, required: ["command"] } } },
        required: ["steps"],
      },
    },
  ];
}

export function modelSnapshot() {
  const doc = getDoc();
  const entries = useMeshes.getState().entries;
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    name: doc.name,
    printer: doc.printer,
    userSelection: useApp.getState().selection,
    objects: doc.features.map((f) => {
      const b = isSolid(f) && entries[geometryKey(f)] ? worldBox(f, entries) : null;
      const { id, name, type, visible, transform } = f;
      const extra = f.type === "boolean" ? { op: f.op, children: f.children.map((c) => c.name) } : f.type === "group" ? { members: f.children.map((c) => ({ id: c.id, name: c.name, type: c.type })) } : f.type === "sketch" ? { shapes: f.shapes } : f.type === "extrude" ? { height: f.height } : f.type === "import" ? { scale: f.scale } : { params: f.params };
      return {
        id, name, type, visible, transform, fillet: f.fillet, chamfer: f.chamfer, ...extra,
        bounds: b ? { min: [r(b.min.x), r(b.min.y), r(b.min.z)], max: [r(b.max.x), r(b.max.y), r(b.max.z)] } : undefined,
      };
    }),
  };
}

export const settle = settleGeometry;

export const r1 = (n: number) => Math.round(n * 100) / 100 + 0;

/** Every solid at any depth with its world box, once the kernel has built it. */
async function worldBoxes(): Promise<{ boxes: { f: Feature; box: THREE.Box3; top: string; path: string[] }[]; errors: string[] }> {
  const doc = getDoc();
  const errors: string[] = [];
  const boxes: { f: Feature; box: THREE.Box3; top: string; path: string[] }[] = [];
  const walk = async (f: Feature, frames: Transform[], top: string, path: string[]) => {
    if (!f.visible || f.type === "sketch") return;
    if (f.type === "group") {
      for (const c of f.children) await walk(c, [...frames, f.transform], top, [...path, f.name]);
      return;
    }
    try {
      await getGeometry(f);
    } catch (e) {
      errors.push(`${f.name}: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    const box = worldBox(f, useMeshes.getState().entries, worldTransform(frames, f.transform));
    if (box) boxes.push({ f, box, top, path });
  };
  for (const f of doc.features) await walk(f, [], f.id, []);
  return { boxes, errors };
}

const boxInfo = (b: THREE.Box3) => {
  const size = b.getSize(new THREE.Vector3());
  return { size: [r1(size.x), r1(size.y), r1(size.z)], min: [r1(b.min.x), r1(b.min.y), r1(b.min.z)], max: [r1(b.max.x), r1(b.max.y), r1(b.max.z)] };
};

async function measure(a: string, b?: string) {
  const { boxes } = await worldBoxes();
  const find = (key: string) => boxes.find((x) => x.f.id === key || x.f.name === key);
  const A = find(a);
  if (!A) throw new Error(`„${a}“ nicht gefunden (Sichtbarkeit prüfen).`);
  if (!b) return { name: A.f.name, ...boxInfo(A.box) };
  const B = find(b);
  if (!B) throw new Error(`„${b}“ nicht gefunden (Sichtbarkeit prüfen).`);
  const gap = [0, 1, 2].map((i) => r1(Math.max(A.box.min.getComponent(i) - B.box.max.getComponent(i), B.box.min.getComponent(i) - A.box.max.getComponent(i))));
  const ca = A.box.getCenter(new THREE.Vector3());
  const cb = B.box.getCenter(new THREE.Vector3());
  return { a: { name: A.f.name, ...boxInfo(A.box) }, b: { name: B.f.name, ...boxInfo(B.box) }, gapXYZ: gap, overlap: gap.every((v) => v < 0), centerDistance: r1(ca.distanceTo(cb)) };
}

/** Automatic self-check; touching parts count as connected, boxes are the measure. */
export async function checkModel() {
  const { boxes, errors } = await worldBoxes();
  const doc = getDoc();
  const [vx, vy, vz] = doc.printer.volume;
  const TOL = 0.05;
  const touches = (a: THREE.Box3, b: THREE.Box3) => a.clone().expandByScalar(TOL).intersectsBox(b);
  const floating: string[] = [];
  const belowBed: string[] = [];
  const outside: string[] = [];
  const overlaps: string[] = [];
  boxes.forEach((x, i) => {
    if (x.box.min.z < -TOL) belowBed.push(`${x.f.name} (unten bei ${r1(x.box.min.z)} mm)`);
    if (x.box.min.x < -vx / 2 - TOL || x.box.max.x > vx / 2 + TOL || x.box.min.y < -vy / 2 - TOL || x.box.max.y > vy / 2 + TOL || x.box.max.z > vz + TOL) outside.push(x.f.name);
    if (x.box.min.z > TOL && !boxes.some((o, j) => i !== j && touches(x.box, o.box))) floating.push(`${x.f.name} (${r1(x.box.min.z)} mm über dem Bett)`);
    for (let j = i + 1; j < boxes.length; j++) {
      const o = boxes[j];
      if (o.top === x.top) continue; // parts of one group may interlock
      const common = x.box.clone().intersect(o.box);
      if (!common.isEmpty()) {
        const s = common.getSize(new THREE.Vector3());
        if (Math.min(s.x, s.y, s.z) > 0.2) overlaps.push(`${x.f.name} / ${o.f.name} (${r1(s.x)} × ${r1(s.y)} × ${r1(s.z)} mm)`);
      }
    }
  });
  // A whole assembly can hang in the air even though its parts touch each other.
  for (const top of new Set(boxes.map((x) => x.top))) {
    const parts = boxes.filter((x) => x.top === top);
    const low = Math.min(...parts.map((x) => x.box.min.z));
    const others = boxes.filter((x) => x.top !== top);
    if (low > TOL && !parts.some((p) => others.some((o) => touches(p.box, o.box)))) {
      const name = doc.features.find((f) => f.id === top)?.name ?? parts[0].f.name;
      if (!floating.some((n) => n.startsWith(name))) floating.push(`${name} (${r1(low)} mm über dem Bett)`);
    }
  }
  const total = boxes.reduce((b, x) => b.union(x.box), new THREE.Box3());
  const list = (a: string[]) => (a.length > 12 ? [...a.slice(0, 12), `… und ${a.length - 12} weitere`] : a);
  const ok = !errors.length && !floating.length && !belowBed.length && !outside.length && !overlaps.length;
  return { ok, parts: boxes.length, ...(boxes.length ? { total: boxInfo(total) } : {}), errors, floating: list(floating), belowBed: list(belowBed), outsideVolume: list(outside), overlaps: list(overlaps) };
}

/** One short line per object (id, type, name, base position, size) for every request. */
export function sceneSummary(): string {
  const doc = getDoc();
  const entries = useMeshes.getState().entries;
  const r = (n: number) => Math.round(n * 10) / 10;
  // Operands of booleans are listed indented (their pos is relative to the parent);
  // commands accept their ids too (edit, extract, remove).
  const lines: string[] = [];
  const add = (f: Feature, depth: number) => {
    const b = isSolid(f) && entries[geometryKey(f)] ? worldBox(f, entries) : null;
    const size = b ? ` size=${r(b.max.x - b.min.x)}×${r(b.max.y - b.min.y)}×${r(b.max.z - b.min.z)}` : "";
    const rot = f.transform.rotation.some((v) => v) ? ` rot=[${f.transform.rotation.map(r).join(",")}]` : "";
    const hidden = f.visible ? "" : " (ausgeblendet)";
    const kind = f.type === "boolean" ? `boolean:${f.op}` : f.type;
    lines.push(`${"  ".repeat(depth)}${depth ? "└ " : ""}${f.id} ${kind} "${f.name}" pos=[${f.transform.position.map(r).join(",")}]${size}${rot}${hidden}`);
    if ((f.type === "boolean" || f.type === "group") && depth < 3) f.children.forEach((c) => add(c, depth + 1));
  };
  doc.features.forEach((f) => add(f, 0));
  const sel = useApp.getState().selection;
  return `${lines.length ? lines.join("\n") : "(leer)"}${sel.length ? `\nAuswahl des Nutzers: ${sel.join(", ")}` : ""}`.slice(0, 6000);
}

export function systemPrompt(webSearch = false): string {
  const doc = getDoc();
  const help = HELP_TOPICS.map((t) => `- ${t.title}${t.status === "soon" ? " (kommt bald)" : ""}: ${t.summary}`).join("\n");
  return `Du bist der KI-Assistent in Cubrix, einer CAD-App für den 3D-Druck für Einsteiger. Antworte auf Deutsch, freundlich und knapp.

Koordinaten: Millimeter, Z zeigt nach oben, das Druckbett liegt bei Z = 0 und ist um den Ursprung zentriert (${doc.printer.name}, ${doc.printer.volume.join(" × ")} mm, also X/Y von −${doc.printer.volume[0] / 2} bis +${doc.printer.volume[0] / 2}). Die Position eines Grundkörpers ist die Mitte seiner Unterseite; neue Körper stehen auf dem Bett. Kugeln liegen auf dem Bett auf.

Arbeitsweise (schnell und mit wenigen Aufrufen):
- Ändere das Modell ausschließlich über die Werkzeuge. Jede Änderung landet im Verlauf.
- Arbeite in drei Schritten:
  1. PLAN: Liste vor dem ersten Werkzeug kurz die Teile mit echten Maßen auf (Stückliste). Bei realen Produkten nimm Datenblatt-Maße (Websuche, falls unsicher) statt Schätzungen. Lege den Aufbau fest: Bezugsteil, Reihenfolge, was gefast, gerundet oder gebohrt wird.
  2. BAUEN: Möglichst alles in EINEM shapes__createMany: Teile bauen aufeinander auf (on: "Platine"), Reihen über repeat oder grid statt Einzelteilen, Farbe, Material, edges und holes direkt am Teil, groupName für das Ganze. Danach nur noch, was der Batch nicht kann (object__pocket, text__create, boolean__*).
  3. PRÜFEN: Rufe am Ende check_model auf, behebe, was es meldet, und miss kritische Abstände mit measure. Wenn ein Viewport-Bild verfügbar ist, kontrolliere mit get_screenshot das Aussehen. Überlappungen innerhalb einer Gruppe sind erlaubt (Pins in der Platine).
- Du kannst mehrere Werkzeuge in einer Antwort aufrufen.
- Nutze Sammelbefehle, nie Schleifen über Einzelaufrufe: shapes__createMany (viele Körper auf einmal), object__pattern (linear/grid/circular/mirror), objects__transformMany, object__delete mit ids, boolean__subtract/union/intersect mit targetId und toolIds (alle Werkzeuge in einem Schnitt).
- Das aktuelle Modell steht unten; get_model nur, wenn du Details brauchst. get_screenshot nur zur Endkontrolle, falls nötig.
- Aufräumen zuerst: Entscheide vor dem ersten Bauschritt, was ersetzt wird. Wird ein vorhandenes Objekt nicht mehr gebraucht, lösche es im ERSTEN Aufruf (object__delete) und baue erst dann; merkst du es später, lösche sofort, nie erst am Ende. Der unveränderte Start-Würfel (20-mm-Quader „Quader 1“ als einziges Objekt) ist nur ein Platzhalter: Bei einem Auftrag für etwas Neues löschst du ihn zuerst, außer die Nachricht bezieht sich auf ihn („mach daraus …“, „nimm den Würfel als Basis“). Was der Nutzer als Ausgangspunkt nennt, bleibt.
- Beispiel Spielwürfel aus dem Start-Würfel („mach daraus einen Spielwürfel“): Würfel behalten, fillet, dann EIN shapes__createMany mit allen 21 Augen-Kugeln (Positionen auf den 6 Seiten), dann EIN boolean__subtract mit toolIds = alle Augen. Fertig in 3 Aufrufen.
- Beispiel „Mach mir einen Schlüsselanhänger“ bei nur dem Start-Würfel: erst object__delete auf den Würfel, dann sketch__roundedRect mit height, Loch per Zylinder und boolean__subtract.
${webSearch ? `- Websuche: NUR wenn die Aufgabe aktuelle oder reale Fakten braucht, die du nicht sicher weißt (z. B. exakte Maße eines bestimmten Produkts wie Platine, Lochabstände und Anschlüsse des neuesten Raspberry Pi, Normen, Datenblätter). Nicht für allgemeines Modellieren (Würfel, Box, Halter mit genannten Maßen: ohne Suche). Höchstens 3 Suchen; web_fetch (falls vorhanden) nur, um eine gefundene Seite mit den Maßen (Datenblatt, Maßzeichnung) ganz zu lesen. Nenne vor dem Bauen kurz die gefundenen Maße und die Quelle.
` : ""}- Runde Formen IMMER als echte Kurven: sketch__ellipse, sketch__roundedRect, sketch__slot, sketch__path mit arc/spline-Segmenten, Kreise. Nie Rundungen durch Linienzüge/Vielecke annähern. Runde Umrisse über corner (2D) bzw. sketch__roundCorners, nicht über 3D-Kantenrundung. Beispiel ovaler Anhänger: sketch__ellipse (rx, ry, height 3), Loch per Zylinder + boolean__subtract.
- Mehrteilige Dinge (z. B. „Bau mir ein ESP32-Modell“: Platine, Chips, Pins, USB-Buchse) kommen IMMER in eine benannte Gruppe (z. B. „ESP32 DevKit“): shapes__createMany mit groupName oder danach group__create. Gruppen sind reine Ordner, keine Booleschen Operationen.
- Bohrungen: object__hole (viele Positionen in at, Tiefe, Senkung, thread für Kernlöcher), nicht einzelne Zylinder abziehen. Ausschnitte, Falze, Dome und Stege: object__pocket (cut/add) auf einer Fläche. Beide sind nachträglich änderbar.
- Echtheit: Reale Teile bekommen reale Details und Farben: Leiterplatte #1f6b45 glossy mit 1,6 mm Dicke und Montagelöchern, Blechschirme und USB-Buchsen #b9c0c5 metal, ICs #1c1e20 matte, vergoldete Pins #d9b24c metal im 2,54-mm-Raster, Taster #2a2c2f. Gehäuse: Wand ≥ 1,6 mm, Deckel mit 0,2 mm Spiel und umlaufendem Falz (object__pocket add), Schrauben M3 mit Kernloch.
- Beispiel ESP32 DevKit (Stückliste zuerst, dann ein Aufruf): Platine box 54×28×1,6 glossy grün mit edges vertical 1 mm und holes in den Ecken; WROOM-Modul on Platine 18×25,5×0,8 dunkel, darauf Schirm 16×18×2,4 metal; micro-USB on Platine am Rand; zwei Taster; Pinleisten als repeat (count 15, step [2.54,0,0]) mit Kunststoffleiste und Pins; alles mit groupName "ESP32 DevKit".
- Nur bestimmte Kanten runden oder fasen: edges__fillet / edges__chamfer mit filter (z. B. "top" für eine weiche Oberkante, "vertical" für runde Gehäuseecken) statt object__fillet, das ALLE Kanten trifft.
- Gefäße und Gehäuse: Box/Becher per object__shell (Wandstärke, open "top") statt Innenkörper abzuziehen. Runde Gefäße (Vase, Becher, Flasche, Knopf): halbes Querschnittsprofil rechts der Achse mit sketch__path zeichnen (Y = Höhe), dann sketch__revolve, dann object__shell.
- Für den 3D-Druck: Wände mindestens 1,2 mm, Überhänge über 45° vermeiden, Teile flach aufs Bett legen.
- Fragen zur App beantwortest du anhand dieser Hilfe-Themen:
${help}

Aktuelles Modell (id typ "name" pos=Fußpunkt size=B×T×H in mm):
${sceneSummary()}`;
}

export interface AgentEvents {
  onText(delta: string): void;
  /** What is happening right now, in plain German ("Denkt nach …", "Erstellt 21 Formen …"). */
  onPhase?(phase: string): void;
  /** Web sources the model used (shown as links under the answer). */
  onSources?(sources: { url: string; title: string }[]): void;
  onStep(step: { label: string; nodeId?: string; ok: boolean; error?: string }): void;
}

/** Hook for viewport screenshots (set by the viewport). */
export let captureViewport: () => Promise<string | null> = async () => null;
export function setCaptureViewport(fn: () => Promise<string | null>) {
  captureViewport = fn;
}

async function runCommand(id: string, params: Record<string, unknown>, group: { id: string; prompt: string }, events: AgentEvents) {
  const cmd = getCommand(id);
  if (!cmd) throw new Error(`Unbekannter Befehl ${id}`);
  const before = useApp.getState().currentId;
  // Scene-changing commands light up the viewport glow (read-only tools don't).
  if (cmd.kind === "document") {
    markModeling();
    // Commands may measure what the previous one built.
    await settleGeometry(getDoc());
  }
  await execute(id, params, { source: "ai", group, throwErrors: true });
  // A step the kernel can't build must reach the model as an error, not end up silently undone.
  if (cmd.kind === "document" && useApp.getState().currentId !== before) {
    const errors = await settleGeometry(getDoc());
    if (errors.length) throw new Error(errors[0]);
  }
  const after = useApp.getState().currentId;
  const node = after !== before ? useApp.getState().nodes[after] : undefined;
  events.onStep({ label: node?.label ?? cmd.label, nodeId: node?.id, ok: true });
  // New objects are reported by id so the model can refer to them (the UI selection stays the user's).
  const created = node && node.parentId ? node.doc.features.filter((f) => !useApp.getState().nodes[node.parentId!].doc.features.some((g) => g.id === f.id)).map((f) => ({ id: f.id, name: f.name })) : [];
  // Compact on purpose: the model already gets the scene summary each turn.
  return created.length ? { ok: true, created } : { ok: true, changed: !!node };
}

/** Plain-German activity for a tool call. */
export function phaseFor(name: string, input: Record<string, unknown>): string {
  const id = commandId(name);
  const n = (k: string) => (Array.isArray(input[k]) ? (input[k] as unknown[]).length : 0);
  if (id === "shapes.createMany") return `Erstellt ${n("shapes")} Formen …`;
  if (id === "boolean.subtract") return n("toolIds") > 1 ? `Schneidet ${n("toolIds")} Formen aus …` : "Schneidet aus …";
  if (id === "boolean.union") return "Verbindet Körper …";
  if (id === "boolean.intersect") return "Bildet die Schnittmenge …";
  if (id === "object.pattern") return "Erstellt ein Muster …";
  if (id === "object.fillet") return "Rundet Kanten ab …";
  if (id === "object.chamfer") return "Fast Kanten …";
  if (id.startsWith("primitive.")) return `Erstellt ${getCommand(id)?.label.replace(/ hinzufügen$/, "") ?? "Form"} …`;
  if (id.startsWith("text.")) return "Setzt Text …";
  if (name === "get_screenshot") return "Prüft das Ergebnis …";
  if (name === "get_model") return "Sieht sich das Modell an …";
  if (name === "measure") return "Misst nach …";
  if (name === "check_model") return "Prüft das Ergebnis …";
  if (name === "run_script") return "Führt mehrere Schritte aus …";
  return `${getCommand(id)?.label ?? id} …`;
}

async function runTool(block: Extract<Block, { type: "tool_use" }>, group: { id: string; prompt: string }, events: AgentEvents): Promise<Block> {
  events.onPhase?.(phaseFor(block.name, block.input));
  const result = (content: unknown, extra: Partial<Extract<Block, { type: "tool_result" }>> = {}): Block => ({
    type: "tool_result",
    tool_use_id: block.id,
    content: typeof content === "string" ? content : JSON.stringify(content),
    ...extra,
  });
  try {
    switch (block.name) {
      case "get_model":
        return result(modelSnapshot());
      case "list_commands":
        return result(listCommands().map((c) => ({ id: c.id, description: c.description })));
      case "get_screenshot": {
        const image = await captureViewport();
        return image ? result("Screenshot des Viewports.", { image }) : result("Kein Screenshot verfügbar.");
      }
      case "measure":
        return result(await measure(String(block.input.a), block.input.b ? String(block.input.b) : undefined));
      case "check_model":
        return result(await checkModel());
      case "run_script": {
        const steps = (block.input.steps as { command: string; params?: Record<string, unknown> }[]) ?? [];
        const done = [];
        for (const s of steps) done.push(await runCommand(s.command, s.params ?? {}, group, events));
        return result({ ok: true, steps: done.length, created: done.flatMap((d) => ("created" in d ? d.created : [])) });
      }
      default:
        return result(await runCommand(commandId(block.name), block.input, group, events));
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logError("ai", `Werkzeug ${block.name}: ${error}`, { tool: block.name, input: block.input });
    events.onStep({ label: commandId(block.name), ok: false, error });
    return result({ ok: false, error }, { isError: true });
  }
}

/** User turns kept in the model context (the visible chat keeps everything). */
export const CONTEXT_TURNS = 20;

const isPrompt = (m: Message) => m.role === "user" && m.content.some((b) => b.type === "text");

/**
 * Makes a history safe to send:
 * - keeps only the last `turns` user prompts (cut at a prompt, so tool pairs stay whole);
 * - every tool_use gets a tool_result in the following user message (a stopped run
 *   leaves calls without results, which both APIs reject with HTTP 400);
 * - tool_results without a matching call and empty text blocks are dropped;
 * - empty messages are removed.
 */
export function prepareHistory(messages: Message[], turns = CONTEXT_TURNS): Message[] {
  const prompts = messages.map((m, i) => (isPrompt(m) ? i : -1)).filter((i) => i >= 0);
  const start = prompts.length > turns ? prompts[prompts.length - turns] : 0;
  const src = messages.slice(start);
  const out: Message[] = [];
  for (let i = 0; i < src.length; i++) {
    const m = src[i];
    if (m.role === "assistant") {
      const content = m.content.filter((b) => !(b.type === "text" && !b.text.trim()));
      if (!content.length) continue;
      out.push({ role: "assistant", content, ...(m.model ? { model: m.model } : {}) });
      const calls = content.filter((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use").map((b) => b.id);
      if (!calls.length) continue;
      // The answers must come right after the calls.
      const next = src[i + 1];
      const given = next?.role === "user" ? next.content.filter((b) => b.type === "tool_result" && calls.includes(b.tool_use_id)) : [];
      const answered = new Set(given.map((b) => (b as Extract<Block, { type: "tool_result" }>).tool_use_id));
      const missing: Block[] = calls
        .filter((id) => !answered.has(id))
        .map((id) => ({ type: "tool_result", tool_use_id: id, content: JSON.stringify({ ok: false, error: "Abgebrochen" }), isError: true }));
      const rest = next?.role === "user" ? next.content.filter((b) => b.type !== "tool_result" && !(b.type === "text" && !b.text.trim())) : [];
      out.push({ role: "user", content: [...given, ...missing, ...rest] });
      if (next?.role === "user") i++;
      continue;
    }
    // A user message not answering calls: orphaned results go.
    const content = m.content.filter((b) => b.type !== "tool_result" && !(b.type === "text" && !b.text.trim()));
    if (content.length) out.push({ role: "user", content });
  }
  // The context must not start with an assistant message.
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

export async function runAgent(opts: {
  provider: Provider;
  model: string;
  /** Reasoning depth, or null when the model has no such setting. */
  effort?: Effort | null;
  transport: Transport;
  history: Message[];
  prompt: string;
  signal: AbortSignal;
  events: AgentEvents;
  maxTurns?: number;
  /** History group id for this run (to undo the whole run at once). */
  groupId?: string;
  /** Offer the provider's server-side web search (the model decides when to use it). */
  webSearch?: boolean;
}): Promise<Message[]> {
  const group = { id: opts.groupId ?? Math.random().toString(36).slice(2), prompt: opts.prompt };
  const messages: Message[] = [...prepareHistory(opts.history), { role: "user", content: [{ type: "text", text: opts.prompt }] }];
  const tools = buildTools();
  for (let turn = 0; turn < (opts.maxTurns ?? 16); turn++) {
    if (opts.signal.aborted) break;
    opts.events.onPhase?.(turn === 0 ? "Denkt nach …" : "Plant den nächsten Schritt …");
    const res = await runTurn(opts.provider, opts.transport, opts.model, opts.effort ?? null, systemPrompt(opts.webSearch), tools, prepareHistory(messages), opts.events.onText, opts.signal, opts.webSearch);
    messages.push({ role: "assistant", content: res.blocks, model: opts.model });
    for (const q of res.searches ?? []) opts.events.onStep({ label: `Sucht im Web: ${q}`, ok: true });
    if (res.sources?.length) opts.events.onSources?.(res.sources);
    // Long server-tool turns (web search) may pause; just continue the conversation.
    if (res.stop === "pause") continue;
    const calls = res.blocks.filter((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use");
    if (!calls.length || res.stop !== "tool_use") break;
    const results: Block[] = [];
    for (const c of calls) {
      if (opts.signal.aborted) break;
      results.push(await runTool(c, group, opts.events));
    }
    messages.push({ role: "user", content: results });
  }
  // Stopped mid-run: close any open tool calls so the saved history stays valid.
  return prepareHistory(messages, Infinity);
}
