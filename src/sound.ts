/**
 * The rotors, heard. A propeller's sound is mostly its blade-pass frequency: two blades, so twice its turns a second,
 * with the harmonics of a sawtooth, plus the rush of air each blade pushes. At speed that is a hum (about 210 Hz at
 * 6,300 rpm); in slow motion, played at the scene's own pace, it falls below hearing and the air comes apart into the
 * separate whup of each blade going by.
 */
export type Sound = { start: () => void; stop: () => void; set: (rpm: number, rate: number) => void; close: () => void };

export function createSound(): Sound {
  let ctx: AudioContext | null = null;
  let nodes: { master: GainNode; tone: GainNode; oscs: OscillatorNode[]; chop: OscillatorNode; air: GainNode; depth: GainNode } | null = null;
  let want = { rpm: 0, rate: 1 }, on = false;

  function build(c: AudioContext) {
    const master = c.createGain();
    master.gain.value = 0;
    master.connect(c.destination);
    // the hum: two sawtooths a hair apart (four rotors never turn at exactly one speed), softened
    const tone = c.createGain();
    tone.gain.value = 0;
    const soft = c.createBiquadFilter();
    soft.type = "lowpass"; soft.frequency.value = 1400; soft.Q.value = 0.7;
    tone.connect(soft).connect(master);
    const oscs = [0.996, 1.004].map(k => {
      const o = c.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = 0;
      (o as OscillatorNode & { k: number }).k = k;
      o.connect(tone);
      o.start();
      return o;
    });
    // the air: noise, beaten at the blade-pass frequency
    const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const noise = c.createBufferSource();
    noise.buffer = buf; noise.loop = true;
    const band = c.createBiquadFilter();
    band.type = "bandpass"; band.frequency.value = 900; band.Q.value = 0.6;
    const air = c.createGain();
    air.gain.value = 0;
    const depth = c.createGain();
    depth.gain.value = 0;
    const chop = c.createOscillator();
    chop.type = "sine"; chop.frequency.value = 0;
    chop.connect(depth).connect(air.gain);
    noise.connect(band).connect(air).connect(master);
    noise.start(); chop.start();
    return { master, tone, oscs, chop, air, depth };
  }

  function apply(fade = 0.08) {
    if (!ctx || !nodes) return;
    const t = ctx.currentTime;
    const bpf = (2 * want.rpm) / 60 * want.rate;                 // blade passes a second, at the scene's pace
    const level = Math.pow(Math.min(1, want.rpm / 9000), 1.4);
    const audible = Math.min(1, Math.max(0, (bpf - 25) / 40));     // the hum fades out below about 30 Hz
    for (const o of nodes.oscs) o.frequency.setTargetAtTime(Math.max(0, bpf) * (o as OscillatorNode & { k: number }).k, t, fade / 2);
    nodes.tone.gain.setTargetAtTime(0.11 * level * audible, t, fade);
    nodes.chop.frequency.setTargetAtTime(bpf, t, fade / 2);
    // slow: each blade is a whup with silence between; fast: a steady rush
    const slow = 1 - audible;
    nodes.air.gain.setTargetAtTime(level * (0.05 + 0.1 * slow), t, fade);
    nodes.depth.gain.setTargetAtTime(level * (0.02 + 0.14 * slow), t, fade);
    nodes.master.gain.setTargetAtTime(on ? 0.9 : 0, t, on ? 0.12 : 0.06);
  }

  return {
    start() {
      if (!ctx) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        ctx = new AC();
        nodes = build(ctx);
      }
      void ctx.resume();
      on = true;
      apply(0.02);
    },
    stop() { on = false; apply(); },
    set(rpm, rate) { want = { rpm, rate }; if (on) apply(); },
    close() { void ctx?.close(); ctx = null; nodes = null; },
  };
}
