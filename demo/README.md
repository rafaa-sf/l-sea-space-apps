# Project Demo deck

PowerPoint deck for the NASA Space Apps **Project Demo** (7 slides including the
cover, per the participant guide).

- File: `demo/L-SEA-Project-Demo.pptx` (16:9, English)
- Content: mirrors [docs/demo-script.md](../docs/demo-script.md)
- Screenshots: [docs/screenshots/](../docs/screenshots/)
- Speaker notes are included in each slide's notes pane.

## Regenerate

```bash
python3 -m pip install --user python-pptx
python3 scripts/demo/build-demo-deck.py
```

## Publish

The Project Demo must be a **single public link** that opens without password,
permission or registration. Upload the deck (or its PDF export) to Drive/OneDrive
with "anyone with the link" access and put that URL in the Project page.

To export a PDF:

```bash
libreoffice --headless --convert-to pdf --outdir demo demo/L-SEA-Project-Demo.pptx
```

## Alternative

A 30-second video script is in
[docs/demo-script.md](../docs/demo-script.md#option-b--30-second-video-script).
The project demo can be the slides **or** the video, not both.
