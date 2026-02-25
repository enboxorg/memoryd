---
"@enbox/memoryd": patch
---

Gracefully handle sqlite-vec extension loading failure — falls back to FTS5-only search when the SQLite build lacks dynamic extension loading support (e.g. some Bun versions on macOS).
