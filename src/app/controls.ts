// Input: keyboard, mouse wheel and touch/pointer. Maps raw events onto
// `Actions` (game verbs) and screen zoom, and exposes the current ride input.
// Tap targets come from the render layer's layout functions, so what you tap
// is exactly what is drawn.

import { canChoose } from '../game/world';
import { streetOf } from '../game/streets';
import type { MoveInput, World } from '../game/world';
import { buildingMenuLayout, DEFAULT_STYLE_3D, hit, hudLayout, menuLayout, setShowroom, setStyle3d, STYLES_3D } from '../render';
import type { Actions } from './actions';
import { installMenu } from './menu';
import type { Screen } from './screen';

export interface Controls {
  /** Current ride input from keys and held touch buttons. */
  move(): MoveInput;
  /** Which on-screen ride buttons are held (for pressed styling). */
  touchHeld(): { left: boolean; right: boolean };
  /** Whether the village is shown from above (Tab, or a tap on the small map). */
  topView(): boolean;
  /** The view from above has its own zoom, apart from the street view's. */
  topZoom(): number;
  /** Buildings in real-time 3D (true) or as 2D art: the 2D · 3D button, V, or ?3d=0 / ?3d=1. */
  view3d(): boolean;
  /** Where the mouse is over the canvas (canvas px), if it is. */
  hover(): { x: number; y: number } | null;
}

const GAME_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'Enter', 'Escape', 'Tab', 'w', 'a', 's', 'd']);
const ZOOM_STEP = 1.2;

type Role = 'left' | 'right' | 'pinch' | 'none';

/** Two taps of left or right this close together (ms), the second held, make the horse gallop. */
const DOUBLE_TAP_MS = 300;
const VIEW_KEY = 'village-game:view';
const TOP_ZOOM_KEY = 'village-game:top-zoom';
const VIEW3D_KEY = 'village-game:view3d';
const STYLE_KEY = 'village-game:style3d';
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
  const pointers = new Map<number, { role: Role; x: number; y: number }>();
  let pinch: { dist: number; zoom: number } | null = null;
  // the view from above is a preference, not game state (game/save.ts leaves UI out), so the browser keeps it;
  // ?view=top opens on it (a link)
  let topView = new URLSearchParams(location.search).get('view') === 'top' || stored(VIEW_KEY) === 'top';
  // 2D or 3D buildings: a preference the browser keeps; the address can set it for a link
  const view3dParam = new URLSearchParams(location.search).get('3d');
  let view3d = view3dParam === '0' ? false : view3dParam === '1' ? true : stored(VIEW3D_KEY) !== '2d';
  const toggleView3d = () => {
    view3d = !view3d;
    store(VIEW3D_KEY, view3d ? '3d' : '2d');
  };
  // how the 3D buildings are painted and lit: a preference; ?style=<name> sets it for a link
  const styleParam = new URLSearchParams(location.search).get('style');
  let style = styleParam && STYLES_3D[styleParam] ? styleParam : (stored(STYLE_KEY) ?? DEFAULT_STYLE_3D);
  if (!STYLES_3D[style]) style = DEFAULT_STYLE_3D;
  setStyle3d(style);
  const styleItems = Object.values(STYLES_3D).map((s) => ({
    title: `  ${s.label}`,
    isOn: () => view3d && style === s.name,
    toggle: () => {
      style = s.name;
      setStyle3d(style);
      store(STYLE_KEY, style);
      if (!view3d) toggleView3d();
    },
  }));
  // the showroom of art experiments along the main street (render/showroom.ts): on in the dev build; ?showroom=0/1
  const showroomParam = new URLSearchParams(location.search).get('showroom');
  let showroom = showroomParam ? showroomParam === '1' : import.meta.env.DEV && stored('village-game:showroom') !== '0';
  setShowroom(showroom);
  const showroomItem = {
    title: 'Showroom (art tests)',
    isOn: () => showroom,
    toggle: () => {
      showroom = !showroom;
      setShowroom(showroom);
      store('village-game:showroom', showroom ? '1' : '0');
    },
  };
  const menu = installMenu([{ title: '3D buildings', isOn: () => view3d, toggle: toggleView3d }, ...styleItems, showroomItem]);
  /** Open the Menu under its HUD button (UI units to CSS px). */
  const toggleMenu = (r: { x: number; y: number; w: number; h: number }) => {
    const s = screen.vp.uiScale / screen.dpr;
    menu.toggle({ right: window.innerWidth - (r.x + r.w) * s, top: (r.y + r.h) * s + 4 });
  };
  let topZoom = Number(stored(TOP_ZOOM_KEY)) || 1;
  const setTopView = (on: boolean) => {
    topView = on;
    store(VIEW_KEY, on ? 'top' : 'street');
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
    if (key === 'v') return toggleView3d();
    if (key === 'm') return actions.toggleSound();
    if (key === '-' || key === '_') return zoomBy(1 / ZOOM_STEP);
    if (key === '=' || key === '+') return zoomBy(ZOOM_STEP);
    if (key === '0') {
      if (topView) setZoom(1);
      else screen.resetZoom();
      return;
    }

    if (world.menu) {
      if (key === 'ArrowLeft' || key === 'a') actions.moveSelection(-1);
      else if (key === 'ArrowRight' || key === 'd') actions.moveSelection(1);
      else if (key === 'ArrowUp' || key === 'w') moveMenuRow(-1);
      else if (key === 'ArrowDown' || key === 's') moveMenuRow(1);
      else if (key === 'Enter' || key === ' ') actions.confirm();
      else if (key === 'Escape' || key === 'q') actions.closeBuildMenu();
      else if (/^[1-9]$/.test(key)) actions.select(Number(key) - 1);
      return;
    }
    // from above the arrows point on the map (see move), so ↓ rides rather than builds
    if (topView && (key === 'ArrowUp' || key === 'w' || key === 'ArrowDown' || key === 's')) return;
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

  /** Move the menu selection to the card straight above/below (the grid's shape comes from the drawn layout). */
  function moveMenuRow(delta: -1 | 1): void {
    if (!world.menu) return;
    // a building's menu is a single row
    if (world.menu.kind === 'building') return actions.moveSelection(delta);
    const { cards } = menuLayout(screen.vp.uiW, screen.vp.uiH);
    const cur = cards[world.menu.selection];
    const rows = [...new Set(cards.map((c) => c.y))].sort((a, b) => a - b);
    const mid = (c: { x: number; w: number }) => c.x + c.w / 2;
    const menu = world.menu;
    // the nearest card that can be chosen in the next row that has one (rows of only greyed-out cards are jumped)
    for (let r = rows.indexOf(cur.y) + delta; r >= 0 && r < rows.length; r += delta) {
      let best = -1;
      cards.forEach((c, i) => {
        if (c.y === rows[r] && canChoose(menu, i) && (best < 0 || Math.abs(mid(c) - mid(cur)) < Math.abs(mid(cards[best]) - mid(cur)))) best = i;
      });
      if (best >= 0) return actions.select(best);
    }
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

    if (world.menu) {
      const M = world.menu.kind === 'build' ? menuLayout(uiW, uiH) : buildingMenuLayout(uiW, uiH, world.menu.options.length);
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
      else if (dir) role = dir;
      else if (screen.touch && actions.atCrossroads() && hit(L.turnUp, ux, uy)) actions.turn('up');
      else if (screen.touch && actions.atCrossroads() && hit(L.turnDown, ux, uy)) actions.turn('down');
      else if (screen.touch && hit(L.build, ux, uy)) actions.openBuildMenu();
      else role = 'pinch';
    }
    pointers.set(e.pointerId, { role, x: e.clientX, y: e.clientY });
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
    p.x = e.clientX;
    p.y = e.clientY;
    if (p.role === 'left' || p.role === 'right') {
      // sliding a thumb from one arrow to the other switches direction
      const [ux, uy] = toUi(e);
      p.role = dirAt(ux, uy) ?? p.role;
    } else if (p.role === 'pinch' && pinch) {
      const ps = pinchPointers();
      if (ps.length === 2 && pinch.dist > 0) setZoom(pinch.zoom * (Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) / pinch.dist));
    }
  });

  function endPointer(e: PointerEvent): void {
    const p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (p?.role === 'pinch') startPinchIfReady();
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
  const keyUp = () => keys.has('ArrowUp') || keys.has('w');
  const keyDown = () => keys.has('ArrowDown') || keys.has('s');

  /**
   * From above (north up) the arrow keys point on the map: the rider heads the
   * way they point along the street, and at a crossroads turns onto the
   * crossing street when that runs the way they point.
   */
  function moveOnMap(): MoveInput {
    const v = { x: (keyRight() ? 1 : 0) - (keyLeft() ? 1 : 0), y: (keyUp() ? 1 : 0) - (keyDown() ? 1 : 0) };
    if (!v.x && !v.y) return { left: held('left'), right: held('right') };
    actions.turnToward(v);
    const d = world.streets[streetOf(world.rider.x)]?.dir ?? { x: 1, y: 0 };
    const along = d.x * v.x + d.y * v.y;
    return { left: along < 0 || held('left'), right: along > 0 || held('right') };
  }

  return {
    move: () => {
      const m = topView && !world.menu ? moveOnMap() : { left: keyLeft() || held('left'), right: keyRight() || held('right') };
      return { ...m, sprint: sprinting !== null && m[sprinting] };
    },
    touchHeld: () => ({ left: held('left'), right: held('right') }),
    topView: () => topView,
    topZoom: () => topZoom,
    hover: () => hover,
    view3d: () => view3d,
  };
}
