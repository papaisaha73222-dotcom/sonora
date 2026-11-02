import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile, spawn } from 'child_process';
import multer from 'multer';
import * as mm from 'music-metadata';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const AUDIO_DIR = path.join(__dirname, 'audio');
const COVERS_DIR = path.join(__dirname, 'covers');
const DATA_FILE = path.join(__dirname, 'data', 'db.json');
const STATUS_FILE = path.join(__dirname, 'data', 'feed_status.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

let dbVersion = Date.now();

// Helper to read / write DB
function getDB() {
  if (!fs.existsSync(DATA_FILE)) {
    return { tracks: [], playlists: [], favorites: [] };
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
}

function saveDB(data) {
  dbVersion = Date.now();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// Ensure directories
[AUDIO_DIR, COVERS_DIR, path.join(__dirname, 'data'), PUBLIC_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Serve static assets
app.use(express.static(PUBLIC_DIR));
app.use('/audio', express.static(AUDIO_DIR));
app.use('/covers', express.static(COVERS_DIR));

// Configure upload storage for manual uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === 'audio') {
      cb(null, AUDIO_DIR);
    } else if (file.fieldname === 'cover') {
      cb(null, COVERS_DIR);
    } else {
      cb(null, AUDIO_DIR);
    }
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    cb(null, `${Date.now()}_${base}${ext}`);
  }
});
const upload = multer({ storage });

// ==========================================
// 1. Auto-Scan Folder Engine
// ==========================================
async function autoScanFolder() {
  try {
    const files = fs.readdirSync(AUDIO_DIR);
    const db = getDB();
    let hasChanges = false;

    // Prune tracks whose audio files no longer exist on disk
    const initialCount = db.tracks.length;
    db.tracks = db.tracks.filter(t => fs.existsSync(path.join(AUDIO_DIR, t.filename)));
    if (db.tracks.length !== initialCount) {
      hasChanges = true;
      console.log(`[Auto-Import Engine] Pruned ${initialCount - db.tracks.length} missing tracks.`);
    }

    const existingFilenames = new Set(db.tracks.map(t => t.filename));
    const validExts = ['.mp3', '.flac', '.wav', '.m4a', '.ogg', '.opus', '.aac'];

    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (!validExts.includes(ext)) continue;
      if (existingFilenames.has(file)) continue;

      const filePath = path.join(AUDIO_DIR, file);
      try {
        const metadata = await mm.parseFile(filePath);
        const format = metadata?.format;
        const common = metadata?.common;

        const sampleRate = format?.sampleRate || 44100;
        const bitDepth = format?.bitsPerSample || 16;
        const bitrateKbps = format?.bitrate ? Math.round(format.bitrate / 1000) : 320;
        const duration = Math.round(format?.duration || 180);

        let audioQuality = 'HQ MASTER (320kbps)';
        if (ext === '.flac' || ext === '.wav') {
          audioQuality = (sampleRate >= 88200 || bitDepth >= 24) ? 'HI-RES LOSSLESS' : 'LOSSLESS';
        }

        let coverUrl = '/covers/cover_spotify_tophits.svg';
        if (common?.picture && common.picture.length > 0) {
          const pic = common.picture[0];
          const picExt = pic.format === 'image/jpeg' ? '.jpg' : '.png';
          const picFilename = `cover_auto_${Date.now()}${picExt}`;
          fs.writeFileSync(path.join(COVERS_DIR, picFilename), pic.data);
          coverUrl = `/covers/${picFilename}`;
        }

        const newTrack = {
          id: `auto-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          title: common?.title || path.basename(file, ext).replace(/_/g, ' '),
          artist: common?.artist || 'Unknown Artist',
          album: common?.album || 'Auto Imported',
          genre: common?.genre?.[0] || 'Imported Hits',
          year: common?.year || new Date().getFullYear(),
          filename: file,
          cover: coverUrl,
          duration,
          audioQuality,
          badgeColor: '#1ed760',
          specs: {
            format: ext.substring(1).toUpperCase(),
            sampleRate,
            bitDepth,
            bitrate: `${bitrateKbps} kbps`,
            channels: format?.numberOfChannels || 2
          },
          license: 'Personal Streaming',
          plays: 100
        };

        db.tracks.unshift(newTrack);
        existingFilenames.add(file);
        hasChanges = true;
        console.log(`[Auto-Import Engine] New song registered: ${newTrack.title}`);
      } catch (err) {
        console.warn(`Could not parse ${file}:`, err.message);
      }
    }

    if (hasChanges) {
      saveDB(db);
    }
  } catch (err) {
    console.error('AutoScan error:', err);
  }
}

// Watch folder with debounce
let watchDebounce = null;
fs.watch(AUDIO_DIR, (eventType, filename) => {
  if (filename) {
    clearTimeout(watchDebounce);
    watchDebounce = setTimeout(() => {
      autoScanFolder();
    }, 1500);
  }
});

// Run initial scan
autoScanFolder();

// ==========================================
// 2. Autonomous Background Feed Runner
// ==========================================
const PYTHON_EXE = 'C:\\Users\\USER\\AppData\\Local\\Programs\\Python\\Python312\\python.exe';
const FFMPEG_DIR = 'C:\\Users\\USER\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-9.0.2-full_build\\bin';

function triggerAutoFeed() {
  console.log('[Autonomous Music Feed] Initiating scheduled chart sync...');
  const pyScript = path.join(__dirname, 'auto_feed_engine.py');
  const env = {
    ...process.env,
    PATH: `${path.dirname(PYTHON_EXE)};${FFMPEG_DIR};${process.env.PATH || ''}`
  };
  execFile(PYTHON_EXE, [pyScript], { timeout: 600000, env }, (err, stdout, stderr) => {
    if (err) {
      console.warn('[Autonomous Feed Notice]', err.message);
    } else {
      console.log('[Autonomous Music Feed] Chart sync finished successfully.');
      dbVersion = Date.now();
    }
  });
}

// Periodic auto-sync every 30 minutes
setInterval(triggerAutoFeed, 30 * 60 * 1000);

// API endpoint to manually trigger or check status
app.post('/api/auto-feed/sync', (req, res) => {
  triggerAutoFeed();
  res.json({ success: true, message: 'Autonomous chart sync triggered in background' });
});

app.get('/api/auto-feed/status', (req, res) => {
  if (fs.existsSync(STATUS_FILE)) {
    return res.json(JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8')));
  }
  res.json({ state: 'idle', message: 'Autonomous feed standby' });
});

// ==========================================
// 3. Audio Streaming (HTTP 206 Range)
// Supports: local files + on-demand yt-dlp proxy
// ==========================================
app.get('/api/stream/:id', async (req, res) => {
  const db = getDB();
  const track = db.tracks.find(t => t.id === req.params.id);
  if (!track) {
    return res.status(404).json({ error: 'Track not found' });
  }

  const filePath = path.join(AUDIO_DIR, track.filename);

  // If file exists on disk — serve directly with HTTP 206 Range support
  if (fs.existsSync(filePath)) {
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    const ext = path.extname(track.filename).toLowerCase();
    let contentType = 'audio/mpeg';
    if (ext === '.flac') contentType = 'audio/flac';
    else if (ext === '.wav') contentType = 'audio/wav';
    else if (ext === '.ogg' || ext === '.opus' || ext === '.oga') contentType = 'audio/ogg';
    else if (ext === '.m4a' || ext === '.aac') contentType = 'audio/aac';
    else if (ext === '.webm') contentType = 'audio/webm';

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize) {
        res.status(416).send(`Requested range not satisfiable\n${start} >= ${fileSize}`);
        return;
      }

      const chunksize = (end - start) + 1;
      const fileStream = fs.createReadStream(filePath, { start, end });
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': contentType,
        'Cache-Control': 'no-cache'
      });
      fileStream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes'
      });
      fs.createReadStream(filePath).pipe(res);
    }
    return;
  }

  // File not on disk — On-Demand direct proxy stream via yt-dlp (no storage used)
  if (track.id.startsWith('yt-')) {
    const ytId = track.id.replace('yt-', '');
    const ytUrl = `https://www.youtube.com/watch?v=${ytId}`;
    console.log(`[On-Demand Stream] Proxying: ${track.title} (${ytId})`);

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Accept-Ranges', 'none');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Stream-Mode', 'on-demand-proxy');

    const ytdlArgs = [
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '320K',
      '--ffmpeg-location', FFMPEG_DIR,
      '-o', '-',
      '--quiet',
      '--no-warnings',
      '--no-playlist',
      ytUrl
    ];

    const ytdlProc = spawn(PYTHON_EXE, ['-m', 'yt_dlp', ...ytdlArgs]);
    ytdlProc.stdout.pipe(res);
    ytdlProc.stderr.on('data', d => console.warn('[yt-dlp proxy]', d.toString().trim()));
    ytdlProc.on('close', code => {
      if (!res.writableEnded) res.end();
    });
    req.on('close', () => ytdlProc.kill());
    return;
  }

  res.status(404).json({ error: 'Audio file not available' });
});

// ==========================================
// 4. One-Click YouTube / Song Importer Endpoint
// ==========================================
app.post('/api/import-youtube', (req, res) => {
  const query = (req.body.query || req.body.url || '').trim();
  if (!query) {
    return res.status(400).json({ error: 'Query or URL is required' });
  }

  const scriptPath = path.join(__dirname, 'import_one.py');
  const env = {
    ...process.env,
    PATH: `${path.dirname(PYTHON_EXE)};${FFMPEG_DIR};${process.env.PATH || ''}`
  };
  execFile(PYTHON_EXE, [scriptPath, query], { timeout: 60000, env }, (error, stdout, stderr) => {
    if (error) {
      console.error('Import error:', error, stderr);
      return res.status(500).json({ error: 'Failed to import song', detail: stderr || error.message });
    }

    try {
      const lines = stdout.trim().split('\n');
      const lastLine = lines[lines.length - 1];
      const trackObj = JSON.parse(lastLine);
      dbVersion = Date.now();
      res.json({ success: true, track: trackObj });
    } catch (parseErr) {
      res.json({ success: true, message: 'Song imported and processed.' });
    }
  });
});

app.get('/api/version', (req, res) => {
  const db = getDB();
  res.json({
    version: dbVersion,
    count: db.tracks.length
  });
});

// ==========================================
// 5. Track & Catalog Endpoints
// ==========================================
app.get('/api/tracks', (req, res) => {
  const db = getDB();
  let tracks = [...db.tracks];

  const search = (req.query.search || '').trim().toLowerCase();
  const genre = (req.query.genre || '').trim().toLowerCase();

  if (search) {
    tracks = tracks.filter(t =>
      t.title.toLowerCase().includes(search) ||
      t.artist.toLowerCase().includes(search) ||
      t.album.toLowerCase().includes(search)
    );
  }

  if (genre && genre !== 'all') {
    tracks = tracks.filter(t => t.genre.toLowerCase().includes(genre));
  }

  const favorites = new Set(db.favorites || []);
  const enriched = tracks.map(t => ({
    ...t,
    isFavorite: favorites.has(t.id)
  }));

  res.json({
    tracks: enriched,
    total: enriched.length,
    version: dbVersion
  });
});

app.get('/api/playlists', (req, res) => {
  const db = getDB();
  res.json({ playlists: db.playlists || [] });
});

app.get('/api/favorites', (req, res) => {
  const db = getDB();
  const favIds = new Set(db.favorites || []);
  const tracks = db.tracks
    .filter(t => favIds.has(t.id))
    .map(t => ({ ...t, isFavorite: true }));
  res.json({ favorites: tracks });
});

app.post('/api/favorites/:id/toggle', (req, res) => {
  const { id } = req.params;
  const db = getDB();
  if (!db.favorites) db.favorites = [];

  const index = db.favorites.indexOf(id);
  let isFavorite = false;
  if (index > -1) {
    db.favorites.splice(index, 1);
  } else {
    db.favorites.push(id);
    isFavorite = true;
  }
  saveDB(db);
  res.json({ trackId: id, isFavorite });
});

app.get('/api/stats', (req, res) => {
  const db = getDB();
  res.json({
    tracksCount: db.tracks.length,
    playlistsCount: db.playlists.length,
    losslessCount: db.tracks.filter(t => t.audioQuality.includes('LOSSLESS') || t.audioQuality.includes('MASTER')).length,
    version: dbVersion
  });
});

app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🎵 SONORA - Autonomous Music Streaming Platform Running!`);
  console.log(`📍 Web Player: http://localhost:${PORT}`);
  console.log(`🤖 Autonomous Music Feed: Auto-syncing from Spotify & YT`);
  console.log(`⚡ Auto-Folder Watcher: Active on ${AUDIO_DIR}`);
  console.log(`======================================================\n`);
});
