# localCards - Local AI (Ollama) setup

The **✦ AI** panel in localCards is **optional** and **authoring-only**. It helps
you *write* cards - distilling notes into flashcards, suggesting keyword checks,
and generating mnemonics. **It never grades your answers** - that is always done
by the deterministic verification kernel, fully offline. *The AI writes the test;
the math grades the test.*

When enabled, it talks to a [local Ollama](https://ollama.com) at
`http://localhost:11434` - the only network call localCards can make, and only
while the AI panel is open. **No data leaves your machine.**

Because localCards runs from a `file://` URL, Ollama must accept requests from
any origin or it rejects the call before the browser sees it.

## 1. Install Ollama and pull a model

Install from [ollama.com](https://ollama.com), then pull a model:

```bash
ollama pull llama3.2          # fast; good for distilling/mnemonics
ollama pull qwen2.5-coder:7b  # stronger for technical material + strict JSON
```

## 2. Allow `file://` origins: set `OLLAMA_ORIGINS=*`

**Windows (persistent):** quit Ollama from the tray, add a User environment
variable `OLLAMA_ORIGINS` = `*`, relaunch Ollama.
**macOS:** `launchctl setenv OLLAMA_ORIGINS "*"` then restart Ollama.
**Linux (systemd):** `systemctl edit ollama` → `[Service]` /
`Environment="OLLAMA_ORIGINS=*"`, then `systemctl daemon-reload && systemctl restart ollama`.

## 3. Use it

Open `localCards.html`, click **✦ AI**. It auto-detects your models.

- **Distill to deck** - paste a datasheet / RFC / notes; the model drafts cards
  *and* their `coverage` keyword checks. You review before adding.
- **✦ AI: keywords from the back** (card editor) - the model proposes the
  required keywords; you edit them; the kernel grades from then on.
- **✦ AI: mnemonic** (review, on cards you keep missing) - a memory hook appended
  to the card's notes.

Everything the AI returns is **validated before it touches your deck**, and the
grading loop never calls it. If Ollama isn't running, the panel says so and the
rest of localCards works exactly the same.
