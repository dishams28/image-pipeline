FROM node:20-bookworm-slim

# sharp needs libvips; tesseract.js downloads its own wasm/traineddata at runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY prisma ./prisma
RUN npx prisma generate

COPY src ./src
COPY scripts ./scripts

RUN mkdir -p /app/uploads

EXPOSE 3000

CMD ["node", "src/server.js"]
