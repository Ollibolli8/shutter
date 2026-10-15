# Shutter

A drone filmed by a phone. A phone's sensor doesn't take a frame all at once: it reads one row at a time, top to
bottom, so each row sees the propellers a moment later than the row above. Spin the rotors up and the camera bends
them, breaks them off their hubs and, at some speeds, stops them dead.

**[Live demo](https://ollibolli8.github.io/shutter/)** · Maquette 03 on [work.draindk.tech](https://work.draindk.tech/lab/shutter/)

three.js and GLSL in one TypeScript file, plus the settings and a synthesized sound.

## How it works

Nothing fakes the look. The drone's body is drawn as usual: in the few milliseconds a readout takes it hardly moves.
Each rotor is a flat disc, and the disc's fragment shader works out, per pixel:

- **When its row was read.** `row × readout`, measured down the frame. A global shutter (readout 0) reads every row
  at once and the blades come out straight.
- **Where the blades were then.** The rotor's angle at that instant, from its speed and the frame's start; the pixel
  is turned back by that angle into the blades' rest pose.
- **What the shutter saw while it was open.** The pixel averages the blades over the exposure, enough samples that no
  step shows (`ceil(ω × exposure / 0.012 rad)`, up to 48). 1/16000, a phone in daylight, gives crisp bent blades;
  1/250 smears them; 1/30 turns them into a disc.

The blades are baked once per rotor, seen along its axis by an orthographic camera, into two half-float pictures: their
colour and their normals. The shader samples them with an explicit level of detail (the derivatives taken once, outside
the loop), turns the normal forward to the blade's angle, and lights it with the same sun, sky and reflection as the
body.

**Time** is a camera's. The page shows the last frame the virtual camera recorded at 30 fps, so it draws only when
there is a new one. **Slow motion** runs the scene 250 times slower and shows the readout in progress: rows above the
line hold the new frame, rows below it the last one, and the true blades are outlined so you can see what the sensor
is missing.

**What the recording shows** follows from the blade passes per frame, `2 × rpm / 60 / fps`: a whole number and the
blades stand still (every 900 rpm at 30 fps), a half and there seem to be four, just under a whole number and they
turn backwards. The demo marks those speeds on the Rotor dial.

**Sound** (`src/sound.ts`, off until turned on): synthesized, no samples. The blade-pass frequency as two detuned
sawtooths (about 210 Hz at 6,300 rpm), and noise beaten at the same rate for the air. Played at the scene's pace,
slow motion drops the hum below hearing and the air comes apart into the whup of each blade.

The real-time view draws at the camera's 30 fps; slow motion at 60 at most. With reduced motion, time stands still
and each change of a setting takes a new photo. Without WebGL, or if the context is lost, `onFail` is called so the
page can show a still.

## Use it

```ts
import { createShutter } from "./src/core";

const shutter = createShutter({
  canvas: document.querySelector("canvas"),
  model: "terne.glb",          // rotors are nodes named TX_motor_*, holding blades named TX_blade_*
  draco: "draco/",             // DRACOLoader's decoder
  still: matchMedia("(prefers-reduced-motion: reduce)").matches,
  onFail: () => showStill(),
});
shutter.set({ rpm: 6300, readout: 0.02, exposure: 1 / 16000, slow: false });
```

`region` places the drone (a box in -1..1 that its outline is fitted into), `materials` swaps in your own materials by
name, `onLine` reports the readout's progress in slow motion, `onSpin` the rotors' speed as they spool.

## Build the demo

```sh
npm install
npm run build   # docs/ (GitHub Pages)
npm run dev     # build and serve
```

## Licence

MIT, Oliver Kure Olsen, 2026. The drone is Terne X, modelled by script in Blender for a case on work.draindk.tech, and
is under the same licence. `docs/draco/` is Google's Draco decoder (Apache 2.0), copied from three.js at build time.
