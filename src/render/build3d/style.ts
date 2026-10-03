// Looks for the 3D buildings. The same models, the same build order, the
// same moving parts; a style decides how they are painted and lit:
// - colours: per material, and per building from palettes (each house its own
//   wall colour, its own painted shutters and door, its own roof);
// - how much surface grain and weathering show (none: always fresh and clean);
// - what decorations are put out (flower boxes under the windows);
// - the light: the sun's warmth and strength, the sky's fill, how dark shadows are.
// The default, Painterly, aims at the warm painted villages of the Age of Empires
// II art (docs/art): golden light, cream and timber, ivy and flowers.
// `?style=<name>` or the Menu picks one; `?view=3d&styles=1` shows them side by side.

export interface Style {
  name: string;
  label: string;
  /** Base colours per material (sRGB), over the library's. */
  colors: Record<string, string>;
  /** Materials each building colours its own way: a palette to pick from by its seed. */
  palettes: Record<string, string[]>;
  /** Surface noise and weathering, as a share of the library's (0: clean, flat colour). */
  grain: number;
  weather: number;
  /** State parts shown on finished buildings (flower boxes). */
  parts: string[];
  /** Light: exposure, sun strength and how warm, sky fill, shadow darkness. */
  exposure: number;
  sun: number;
  warmth: number;
  sky: number;
  shadow: number;
  /** How bright the colours are pushed (1: as given). */
  saturation: number;
  /** Painted surface textures (public/textures, tools/paint/tileable.ts) over the materials. */
  textures: boolean;
  /** A painter's grading: warm sunlit highlights, cool lifted shadows (0: none). */
  grade: number;
}

export const STYLES: Record<string, Style> = {
  // the reference painting: warm golden sun, cream plaster between rich brown timbers, warm brown and
  // red roofs, honey stone, ivy and flowers everywhere, never grimy
  painterly: {
    name: 'painterly',
    label: 'Painterly',
    colors: {
      oak: '#5e3a22',
      daub: '#f3e6c8',
      limewash: '#f5ecd8',
      rubble: '#cdb38a',
      fieldstone: '#a88f6a',
      ashlar: '#e2cfa6',
      mortar: '#d9c7a2',
      thatch: '#b98c55',
      'thatch-old': '#ad8452',
      tile: '#94503a',
      shingle: '#7a4e38',
      slate: '#6a6f86',
      boards: '#8a5c38',
      planks: '#6e4426',
      'roof-boards': '#7a5034',
      logs: '#7e5532',
      pole: '#7e5a38',
      wattle: '#8a6440',
      earth: '#a88a5e',
      'earth-dark': '#5a4028',
      brick: '#b4603e',
      clay: '#c8784e',
    },
    palettes: {
      daub: ['#f3e6c8', '#f0dcb4', '#f6ead2', '#eed6b0', '#f2e2c6'],
      paint: ['#6e4426', '#5e3a22', '#7a4a2a', '#4f6a5a', '#6a3a2e'],
      tile: ['#94503a', '#8a4636', '#a05a3e', '#7e4434'],
      shingle: ['#7a4e38', '#6e4634', '#86583e'],
      thatch: ['#b98c55', '#c2965a', '#ae8450'],
    },
    grain: 0.55,
    weather: 0,
    parts: ['flowers', 'ivy'],
    exposure: 1.25,
    sun: 3.6,
    warmth: 1.25,
    sky: 1.25,
    shadow: 0.34,
    saturation: 1.0,
    textures: true,
    grade: 1,
  },
  // as it was: real materials, aged, moss and damp
  realistic: {
    name: 'realistic',
    label: 'Realistic (aged)',
    colors: {},
    palettes: { daub: ['#e9e0c9', '#e4c68e', '#e8cbb6'] },
    grain: 1,
    weather: 1,
    parts: [],
    exposure: 1.15,
    sun: 3.2,
    warmth: 1,
    sky: 1.1,
    shadow: 0.42,
    saturation: 1,
    textures: false,
    grade: 0,
  },
};

export const STYLE_NAMES = Object.keys(STYLES);
export const DEFAULT_STYLE = 'painterly';

let current: Style = STYLES['painterly'];

/** The style buildings are drawn in now. */
export const styleNow = () => current;

export function setStyle(name: string): void {
  current = STYLES[name] ?? STYLES[DEFAULT_STYLE];
}

/** Which palette a material belongs to (the daub colours share one, the roofs each their own). */
export function paletteOf(style: Style, material: string): string[] | undefined {
  if (material.startsWith('daub')) return style.palettes.daub;
  return style.palettes[material];
}
