# Contributing

Keep changes focused and describe the user-visible problem they solve. Include verification steps and screenshots for interface changes.

## Development boundaries

- Edit standalone HTML, CSS, JavaScript, and Python sources where available.
- The original frontend build project is not available. Avoid editing generated bundles unless a source-level solution is impossible.
- Keep provider definitions in `source-catalog.js`; both the detail page and player consume this catalogue.
- Never commit API tokens, server credentials, personal data, database files, or operational notes.

## Before submitting

1. Check Python syntax with `python -m compileall -q app_main.py books_backend.py theater_backend.py wsgi.py`.
2. Check modified JavaScript with `node --check FILE.js`.
3. Verify affected pages at desktop and mobile widths.
4. For playback changes, verify both a movie and a TV episode, switching sources, next-episode navigation, and existing progress handling.
5. Bump script cache versions when changing deployed browser files.
6. Run `python3 scripts/check_privacy.py` before pushing. It checks tracked files without printing matching secret values.

Explain any untested third-party behavior rather than describing an iframe load as successful playback.
