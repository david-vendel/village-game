// Collapsible side panels (the workers list on the left, tuning on the right).
// Collapsed, a panel is just a small expand chip at its edge of the screen;
// whether each is open is remembered in this browser.

const PANEL_BG = 'rgba(20,14,8,0.78)';
const PANEL_BORDER = '1px solid rgba(232,200,114,0.25)';

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
 * everything inside it; the toggle chip goes at the top of `root`.
 */
export function makeCollapsible(root: HTMLElement, content: HTMLElement, side: 'left' | 'right', key: string): void {
  const expanded = root.style.cssText;
  const button = document.createElement('button');
  button.style.cssText =
    'display:block;font:14px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:#e8c872;' +
    'background:none;border:none;padding:0 2px;cursor:pointer;pointer-events:auto;' +
    // at the panel's outer edge, where it folds away to
    `margin-${side === 'left' ? 'right' : 'left'}:auto`;
  root.prepend(button);
  root.append(content);

  const set = (open: boolean) => {
    content.style.display = open ? '' : 'none';
    // pointing towards the edge it folds into, or out of it to expand
    button.textContent = open === (side === 'left') ? '‹' : '›';
    button.title = open ? 'collapse' : 'expand';
    root.style.cssText = expanded;
    if (!open) Object.assign(root.style, { padding: '4px 6px', background: PANEL_BG, border: PANEL_BORDER, borderRadius: '6px' });
    remember(key, open);
  };
  button.addEventListener('click', () => {
    set(content.style.display === 'none');
    button.blur(); // hand the keys back to the game
  });
  set(remembered(key) ?? true);
}
