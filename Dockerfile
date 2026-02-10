# ============================================================
# QA Test Hub – Production Dockerfile
# Includes: Node 20, Playwright (Chromium, Firefox, WebKit), Xvfb, x11vnc,
#           noVNC/websockify (remote Codegen), Java (CATS)
# ============================================================

FROM node:20-bookworm

# ---- System dependencies + CA certificates + CATS ----
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Virtual display & VNC
    xvfb x11vnc \
    # noVNC and websockify
    novnc websockify \
    # Java for CATS
    default-jre-headless \
    # Curl and CA certificates (CRITICAL)
    curl ca-certificates \
    # Misc utilities
    procps \
    # Update CA certificates BEFORE any HTTPS downloads
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    # NOW download CATS in same layer
    && curl -k -sL -o /tmp/cats.tar.gz "https://github.com/Endava/cats/releases/download/cats-13.7.0/cats_linux_amd64_13.7.0.tar.gz" \
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

# Install Playwright system deps for Chromium, Firefox, and WebKit, then install all browsers
RUN npx playwright install-deps
RUN npx playwright install

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

# Ensure LF line endings so exec works in Linux (avoids "not found" when script has Windows CRLF)
RUN sed -i 's/\r$//' /app/scripts/docker-entry.sh && chmod +x /app/scripts/docker-entry.sh
CMD ["/app/scripts/docker-entry.sh"]
