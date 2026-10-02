FROM node:22-bookworm-slim

# qpdf is Apache-2.0 and safe to bundle — it powers Protect/Unlock.
# Ghostscript is deliberately NOT installed here: it's AGPL-licensed, and bundling it inside
# a distributed/hosted image is a different licensing situation than a user installing it
# themselves on their own machine (see README "Licensing" section). Compress still works via
# pdf-lib's basic pass without it.
RUN apt-get update && apt-get install -y --no-install-recommends qpdf ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /app/data && chown -R node:node /app

ENV NODE_ENV=production \
    PORT=4321 \
    DATA_DIR=/app/data

EXPOSE 4321
USER node

CMD ["node", "server.js"]
