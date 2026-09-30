// Sound: small synthesised effects (Web Audio, no audio files), in the same
// spirit as the procedural art. Reads game state once a frame and never
// changes it. Covers:
//   - the horse's hoofbeats, in step with the drawn walk / trot
//   - build menu clicks, a thunk when a building is placed, a chime when done
//   - hammering on anything under construction
//   - each finished building's everyday work (anvil, bell, creaking mill…)
//   - the farmer sowing, scything and stacking sheaves
// World sounds are positioned relative to the rider: they pan left/right and
// fade out beyond EARSHOT.

import type { BuildingType } from '../game/buildings';
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
    thud(x: number) {
      tone({ x, dur: 0.18, gain: 0.3, freq: 90, to: 50 });
      noise({ x, dur: 0.12, gain: 0.25, filter: 'lowpass', freq: 300 });
    },
  };

  /** Everyday work of a finished building: how often (s) and what it sounds like. */
  const AMBIENT: Partial<Record<BuildingType, { every: [number, number]; play: (x: number) => void }>> = {
    house: { every: [3, 7], play: sfx.crackle },
    mill: { every: [2.5, 4], play: sfx.creak },
    blacksmith: { every: [1.4, 2.4], play: (x) => (sfx.anvil(x), sfx.anvil(x, 0.35)) },
    market: { every: [1.5, 3.5], play: (x) => sfx.clink(x) },
    chapel: { every: [14, 22], play: (x) => [0, 1.4, 2.8].forEach((d) => sfx.bell(x, d)) },
    tavern: { every: [5, 9], play: (x) => (Math.random() < 0.3 ? sfx.clink(x, 1600) : sfx.lute(x)) },
    watchtower: { every: [18, 30], play: sfx.horn },
    well: { every: [5, 9], play: sfx.splash },
  };

  // --- Per-frame state ------------------------------------------------------------

  let clock = 0;
  let lastGait: number | null = null;
  /** Next time (clock s) each building makes its ambient / construction sound. */
  const next = new Map<number, number>();
  const farms = new Map<number, { storage: number; nextWork: number }>();

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

      for (const b of world.buildings) {
        const x = world.plots[b.plotIndex].x;
        const near = Math.abs(x - listenerX) < EARSHOT;
        if (b.status === 'constructing') {
          if (clock >= (next.get(b.id) ?? 0)) {
            next.set(b.id, clock + rnd(0.3, 0.7));
            if (near) sfx.knock(x + rnd(-40, 40));
          }
          continue;
        }
        const amb = AMBIENT[b.type];
        if (amb) {
          if (!next.has(b.id)) next.set(b.id, clock + rnd(0, amb.every[1]));
          if (clock >= next.get(b.id)!) {
            next.set(b.id, clock + rnd(...amb.every));
            if (near) amb.play(x);
          }
        }
        if (b.farm) {
          const f = b.farm;
          let s = farms.get(b.id);
          if (!s) farms.set(b.id, (s = { storage: f.storage, nextWork: 0 }));
          const fx = x + f.farmer.dx;
          if (f.storage > s.storage && near) sfx.thud(x);
          s.storage = f.storage;
          const task = f.farmer.task;
          if (task.kind === 'work' && clock >= s.nextWork) {
            s.nextWork = clock + (task.action === 'sow' ? 0.6 : 0.75);
            if (near) (task.action === 'sow' ? sfx.rustle : sfx.swish)(fx);
          }
        }
      }
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
