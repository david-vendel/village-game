// Input: keyboard, mouse wheel and touch/pointer. Maps raw events onto
// `Actions` (game verbs) and screen zoom, and exposes the current ride input.
// Tap targets come from the render layer's layout functions, so what you tap
// is exactly what is drawn.

import { canChoose, facingOf } from '../game/world';
import { mapPoint, streetOf, type Vec } from '../game/streets';
import type { MoveInput, World } from '../game/world';
import { BUILD_CATEGORIES, buildBarLayout, buildingMenuLayout, categoryOf, hit, hudLayout, strategyDistance, strategyGround, strategyPick } from '../render';
import { BUILDING_TYPES, type BuildingType } from '../game/buildings';
import type { Actions } from './actions';
import { installGraphics } from './graphics';
import { installMenu } from './menu';
import type { Screen } from './screen';

export interface Controls {
  /** Current ride input from keys and held touch buttons. */
  move(): MoveInput;
  /** Which on-screen ride buttons are held (for pressed styling). */
  touchHeld(): { left: boolean; right: boolean };
  /** Whether the strategy view is showing (Tab, or a tap on the small map). */
  topView(): boolean;
  /** The strategy view has its own zoom, apart from the street view's. */
  topZoom(): number;
  /** Its turn about the point it looks at (radians, 0 looking north): Q / E, or a right drag. */
  topYaw(): number;
  /** The map point it looks at: it starts over the rider and moves freely (WASD / arrows, a drag); F goes back to the rider. */
  topCenter(): Vec;
  /** The building being placed in it (chosen in its build bar), and which of FACINGS its door faces (R turns it). */
  topGhost(): { type: BuildingType; facing: number } | null;
  /** Move the strategy view with the keys held, once a frame (dt in seconds). */
  frame(dt: number): void;
  /** Buildings in real-time 3D (true) or as 2D art: advanced graphics (app/graphics.ts). */
  view3d(): boolean;
  /** Where the mouse is over the canvas (canvas px), if it is. */
  hover(): { x: number; y: number } | null;
  /** The build bar's open category, if one is. */
  buildCategory(): number | null;
}

const GAME_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'Enter', 'Escape', 'Tab', 'w', 'a', 's', 'd', 'q', 'e']);
const ZOOM_STEP = 1.1;

type Role = 'left' | 'right' | 'pinch' | 'none';
/** A pointer moved less than this (CSS px) between down and up is a click or a tap. */
const TAP_SLOP = 6;

/** Two taps of left or right this close together (ms), the second held, make the horse gallop. */
const DOUBLE_TAP_MS = 300;
const VIEW_KEY = 'village-game:view';
const TOP_ZOOM_KEY = 'village-game:top-zoom';
const TOP_YAW_KEY = 'village-game:top-yaw';
/** Q / E turn the strategy view by an eighth of a turn; a drag across the whole screen turns it about once round. */
const YAW_STEP = Math.PI / 4;
const stored = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const store = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // no storage: it just won't be remembered
  }
};

export function installControls(world: World, screen: Screen, actions: Actions, newVillage: () => void): Controls {
  const canvas = screen.canvas;
  const keys = new Set<string>();
  /** Each pointer down: its role, where it is (CSS px), where it went down, and whether it turns the strategy view (a right or middle drag). */
  const pointers = new Map<number, { role: Role; x: number; y: number; from: { x: number; y: number }; turn: boolean }>();
  let pinch: { dist: number; zoom: number } | null = null;
  // the strategy view is a preference, not game state (game/save.ts leaves UI out), so the browser keeps it;
  // ?view=top opens on it (a link)
  let topView = new URLSearchParams(location.search).get('view') === 'top' || stored(VIEW_KEY) === 'top';
  // the Menu's own rows: advanced graphics (app/graphics.ts); the side panels add theirs (menu.ts)
  const graphics = installGraphics();
  const menu = installMenu(graphics.menuItems);
  /** Open the Menu under its HUD button (UI units to CSS px). */
  const toggleMenu = (r: { x: number; y: number; w: number; h: number }) => {
    const s = screen.vp.uiScale / screen.dpr;
    menu.toggle({ right: window.innerWidth - (r.x + r.w) * s, top: (r.y + r.h) * s + 4 });
  };
  let topZoom = Number(stored(TOP_ZOOM_KEY)) || 1;
  let topYaw = Number(stored(TOP_YAW_KEY)) || 0;
  const turnView = (by: number) => {
    topYaw += by;
    store(TOP_YAW_KEY, String(topYaw));
  };
  // the strategy view's camera: where it looks, over the rider until moved; and how the building being placed is turned
  const riderPoint = (): Vec => mapPoint(world, world.rider.x);
  let center = riderPoint();
  let facing = 0;
  const setTopView = (on: boolean) => {
    // a plan menu belongs to the strategy view (its building is placed on the land there)
    if (!on && world.menu?.kind === 'build' && world.menu.plan) actions.closeBuildMenu();
    if (on && !topView) center = riderPoint();
    topView = on;
    store(VIEW_KEY, on ? 'top' : 'street');
  };
  const planMenu = () => (topView && world.menu?.kind === 'build' && world.menu.plan ? world.menu : null);
  /** The building being placed: the plan menu's choice, once its category is open. */
  const ghostType = (): BuildingType | null => {
    const menu = planMenu();
    const open = buildCategory();
    if (!menu || open === null) return null;
    const type = BUILDING_TYPES[menu.selection];
    return categoryOf(type) === open ? type : null;
  };
  const openPlanMenu = () => {
    // turned at first to face the street the rider is on
    const st = world.streets[streetOf(world.rider.x)];
    if (st) facing = Math.max(0, facingOf(st));
    actions.openPlanMenu();
  };
  /** Place the building being placed at the screen point (UI units) on the land. */
  const placeAt = (ux: number, uy: number) => {
    const type = ghostType();
    const p = strategyGround(ux, uy);
    if (type && p) actions.plan(type, p, facing);
  };
  // zooming acts on whichever view is showing
  const zoomNow = () => (topView ? topZoom : screen.vp.zoom);
  const setZoom = (z: number) => {
    if (topView) {
      topZoom = Math.max(0.25, Math.min(8, z));
      store(TOP_ZOOM_KEY, String(topZoom));
    } else screen.setZoom(z);
  };
  const zoomBy = (f: number) => setZoom(zoomNow() * f);

  // --- Keyboard -----------------------------------------------------------------

  /** The last tap of left or right, and which of them is being sprinted (tapped twice and held). */
  let lastTap: { way: 'left' | 'right'; at: number } | null = null;
  let sprinting: 'left' | 'right' | null = null;

  // Everything is reachable with the left hand alone: WASD mirrors the arrows,
  // Space confirms. Letters are lower-cased so Shift / Caps Lock don't matter.
  const keyOf = (e: KeyboardEvent) => (e.key.length === 1 ? e.key.toLowerCase() : e.key);

  window.addEventListener('keydown', (e) => {
    const key = keyOf(e);
    if (GAME_KEYS.has(key)) e.preventDefault();
    keys.add(key);
    if (e.repeat) return;
    // a second tap of left or right, quickly after the first, and held: a gallop
    const way = key === 'ArrowLeft' || key === 'a' ? 'left' : key === 'ArrowRight' || key === 'd' ? 'right' : null;
    if (way) {
      const now = performance.now();
      if (lastTap?.way === way && now - lastTap.at < DOUBLE_TAP_MS) sprinting = way;
      lastTap = { way, at: now };
    }

    if (key === 'Tab') {
      setTopView(!topView);
      return;
    }
    if (key === 'c') return actions.toggleConstruction();
    if (key === 'm') return actions.toggleSound();
    if (key === '-' || key === '_') return zoomBy(1 / ZOOM_STEP);
    if (key === '=' || key === '+') return zoomBy(ZOOM_STEP);
    if (key === '0') {
      if (topView) setZoom(1);
      else screen.resetZoom();
      return;
    }

    if (topView) {
      // the camera: WASD (and the arrows, with no menu open) move it while held (frame), Q / E turn it, F takes it to the rider
      if (key === 'q') return turnView(-YAW_STEP);
      if (key === 'e') return turnView(YAW_STEP);
      if (key === 'f') return void (center = riderPoint());
      if (key === 'r' && ghostType()) return void (facing = (facing + 1) % 4);
      if (key === 'w' || key === 'a' || key === 's' || key === 'd') return;
      if (!world.menu && key.startsWith('Arrow')) return;
      if (!world.menu && (key === ' ' || key === 'Enter' || key === 'b')) return openPlanMenu();
      if (ghostType() && (key === ' ' || key === 'Enter')) {
        if (hover) placeAt(hover.x / screen.vp.uiScale, hover.y / screen.vp.uiScale);
        return;
      }
    }
    if (world.menu?.kind === 'build') return buildBarKey(key);
    if (world.menu) {
      if (key === 'ArrowLeft' || key === 'a' || key === 'ArrowUp' || key === 'w') actions.moveSelection(-1);
      else if (key === 'ArrowRight' || key === 'd' || key === 'ArrowDown' || key === 's') actions.moveSelection(1);
      else if (key === 'Enter' || key === ' ') actions.confirm();
      else if (key === 'Escape' || key === 'q') actions.closeBuildMenu();
      else if (/^[1-9]$/.test(key)) actions.select(Number(key) - 1);
      return;
    }
    // at a crossroads up and down turn onto the crossing street
    if (actions.atCrossroads() && (key === 'ArrowUp' || key === 'w')) return actions.turn('up');
    if (actions.atCrossroads() && (key === 'ArrowDown' || key === 's')) return actions.turn('down');
    if (key === 'ArrowDown' || key === 's' || key === ' ' || key === 'Enter' || key === 'b') actions.openBuildMenu();
  });
  window.addEventListener('keyup', (e) => {
    keys.delete(keyOf(e));
    if (sprinting === 'left' && !keyLeft()) sprinting = null;
    if (sprinting === 'right' && !keyRight()) sprinting = null;
  });

  // --- The build bar (render/ui.ts buildBarLayout) ------------------------------------

  /** The open category, forgotten whenever another menu opens. */
  let category: number | null = null;
  let categoryMenu: World['menu'] = null;
  const buildCategory = () => {
    if (world.menu !== categoryMenu) {
      categoryMenu = world.menu;
      category = null;
    }
    return world.menu?.kind === 'build' ? category : null;
  };
  /** Open category i, choosing the first of its buildings that fits here. */
  const openCategory = (i: number) => {
    buildCategory();
    category = i;
    const menu = world.menu;
    if (!menu) return;
    const first = BUILD_CATEGORIES[i].types.map((t) => BUILDING_TYPES.indexOf(t)).find((k) => canChoose(menu, k));
    if (first !== undefined) actions.select(first);
  };
  const chosenCategory = () => (world.menu ? categoryOf(BUILDING_TYPES[world.menu.selection]) : 0);

  /**
   * Keys in the build bar: 1–5 open a category, ← → choose among the buildings (opening the
   * chosen one's category), ↑ / Enter open the chosen one's category and then Enter builds it,
   * ↓ / Esc close the category row and then the bar.
   */
  function buildBarKey(key: string): void {
    const open = buildCategory();
    if (key === 'ArrowLeft' || key === 'a' || key === 'ArrowRight' || key === 'd') {
      actions.moveSelection(key === 'ArrowLeft' || key === 'a' ? -1 : 1);
      category = chosenCategory();
    } else if (/^[1-9]$/.test(key) && Number(key) <= BUILD_CATEGORIES.length) openCategory(Number(key) - 1);
    else if (key === 'ArrowUp' || key === 'w') category = chosenCategory();
    else if (key === 'Enter' || key === ' ') {
      if (open !== null && open === chosenCategory()) actions.confirm();
      else category = chosenCategory();
    } else if (key === 'ArrowDown' || key === 's' || key === 'Escape' || key === 'q') {
      if (open !== null) category = null;
      else actions.closeBuildMenu();
    }
  }

  /** A tap or click with the build bar open. */
  function buildBarTap(ux: number, uy: number): void {
    const menu = world.menu;
    if (menu?.kind !== 'build') return;
    const L = buildBarLayout(screen.vp.uiW, screen.vp.uiH, buildCategory());
    const cat = L.categories.findIndex((r) => hit(r, ux, uy));
    const card = L.cards.findIndex((r) => hit(r, ux, uy));
    if (cat >= 0) {
      if (cat === category) category = null;
      else openCategory(cat);
    } else if (card >= 0) {
      const i = BUILDING_TYPES.indexOf(L.types[card]);
      if (i === menu.selection) actions.confirm();
      else actions.select(i);
    } else if (L.build && hit(L.build, ux, uy)) {
      // a plan's button turns the building being placed
      if (menu.plan) facing = (facing + 1) % 4;
      else actions.confirm();
    } else if (hit(L.cancel, ux, uy) || (!menu.plan && !hit(L.panel, ux, uy))) actions.closeBuildMenu();
  }

  window.addEventListener('blur', () => {
    keys.clear();
    pointers.clear();
  });

  // --- Pointer: touch buttons, menu taps, pinch zoom ------------------------------

  const toUi = (e: PointerEvent): [number, number] => [(e.clientX * screen.dpr) / screen.vp.uiScale, (e.clientY * screen.dpr) / screen.vp.uiScale];

  function dirAt(ux: number, uy: number): Role | null {
    const L = hudLayout(screen.vp.uiW, screen.vp.uiH);
    if (hit(L.left, ux, uy)) return 'left';
    if (hit(L.right, ux, uy)) return 'right';
    return null;
  }

  const pinchPointers = () => [...pointers.values()].filter((p) => p.role === 'pinch');

  function startPinchIfReady(): void {
    const ps = pinchPointers();
    pinch = ps.length === 2 ? { dist: Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y), zoom: zoomNow() } : null;
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse') screen.enableTouch();
    canvas.setPointerCapture(e.pointerId);
    const [ux, uy] = toUi(e);
    const { uiW, uiH } = screen.vp;
    let role: Role = 'none';

    // in the strategy view, on a touch screen, the last tap is where the ghost stands
    if (topView && e.pointerType !== 'mouse') hover = { x: e.clientX * screen.dpr, y: e.clientY * screen.dpr };
    const plan = planMenu();
    if (plan && !hit(buildBarLayout(uiW, uiH, buildCategory()).panel, ux, uy)) {
      // the land under the plan menu: a click places the building (on pointerup), a drag moves the view
      role = 'pinch';
    } else if (world.menu?.kind === 'build') buildBarTap(ux, uy);
    else if (world.menu) {
      const M = buildingMenuLayout(uiW, uiH, world.menu.options.length);
      const card = M.cards.findIndex((r) => hit(r, ux, uy));
      if (card >= 0) {
        if (card === world.menu.selection) actions.confirm();
        else actions.select(card);
      } else if (hit(M.build, ux, uy)) actions.confirm();
      else if (hit(M.cancel, ux, uy) || !hit(M.panel, ux, uy)) actions.closeBuildMenu();
    } else {
      const L = hudLayout(uiW, uiH);
      const dir = screen.touch ? dirAt(ux, uy) : null;
      if (hit(L.zoomOut, ux, uy)) zoomBy(1 / ZOOM_STEP);
      else if (hit(L.newVillage, ux, uy)) newVillage();
      else if (hit(L.menu, ux, uy)) toggleMenu(L.menu);
      else if (hit(L.map, ux, uy)) setTopView(!topView);
      else if (hit(L.zoomIn, ux, uy)) zoomBy(ZOOM_STEP);
      else if (hit(L.build, ux, uy)) {
        if (topView) openPlanMenu();
        else actions.openBuildMenu();
      }
      else if (dir) role = dir;
      else if (screen.touch && actions.atCrossroads() && hit(L.turnUp, ux, uy)) actions.turn('up');
      else if (screen.touch && actions.atCrossroads() && hit(L.turnDown, ux, uy)) actions.turn('down');

      else role = 'pinch';
    }
    pointers.set(e.pointerId, { role, x: e.clientX, y: e.clientY, from: { x: e.clientX, y: e.clientY }, turn: e.button === 2 || e.button === 1 });
    if (role === 'pinch') startPinchIfReady();
  });

  // where the mouse is over the canvas (canvas px): the grid names the cell under it, buildings show their info box
  let hover: { x: number; y: number } | null = null;
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') hover = { x: e.clientX * screen.dpr, y: e.clientY * screen.dpr };
  });
  canvas.addEventListener('pointerleave', () => (hover = null));
  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const lastX = p.x;
    const lastY = p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (p.role === 'left' || p.role === 'right') {
      // sliding a thumb from one arrow to the other switches direction
      const [ux, uy] = toUi(e);
      p.role = dirAt(ux, uy) ?? p.role;
    } else if (p.role === 'pinch' && topView && pinchPointers().length === 1) {
      if (p.turn) turnView(-((e.clientX - lastX) / window.innerWidth) * Math.PI * 2);
      else {
        // one finger or the mouse drags the land along under it
        const k = screen.dpr / screen.vp.uiScale;
        const a = strategyGround(lastX * k, lastY * k);
        const b = strategyGround(e.clientX * k, e.clientY * k);
        if (a && b) center = { x: center.x - (b.x - a.x), y: center.y - (b.y - a.y) };
      }
    } else if (p.role === 'pinch' && pinch) {
      const ps = pinchPointers();
      if (ps.length === 2 && pinch.dist > 0) setZoom(pinch.zoom * (Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) / pinch.dist));
    }
  });

  /** A touch tap in the strategy view's plan, the last one: a second tap where the ghost stands places it. */
  let lastLandTap: { x: number; y: number } | null = null;
  function endPointer(e: PointerEvent): void {
    const p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (p?.role === 'pinch') startPinchIfReady();
    // a click on the strategy view's land (not a drag, nor one of a pinch)
    if (e.type !== 'pointerup' || !p || p.role !== 'pinch' || !topView || p.turn || pinchPointers().length) return;
    if (Math.hypot(e.clientX - p.from.x, e.clientY - p.from.y) > TAP_SLOP) return;
    const [ux, uy] = toUi(e);
    if (ghostType()) {
      // with a mouse the ghost is seen before the click; on a touch screen the first tap shows it, a second there places it
      const again = lastLandTap && Math.hypot(e.clientX - lastLandTap.x, e.clientY - lastLandTap.y) < 30;
      lastLandTap = { x: e.clientX, y: e.clientY };
      if (e.pointerType === 'mouse' || again) {
        placeAt(ux, uy);
        lastLandTap = null;
      }
    } else if (planMenu()) actions.closeBuildMenu();
    else if (!world.menu) {
      const at = strategyPick(world, ux, uy);
      if (at) actions.openBuildingMenuAt(at);
    }
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoomBy(Math.exp(-e.deltaY * 0.0015));
    },
    { passive: false },
  );

  const held = (role: Role) => [...pointers.values()].some((p) => p.role === role);

  const keyLeft = () => keys.has('ArrowLeft') || keys.has('a');
  const keyRight = () => keys.has('ArrowRight') || keys.has('d');

  return {
    move: () => {
      // in the strategy view the keys move the camera, and the rider waits
      if (topView) return { left: false, right: false };
      const m = { left: keyLeft() || held('left'), right: keyRight() || held('right') };
      return { ...m, sprint: sprinting !== null && m[sprinting] };
    },
    frame(dt) {
      if (!topView) return;
      // WASD always, the arrows while no menu takes them: up is away from the camera, however it is turned
      const arrows = !world.menu;
      const sx = (keys.has('d') || (arrows && keys.has('ArrowRight')) ? 1 : 0) - (keys.has('a') || (arrows && keys.has('ArrowLeft')) ? 1 : 0);
      const sy = (keys.has('w') || (arrows && keys.has('ArrowUp')) ? 1 : 0) - (keys.has('s') || (arrows && keys.has('ArrowDown')) ? 1 : 0);
      if (!sx && !sy) return;
      const speed = strategyDistance(topZoom) * 1.2 * dt;
      const c = Math.cos(topYaw);
      const s = Math.sin(topYaw);
      center = { x: center.x + (sx * c + sy * s) * speed, y: center.y + (-sx * s + sy * c) * speed };
    },
    topCenter: () => center,
    topGhost: () => {
      const type = ghostType();
      return type ? { type, facing } : null;
    },
    touchHeld: () => ({ left: held('left'), right: held('right') }),
    topView: () => topView,
    topZoom: () => topZoom,
    topYaw: () => topYaw,
    hover: () => hover,
    buildCategory,
    view3d: graphics.view3d,
  };
}
