# Matchwinners Composer

## Description
Mapping editor built with Next.js where the root page [app/page.tsx](./app/page.tsx) renders the interactive [components/MappingEditor.tsx](./components/MappingEditor.tsx). The editor models canvases, sources, overlays, and playlists, combining responsive canvases with forms for editing zone geometry and metadata. Playlists rely on on-demand file enumeration through the filesystem-backed API in [app/api/list-media/route.ts](./app/api/list-media/route.ts). Sample data lives in [examples/mapping_multi.json](./examples/mapping_multi.json) and assumes absolute `media_root` paths that must exist on the machine running the server. The repo ships only placeholder assets in [public/](./public), so any production media must be provided separately.

## Interesting techniques
- High-DPI canvas scaling with [`ResizeObserver`](https://developer.mozilla.org/docs/Web/API/ResizeObserver) keeps `ZoneCanvas` visuals crisp across container resizes while syncing to `window.devicePixelRatio` ([components/MappingEditor.tsx](./components/MappingEditor.tsx)).
- Drag-and-drop playlist editing via HTML5 [`DataTransfer`](https://developer.mozilla.org/docs/Web/API/DataTransfer) streamlines reordering clips without leaving form mode ([components/MappingEditor.tsx](./components/MappingEditor.tsx)).
- File discovery uses the browser [`fetch`](https://developer.mozilla.org/docs/Web/API/fetch) API to query a local Next route, enabling media suggestions without bundling assets ([components/MappingEditor.tsx](./components/MappingEditor.tsx)).

## Non-obvious technologies/libraries
- [lucide-react](https://lucide.dev/) provides lightweight SVG icon components for toolbar affordances.
- [Tailwind CSS](https://tailwindcss.com/) powers utility-first styling with project-specific brand colors ([tailwind.config.ts](./tailwind.config.ts)).

## Project structure
```text
.
├── .gitignore
├── README.md
├── app/
│   ├── api/
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── MappingEditor.tsx
│   └── ui/
├── examples/
│   └── mapping_multi.json
├── public/
│   ├── favicon.ico
│   ├── icon.png
│   └── logo.png
├── tailwind.config.ts
├── tsconfig.json
├── package.json
├── pnpm-lock.yaml
└── postcss.config.js
```
- `components/` contains the primary editor plus archived variants for reference and UI primitives under `ui/`.
- `app/api/` exposes filesystem-backed endpoints that expect readable absolute paths at runtime.
