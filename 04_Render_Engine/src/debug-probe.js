/**
 * Debug Probe — GPU/JS resource sampler for the P3f freeze hunt.
 *
 * WHY THIS EXISTS AT ALL:
 * The "frozen picture, sound still playing" bug has now survived two soak tests
 * because both measured the wrong thing in the wrong place:
 *   1. `performance.memory` measures the JS heap. The suspected leak is GPU-side
 *      (geometries/textures/programs never released), which the JS heap cannot
 *      see — a leaked WebGL buffer costs a few dozen JS bytes and megabytes of
 *      VRAM. three.js already counts exactly what we need in `renderer.info`,
 *      so this file is a sampler, not an accountant (ponytail Rung 4).
 *   2. Both runs kept their samples on `window`. When the tab actually died the
 *      page auto-reloaded, `window` was rebuilt empty, and the entire run's
 *      evidence went with it — which is why both attempts read "inconclusive"
 *      rather than "leak" or "no leak". Samples therefore go to localStorage,
 *      which outlives a renderer-process crash, and every sample is stamped
 *      with a boot id so a reload is visible IN the data instead of having to
 *      be inferred from Vite's log.
 *
 * Off unless the URL carries `?debug` — a shipping player pays one boolean.
 */

const KEY_SAMPLES = 'rb.probe.samples';
const KEY_BOOTS = 'rb.probe.boots';
const MAX_SAMPLES = 400; // ~66 min at the 10s default; bounded so storage cannot grow forever

export const DEBUG_ON = typeof location !== 'undefined' && /(\?|&)debug\b/.test(location.search);

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback; // corrupt or storage-disabled — a debug tool must never break the game
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota or private mode — sampling continues to console only */
  }
}

/**
 * The boot this page is running as. A fresh page = a fresh boot id, so if this
 * climbs while nobody navigated, the tab restarted itself — the signature of a
 * renderer crash + auto-recover. `navType` separates an auto-recover ('reload')
 * from a normal first visit ('navigate'), which is the exact ambiguity that made
 * the second soak attempt unreadable.
 */
let currentBoot = null;

function registerBoot() {
  const boots = readJson(KEY_BOOTS, []);
  const nav = performance.getEntriesByType('navigation')[0];
  currentBoot = {
    bootId: boots.length + 1,
    at: new Date().toISOString(),
    navType: nav ? nav.type : 'unknown',
  };
  boots.push(currentBoot);
  writeJson(KEY_BOOTS, boots);
}

/**
 * Start sampling. Returns a `tick` to call once per rendered frame (used only to
 * derive real fps — rAF timestamps alone cannot tell a slow frame from a dropped one).
 *
 * @param {object} rb        the Renderer wrapper (owns .renderer, .scene, .meshes)
 * @param {number} intervalMs sampling period
 */
export function startProbe(rb, intervalMs = 10000) {
  if (!DEBUG_ON) return () => {};

  registerBoot();
  console.info(`[probe] boot #${currentBoot.bootId} (navigation: ${currentBoot.navType})`);

  let frames = 0;
  let lastSampleAt = performance.now();
  const startedAt = performance.now();

  // Peak live-particle counts SINCE THE LAST SAMPLE, not at the sampling instant.
  // A drift lasts under a second, so a 10-second snapshot would read 0 almost every
  // time and prove nothing. Peaks also make a leak in `liveCount` itself visible: if
  // the bookkeeping in ParticleSystem.emit ever drifts upward, these stop returning
  // to 0 and the idle skip is silently dead.
  let smokePeak = 0;
  let flamePeak = 0;

  setInterval(() => {
    const now = performance.now();
    const info = rb.renderer.info;
    const heap = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1;

    const sample = {
      b: currentBoot.bootId,
      t: Math.round((now - startedAt) / 1000),
      geo: info.memory.geometries,
      tex: info.memory.textures,
      prog: info.programs ? info.programs.length : -1,
      calls: info.render.calls,
      tris: info.render.triangles,
      kids: rb.scene.children.length,
      meshes: rb.meshes.size,
      heapMB: heap,
      fps: Math.round((frames * 1000) / (now - lastSampleAt)),
      sPk: smokePeak,
      fPk: flamePeak,
      sLive: rb.smokeSystem ? rb.smokeSystem.liveCount : -1,
      fLive: rb.flameSystem ? rb.flameSystem.liveCount : -1,
    };

    frames = 0;
    smokePeak = 0;
    flamePeak = 0;
    lastSampleAt = now;

    const samples = readJson(KEY_SAMPLES, []);
    samples.push(sample);
    // Ring the buffer rather than let a long soak blow the 5MB storage quota.
    writeJson(KEY_SAMPLES, samples.slice(-MAX_SAMPLES));

    console.info(
      `[probe] b${sample.b} t=${sample.t}s geo=${sample.geo} tex=${sample.tex} ` +
        `prog=${sample.prog} calls=${sample.calls} kids=${sample.kids} ` +
        `meshes=${sample.meshes} heap=${sample.heapMB}MB fps=${sample.fps} ` +
        `smokePk=${sample.sPk} flamePk=${sample.fPk} live=${sample.sLive}/${sample.fLive}`
    );
  }, intervalMs);

  return () => {
    frames++;
    if (rb.smokeSystem && rb.smokeSystem.liveCount > smokePeak) smokePeak = rb.smokeSystem.liveCount;
    if (rb.flameSystem && rb.flameSystem.liveCount > flamePeak) flamePeak = rb.flameSystem.liveCount;
  };
}

/** Console helper: `rbProbe()` dumps the full surviving series, crash or not. */
if (DEBUG_ON && typeof window !== 'undefined') {
  window.rbProbe = () => ({ boots: readJson(KEY_BOOTS, []), samples: readJson(KEY_SAMPLES, []) });
  // WHY reset RE-REGISTERS instead of just clearing: the boots list is the crash
  // signal, and it is only readable if it always contains the boot that is running
  // right now. A plain clear left it empty, so a mid-run reset (starting a fresh
  // experiment without reloading) silently destroyed the very evidence the probe
  // exists to preserve. Found by using it.
  window.rbProbeReset = () => {
    localStorage.removeItem(KEY_SAMPLES);
    localStorage.removeItem(KEY_BOOTS);
    registerBoot();
    return { boots: readJson(KEY_BOOTS, []) };
  };
}
