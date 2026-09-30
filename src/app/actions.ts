// Player actions: the verbs that keyboard and touch input both map onto.
// Each calls into the game and reports what happened as a short message.
// Messages are plain text here; how they look is up to the renderer.

import { BUILDINGS } from '../game/buildings';
import {
  closeMenu,
  confirmMenu,
  getBuilding,
  moveMenu,
  openMenu,
  selectMenu,
  setConstructionEnabled,
  type World,
} from '../game/world';

export type Notify = (text: string) => void;

export interface Actions {
  toggleConstruction(): void;
  openBuildMenu(): void;
  closeBuildMenu(): void;
  moveSelection(delta: number): void;
  select(index: number): void;
  build(): void;
}

export function createActions(world: World, notify: Notify, isTouch: () => boolean): Actions {
  return {
    toggleConstruction() {
      setConstructionEnabled(world, !world.constructionEnabled);
      notify(world.constructionEnabled ? 'Construction phase ON' : 'Construction phase OFF — buildings appear instantly');
    },
    openBuildMenu() {
      if (!openMenu(world) && isTouch()) notify('Ride to a pennant to build');
    },
    closeBuildMenu() {
      closeMenu(world);
    },
    moveSelection(delta) {
      moveMenu(world, delta);
    },
    select(index) {
      selectMenu(world, index);
    },
    build() {
      const b = confirmMenu(world);
      if (!b) return;
      const name = BUILDINGS[b.type].name;
      notify(b.status === 'done' ? `${name} built` : `Construction of the ${name} begins`);
    },
  };
}

/** Turn game events from the last update into messages, and clear them. */
export function announceEvents(world: World, notify: Notify): void {
  for (const ev of world.events) {
    const b = getBuilding(world, ev.buildingId);
    if (ev.kind === 'completed' && b && world.constructionEnabled) notify(`The ${BUILDINGS[b.type].name} is complete!`);
  }
  world.events.length = 0;
}
