FROM node:26.9.0-bookworm-slim@sha256:582460f614631b59b824ac6020533b9bf339c7fdf3a6d7db31abb6b4065f0212
WORKDIR /app
ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npx --no-install playwright install --with-deps chromium \
    && npm cache clean --force \
    && rm -rf /var/lib/apt/lists/*
COPY --chown=node:node . .
RUN mkdir -p /app/.artifacts && chown node:node /app/.artifacts
USER node
EXPOSE 4500
CMD ["node", "src/server.mjs"]
