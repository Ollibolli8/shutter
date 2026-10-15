/**
 * A camera app's pro-mode dial: the scale slides under a fixed needle, by drag, wheel or keys. The value is a position on
 * the scale (an index for stepped scales such as shutter speeds). Marks are places on the scale worth finding.
 */
export type DialOptions = {
  label: string;
  value: number;
  min: number;
  max: number;
  /** One step: a tick, an arrow key. */
  step: number;
  /** Pixels a step takes on the scale. */
  gap: number;
  /** Every how many steps the tick is long. */
  every?: number;
  /** Every how many steps a tick is drawn (a fine scale steps finer than it shows). */
  draw?: number;
  format: (v: number) => string;
  /** The value as words for a screen reader. */
  spoken?: (v: number) => string;
  /** A short note beside the value. */
  note?: (v: number) => string;
  marks?: number[];
  onChange: (v: number) => void;
};

let ids = 0;

export function createDial(o: DialOptions) {
  const id = `dial-${++ids}`;
  let value = o.value, disabled = false;
  const root = document.createElement("div");
  root.className = "dial";
  root.innerHTML = `<p class="dial-head"><span class="dial-label" id="${id}"></span><span class="dial-value"></span><span class="dial-note" hidden></span></p>
    <div class="dial-track" role="slider" tabindex="0" aria-labelledby="${id}" aria-valuemin="${o.min}" aria-valuemax="${o.max}">
      <div class="dial-scale"></div><span class="dial-needle" aria-hidden="true"></span></div>`;
  const $ = <T extends Element>(s: string) => root.querySelector(s) as T;
  $<HTMLElement>(".dial-label").textContent = o.label;
  const valueEl = $<HTMLElement>(".dial-value"), noteEl = $<HTMLElement>(".dial-note");
  const track = $<HTMLElement>(".dial-track"), scale = $<HTMLElement>(".dial-scale");
  const n = Math.round((o.max - o.min) / o.step), every = o.every ?? 10;
  let html = "";
  for (let i = 0; i <= n; i += o.draw ?? 1) html += `<i class="${i % every === 0 ? "dial-tick dial-tick-long" : "dial-tick"}" style="left:${i * o.gap}px"></i>`;
  for (const m of o.marks ?? []) html += `<b class="dial-mark" style="left:${((m - o.min) / o.step) * o.gap}px"></b>`;
  scale.innerHTML = html;

  const clamp = (v: number) => Math.min(o.max, Math.max(o.min, Math.round(v / o.step) * o.step));
  function show() {
    valueEl.textContent = o.format(value);
    const note = o.note?.(value) ?? "";
    noteEl.hidden = !note;
    noteEl.textContent = note;
    track.setAttribute("aria-valuenow", String(value));
    track.setAttribute("aria-valuetext", (o.spoken ?? o.format)(value));
    scale.style.transform = `translate3d(${-((value - o.min) / o.step) * o.gap}px,0,0)`;
  }
  function set(v: number) {
    const c = clamp(v);
    if (c === value) return;
    value = c;
    show();
    o.onChange(value);
  }

  let drag: { id: number; x: number; v: number } | null = null;
  track.addEventListener("pointerdown", e => {
    if (disabled) return;
    track.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, x: e.clientX, v: value };
    root.dataset.dragging = "";
  });
  track.addEventListener("pointermove", e => {
    if (drag && drag.id === e.pointerId) set(drag.v - ((e.clientX - drag.x) / o.gap) * o.step);
  });
  const end = () => { drag = null; delete root.dataset.dragging; };
  track.addEventListener("pointerup", end);
  track.addEventListener("pointercancel", end);
  track.addEventListener("wheel", e => {
    if (disabled) return;
    e.preventDefault();
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    set(value + Math.sign(d) * o.step);
  }, { passive: false });
  track.addEventListener("keydown", e => {
    if (disabled) return;
    const k = e.key, big = o.step * every;
    const v = k === "ArrowRight" || k === "ArrowUp" ? value + o.step : k === "ArrowLeft" || k === "ArrowDown" ? value - o.step
      : k === "PageUp" ? value + big : k === "PageDown" ? value - big : k === "Home" ? o.min : k === "End" ? o.max : null;
    if (v === null) return;
    e.preventDefault();
    set(v);
  });
  show();

  return {
    el: root,
    get value() { return value; },
    setDisabled(on: boolean) {
      disabled = on;
      track.tabIndex = on ? -1 : 0;
      if (on) { track.setAttribute("aria-disabled", "true"); root.dataset.disabled = ""; }
      else { track.removeAttribute("aria-disabled"); delete root.dataset.disabled; }
    },
  };
}
