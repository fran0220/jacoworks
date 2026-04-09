---
name: asset-gateway
description: >
  Generates and post-processes assets through the bundled asset-gateway CLI.
  Use when the user asks to create or edit images, video, audio, music, TTS,
  text, 3D models, sprites, worlds, or upload generated files through the bash tool.
---

# Asset Gateway

Use the bundled `asset-gateway` CLI through `bash`.

## Core Rules

- Always run from the user's workspace and always pass an explicit `--output-dir`.
- If you are unsure about flags, inspect the live CLI instead of guessing:

```bash
asset-gateway generate --help
asset-gateway describe generate
asset-gateway process --help
asset-gateway upload --help
```

- The sidecar injects the needed gateway configuration. Do not ask the user for tokens in the normal path.

## Local File Inputs Vs URLs

Some generation commands expect URLs for input assets.

- If a command accepts a URL and the user gave you a local file, upload it first:

```bash
asset-gateway upload file ./cover.png
```

- Reuse the returned public URL in `--input`, `--ref`, `--image`, or `--multiview`.

## Generate Commands

### Image

```bash
asset-gateway generate image \
  --prompt "Editorial poster of a silver robot reading a newspaper in a cafe" \
  --size 1024x1024 \
  --output-dir ./output
```

Image editing with an uploaded input URL:

```bash
asset-gateway generate image \
  --prompt "Keep the subject, replace the background with a neon rainy street" \
  --input "https://cdn.example.com/source.png" \
  --edit-mode restyle \
  --output-dir ./output
```

### Video

```bash
asset-gateway generate video \
  --prompt "Slow cinematic fly-through of a mossy temple at sunrise" \
  --output-dir ./output
```

Image-to-video with uploaded input URL:

```bash
asset-gateway generate video \
  --prompt "Animate the character waving and blinking" \
  --input "https://cdn.example.com/character.png" \
  --output-dir ./output
```

### Batch

```bash
asset-gateway generate batch \
  --prompt "tiny fox idle pose" "tiny fox run pose" "tiny fox jump pose" \
  --asset-type image \
  --compose horizontal \
  --frame-size 256x256 \
  --output-dir ./output
```

### Audio

```bash
asset-gateway generate audio \
  --prompt "Mechanical keyboard typing in a quiet office" \
  --type sfx \
  --duration 8 \
  --output-dir ./output
```

### Music

```bash
asset-gateway generate music \
  --prompt "Light upbeat lo-fi study music with soft piano" \
  --duration 30 \
  --force-instrumental \
  --output-dir ./output
```

### TTS

```bash
asset-gateway generate tts \
  --prompt "欢迎来到 JAcoworks，本次演示将展示新的本地 Agent 工作流。" \
  --voice Cherry \
  --language Chinese \
  --output-dir ./output
```

ElevenLabs example:

```bash
asset-gateway generate tts \
  --prompt "This is a product demo voiceover." \
  --provider elevenlabs \
  --voice-id VOICE_ID_HERE \
  --output-dir ./output
```

### 3D Model

```bash
asset-gateway generate model \
  --prompt "A stylized ceramic cat figurine" \
  --pbr \
  --texture-quality detailed \
  --output-dir ./output
```

### Text

```bash
asset-gateway generate text \
  --prompt "Write a concise landing page headline and subheadline for an AI desktop app" \
  --max-tokens 300 \
  --output-dir ./output
```

### Sprite

```bash
asset-gateway generate sprite \
  --prompt "Small wizard in a blue cloak" \
  --animation-type walk \
  --direction right \
  --style "pixel art" \
  --output-format spritesheet \
  --output-dir ./output
```

### World

```bash
asset-gateway generate world \
  --prompt "A peaceful floating island village above the clouds" \
  --model marble-1.1 \
  --display-name "floating-island-village" \
  --output-dir ./output
```

## Upload

Upload a local file and get a public URL:

```bash
asset-gateway upload file ./output/cover.png
```

Use this before commands that require a URL rather than a local path.

## Process Commands

### Crop

```bash
asset-gateway process crop \
  --input ./output/icon.png \
  --mode tightest \
  --output-dir ./output
```

### Resize

```bash
asset-gateway process resize \
  --input ./output/icon.png \
  --width 512 \
  --height 512 \
  --output-dir ./output
```

### Remove Background

```bash
asset-gateway process remove-bg \
  --input ./output/photo.png \
  --output-dir ./output
```

### Compose

```bash
asset-gateway process compose \
  --input ./frame-1.png ./frame-2.png ./frame-3.png \
  --direction grid \
  --columns 3 \
  --output-dir ./output
```

### Extract Frames

```bash
asset-gateway process extract-frames \
  --input ./output/demo.mp4 \
  --count 6 \
  --output-dir ./output
```

## Choosing Commands

- `generate image` for still image creation or editing.
- `generate video` for motion clips.
- `generate audio` for sound effects or background audio.
- `generate music` for music tracks.
- `generate tts` for speech.
- `generate model` for 3D assets.
- `generate sprite` for 2D character animation sheets or GIFs.
- `generate world` for explorable 3D environments.
- `generate text` for copywriting or LLM-generated text artifacts.
- `generate batch` for multiple related assets in one run.
- `process ...` for local asset cleanup and composition.
- `upload file` when another command needs a public URL.

## Troubleshooting

- If a command fails because an input must be a URL, upload the file first and retry with the returned URL.
- If you need a less common flag, read `asset-gateway describe generate` or the relevant `--help` output before rerunning.
- If generation fails server-side, report the failure briefly and retry with a simpler prompt or fewer options.

## Quick Reference

| Goal | Command |
|------|---------|
| Image | `asset-gateway generate image --prompt "..." --output-dir ./output` |
| Video | `asset-gateway generate video --prompt "..." --output-dir ./output` |
| Audio | `asset-gateway generate audio --prompt "..." --output-dir ./output` |
| Music | `asset-gateway generate music --prompt "..." --output-dir ./output` |
| TTS | `asset-gateway generate tts --prompt "..." --output-dir ./output` |
| 3D model | `asset-gateway generate model --prompt "..." --output-dir ./output` |
| Sprite | `asset-gateway generate sprite --prompt "..." --output-dir ./output` |
| World | `asset-gateway generate world --prompt "..." --output-dir ./output` |
| Upload | `asset-gateway upload file ./file.png` |
| Processing help | `asset-gateway process --help` |
