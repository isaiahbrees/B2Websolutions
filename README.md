# ReelWorks — before/after website reels, on autopilot

Paste two URLs, get a polished vertical video showing the client's old site
next to your redesign, and post it straight to your Facebook Page.

```
npm run make -- \
  --before "https://web.archive.org/web/2024/https://old-client-site.com" \
  --after  "https://shiny-new-site.com" \
  --client "Acme Plumbing" \
  --post reel
```

The pipeline:

1. **Capture** — headless Chromium (Playwright) loads each URL, dismisses
   cookie banners, waits for fonts, triggers lazy-loaded and scroll-reveal
   content, saves a sharp retina full-page screenshot, and **detects page
   sections** (hero, cards, testimonials, pricing, CTAs…) for the camera plan
   (`src/capture.ts`).
2. **Render** — a Remotion composition (`src/remotion/`) turns the captures
   into a vertical reel with a **smart camera**: eased human-feel scrolling,
   gentle push-ins on detected sections with holds and pull-backs, a soft
   flash transition, small BEFORE/AFTER corner labels, and branded intro/end
   cards. Three templates (Clean Agency, Dark Luxury, Split Comparison),
   three camera intensities, three scroll speeds, 1080p or 4K, 30 or 60 fps.
3. **Post** — the mp4 is published to your Facebook Page as a Reel or feed
   video via the Meta Graph API (`src/post/facebook.ts`), or handed to a
   Make.com webhook if you'd rather let Make handle Facebook (`src/post/make.ts`).

Because the "screen recording" is scripted, the whole camera path is planned
up front from real page structure — no editing, no cursor tracking, and the
result is deterministic and smooth at any frame rate.

## Setup

Requires Node 20+. Works on Windows, macOS, and Linux.

```
npm install
npx playwright install chromium
copy .env.example .env   # then fill in the values you need (macOS/Linux: cp)
```

The first render downloads Remotion's headless browser automatically.

## The web app

```
npm run web
```

Open http://localhost:3000, sign in with the `ADMIN_EMAIL` / `ADMIN_PASSWORD`
you set in `.env`, paste the two URLs, and hit **Create reel**. The dashboard
shows live progress (capturing → rendering → posting), previews the finished
video, and has one-click posting to Facebook (Reel or feed video) or Make.com.
Jobs land in `out/jobs/` and survive restarts.

It's a single-login app for your agency. To let teammates in, share the login
or put the app behind something like Cloudflare Access — proper multi-user
accounts are on the roadmap. If you expose it to the internet, run it behind
HTTPS (Caddy, nginx, Cloudflare Tunnel) and set a strong `SESSION_SECRET`.

## Deploying it (get a real URL, not localhost)

**Heads up: Vercel/Netlify won't work for this app.** They run serverless
functions that must respond in seconds, with no persistent processes or disk —
this app keeps a render queue alive and spends minutes per video in headless
Chrome. You need a host that runs a long-lived server. The included
`Dockerfile` makes that one click on:

**Railway** (easiest):

1. Go to [railway.com](https://railway.com) → **New Project** →
   **Deploy from GitHub repo** → pick this repo and branch. It detects the
   Dockerfile automatically.
2. In the service's **Variables** tab, add `ADMIN_EMAIL`, `ADMIN_PASSWORD`,
   `SESSION_SECRET` (any long random string), and your `FB_PAGE_ID` /
   `FB_PAGE_ACCESS_TOKEN` (or `MAKE_WEBHOOK_URL`).
3. **Settings → Networking → Generate Domain**. Open the URL, log in, make a
   reel.

**Render**: New → Web Service → connect the repo (runtime: Docker), add the
same environment variables, pick at least the **2 GB RAM** instance — video
rendering is hungry, 512 MB free-tier instances will fall over.

Notes for hosted deploys:

- Give the service **2 GB+ RAM and 2 vCPUs** for comfortable renders.
- Job history lives on the container's disk (`out/jobs/`), which resets on
  redeploy. Attach a volume mounted at `/app/out` if you want it to stick
  around; finished videos are also posted/downloadable, so losing history is
  cosmetic.
- If you ever *do* want the Vercel-style serverless route, the play is
  Remotion Lambda for rendering + a screenshot API for capture + S3 for
  storage — a bigger rebuild, worth it only at real volume.

## CLI usage

Full pipeline (capture + render, no posting):

```
npm run make -- --before <url> --after <url> --client "Client Name"
```

Everything lands in `out/<client>-<date>/` — check `reel.mp4`, then post it:

```
npm run post -- --video out/acme-plumbing-2026-07-02/reel.mp4 --caption "..." --via reel
```

Or do it all in one shot with `--post reel` (Reel), `--post facebook`
(feed video), or `--post make` (Make.com webhook).

Useful flags on `run`/`render`:

| Flag | What it does |
| --- | --- |
| `--headline "..."` | Hook line on the opening card |
| `--brand "..."` / `--cta "..."` | End-card branding |
| `--accent "#22d3ee"` | Accent color (progress bar, CTA pill) |
| `--music music.mp3` | Background track (path relative to `public/`) |
| `--scale 0.5` | Half-resolution render for fast previews |
| `--caption "..."` | Facebook caption (defaults to headline + CTA) |

Tips:

- **The old site is usually already gone by the time you post.** Use a
  Wayback Machine snapshot as the before URL:
  `https://web.archive.org/web/2024/https://client-site.com`.
- **Preview and tweak the template live** with `npm run studio` — edit props
  in the right-hand panel, edit the look in `src/remotion/`.
- **Music**: drop an mp3 into `public/` and pass `--music yourfile.mp3`.
  Use licensed/royalty-free tracks — Facebook mutes or removes videos with
  flagged audio.

## Getting a Facebook token

To post to a Page **you admin**, no app review is needed:

1. Create an app at [developers.facebook.com](https://developers.facebook.com)
   (type: Business).
2. In [Graph API Explorer](https://developers.facebook.com/tools/explorer/),
   select your app, click **Get User Access Token**, and grant
   `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`.
3. Exchange it for a long-lived token (Graph Explorer → the ⓘ icon →
   "Open in Access Token Tool" → Extend), then call `GET /me/accounts` —
   the `access_token` in the response for your Page is a **Page token that
   doesn't expire**. Put it in `.env` with the Page ID.

Posting to **client-owned** Pages needs Meta app review for
`pages_manage_posts` — that's the point where it's saner to route through
Make.com (`--post make` + a "Custom webhook → Facebook Pages: Upload a Reel"
scenario) or a scheduler like Buffer/Publer, which already have approved apps.

## Project layout

```
src/cli.ts                  CLI (capture / render / post / run)
src/capture.ts              Playwright full-page capture
src/render.ts               Remotion bundling + rendering
src/post/                   Graph API (feed video + Reels) and Make.com hand-off
src/server/                 Web app: Express API, login, job queue
  index.ts                  Routes (login, jobs, video streaming)
  auth.ts                   Signed-cookie sessions from ADMIN_* env vars
  jobs.ts                   Persistent job store + sequential render queue
  ui/                       Dashboard (vanilla HTML/CSS/JS, no build step)
src/remotion/               The video template (edit me!)
  BeforeAfterReel.tsx       Timeline: hook → before → swipe → after → end card
  components/SitePan.tsx    Scroll-through with zoom inside a browser frame
  schema.ts                 Props, durations, segment layout
public/                     Static assets (job captures are copied here)
```

## Roadmap / ideas

- **Multi-user accounts** (per-teammate logins, a real database).
- **Screen-recording drop-in**: accept an .mp4, normalize it (trim, pad,
  speed-ramp) and slot it into the same template — for sites where a live
  scroll-through with animations beats a screenshot pan.
- **True auto-zoom on recordings** via a small helper that logs mouse events
  while recording (the Screen Studio trick).
- **Batch mode**: a CSV of clients → a reel per row.
- **Mobile variant**: capture at 390px wide and show a phone frame.

## Note on Remotion licensing

Remotion is free for individuals and companies with up to 3 employees;
larger teams need a [company license](https://remotion.dev/license).
