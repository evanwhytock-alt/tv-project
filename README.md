# tv-project

A simple browser AI face bot that:

- Draws a face inspired by the provided design.
- Listens through your microphone (Web Speech API recognition).
- Talks back with text-to-speech (Speech Synthesis API).
- Changes facial expression based on what you say.

## Run locally

Because this is a static web app, you can open `index.html` directly, but using a small local server is recommended for microphone permissions.

```bash
python3 -m http.server 8000
```

Then open: <http://localhost:8000>
