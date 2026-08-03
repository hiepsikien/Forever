# Forever web landing

Philosophy-led early access site. Copy lives in `@forever/philosophy`.

```bash
npm install          # from repo root
npm run dev:web      # http://localhost:5173
npm run build:web
```

Waitlist: set `VITE_FORMSPREE_ID` or `VITE_WAITLIST_ENDPOINT` in `.env` (see `.env.example`). Without either, emails are kept in `localStorage` for local demos.
