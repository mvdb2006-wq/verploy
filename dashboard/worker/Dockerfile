# Verploy-worker voor Railway. Bouwen vanuit de map dashboard/:
#   docker build -f worker/Dockerfile -t verploy-worker .
# Het Playwright-image bevat Chromium en alle systeembibliotheken (versie = playwright-core in package.json).
FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
# NODE_ENV=production zou devDependencies (vite) overslaan; die zijn nodig om te bouwen en worden daarna weggesnoeid.
RUN npm ci --include=dev --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run worker:build && npm prune --omit=dev --ignore-scripts
USER pwuser
EXPOSE 8080
CMD ["node", "--enable-source-maps", "worker/dist/main.mjs"]
