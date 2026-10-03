// What a building generator makes: its elements, its named points (the door
// people go in by, chimney tops for the smoke, windows, where sleepers snore)
// and its moving parts (door leaves, shutters, sails, a bell), each turning
// about its own hinge.

import { Builder, type Element, type Vec3 } from './elements';
import type { Plot } from './plot';

/**
 * A moving part: the elements tagged anim:<name> turn about `axis` through `pivot` (model space).
 * door / shutter: by the building's door or shutters state (0 shut … 1 open), to `open` radians;
 * spin: steadily, `speed` radians a second (sails, a windlass); swing: by the chapel bell's angle;
 * sway: a hanging sign in the wind.
 */
export interface Anim {
  kind: 'door' | 'shutter' | 'spin' | 'swing' | 'sway';
  pivot: Vec3;
  axis: Vec3;
  open?: number;
  speed?: number;
}

export interface Model {
  elements: Element[];
  points: Record<string, Vec3>;
  anims: Record<string, Anim>;
}

/** Collects a model: elements (Builder), points and moving parts. */
export class ModelBuilder extends Builder {
  readonly points: Record<string, Vec3> = {};
  readonly anims: Record<string, Anim> = {};

  constructor(
    seed: number,
    readonly plot: Plot,
  ) {
    super(seed);
  }

  point(name: string, p: Vec3): void {
    this.points[name] = p;
  }

  /** Declare a moving part and add its elements (everything `fn` adds is tagged with it). */
  part(name: string, anim: Anim, fn: () => void): void {
    this.anims[name] = anim;
    this.tagged([`anim:${name}`], fn);
  }

  model(): Model {
    return { elements: this.out, points: this.points, anims: this.anims };
  }
}
