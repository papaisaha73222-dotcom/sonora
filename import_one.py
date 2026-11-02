import os
import sys
import json
import yt_dlp
import urllib.request

SONORA_DIR = r"C:\Users\USER\.gemini\antigravity\scratch\sonora"
AUDIO_DIR = os.path.join(SONORA_DIR, "audio")
COVERS_DIR = os.path.join(SONORA_DIR, "covers")
DATA_FILE = os.path.join(SONORA_DIR, "data", "db.json")
FFMPEG_BIN = r"C:\Users\USER\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.2-full_build\bin"

def import_query(query_or_url):
    query = query_or_url.strip()
    if not query.startswith("http://") and not query.startswith("https://"):
        search_target = f"ytsearch1:{query} official audio"
    else:
        search_target = query
        
    ydl_opts = {
        'format': 'bestaudio/best',
        'outtmpl': os.path.join(AUDIO_DIR, '%(id)s.%(ext)s'),
        'noplaylist': True,
        'quiet': True,
        'no_warnings': True,
        'writethumbnail': True,
        'ffmpeg_location': FFMPEG_BIN,
        'postprocessors': [
            {
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '320',
            }
        ]
    }
    
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(search_target, download=True)
        entry = info['entries'][0] if 'entries' in info else info
        
        vid_id = entry.get('id')
        title = entry.get('title')
        clean_title = title.split('(')[0].split('[')[0].strip()
        uploader = entry.get('uploader') or entry.get('artist') or "Artist"
        duration = int(entry.get('duration') or 210)
        
        mp3_filename = f"{vid_id}.mp3"
        cover_filename = f"cover_{vid_id}.jpg"
        cover_path = os.path.join(COVERS_DIR, cover_filename)
        
        thumb_url = entry.get('thumbnail')
        cover_url = f"/covers/{cover_filename}"
        if thumb_url and not os.path.exists(cover_path):
            try:
                req = urllib.request.Request(thumb_url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req) as resp, open(cover_path, 'wb') as f:
                    f.write(resp.read())
            except Exception:
                cover_url = "/covers/cover_spotify_tophits.svg"
        elif not os.path.exists(cover_path):
            cover_url = "/covers/cover_spotify_tophits.svg"
            
        track_obj = {
            "id": f"yt-{vid_id}",
            "title": clean_title,
            "artist": uploader,
            "album": "Imported Hit",
            "genre": "Trending Pop",
            "year": 2026,
            "filename": mp3_filename,
            "cover": cover_url,
            "duration": duration,
            "audioQuality": "HQ MASTER (320kbps)",
            "badgeColor": "#1ed760",
            "specs": {
                "format": "MP3 / STEREO",
                "sampleRate": 44100,
                "bitDepth": 16,
                "bitrate": "320 kbps",
                "channels": 2
            },
            "license": "Personal Streaming",
            "plays": 50000
        }
        
        # Save directly to db.json
        if os.path.exists(DATA_FILE):
            with open(DATA_FILE, "r", encoding="utf-8") as f:
                db = json.load(f)
            # Remove any existing with same id
            db["tracks"] = [t for t in db["tracks"] if t["id"] != track_obj["id"]]
            db["tracks"].insert(0, track_obj)
            with open(DATA_FILE, "w", encoding="utf-8") as f:
                json.dump(db, f, indent=2)
                
        print(json.dumps(track_obj))

if __name__ == "__main__":
    if len(sys.argv) > 1:
        import_query(" ".join(sys.argv[1:]))
    else:
        print(json.dumps({"error": "No query provided"}))
