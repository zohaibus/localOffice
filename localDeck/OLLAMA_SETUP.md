# localDeck - Local AI (Ollama) setup

The **AI** panel in localDeck is optional. It talks to a [local Ollama](https://ollama.com)
running on your own machine at `http://localhost:11434`. **No data ever leaves
your computer** - it's the only network call localDeck makes, and the AI never
changes the deck on its own (it proposes text or a slide patch; you apply it).

Because localDeck runs from a `file://` URL, Ollama must be told to accept
requests from any origin, or it rejects the call before the browser sees it.

## 1. Install Ollama and pull a model

Install from [ollama.com](https://ollama.com), then pull at least one model:

```bash
ollama pull llama3.2          # fast, good for the Assist (freeform) mode
ollama pull qwen2.5-coder:7b  # better for the Draft-slide (JSON) mode
```

## 2. Allow `file://` origins: set `OLLAMA_ORIGINS=*`

**Windows (persistent):**
1. Quit Ollama from the system tray (it ignores env vars set after it starts).
2. Start menu → "Environment Variables" → add a **User variable**
   `OLLAMA_ORIGINS` = `*`.
3. Relaunch Ollama. Verify in PowerShell: `echo $env:OLLAMA_ORIGINS` → `*`.

**macOS:** `launchctl setenv OLLAMA_ORIGINS "*"` then restart Ollama.
**Linux (systemd):** `systemctl edit ollama` →
`[Service]` / `Environment="OLLAMA_ORIGINS=*"`, then
`systemctl daemon-reload && systemctl restart ollama`.

## 3. Use it

Open `localDeck.html`, click **✦ AI**. It auto-detects running models.
- **Assist** - freeform help; insert the reply into the focused field or notes.
- **Draft slide** - returns a JSON patch for the current slide's fields, which
  you review and apply.

If detection fails, the panel says so and the rest of localDeck works normally -
AI is entirely optional.
