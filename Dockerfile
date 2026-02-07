# ============================================================
# QA Test Hub – Production Dockerfile
# Includes: Node 20, Playwright Chromium, Xvfb, x11vnc,
#           noVNC/websockify (remote Codegen), Java (CATS)
# ============================================================

FROM node:20-bookworm

# ---- System dependencies ----
# Playwright Chromium deps, virtual display, VNC, noVNC, Java for CATS
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Virtual display & VNC
    xvfb x11vnc \
    # noVNC (browser-based VNC client) and websockify (WebSocket-to-TCP bridge)
    novnc websockify \
    # Playwright Chromium system dependencies
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 \
    libpango-1.0-0 libcairo2 libasound2 libxshmfence1 \
    fonts-liberation fonts-noto-color-emoji \
    # Java for CATS fuzz runner (JAR fallback; native CATS binary used when available)
    default-jre-headless \
    # Download CATS and curl for fetching releases
    curl \
    # Misc utilities
    procps \
    && rm -rf /var/lib/apt/lists/*

# ---- CATS (Contract API Testing Service) ----
# Install CATS Linux native binary so "Run Fuzz" works without CATS_CMD.
# Optional: override with CATS_CMD=java -jar /path/to/cats-runner.jar at runtime.
ARG CATS_VERSION=13.7.0
RUN set -eux \
    && curl -sL -o /tmp/cats.tar.gz "https://github.com/Endava/cats/releases/download/cats-${CATS_VERSION}/cats_linux_amd64_${CATS_VERSION}.tar.gz" \
    && tar xzf /tmp/cats.tar.gz -C /tmp \
    && CATS_BIN=$(find /tmp -type f -executable \( -name 'cats' -o -name 'cats-*' \) 2>/dev/null | head -1) \
    && mv "$CATS_BIN" /usr/local/bin/cats \
    && chmod +x /usr/local/bin/cats \
    && rm -rf /tmp/cats.tar.gz /tmp/cats* \
    && cats --version

# Verify Java (for docs and optional CATS JAR usage)
RUN java -version

# ---- Application ----
WORKDIR /app

# Install npm dependencies (cached layer)
COPY package*.json ./
RUN npm ci --omit=dev

# Install Playwright Chromium browser
RUN npx playwright install chromium

# Copy application source
COPY . .

# Create required directories
RUN mkdir -p uploads reports e2e/recorded tmp

# ---- Runtime configuration ----
ENV NODE_ENV=production
ENV PLAYWRIGHT_HEADLESS=true
# noVNC client path (Debian package installs here)
ENV NOVNC_PATH=/usr/share/novnc

EXPOSE 3000
# Ports 6080-6089 are used dynamically by websockify for codegen sessions

CMD ["node", "server.js"]
