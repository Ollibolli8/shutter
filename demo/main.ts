import "./style.css";
import { createShutter, DEFAULTS, SLOW, type Region } from "../src/core";
import { apparent } from "../src/settings";
import { createSound } from "../src/sound";
import { createDial } from "./dial";

/** Shutter speeds a camera offers, as 1/x of a second. */
const SPEEDS = [16000, 8000, 4000, 2000, 1000, 500, 250, 125, 60, 30];
/** Speeds at which a 30 fps recording shows the blades standing still: one blade pass a frame, or a whole number of them. */
const STILL_AT = Array.from({ length: 10 }, (_, i) => (i + 1) * 900);

/** What the recording shows at this speed, in a few words. */
function seen(rpm: number) {
  if (rpm < 200) return "";
  const a = apparent(rpm, DEFAULTS.fps);
  if (a < 0.015 || a > 0.985) return "Stands still";
  if (Math.abs(a - 0.5) < 0.02) return "Four blades";
  if (a > 0.55) return "Turns backwards";
  return "";
}

const root = document.querySelector<HTMLElement>(".sh")!;
const canvas = root.querySelector<HTMLCanvasElement>("canvas")!;
const line = root.querySelector<HTMLElement>(".sh-line")!;
const dials = root.querySelector<HTMLElement>(".sh-dials")!;
const [slowBtn, soundBtn] = root.querySelectorAll<HTMLButtonElement>(".sh-button");
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
let still = reduced.matches, hidden = false, slow = false, spin = DEFAULTS.rpm;
const settings = { rpm: DEFAULTS.rpm, readout: DEFAULTS.readout, speed: SPEEDS.indexOf(Math.round(1 / DEFAULTS.exposure)) };
const sound = createSound();
let soundOn = false;

// The drone sits in the sky the type leaves: beside the text on a wide screen, between the text and the dials on a
// tall one (measured, so a longer line or a short phone still frames it clear of both).
function region(w: number, h: number): Region {
  const c = canvas.getBoundingClientRect();
  // the type at the top of the frame (a short phone moves the paragraph below the frame, out of the way)
  let right = 0, bottom = 0;
  root.querySelectorAll(".sh-head > *").forEach(e => {
    const r = e.getBoundingClientRect();
    if (r.height && r.top - c.top < h * 0.6) { right = Math.max(right, r.right); bottom = Math.max(bottom, r.bottom); }
  });
  const low = dials.getBoundingClientRect();
  const y = (px: number) => 1 - (2 * (px - c.top)) / h, x = (px: number) => -1 + (2 * (px - c.left)) / w;
  if (h > w * 1.1) return { x0: -0.86, x1: 0.86, y0: y(low.top - 18), y1: y(bottom + 14) };
  const above: Region = { x0: x(right + 40), x1: 0.92, y0: y(low.top - 18), y1: 0.8 };
  // a tablet held sideways: the dials stand in a column under the text, so the drone may take the sky right of both,
  // down to the footer, where that gives it more room than the sky above the dials
  const foot = root.querySelector(".sh-foot")!.getBoundingClientRect();
  const beside: Region = { x0: x(Math.max(right, low.right) + 40), x1: 0.92, y0: Math.max(-0.9, y(foot.top - 18)), y1: 0.8 };
  const room = (r: Region) => Math.min((r.x1 - r.x0) * w, (r.y1 - r.y0) * h);
  return room(beside) > room(above) ? beside : above;
}

const coarse = matchMedia("(pointer: coarse)").matches;
let cam: ReturnType<typeof createShutter> | null = null;
const fail = () => { root.dataset.gl = "off"; };
try {
  cam = createShutter({
    canvas, model: "terne.glb", draco: "draco/", region, still,
    pixelRatio: Math.min(devicePixelRatio || 1, coarse ? 1.5 : 2),
    onReady: () => { root.dataset.gl = "on"; void document.fonts?.ready.then(() => cam?.refit()); },
    onFail: fail,
    onSpin: r => { spin = r; if (soundOn) sound.set(r, rate()); },
    onLine: row => {
      line.hidden = row === null;
      if (row !== null) line.style.transform = `translate3d(0,${row * canvas.clientHeight}px,0)`;
    },
  });
} catch { fail(); }

const rate = () => (still || hidden ? 0 : slow ? SLOW : 1);
function apply() {
  cam?.set({ rpm: settings.rpm, readout: settings.readout, exposure: 1 / SPEEDS[settings.speed], slow: slow && !still });
  if (soundOn) sound.set(spin, rate());
}

const rotor = createDial({
  label: "Rotor", value: settings.rpm, min: 0, max: 9000, step: 25, gap: 2, every: 40, draw: 4, marks: STILL_AT,
  format: v => `${v.toLocaleString("en-GB")} rpm`, note: seen,
  onChange: v => { settings.rpm = v; apply(); },
});
const readout = createDial({
  label: "Readout", value: settings.readout, min: 0, max: 0.033, step: 0.0005, gap: 6, every: 10,
  format: s => (s === 0 ? "Global" : `${(s * 1000).toFixed(1)} ms`),
  spoken: s => (s === 0 ? "Global shutter, every row at once" : `${(s * 1000).toFixed(1)} milliseconds top to bottom`),
  note: s => (s === 0 ? "Every row at once" : ""),
  onChange: v => { settings.readout = v; apply(); },
});
const speed = createDial({
  label: "Shutter", value: settings.speed, min: 0, max: SPEEDS.length - 1, step: 1, gap: 22, every: 1,
  format: i => `1/${SPEEDS[i]}`, spoken: i => `1/${SPEEDS[i]} of a second`,
  onChange: v => { settings.speed = v; apply(); },
});
dials.prepend(rotor.el, readout.el, speed.el);

function showButtons() {
  slowBtn.disabled = still;
  slowBtn.setAttribute("aria-pressed", String(slow && !still));
  soundBtn.setAttribute("aria-pressed", String(soundOn));
  soundBtn.textContent = soundOn ? "Sound on" : "Sound off";
  root.toggleAttribute("data-slow", slow && !still);
}
slowBtn.addEventListener("click", () => { slow = !slow; showButtons(); apply(); });
// the audio starts inside the tap itself: iOS Safari only lets a page make sound from a gesture
soundBtn.addEventListener("click", () => {
  soundOn = !soundOn;
  if (soundOn) { sound.start(); sound.set(spin, rate()); } else sound.stop();
  showButtons();
});
reduced.addEventListener("change", e => { still = e.matches; cam?.setStill(still || hidden); showButtons(); apply(); });
// offscreen or in another tab the camera stops, and so does the sound
new IntersectionObserver(([e]) => { hidden = !e.isIntersecting; cam?.setStill(still || hidden); if (soundOn) sound.set(spin, rate()); }, { threshold: 0.05 }).observe(root);
document.addEventListener("visibilitychange", () => { if (document.hidden && soundOn) { soundOn = false; sound.stop(); showButtons(); } });
showButtons();
