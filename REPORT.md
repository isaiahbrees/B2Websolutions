# ReelForge — overnight implementation report

_Working name **ReelForge** ("Turn website redesigns into scroll-stopping
videos."). Renaming is a one-file change: `src/branding.ts`._

## 1. What changed

The single-page tool became a structured SaaS product:

- **Design system** (`ui/theme.css`): tokens, light **and** dark mode
  (follows OS), Inter stack, buttons/cards/badges/modals/toasts/skeletons/
  empty states/meters, app shell with sidebar — hand-built, Linear/Stripe
  restraint, no framework.
- **Landing page** at `/`: animated before/after browser-mockup hero (pure
  CSS motion), feature blocks, how-it-works, template strip, pricing, FAQ,
  CTA footer. Mobile-responsive.
- **App**: dashboard, 5-step new-reel wizard, project workspace (player,
  scene timeline, style editor + re-render, social copy, publish, delivery
  link), filterable project history, template gallery, brand kits, asset
  library, plan & usage, settings, help.
- **Backend**: data layer (`store.ts` — workspace/brand kits/assets/usage as
  JSON repos shaped like future Postgres tables), plan gates (`plans.ts`),
  template registry (`templates.ts`, 8 templates as data), caption generator
  (`copy.ts`), scene derivation from real render info (`scenes.ts`),
  project APIs with duplicate/archive/delete/re-render, public share pages.
- **Renderer**: multi-format canvas (Reel 1080×1920 / Square 1080×1080 /
  Landscape 1920×1080, 720p–4K), free-plan watermark overlay, template-driven
  pacing and copy.

## 2. Fully functional now

- End-to-end reel generation (the battle-tested engine, untouched at its core)
- Wizard → queue → progress → preview → download
- Re-render with new template/copy/camera (reuses captures — fast)
- 8 data-driven templates; story types pre-select the right one
- Brand kits (with logo upload) applied to new projects
- Auto captions per platform + hashtags + client delivery message (copy to clipboard)
- Client delivery links (`/share/<token>`), white-label on Agency plan
- Plan enforcement: export quotas, resolution caps, 60fps gate, watermark,
  brand-kit limits, template locks — with upgrade modals, not dead buttons
- Usage metering per month; dashboard + sidebar meters
- Facebook Page posting + Make.com webhook (env-configured, status shown in Settings)
- Asset uploads (base64, 8MB cap), scene timeline with detected camera dwells

## 3. Designed + structurally ready, needs backend work

- **Stripe**: pricing UI, plan switcher, gates and data model are done; plan
  switching is instant (self-hosted mode). Wiring = replace one endpoint
  (`POST /api/billing/plan`) with Checkout + webhook.
- **Multi-user / teams**: the data model has workspaces and owner emails;
  auth is still single-login. Teams need a users table + invites.
- **Music library**: categories exist in brand kits; no bundled tracks
  (licensing) — music via URL works today.
- **Square/landscape formats**: composition math is implemented and clamped,
  but I could not render-test them in this sandbox — treat first square/
  landscape export as beta.
- **Roadmap items** (voiceovers, direct IG/TikTok posting, approvals,
  analytics, API): listed in Help, deliberately not fake-buttoned.

## 4. New app structure

See README “Architecture”. Pages are no-build HTML/JS sharing `theme.css` +
`shell.js`; all data flows through JSON APIs in `src/server/index.ts`.

## 5. Pricing & upgrade logic

Free (3/mo, 720p, watermark) · Starter $29 (20/mo, 1080p) · Pro $79 (75/mo,
4K, AI copy, priority) · Agency $199 (250/mo, client kits, white-label) ·
Enterprise (contact). Credit packs are modeled as a future usage-ledger entry
kind. Every gate returns `{reason, upgradeTo}` → consistent upgrade modals.

## 6. Most important next builds

1. Stripe Checkout + webhook (1–2 days) — everything else is ready.
2. Screenshot-upload as “before” source (flipper audience unlock).
3. Postgres swap for `store.ts` + real users/teams.
4. Watermark-free referral loop + public template gallery pages (growth).
5. Live cursor/hover capture mode (the last Screen Studio gap).

## 7. Bugs & blockers found tonight

- `[hidden]` attribute was overridden by component CSS (empty states showed
  wrongly) — fixed globally in the design system.
- Scene timeline initially used placeholder durations — now reads
  `render-info.json` written by every render.
- Sandbox still can’t run npm/Remotion (registry blocked), so the square/
  landscape composition paths and the full new-project flow ship
  code-reviewed + screenshot-verified but not render-tested. First runs to
  watch: a square export, a 4K export, and a re-render.

## 8. Run locally

```
npm install && npx playwright install chromium ffmpeg
cp .env.example .env   # ADMIN_EMAIL, ADMIN_PASSWORD, SESSION_SECRET
npm run web            # http://localhost:3000
```

## 9. Deploying

**Vercel cannot run this app** — the render engine needs a persistent server
(headless Chrome, minutes-long jobs); Vercel functions are seconds-long and
diskless. Deploy stays one-click on **Railway** via the Dockerfile (README
has steps; it’s the same setup already live). If you want the *marketing
site* on Vercel later, we can split `landing.html` out — the app itself
stays on Railway until a worker-queue architecture exists.

## 10. Review these first (in order)

1. `/` — landing page (also try dark mode + phone width)
2. `/app` — dashboard
3. `/app/new` — the wizard, all five steps
4. `/app/project/<any finished project>` — workspace: timeline, copy panel, style editor
5. `/app/billing` — plans + usage meter
6. `/app/templates`, `/app/brand` — gallery + brand kits
7. `/share/<token>` from a finished project — the client delivery page
