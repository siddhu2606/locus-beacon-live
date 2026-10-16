"""python build.py -> dashboard.html (self-contained, no CDN) and a copy in android/app/src/main/assets/."""
import pathlib
R = pathlib.Path(__file__).parent
eng = (R / 'src/engine.js').read_text(encoding='utf-8')
html = (R / 'src/dashboard.template.html').read_text(encoding='utf-8').replace('/*__ENGINE__*/', eng).replace('/*__APP__*/', (R / 'src/dashboard.js').read_text(encoding='utf-8'))
(R / 'dashboard.html').write_text(html, encoding='utf-8')
a = R / 'android/app/src/main/assets'
a.mkdir(parents=True, exist_ok=True)
(a / 'dashboard.html').write_text(html, encoding='utf-8')
print('dashboard.html', len(html) // 1024, 'KB')
