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

1. **Capture** — headless Chromium (Playwright) loads each URL, scrolls the
   whole page to trigger lazy-loaded content, and saves a full-page screenshot
   plus metadata (`src/capture.ts`).
2. **Render** — a Remotion composition (`src/remotion/`) turns the captures
   into a 1080×1920 reel: hook text → "BEFORE" scroll-through in a browser
   frame (desaturated, red-tinted) → swipe → "AFTER" scroll-through with a
   Screen-Studio-style zoom → branded end card with CTA.
3. **Post** — the mp4 is published to your Facebook Page as a Reel or feed
   video via the Meta Graph API (`src/post/facebook.ts`), or handed to a
   Make.com webhook if you'd rather let Make handle Facebook (`src/post/make.ts`).

Because the "screen recording" is scripted, the whole camera path is known up
front — no editing, no cursor tracking, same template every time.

## Setup

Requires Node 20+. Works on Windows, macOS, and Linux.

```
npm install
npx playwright install chromium
copy .env.example .env   # then fill in the values you need (macOS/Linux: cp)
```

The first render downloads Remotion's headless browser automatically.

## Usage

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
src/post/facebook.ts        Graph API: feed video + Reels upload
src/post/make.ts            Make.com webhook hand-off
src/remotion/               The video template (edit me!)
  BeforeAfterReel.tsx       Timeline: hook → before → swipe → after → end card
  components/SitePan.tsx    Scroll-through with zoom inside a browser frame
  schema.ts                 Props, durations, segment layout
public/                     Static assets (job captures are copied here)
```

## Roadmap / ideas

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
