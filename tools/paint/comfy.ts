// A small client for a ComfyUI server's HTTP API (on the rented GPU): upload
// images, queue a workflow graph, wait for it, fetch what it saved.

export class Comfy {
  constructor(readonly url: string) {}

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const r = await fetch(`${this.url}${path}`, init);
    if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
    return (await r.json()) as T;
  }

  /** Whether the server answers, and its GPU. */
  async stats(): Promise<{ devices: Array<{ name: string; vram_total: number }> }> {
    return this.json('/system_stats');
  }

  /** Upload a PNG into ComfyUI's input folder; returns the name to use in LoadImage. */
  async upload(name: string, png: Buffer): Promise<string> {
    const form = new FormData();
    form.append('image', new Blob([new Uint8Array(png)], { type: 'image/png' }), name);
    form.append('overwrite', 'true');
    const r = await this.json<{ name: string; subfolder: string }>('/upload/image', { method: 'POST', body: form });
    return r.subfolder ? `${r.subfolder}/${r.name}` : r.name;
  }

  /** Unload every model and free the GPU (before a graph that patches weights, e.g. a LoRA on FLUX fp8). */
  async free(): Promise<void> {
    await fetch(`${this.url}/free`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ unload_models: true, free_memory: true }) });
  }

  /** Queue a graph and wait for it; returns the images it saved. */
  async run(graph: Record<string, unknown>, timeoutMs = 15 * 60_000): Promise<Buffer[]> {
    const { prompt_id } = await this.json<{ prompt_id: string }>('/prompt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: graph }) });
    const t0 = Date.now();
    for (;;) {
      const h = await this.json<Record<string, { outputs: Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }>; status?: { status_str: string; messages?: unknown[] } }>>(`/history/${prompt_id}`);
      const done = h[prompt_id];
      if (done) {
        if (done.status?.status_str === 'error') throw new Error(`ComfyUI failed: ${JSON.stringify(done.status.messages).slice(0, 2000)}`);
        const out: Buffer[] = [];
        for (const node of Object.values(done.outputs)) {
          for (const img of node.images ?? []) {
            const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder, type: img.type });
            const r = await fetch(`${this.url}/view?${q}`);
            out.push(Buffer.from(await r.arrayBuffer()));
          }
        }
        return out;
      }
      if (Date.now() - t0 > timeoutMs) throw new Error('ComfyUI: timed out');
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}
