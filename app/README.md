# David Whyte Experience — local reconstruction

High-fidelity, local-only reconstruction of the Experience page. The source baseline is the
read-only internal mirror at `../sources/original-extraction`; it is never imported at runtime.

## Run

```powershell
npm ci
npm run dev
```

Production verification:

```powershell
npm run verify
```

`verify` builds the production bundle and checks all 73 local assets by byte size and SHA-256
against the generated source manifest and the internal source mirror. Its report is written to
`.artifacts/qa/integrity-report.json`.

## Rendering architecture

- The baked `Camera_Action_Baked` animation is sampled from real document scroll height.
- Raw scroll controls reveal triggers; a frame-rate-independent, 1.5%-bounded sample controls
  the camera so input responds on the next frame without losing all inertia.
- GLB paper meshes are hidden authoring/raycast proxies. Visible paint is one shared 10×10
  subdivided instanced plane using the verified texture and mask atlases.
- Every paper owns an isolated fluid-atlas region. Desktop hover and press inject watercolor;
  touch injects only while dragging.
- All 26 paper layers begin flat and follow their original scroll-triggered rise, curve and
  ink-reveal sequence.

## Review mode

Append `?debug=1&seed=42` to enable local checkpoint controls and deterministic reveal points.
Append `&freeze=1` to freeze shader time. Debug controls are unavailable in production builds.

With the dedicated Chrome CDP profile running on port `9333`, use `npm run qa` to capture the
five acceptance viewports, camera checkpoints, ripple, Full Paint, FAQ, Restart and reduced
motion fallback. The accepted baseline is retained at
`../evidence/qa/accepted-2026-08-20/report.json`; new runs write only to ignored `.artifacts`.

Commercial purchase and gift actions intentionally remain disabled. When WebGL is unavailable,
or the visitor requests reduced motion, the page switches to the readable DOM fallback.

Source provenance is recorded in `src/config/sourceManifest.ts` and
`src/config/source-assets.manifest.json`. The migration record is preserved at
`../evidence/migration/migration-manifest.json`; the two v1 ChatGPT patches remain available as
historical evidence under `../archive/legacy-v1-patches`.
