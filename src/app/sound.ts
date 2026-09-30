// Sound: small synthesised effects (Web Audio, no audio files), in the same
// spirit as the procedural art. Reads game state once a frame and never
// changes it. Covers:
//   - the horse's hoofbeats, in step with the drawn walk / trot
//   - build menu clicks, a thunk when a building is placed, a chime when done
//   - each builder's hammer blow
//   - each finished building's everyday work (anvil, bell, creaking mill…)
//   - the farmer sowing and scything
//   - anything carried being picked up or put down (a sheaf, logs, stone)
// A sound that goes with something drawn happens on the frame it is seen:
// the hammer hits, the scythe sweeps, the bucket reaches the water. Those
// beats come from the same clock and rates as the animations in src/render
// (see `beat`), so change them together. Sounds with nothing to see (a
// house's fire, the tavern) just come now and then.
// World sounds are positioned relative to the rider: they pan left/right and
// fade out beyond EARSHOT.

import type { BuildingType } from '../game/buildings';
import type { Resource } from '../game/resources';
import { employees } from '../game/people';
import { RIDER_MAX_SPEED, getBuilding, type World } from '../game/world';
import { HORSE_STRIDE } from '../render';

export type UiSound = 'menuOpen' | 'menuMove' | 'menuClose' | 'toggle' | 'denied';

export interface Sound {
  /** Call once a frame, after update() and before events are drained. */
  frame(world: World, dt: number): void;
  ui(name: UiSound): void;
  /** Master volume 0..1. */
  volume: number;
  /** Returns whether sound is now muted. */
  toggleMute(): boolean;
}

/** World px from the rider beyond which a sound is silent. */
const EARSHOT = 900;

interface Voice {
  dur: number;
  gain: number;
  /** World x of the source; omit for UI sounds (centred, full volume). */
  x?: number;
  delay?: number;
  attack?: number;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export function createSound(initialVolume = 0.6): Sound {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let noiseBuf: AudioBuffer | null = null;
  let volume = initialVolume;
  let muted = false;
  let listenerX = 0;

  // Browsers only allow audio after a user gesture, so the context is created
  // (or resumed) on the first key or tap.
  const unlock = () => {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp).connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      applyVolume();
    }
    if (ctx.state !== 'running') void ctx.resume();
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  function applyVolume(): void {
    if (ctx && master) master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.02);
  }

  const live = () => ctx !== null && ctx.state === 'running';

  // --- Voices ---------------------------------------------------------------------

  /** Output node for a voice: distance-attenuated and panned, or null if out of earshot. */
  function route(v: Voice): AudioNode | null {
    if (!ctx || !master) return null;
    const g = ctx.createGain();
    const pan = ctx.createStereoPanner();
    let k = 1;
    if (v.x !== undefined) {
      const d = v.x - listenerX;
      k = Math.max(0, 1 - Math.abs(d) / EARSHOT);
      k *= k;
      if (k < 0.01) return null;
      pan.pan.value = Math.max(-0.9, Math.min(0.9, (d / EARSHOT) * 1.4));
    }
    g.gain.value = k;
    g.connect(pan).connect(master);
    return g;
  }

  function envelope(t: number, v: Voice): GainNode {
    const g = ctx!.createGain();
    const a = v.attack ?? 0.004;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v.gain, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(a + 0.01, v.dur));
    return g;
  }

  function tone(v: Voice & { freq: number; to?: number; type?: OscillatorType }): void {
    const out = route(v);
    if (!out) return;
    const t = ctx!.currentTime + (v.delay ?? 0);
    const o = ctx!.createOscillator();
    o.type = v.type ?? 'sine';
    o.frequency.setValueAtTime(v.freq, t);
    if (v.to) o.frequency.exponentialRampToValueAtTime(v.to, t + v.dur);
    o.connect(envelope(t, v)).connect(out);
    o.start(t);
    o.stop(t + v.dur + 0.05);
  }

  function noise(v: Voice & { filter: BiquadFilterType; freq: number; to?: number; q?: number }): void {
    const out = route(v);
    if (!out) return;
    const t = ctx!.currentTime + (v.delay ?? 0);
    const src = ctx!.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx!.createBiquadFilter();
    f.type = v.filter;
    f.Q.value = v.q ?? 1;
    f.frequency.setValueAtTime(v.freq, t);
    if (v.to) f.frequency.exponentialRampToValueAtTime(v.to, t + v.dur);
    src.connect(f).connect(envelope(t, v)).connect(out);
    src.start(t, Math.random() * 0.9);
    src.stop(t + v.dur + 0.05);
  }

  // --- The sounds -----------------------------------------------------------------

  const sfx = {
    hoof(x: number, k: number) {
      noise({ x, dur: 0.06, gain: 0.22 * k, filter: 'bandpass', freq: rnd(800, 1200), q: 3 });
      tone({ x, dur: 0.09, gain: 0.3 * k, freq: rnd(120, 150), to: 60 });
    },
    knock(x: number) {
      noise({ x, dur: 0.05, gain: 0.35, filter: 'bandpass', freq: rnd(1400, 2000), q: 6 });
      tone({ x, dur: 0.09, gain: 0.2, freq: rnd(280, 360), to: 200 });
    },
    thunk(x: number) {
      tone({ x, dur: 0.3, gain: 0.5, freq: 110, to: 50 });
      noise({ x, dur: 0.15, gain: 0.35, filter: 'lowpass', freq: 500 });
    },
    chime(x: number) {
      [523, 659, 784, 1047].forEach((f, i) => tone({ x, dur: 0.8, gain: 0.12, freq: f, type: 'triangle', delay: i * 0.09 }));
    },
    anvil(x: number, delay = 0) {
      const f = rnd(600, 660);
      [1, 2.76, 5.4].forEach((m) => tone({ x, delay, dur: 1.4 / m, gain: 0.12 / m, freq: f * m }));
      noise({ x, delay, dur: 0.03, gain: 0.2, filter: 'highpass', freq: 3000 });
    },
    bell(x: number, delay = 0) {
      const f = 330;
      [0.5, 1, 1.19, 1.5, 2, 2.74].forEach((m, i) => tone({ x, delay, dur: 3.5 - i * 0.4, gain: 0.08 / (1 + i * 0.4), freq: f * m }));
    },
    splash(x: number) {
      noise({ x, dur: 0.5, gain: 0.3, filter: 'lowpass', freq: 1400, to: 300, attack: 0.02 });
      tone({ x, dur: 0.08, gain: 0.08, freq: 1400, to: 700, delay: 0.55 });
      tone({ x, dur: 0.08, gain: 0.06, freq: 1300, to: 650, delay: 0.9 });
    },
    creak(x: number) {
      noise({ x, dur: 0.8, gain: 0.35, filter: 'bandpass', freq: 240, to: 380, q: 14, attack: 0.2 });
      tone({ x, dur: 0.8, gain: 0.02, freq: 85, to: 70, type: 'sawtooth', attack: 0.2 });
    },
    lute(x: number) {
      const scale = [294, 330, 370, 440, 494, 587];
      const n = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const f = scale[Math.floor(Math.random() * scale.length)];
        tone({ x, dur: 0.6, gain: 0.1, freq: f, type: 'triangle', delay: i * 0.22 });
        tone({ x, dur: 0.3, gain: 0.03, freq: f * 2, delay: i * 0.22 });
      }
    },
    clink(x: number, f = 2400) {
      tone({ x, dur: 0.15, gain: 0.06, freq: f });
      tone({ x, dur: 0.12, gain: 0.05, freq: f * 1.5, delay: 0.06 });
    },
    horn(x: number) {
      tone({ x, dur: 0.7, gain: 0.05, freq: 196, type: 'sawtooth', attack: 0.12 });
      tone({ x, dur: 1.1, gain: 0.05, freq: 294, type: 'sawtooth', attack: 0.12, delay: 0.6 });
    },
    crackle(x: number) {
      for (let i = 0, n = 4 + Math.floor(Math.random() * 5); i < n; i++) {
        noise({ x, dur: 0.02, gain: 0.12, filter: 'highpass', freq: 2500, delay: Math.random() * 0.8 });
      }
    },
    rustle(x: number) {
      noise({ x, dur: 0.35, gain: 0.1, filter: 'bandpass', freq: 2500, attack: 0.1 });
    },
    swish(x: number) {
      noise({ x, dur: 0.3, gain: 0.18, filter: 'bandpass', freq: 1200, to: 3500, q: 2, attack: 0.12 });
    },
    /** A load put down (or, softer, picked up): a sheaf, logs or a block of stone. */
    setDown(x: number, r: Resource, k = 1) {
      if (r === 'grain' || r === 'flour' || r === 'bread') {
        noise({ x, dur: 0.12, gain: 0.2 * k, filter: 'bandpass', freq: 1800, attack: 0.02 });
        tone({ x, dur: 0.14, gain: 0.15 * k, freq: 90, to: 55 });
      } else if (r === 'wood') {
        tone({ x, dur: 0.12, gain: 0.3 * k, freq: rnd(170, 200), to: 110 });
        tone({ x, dur: 0.1, gain: 0.2 * k, freq: rnd(230, 260), to: 150, delay: 0.07 });
        noise({ x, dur: 0.05, gain: 0.15 * k, filter: 'bandpass', freq: 900, q: 3 });
      } else {
        noise({ x, dur: 0.06, gain: 0.3 * k, filter: 'bandpass', freq: rnd(2600, 3200), q: 5 });
        tone({ x, dur: 0.12, gain: 0.25 * k, freq: 110, to: 60 });
      }
    },
  };

  /** Everyday sounds of a finished building with nothing drawn to go with them: how often (s), and what. */
  const AMBIENT: Partial<Record<BuildingType, { every: [number, number]; play: (x: number) => void }>> = {
    house: { every: [3, 7], play: sfx.crackle },
    market: { every: [1.5, 3.5], play: (x) => sfx.clink(x) },
    tavern: { every: [5, 9], play: (x) => (Math.random() < 0.3 ? sfx.clink(x, 1600) : sfx.lute(x)) },
    watchtower: { every: [18, 30], play: sfx.horn },
  };

  // --- Per-frame state ------------------------------------------------------------

  let clock = 0;
  let lastGait: number | null = null;
  /** Next time (clock s) each building makes its ambient sound. */
  const next = new Map<number, number>();
  /** World time at the previous frame, for `beat`. */
  let prevTime: number | null = null;
  /** What each person carried at the previous frame. */
  const carried = new Map<number, Resource | null>();

  /**
   * Whether an animation passed one of its beats this frame. The animation's
   * cycle value is `world.time * rate + offset` (as in src/render); a beat
   * falls at every multiple of `every` of it, shifted by `at`.
   */
  function beat(world: World, rate: number, every: number, at = 0, offset = 0): boolean {
    if (prevTime === null || world.time <= prevTime) return false;
    const n = (t: number) => Math.floor((t * rate + offset - at) / every);
    return n(world.time) > n(prevTime);
  }

  function horse(world: World): void {
    const r = world.rider;
    const prev = lastGait ?? r.gait;
    lastGait = r.gait;
    const speed = Math.min(1, Math.abs(r.vx) / RIDER_MAX_SPEED);
    if (speed < 0.02 || r.gait === prev) return;
    // same footfall pattern as render/horse.ts: 4-beat walk, 2-beat trot
    const trot = speed > 0.6;
    const beats = trot ? [0, 0.5] : [0, 0.25, 0.5, 0.75];
    const a = prev / HORSE_STRIDE;
    const b = r.gait / HORSE_STRIDE;
    for (const off of beats) {
      if (Math.floor(a - off) < Math.floor(b - off)) sfx.hoof(r.x, (trot ? 0.9 : 0.6) * (0.5 + speed * 0.5));
    }
  }

  return {
    frame(world, dt) {
      clock += dt;
      listenerX = world.rider.x;
      if (!live()) {
        lastGait = world.rider.gait;
        prevTime = world.time;
        return;
      }
      horse(world);

      const played = new Set<string>();
      for (const ev of world.events) {
        const b = getBuilding(world, ev.buildingId);
        if (!b || played.has(ev.kind)) continue;
        played.add(ev.kind);
        const x = world.plots[b.plotIndex].x;
        if (ev.kind === 'placed') sfx.thunk(x);
        else sfx.chime(x);
      }

      const PI = Math.PI;
      for (const b of world.buildings) {
        const x = world.plots[b.plotIndex].x;
        const near = Math.abs(x - listenerX) < EARSHOT + 300;

        // people at work here: the blows and sweeps of their tools (render/farm.ts drawWorker)
        for (const p of employees(world, b)) {
          const w = p.job!.worker;
          const wx = x + w.dx;
          if (w.task.kind !== 'job' || !near) continue;
          const action = w.task.job.action;
          // hammer: the arm is lowest when |sin(6t)| peaks
          if (action === 'build' && beat(world, 6, PI, PI / 2)) sfx.knock(wx);
          // seed cast at the start of each arm cycle (5t over 2π)
          else if (action === 'sow' && beat(world, 5, 2 * PI)) sfx.rustle(wx);
          // the scythe passes through the crop twice a swing (sin(4t) crosses 0)
          else if (action === 'harvest' && beat(world, 4, PI)) sfx.swish(wx);
        }

        if (b.status !== 'done' || !near) continue;
        // buildings whose art shows the work (render/buildings.ts)
        const seed = b.id * 97; // the art's per-building seed (render/scene.ts)
        if (b.type === 'blacksmith' && beat(world, 5, PI)) sfx.anvil(x + 34); // sparks fly as the hammer lands
        else if (b.type === 'well' && beat(world, 0.6, 2 * PI, PI / 2)) sfx.splash(x); // the bucket at the bottom
        else if (b.type === 'mill' && beat(world, 0.9, PI / 2, 0, seed)) sfx.creak(x); // each quarter turn of the sails
        else if (b.type === 'chapel' && beat(world, 1.3, PI, PI / 2)) sfx.bell(x); // the bell at each end of its swing
        const amb = AMBIENT[b.type];
        if (amb) {
          if (!next.has(b.id)) next.set(b.id, clock + rnd(0, amb.every[1]));
          if (clock >= next.get(b.id)!) {
            next.set(b.id, clock + rnd(...amb.every));
            amb.play(x);
          }
        }
      }

      // a load picked up or put down, where the person stands
      for (const p of world.people) {
        const b = p.job && getBuilding(world, p.job.buildingId);
        const now = p.job?.worker.carrying?.resource ?? null;
        const before = carried.get(p.id);
        carried.set(p.id, now);
        if (!b || before === undefined || before === now) continue;
        const wx = world.plots[b.plotIndex].x + p.job!.worker.dx;
        if (before) sfx.setDown(wx, before);
        if (now) sfx.setDown(wx, now, 0.5);
      }
      prevTime = world.time;
    },

    ui(name) {
      if (!live()) return;
      if (name === 'menuOpen') {
        tone({ dur: 0.15, gain: 0.12, freq: 660, type: 'triangle' });
        tone({ dur: 0.2, gain: 0.12, freq: 990, type: 'triangle', delay: 0.07 });
      } else if (name === 'menuMove') tone({ dur: 0.04, gain: 0.04, freq: 1200, type: 'square' });
      else if (name === 'menuClose') tone({ dur: 0.14, gain: 0.12, freq: 660, to: 440, type: 'triangle' });
      else if (name === 'toggle') {
        tone({ dur: 0.05, gain: 0.05, freq: 880, type: 'square' });
        tone({ dur: 0.05, gain: 0.05, freq: 1320, type: 'square', delay: 0.06 });
      } else tone({ dur: 0.15, gain: 0.05, freq: 220, type: 'square' });
    },

    get volume() {
      return volume;
    },
    set volume(v) {
      volume = v;
      applyVolume();
    },

    toggleMute() {
      muted = !muted;
      applyVolume();
      return muted;
    },
  };
}
