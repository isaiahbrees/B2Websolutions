# ReelForge

**Turn website redesigns into scroll-stopping videos.**

Paste two URLs — a client's old site and your redesign — and ReelForge films
both in a real browser with cinematic camera work, then renders a social-ready
before/after video: Instagram Reels, TikToks, Facebook, LinkedIn, square posts.

Built for web design agencies, freelancers, and anyone who ships redesigns and
wants the content to prove it.

## How a reel gets made

1. **Capture** — headless Chromium loads each URL, dismisses cookie banners
   and marketing popups, forces lazy images eager, preserves WebGL scenes,
   detects the visually interesting sections (hero, bento cards, testimonials,
   pricing, CTAs), and takes a sharp full-page still.
2. **Film** — a 60fps compositor screencast records a scripted *tour*:
   glide to a section with eased acceleration, settle, dwell, glide on. The
   footage is assembled into a seekable constant-frame-rate webm.
3. **Compose** — a Remotion composition builds the story around the footage:
   intro card, labeled before/after tours with camera push-ins timed to the
   recorded dwells, a soft transition, branded end card, optional music bed,
   watermark on free-plan exports.
4. **Ship** — download the MP4, share a client delivery link, or post to a
   Facebook Page directly. Platform captions, hashtags, and a client delivery
   message are generated with every project.

Every stage degrades gracefully: screencast → standard recorder → stills.
A job always ends in a watchable reel.

## The product

- **Landing page** at `/` and the app at `/app` (session login).
- **Dashboard** — usage, active renders, recent projects, quick templates.
- **New reel wizard** — basics → story type → template → format → generate.
- **Project workspace** — preview player, scene timeline (with detected
  camera dwells), style editor with fast re-render (captures are reused),
  social copy panel, publish controls, client delivery link.
- **8 templates** — Clean Agency, Dark Luxury, Split Comparison, Fast Social
  Ad, Client Reveal, Portfolio Case Study, Local Business Upgrade, SaaS
  Launch. Templates are data (`src/templates.ts`) driving pacing, camera
  intensity, colors and copy.
- **Brand kits** — per-client logo, colors, CTA, end-card message; the
  default kit applies to new projects automatically.
- **Assets** — logo/music uploads served to the renderer.
- **Plans & usage** — Free / Starter $29 / Pro $79 / Agency $199 with real
  enforcement: export quotas, resolution caps, 60fps, watermarking, brand-kit
  limits, template gating, white-label delivery pages. Stripe-ready: gates go
  through one module (`src/server/plans.ts`), plan ids map to future prices.

## Run it locally

Requires Node 20+.

```
npm install
npx playwright install chromium ffmpeg
cp .env.example .env    # set ADMIN_EMAIL, ADMIN_PASSWORD, SESSION_SECRET
npm run web             # → http://localhost:3000
```

CLI (no UI): `npm run make -- --before <url> --after <url> --client "Name"`.

## Deploy

The renderer needs a long-lived server (headless Chrome + minutes-long
renders), so serverless hosts (Vercel/Netlify functions) can't run it.
The included `Dockerfile` deploys in one click on **Railway** (or Render/Fly):

1. railway.com → New Project → Deploy from GitHub repo.
2. Variables: `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SESSION_SECRET`, and
   optionally `FB_PAGE_ID`/`FB_PAGE_ACCESS_TOKEN`, `MAKE_WEBHOOK_URL`,
   `PLAN` (free|starter|pro|agency), `WORKSPACE_NAME`.
3. Settings → Networking → Generate Domain.

Give the service 2GB+ RAM. Workspace data lives in `data/`, projects in
`out/jobs/` — attach a volume at `/app/data` and `/app/out` to survive
redeploys.

## Architecture

```
src/branding.ts            product name/tagline (rename = one file)
src/templates.ts           template registry + story types + formats
src/capture.ts             site analysis + stills (sections, popups, WebGL)
src/screencast.ts          60fps CFR assembly from compositor frames
src/render.ts              Remotion bundling/rendering, quality settings
src/remotion/              composition: canvas formats, camera, components
src/server/
  index.ts                 routes (pages + JSON APIs)
  jobs.ts                  project queue: capture → film → render → publish
  store.ts                 data layer (JSON repos today, Postgres-shaped)
  plans.ts                 plan catalog + gates (Stripe-ready)
  copy.ts                  caption/hashtag/delivery-message generator
  scenes.ts                scene model derived from real render info
  auth.ts                  signed-cookie sessions
  ui/                      landing + app pages (no build step)
```

## License note

Remotion is free for individuals and companies up to 3 employees; larger
teams need a [company license](https://remotion.dev/license).
