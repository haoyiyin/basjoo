FROM python:3.11-slim

WORKDIR /app

# Chromium into a stable path so the browser layer caches across rebuilds.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# The upstream mirror is the default; `--build-arg DEBIAN_MIRROR=...` exists for
# networks whose proxy mangles deb.debian.org's InRelease.
ARG DEBIAN_MIRROR=http://deb.debian.org

# System dependencies for curl_cffi and lxml
RUN sed -i "s|http://deb.debian.org|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
    && apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# crawl4ai drives Playwright's Chromium; --with-deps installs its shared libs.
RUN playwright install --with-deps chromium

COPY . .

EXPOSE 8001

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
