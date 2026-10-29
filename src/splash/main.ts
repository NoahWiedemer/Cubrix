// Boot splash: a still image (src/assets/splash/splash.webp, 1280 × 800 for the 640 × 400 window), logo + wordmark,
// a small mint spinner and the version. Fades out once the app reports ready.
import "./splash.css";
import pkg from "../../package.json";
import image from "../assets/splash/splash.webp";
import logo from "../assets/brand/modelonio-logo-ohne-hintergrund-256.png";

const MIN_MS = 800;
const shownAt = performance.now();

document.getElementById("splash")!.innerHTML = `
<div class="card" id="card">
  <img class="backdrop" src="${image}" alt="" />
  <div class="shade"></div>
  <div class="brand"><img src="${logo}" alt="" /><div class="word">Cubrix</div></div>
  <div class="corner"><span class="version">${pkg.version}</span><svg class="spinner" viewBox="0 0 20 20" aria-label="Lädt"><circle cx="10" cy="10" r="8"/></svg></div>
</div>`;

let finished = false;
async function finish() {
  if (finished) return;
  finished = true;
  const wait = Math.max(0, MIN_MS - (performance.now() - shownAt));
  setTimeout(() => {
    document.getElementById("card")!.classList.add("out");
    setTimeout(async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      void invoke("splash_finished");
    }, 220);
  }, wait);
}

if ("__TAURI_INTERNALS__" in window) {
  void import("@tauri-apps/api/event").then(({ listen }) => {
    void listen<string>("boot-progress", ({ payload }) => {
      if (payload === "ready") void finish();
    });
  });
}
