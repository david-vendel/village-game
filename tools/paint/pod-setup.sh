#!/bin/bash
# Run once on the rented GPU machine (RunPod pod or any Linux box with an NVIDIA GPU and Python):
#   bash pod-setup.sh            installs ComfyUI and the models into /workspace (kept on the volume)
# then it starts ComfyUI on port 8188. Every later time: bash pod-setup.sh (skips what is there).
set -euo pipefail
ROOT=${ROOT:-/workspace}
cd "$ROOT"
[ -d ComfyUI ] || git clone --depth 1 https://github.com/comfyanonymous/ComfyUI
cd ComfyUI
pip install -q -r requirements.txt
[ -d custom_nodes/ComfyUI_IPAdapter_plus ] || git clone --depth 1 https://github.com/cubiq/ComfyUI_IPAdapter_plus custom_nodes/ComfyUI_IPAdapter_plus
HF=https://huggingface.co
dl() { mkdir -p "$(dirname "$2")"; [ -s "$2" ] || { echo "downloading $2"; wget -q --show-progress -O "$2.part" "$1" && mv "$2.part" "$2"; }; }
# the painter: an SDXL model tuned for painterly, illustrative pictures (CreativeML OpenRAIL++-M)
dl $HF/Lykon/dreamshaper-xl-v2-turbo/resolve/main/DreamShaperXL_Turbo_v2_1.safetensors models/checkpoints/DreamShaperXL_Turbo_v2_1.safetensors
# plain SDXL base, to compare against (CreativeML OpenRAIL++-M)
dl $HF/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors models/checkpoints/sd_xl_base_1.0.safetensors
# ControlNet union (depth, lines, …) for SDXL: holds the painting to the model's shape (Apache-2.0)
dl $HF/xinsir/controlnet-union-sdxl-1.0/resolve/main/diffusion_pytorch_model_promax.safetensors models/controlnet/controlnet-union-sdxl-promax.safetensors
# IP-Adapter: carries an approved painting's style to the rest (Apache-2.0)
dl $HF/h94/IP-Adapter/resolve/main/sdxl_models/ip-adapter-plus_sdxl_vit-h.safetensors models/ipadapter/ip-adapter-plus_sdxl_vit-h.safetensors
dl $HF/h94/IP-Adapter/resolve/main/models/image_encoder/model.safetensors models/clip_vision/CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors
dl $HF/madebyollin/sdxl-vae-fp16-fix/resolve/main/sdxl_vae.safetensors models/vae/sdxl_vae.safetensors
# FLUX.1-dev, fp8, one file with its text encoders and VAE (FLUX.1 [dev] Non-Commercial Licence: this project is non-commercial)
dl $HF/Comfy-Org/flux1-dev/resolve/main/flux1-dev-fp8.safetensors models/checkpoints/flux1-dev-fp8.safetensors
# oil-painting LoRAs for FLUX.1-dev (style tests): dtthanh (Apache-2.0), Muapi textured brush strokes (OpenRAIL++), bingbangboom oilscape (licence "other": tests only)
dl $HF/dtthanh/flux_oil_painting_lora/resolve/main/flux-oilpainting1.3-00001.safetensors models/loras/oil-dtthanh.safetensors
dl $HF/Muapi/oil-painting-style-for-flux-textured-brush-strokes-artistic-touch/resolve/main/oil-painting-style-for-flux-textured-brush-strokes-artistic-touch.safetensors models/loras/oil-muapi.safetensors
dl $HF/bingbangboom/flux_oilscape/resolve/main/flux_Oilstyle.safetensors models/loras/oilscape.safetensors
echo "starting ComfyUI on :8188"
exec python main.py --listen 0.0.0.0 --port 8188
