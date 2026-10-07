"""Generate Russian neural narration for the public demo."""
import asyncio
import os
import json
import re
import subprocess
import wave
from pathlib import Path
import edge_tts

ROOT = Path(__file__).resolve().parent
SCENES = [(0, 8), (8, 14), (22, 12), (34, 12), (46, 12), (58, 14), (72, 13)]

async def main():
    first=int(os.environ.get('START_SCENE','0'))
    captions = [c for c in json.loads((ROOT/'src/captions.json').read_text()) if c['startMs'] < SCENES[first][0]*1000] if first else []
    metadata = json.loads((ROOT/'audio-manifest.json').read_text())[:first] if first else []
    texts = (ROOT / 'narration.txt').read_text().strip().split('\n\n')
    assert len(texts) == len(SCENES)
    for i, ((start, duration), text) in enumerate(zip(SCENES, texts)):
        if i < first: continue
        for rate in ([16] if i in (0, 6) else [8, 16]):
            for attempt in range(4):
                boundaries = []
                mp3 = ROOT / f'public/audio/scene-{i}.mp3'
                try:
                    speech = edge_tts.Communicate(text, voice='ru-RU-DmitryNeural', rate=f'+{rate}%', boundary='WordBoundary', connect_timeout=15, receive_timeout=30)
                    with mp3.open('wb') as out:
                        async for chunk in speech.stream():
                            if chunk['type'] == 'audio': out.write(chunk['data'])
                            elif chunk['type'] == 'WordBoundary': boundaries.append(chunk)
                    spoken = ' '.join(b['text'] for b in boundaries)
                    words = re.findall(r'\w+', text)
                    assert words[-1].lower() in spoken.lower()
                    assert len(re.findall(r'\w+', spoken)) >= len(words) * .9
                    break
                except Exception:
                    if attempt == 3: raise
                    await asyncio.sleep(2)
            wav = ROOT / f'public/audio/scene-{i}.wav'
            if wav.exists(): wav.unlink()
            subprocess.run(['afconvert', '-f', 'WAVE', '-d', 'LEI16', str(mp3), str(wav)], check=True)
            with wave.open(str(wav)) as stream: length = stream.getnframes() / stream.getframerate()
            if length <= duration - .75: break
        else: raise RuntimeError(f'Scene {i + 1} narration exceeds its timing')
        groups, group = [], []
        for word in boundaries:
            if sum(len(w['text']) + 1 for w in group) + len(word['text']) > 65:
                groups.append(group); group = []
            group.append(word)
        if group: groups.append(group)
        for words in groups:
            captions.append({'text': ' ' + ' '.join(w['text'] for w in words), 'startMs': round((start + .6) * 1000 + words[0]['offset'] / 10000), 'endMs': round((start + .6) * 1000 + (words[-1]['offset'] + words[-1]['duration']) / 10000 + 100), 'timestampMs': None, 'confidence': None})
        (ROOT / f'public/audio/scene-{i}.boundaries.json').write_text(json.dumps(boundaries, ensure_ascii=False, indent=2))
        metadata.append({'scene': i + 1, 'durationSeconds': round(length, 2), 'rate': rate, 'voice': 'ru-RU-DmitryNeural'})
        (ROOT / 'src/captions.json').write_text(json.dumps(captions, ensure_ascii=False, indent=2))
        (ROOT / 'audio-manifest.json').write_text(json.dumps(metadata, indent=2))
        print(f'Scene {i + 1}: {length:.2f}s / {duration}s, rate +{rate}%', flush=True)
    (ROOT / 'src/captions.json').write_text(json.dumps(captions, ensure_ascii=False, indent=2))
    (ROOT / 'audio-manifest.json').write_text(json.dumps(metadata, indent=2))

if __name__ == '__main__':
    asyncio.run(main())
    subprocess.run(['python3',str(ROOT/'build-captions.py')],check=True)
