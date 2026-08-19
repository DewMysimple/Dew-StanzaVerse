"""从 app.beautified.js 提取烘焙的 SDF/纹理图集映射数据（161848 与 161851 行的两个单引号 JSON 字符串）。"""
import json, os

BASE = os.path.dirname(os.path.abspath(__file__))
lines = open(os.path.join(BASE, 'app.beautified.js'), encoding='utf-8').read().split('\n')

def extract(line_no):
    line = lines[line_no - 1]
    start = line.index("'")
    end = line.rindex("'")
    return json.loads(line[start + 1:end])

sdf = extract(161848)
tex = extract(161851)

outdir = os.path.join(BASE, '..', '..', 'replica', 'src', 'config')
os.makedirs(outdir, exist_ok=True)

with open(os.path.join(outdir, 'atlas-sdf.json'), 'w', encoding='utf-8') as f:
    json.dump(sdf, f, ensure_ascii=False, indent=1)
with open(os.path.join(outdir, 'atlas-texture.json'), 'w', encoding='utf-8') as f:
    json.dump(tex, f, ensure_ascii=False, indent=1)

print('sdf entries:', len(sdf), [e[0] for e in sdf][:8], '...')
print('tex entries:', len(tex), [e[0] for e in tex][:8], '...')
