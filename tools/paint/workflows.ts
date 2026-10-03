// ComfyUI graphs (API format) for painting buildings, and the looks we paint in.
//
// paintover: the Cycles render, img2img, its shape held by ControlNet (union
//   model: depth + line art from the render's own passes), so the painting keeps
//   every timber, window and course where the model has it, and so every stage
//   and variant of a building stays the same building.
// repaint:  the same controls from an empty canvas (denoise 1): freer, more
//   painted, the shape still held by the depth and lines.
// A style anchor (an approved painting, ours, never someone else's art) can be
// given: IP-Adapter carries its look over to everything painted after it, so
// the whole village is one painter's hand.

export interface Look {
  name: string;
  prompt: string;
  negative: string;
  /** img2img strength for paintover (how much the painter may change). */
  denoise: number;
  /** How hard depth and lines hold the shape. */
  depth: number;
  lines: number;
  /** After painting: shrink to pixels (Kingdom Two Crowns' look) by this factor, 0 for none. */
  pixelate: number;
}

const NEG = 'photo, photorealistic, 3d render, cgi, plastic, blurry, lowres, jpeg artifacts, text, watermark, signature, frame, border, people, person, modern, glass windows, power lines, cars, deformed, extra windows, floating, cut off';

export const LOOKS: Record<string, Look> = {
  // the reference: a warm painted medieval village, concept art at golden hour
  painted: {
    name: 'painted',
    prompt:
      'digital oil painting of a single medieval half-timbered building, cream lime plaster between dark oak beams, weathered warm terracotta and brown roof, honey-coloured stone, ivy and climbing roses, flower boxes, warm golden afternoon sunlight from the left, soft painterly brushwork, rich warm colours, fantasy strategy game concept art, highly detailed, isolated on a plain background',
    negative: NEG,
    denoise: 0.62,
    depth: 0.85,
    lines: 0.55,
    pixelate: 0,
  },
  // Kingdom Two Crowns: flat-lit, bold shapes, then pixels
  kingdom: {
    name: 'kingdom',
    prompt:
      '2d side-scrolling game art of a single medieval building, flat painted illustration, bold simple shapes, limited warm palette, soft rim light, cosy and cheerful, clean silhouette, isolated on a plain background',
    negative: `${NEG}, gradient noise, photo texture`,
    denoise: 0.7,
    depth: 0.75,
    lines: 0.6,
    pixelate: 4,
  },
};

export interface PaintArgs {
  look: Look;
  mode: 'paintover' | 'repaint';
  colour: string;
  depth: string;
  /** Uploaded line art (unused: lines come from Canny on the colour render; kept for experiments). */
  lines?: string;
  width: number;
  height: number;
  seed: number;
  /** An uploaded style anchor image (IP-Adapter), if any. */
  anchor?: string;
  /** Extra words for this building (what it is). */
  subject?: string;
  ckpt?: string;
}

/** The graph for one painting. */
export function paintGraph(a: PaintArgs): Record<string, unknown> {
  const ckpt = a.ckpt ?? 'DreamShaperXL_Turbo_v2_1.safetensors';
  const turbo = /turbo|lightning/i.test(ckpt);
  const g: Record<string, unknown> = {
    ckpt: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckpt } },
    colour: { class_type: 'LoadImage', inputs: { image: a.colour } },
    depth: { class_type: 'LoadImage', inputs: { image: a.depth } },
    // the line art: edges found in the render itself (outlines, timbers, windows, courses)
    lines: { class_type: 'Canny', inputs: { image: ['colour', 0], low_threshold: 0.18, high_threshold: 0.42 } },
    pos: { class_type: 'CLIPTextEncode', inputs: { clip: ['ckpt', 1], text: `${a.subject ? `${a.subject}, ` : ''}${a.look.prompt}` } },
    neg: { class_type: 'CLIPTextEncode', inputs: { clip: ['ckpt', 1], text: a.look.negative } },
    cn: { class_type: 'ControlNetLoader', inputs: { control_net_name: 'controlnet-union-sdxl-promax.safetensors' } },
    cnDepth: { class_type: 'SetUnionControlNetType', inputs: { control_net: ['cn', 0], type: 'depth' } },
    cnLines: { class_type: 'SetUnionControlNetType', inputs: { control_net: ['cn', 0], type: 'canny/lineart/anime_lineart/mlsd' } },
    applyDepth: { class_type: 'ControlNetApplyAdvanced', inputs: { positive: ['pos', 0], negative: ['neg', 0], control_net: ['cnDepth', 0], image: ['depth', 0], strength: a.look.depth, start_percent: 0, end_percent: 0.9, vae: ['ckpt', 2] } },
    applyLines: { class_type: 'ControlNetApplyAdvanced', inputs: { positive: ['applyDepth', 0], negative: ['applyDepth', 1], control_net: ['cnLines', 0], image: ['lines', 0], strength: a.look.lines, start_percent: 0, end_percent: 0.75, vae: ['ckpt', 2] } },
  };
  let model: [string, number] = ['ckpt', 0];
  if (a.anchor) {
    g.anchor = { class_type: 'LoadImage', inputs: { image: a.anchor } };
    g.ipLoader = { class_type: 'IPAdapterUnifiedLoader', inputs: { model: ['ckpt', 0], preset: 'PLUS (high strength)' } };
    g.ip = { class_type: 'IPAdapterAdvanced', inputs: { model: ['ipLoader', 0], ipadapter: ['ipLoader', 1], image: ['anchor', 0], weight: 0.7, weight_type: 'style transfer', combine_embeds: 'concat', start_at: 0, end_at: 1, embeds_scaling: 'V only' } };
    model = ['ip', 0];
  }
  g.latent =
    a.mode === 'paintover'
      ? { class_type: 'VAEEncode', inputs: { pixels: ['colour', 0], vae: ['ckpt', 2] } }
      : { class_type: 'EmptyLatentImage', inputs: { width: a.width, height: a.height, batch_size: 1 } };
  g.sample = {
    class_type: 'KSampler',
    inputs: {
      model,
      positive: ['applyLines', 0],
      negative: ['applyLines', 1],
      latent_image: ['latent', 0],
      seed: a.seed,
      steps: turbo ? 10 : 32,
      cfg: turbo ? 2.2 : 6,
      sampler_name: turbo ? 'dpmpp_sde' : 'dpmpp_2m_sde',
      scheduler: 'karras',
      denoise: a.mode === 'paintover' ? a.look.denoise : 1,
    },
  };
  g.decode = { class_type: 'VAEDecode', inputs: { samples: ['sample', 0], vae: ['ckpt', 2] } };
  g.save = { class_type: 'SaveImage', inputs: { images: ['decode', 0], filename_prefix: `village/${a.look.name}` } };
  return g;
}
