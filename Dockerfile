FROM node:22-bookworm-slim

# System tools:
# - qpdf (Apache-2.0): Protect/Unlock.
# - LibreOffice Writer/Calc/Impress (MPL-2.0): Office ↔ PDF. Installed without recommends to keep
#   the image smaller; the Draw import filter is needed for PDF → Word/PowerPoint.
# - fonts-noto-core / fonts-noto-ui-core: Tamil and other Indian scripts render correctly when
#   LibreOffice converts documents that use fonts we don't ship.
# Ghostscript is deliberately NOT installed: it is AGPL-licensed (see README "Licensing").
# PDF compression uses the built-in image recompression pass instead.
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
