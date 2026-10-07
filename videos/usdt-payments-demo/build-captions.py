import json, re
from pathlib import Path
root=Path(__file__).resolve().parent
captions=json.loads((root/'src/captions.json').read_text())
texts=(root/'narration.txt').read_text().strip().split('\n\n')
starts=[.6,8.6,22.6,34.6,46.6,58.6,72.6,85]
for i,text in enumerate(texts):
 words=list(re.finditer(r'\w+',text)); cursor=0
 for c in [c for c in captions if starts[i]*1000 <= c['startMs'] < starts[i+1]*1000]:
  count=len(re.findall(r'\w+',c['text'])); end=cursor+count
  if end <= len(words):
   c['text']=text[words[cursor].start():words[end].start() if end<len(words) else len(text)].strip()
  cursor=end
for c in captions:
 text=c['text'].strip()
 for a,b in [('Ю эс ди ти пэйментс','usdt-payments'),('ю эс ди ти','USDT'),('Ю эс ди ти','USDT'),('ай трикс','itrx'),('Трон','TRON'),('троном','TRX'),('Гитхаб','GitHub')]:text=text.replace(a,b)
 c['text']=' '+text
for i,c in enumerate(captions[:-1]): c['endMs']=min(c['endMs'],captions[i+1]['startMs'])
source="import {BasicCaptions} from './basic-captions';\nimport {useVideoConfig} from 'remotion';\n\nexport const Captions = () => {\n const {fps}=useVideoConfig();\n return <div className=\"video-captions\" style={{position:'absolute',left:240,bottom:110,width:1440}}>\n <style>{`.video-captions > div > div {font-size:42px !important;background:rgba(5,20,16,.9) !important;border-radius:14px;}`}</style>\n <BasicCaptions name=\"Русские субтитры\" width={1440} premountFor={fps} combineTokensWithinMilliseconds={0} captions={"
source+=json.dumps(captions,ensure_ascii=False,indent=2)
source+='} />\n </div>;\n};\n'
(root/'src/Captions.tsx').write_text(source)
def stamp(ms):
 seconds,ms=divmod(ms,1000);minutes,seconds=divmod(seconds,60)
 return f'00:{minutes:02}:{seconds:02},{ms:03}'
(root/'../../docs/media/usdt-payments-demo-ru.srt').resolve().write_text('\n\n'.join(f'{i+1}\n{stamp(c["startMs"])} --> {stamp(c["endMs"])}\n{c["text"].strip()}' for i,c in enumerate(captions)))
