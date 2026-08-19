"""从 app.beautified.js 的体验代码区间提取全部内嵌 GLSL 着色器字符串。"""
import re, json, os

BASE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(BASE, 'app.beautified.js'), encoding='utf-8').read()
lines = src.split('\n')
region = '\n'.join(lines[157000:183500])

outdir = os.path.join(BASE, 'extracted-shaders')
os.makedirs(outdir, exist_ok=True)

# 匹配 vertexShader:/fragmentShader: 后跟一个双引号字符串字面量（允许跨行空白）
pat = re.compile(r'(vertexShader|fragmentShader):\s*("(?:[^"\\]|\\.)*")', re.S)

count = 0
index = []
for m in pat.finditer(region):
    kind = m.group(1)
    raw = m.group(2)
    try:
        s = json.loads(raw)
    except Exception:
        continue
    if 'void main' not in s:
        continue
    count += 1
    fname = f'{count:02d}_{kind}.glsl'
    with open(os.path.join(outdir, fname), 'w', encoding='utf-8') as f:
        f.write(s)
    index.append((fname, len(s)))

for f, l in index:
    print(f, l)
print('total:', count)
