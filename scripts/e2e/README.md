# Browser checks (headless Chrome via CDP)

Start Chrome with `--remote-debugging-port=9333 --headless`, run `npm run dev`, then:

```
node --experimental-websocket scripts/e2e/cdp.mjs http://localhost:1420/ scripts/e2e/views.json
```

`views.json` cycles Modell → Vorschau → Modell, Vorschau → 2D → Modell, 2D → Vorschau → Modell
and rapid clicks. Every logged line must show the same `x`/`y` (screen position of a point on
the model) and `aspect` equal to `canvas`.
