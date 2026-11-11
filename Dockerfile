FROM node:22-bookworm-slim

# System tools:
# - qpdf (Apache-2.0): Protect/Unlock.
# - LibreOffice Writer/Calc/Impress (MPL-2.0): Office ↔ PDF. Installed without recommends to keep
#   the image smaller; the Draw import filter is needed for PDF → Word/PowerPoint.
# - fonts-noto-core / fonts-noto-ui-core: Tamil and other Indian scripts render correctly when
#   LibreOffice converts documents that use fonts we don't ship.
# Ghostscript is deliberately NOT installed: it is AGPL-licensed (see README "Licensing").
# PDF compression uses the built-in image recompression pass instead.
#
# TODO (deploy follow-up, not yet done): the `puppeteer` dependency (HTML to PDF) bundles its
# own Chromium, which needs shared libraries this slim image doesn't have yet — e.g. libnss3,
# libatk-bridge2.0-0, libcups2, libxkbcommon0, libgbm1, libasound2, libpango-1.0-0. Until those
# are added, Chromium will fail to launch in the deployed container even though it works in
# local dev. Add them with `apt-get install -y libnss3 libatk-bridge2.0-0 libcups2 libxkbcommon0
# libxcomposite1 libxdamage1 libgbm1 libasound2 libpango-1.0-0 libcairo2 libgtk-3-0` before relying
# on the HTML to PDF tool in production.
RUN apt-get update && apt-get install -y --no-install-recommends \
      qpdf ca-certificates \
      libreoffice-writer libreoffice-calc libreoffice-impress libreoffice-draw \
      fonts-noto-core fonts-noto-ui-core fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# onnxruntime-node otherwise downloads several hundred MB of CUDA libraries we don't use.
ENV ONNXRUNTIME_NODE_INSTALL_CUDA=skip

COPY package*.json ./
COPY scripts/download-models.mjs ./scripts/download-models.mjs
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /app/data && chown -R node:node /app

ENV NODE_ENV=production \
    PORT=4321 \
    DATA_DIR=/app/data \
    HOME=/tmp

EXPOSE 4321
USER node

CMD ["node", "server.js"]
