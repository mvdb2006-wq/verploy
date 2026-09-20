FROM mcr.microsoft.com/playwright:v1.48.0-jammy

WORKDIR /app

# Install dependencies
COPY package.json ./
RUN npm install

# Install Playwright browsers
RUN npx playwright install chromium

# Copy source
COPY src/ ./src/

EXPOSE 3001

CMD ["node", "src/index.js"]
