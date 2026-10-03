// Collapsible side panels (the workers list and versions on the left, tuning on
// the right). They are opened from the HUD's Menu (menu.ts); an open panel has
// a small round button at its top to fold it away again (shaped like a Mac
// window's full-screen button). Whether each is open is remembered in this
// browser.

/** The round button: arrows out to the corners to expand, in to the middle to collapse. */
const ARROWS = { expand: '4,4 8.3,4 4,8.3 M10,10 5.7,10 10,5.7', collapse: '6.6,6.6 2.9,6.6 6.6,2.9 M7.4,7.4 11.1,7.4 7.4,11.1' };
const icon = (arrows: string) =>
  '<svg viewBox="0 0 14 14" style="display:block;width:var(--hud-button,14px);height:var(--hud-button,14px)">' +
  '<circle cx="7" cy="7" r="6.5" fill="#e8c872" stroke="#b8963e" stroke-width="1"/>' +
  `<path d="M${arrows.replace(' M', 'Z M')}Z" fill="#3a2a1c"/></svg>`;

const remembered = (key: string): boolean | null => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? null : v === '1';
  } catch {
    return null;
  }
};
const remember = (key: string, open: boolean) => {
  try {
    localStorage.setItem(key, open ? '1' : '0');
  } catch {
    // no storage: it just won't be remembered
  }
};

/** A panel the Menu can open and close. */
export interface MenuPanel {
  title: string;
  isOpen(): boolean;
  setOpen(open: boolean): void;
}

/** The panels in the Menu, in the order they were made. */
export const menuPanels: MenuPanel[] = [];

/**
 * Make a fixed side panel collapsible. `root` is the positioned panel, `content`
 * everything inside it; the fold-away button goes at the top of `root`. In the
 * Menu (`title`), a folded panel is hidden altogether and opened from there;
 * without one (no Menu: an old version showing) it folds to its round button.
 */
export function makeCollapsible(root: HTMLElement, content: HTMLElement, side: 'left' | 'right', key: string, startOpen = true, title?: string): void {
  const expanded = root.style.cssText;
  const button = document.createElement('button');
  button.style.cssText =
    'display:block;background:none;border:none;padding:0;cursor:pointer;pointer-events:auto;' +
    // at the panel's outer edge, where it folds away to
    `margin-${side === 'left' ? 'right' : 'left'}:auto`;
  root.prepend(button);
  root.append(content);

  let open = false;
  const set = (o: boolean) => {
    open = o;
    content.style.display = open ? '' : 'none';
    button.innerHTML = icon(open ? ARROWS.collapse : ARROWS.expand);
    button.title = open ? 'collapse' : 'expand';
    root.style.cssText = expanded;
    // folded: nothing but the button, or nothing at all when the Menu opens it
    if (!open) Object.assign(root.style, title ? { display: 'none' } : { padding: '0', background: 'none', border: 'none' });
    remember(key, open);
  };
  button.addEventListener('click', () => {
    set(!open);
    button.blur(); // hand the keys back to the game
  });
  set(remembered(key) ?? startOpen);
  if (title) menuPanels.push({ title, isOpen: () => open, setOpen: set });
}

let buttonPx = 0;
/** Size the panels' buttons to match the HUD's zoom buttons (CSS px); call when the screen scale may have changed. */
export function sizePanelButtons(px: number): void {
  if (Math.abs(px - buttonPx) < 0.1) return;
  buttonPx = px;
  document.documentElement.style.setProperty('--hud-button', `${px}px`);
}
