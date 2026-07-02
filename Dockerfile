# ReelWorks — web app + render pipeline in one container.
# Works as-is on Railway, Render, Fly.io, or any Docker host.
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Chromium for site capture (+ the system libraries it needs)...
RUN npx playwright install --with-deps chromium
# ...and Remotion's headless shell for rendering, baked in at build time
# so the first render doesn't stall on a download.
RUN npx remotion browser ensure

COPY . .

EXPOSE 3000
CMD ["npm", "run", "web"]
