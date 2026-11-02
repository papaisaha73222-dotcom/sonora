# 🎵 Sonora — Free Lossless Music Streaming Platform

Sonora is a modern Spotify-style high-fidelity music streaming application built for true audiophiles and independent creators. It offers uncompressed studio master audio streaming without subscriptions, ads, or artificial lossy compression.

---

## 🌟 Key Features

- **🎧 True Lossless & Hi-Res Streaming**:
  - Direct 24-bit / 96kHz and 16-bit uncompressed PCM streaming (`audio/wav`, `audio/flac`).
  - Native HTTP 206 Partial Content range requests for instantaneous scrubbing without buffering.
- **🎨 Spotify-Inspired Modern Dark UI**:
  - Sleek glassmorphism player with real-time responsive layout.
  - Interactive Web Audio API **Frequency Spectrum Visualizer**.
  - Audio Stream Diagnostics inspector displaying sample rate, bit depth, format, and bitrate.
- **📁 Open Music & Independent Artist Uploads**:
  - Drag & drop FLAC, WAV, MP3, or AAC files.
  - Automatic audio metadata extraction (title, artist, album, bit depth, sample rate, embedded artwork).
- **📋 Playlists & Favorites**:
  - Instant like/favorite tracking.
  - Custom playlist creation and track management.
- **🆓 100% Free**:
  - Zero subscriptions, no accounts required, no lock-in.

---

## 🚀 How to Run

1. Open a terminal in this directory:
   ```bash
   node server.js
   ```
   Or simply double-click `start.bat`.

2. Open your browser and navigate to:
   ```
   http://localhost:3000
   ```
