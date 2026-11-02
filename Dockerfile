FROM node:20-bullseye-slim

# Install system dependencies: Python 3, pip, ffmpeg, curl
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    ffmpeg \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp
RUN pip3 install --no-cache-dir yt-dlp

WORKDIR /app

# Install npm dependencies
COPY package*.json ./
RUN npm install --production

# Copy all application source code
COPY . .

ENV PORT=10000
ENV NODE_ENV=production
ENV PYTHON_PATH=python3

EXPOSE 10000

CMD ["node", "server.js"]
