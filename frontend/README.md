# Smart Patents — Frontend

A React + TypeScript single-page app for the Smart Patents platform: filing and examining patents,
prior-art search, and user administration — built on a token-driven design system every screen
draws from rather than restyling.

## Stack

- **React 18 + TypeScript + Vite**
- **react-router-dom** for routing
- Plain CSS with **design tokens** (CSS custom properties) — no UI framework, so the visual identity
  is fully owned and consistent
- No component library and no icon dependency (icons are hand-drawn SVG)

## Getting started

```bash
cp .env.example .env      # optional; dev works with the Vite proxy defaults
npm install
npm run dev               # http://localhost:5173
```

The backend must be running on `:5000` (`npm run dev` in the repo root, with Postgres up). Vite
proxies `/api` → `http://localhost:5000`, so the app is same-origin in development.

```bash
npm run build       # type-check (tsc -b) + production bundle
npm run preview     # serve the production build
npm run typecheck   # types only
```

## Design system

The foundation lives in `src/styles/tokens.css` — colour, typography, spacing, radius, elevation,
motion, and z-index, all as CSS custom properties. Light and dark themes re-map only the *semantic*
layer, so components never branch on theme. **Browse it live at `/design-system`** once signed in.

Design direction, grounded in the subject (patent drawings, legal instruments, certification seals):

- **Colour** — a cool, document-neutral palette; blueprint-indigo primary; a brass "seal" accent
  used sparingly for certification and admin emphasis; semantic success/warning/danger.
- **Type** — the **IBM Plex** superfamily: Serif for headings (document gravitas), Sans for UI,
  **Mono for every identifier** (user references, filing numbers).
- **Signature** — an engraved certification seal, a blueprint-grid brand panel, and status/role
  badges rendered as ruled ink stamps.

Theme is light/dark with a toggle; it follows the OS preference until the user chooses.

## Architecture

```
src/
  components/
    ui/          reusable design-system components (Button, Input, Modal, Table, Badge, Toast, …)
    layout/      app shell (Sidebar, Topbar), AuthLayout, guards' loaders
    brand/       Brandmark (the seal)
    icons/       hand-drawn SVG icon set
  context/       AuthContext, ThemeContext, ToastContext
  hooks/         useAsync (fetch + abort + retry), useDebounced
  pages/         one folder/file per route; patents/ holds the module and its components/
  routes/        ProtectedRoute, AdminRoute, PublicOnlyRoute
  services/      apiClient (typed, auto-refresh), authService, userService, patentService,
                 catalogService, tokenStore
  styles/        tokens.css, base.css
  types/         shared domain + API types
  utils/         validation (mirrors backend rules), formatting
```

Conventions:

- **Business/data logic stays in `services/` and `context/`.** Pages compose components and handle
  view state only.
- **Styling comes from the design system.** Components use token variables and shared classes; there
  are no per-page colour or spacing overrides.
- `@/` aliases `src/` (configured in both `tsconfig.json` and `vite.config.ts`).

Three things in the Patents module are worth knowing before you change them:

- **A document is uploaded when it is chosen, not when the form is saved.** The browser PUTs
  straight to object storage over a presigned URL and the form only carries the resulting key, so
  bytes never touch the API. Abandoning the form therefore orphans an object — an accepted cost,
  and cheaper than streaming multi-megabyte specifications through Node. The presigned URL must
  name a host the *browser* can reach; if uploads fail inside Docker, check `S3_PUBLIC_ENDPOINT`
  on the backend rather than the frontend.
- **Inventor order is list position.** The API requires a contiguous `1..N`, so `order` is derived
  from the index and a gap is unrepresentable rather than a validation error.
- **Anything the AI wrote is visibly marked as generated.** Explanations sit in their own tinted
  block rather than in the same type as the patent's own text, and the similarity card is labelled
  advisory — because it is. The AI gates nothing; a person makes every decision.

## Auth & data flow

- Login/signup store an access + refresh token (`tokenStore`, localStorage).
- `apiClient` attaches the access token, and on a `401` transparently refreshes once and retries;
  concurrent refreshes are de-duplicated.
- `AuthContext` hydrates the session on load and exposes `user`, `status`, and `isAdmin`.
- Every async surface handles four states explicitly: **loading** (skeletons/spinner), **success**,
  **empty** (guidance, not a blank screen), and **error** (with retry).

## Routes

| Path              | Access        | Purpose                                             |
| ----------------- | ------------- | --------------------------------------------------- |
| `/login`          | Public        | Sign in                                             |
| `/signup`         | Public        | Register (creates a `user`)                         |
| `/`               | Authenticated | Dashboard (admin sees directory stats)              |
| `/profile`        | Authenticated | View/edit profile, change password                  |
| `/patents`        | Authenticated | Registry list: search, status/category filters, "only mine", pagination |
| `/patents/new`    | Authenticated | File a patent — form plus direct-to-storage document upload |
| `/patents/search` | Authenticated | Prior-art search: semantic, with per-match LLM explanations |
| `/patents/:id`    | Authenticated | Filing detail, examination trail, and the actions the viewer is entitled to |
| `/patents/:id/edit` | Owner       | Amend a `draft` or `declined` filing |
| `/review-queue`   | Admin only    | Filings awaiting a decision, ranked by AI prior-art score |
| `/design-system`  | Authenticated | Living component & token showcase                    |
| `/users`          | Admin only    | User directory (search, role filter, pagination)    |
| `/users/:id`      | Admin only    | User detail with audit info                          |

## Accessibility & responsiveness

Keyboard-navigable (focus-visible rings, modal focus trap, arrow-key tabs), respects
`prefers-reduced-motion`, labelled controls with `aria-*` wiring, and responsive from wide desktop
down to a mobile drawer.
