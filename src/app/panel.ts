// Collapsible side panels (the workers list on the left, tuning on the right).
// Collapsed, a panel is just a small round expand button at its edge of the
// screen (shaped like a Mac window's full-screen button);
// whether each is open is remembered in this browser.

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

/**
 * Make a fixed side panel collapsible. `root` is the positioned panel, `content`
 * everything inside it; the toggle button goes at the top of `root`.
 */
export function makeCollapsible(root: HTMLElement, content: HTMLElement, side: 'left' | 'right', key: string, startOpen = true): void {
  const expanded = root.style.cssText;
  const button = document.createElement('button');
  button.style.cssText =
    'display:block;background:none;border:none;padding:0;cursor:pointer;pointer-events:auto;' +
    // at the panel's outer edge, where it folds away to
    `margin-${side === 'left' ? 'right' : 'left'}:auto`;
  root.prepend(button);
  root.append(content);

  const set = (open: boolean) => {
    content.style.display = open ? '' : 'none';
    button.innerHTML = icon(open ? ARROWS.collapse : ARROWS.expand);
    button.title = open ? 'collapse' : 'expand';
    root.style.cssText = expanded;
    // collapsed: nothing but the button
    if (!open) Object.assign(root.style, { padding: '0', background: 'none', border: 'none' });
    remember(key, open);
  };
  button.addEventListener('click', () => {
    set(content.style.display === 'none');
    button.blur(); // hand the keys back to the game
  });
  set(remembered(key) ?? startOpen);
}

let buttonPx = 0;
/** Size the panels' buttons to match the HUD's zoom buttons (CSS px); call when the screen scale may have changed. */
export function sizePanelButtons(px: number): void {
  if (Math.abs(px - buttonPx) < 0.1) return;
  buttonPx = px;
  document.documentElement.style.setProperty('--hud-button', `${px}px`);
}
