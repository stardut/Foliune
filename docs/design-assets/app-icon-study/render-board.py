from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
FONT_ZH = '/System/Library/Fonts/STHeiti Light.ttc'
FONT_UI = '/Library/Fonts/SF-Pro-Display-Regular.otf'
W, H = 1440, 1100
board = Image.new('RGB', (W, H), '#111418')
draw = ImageDraw.Draw(board)
def text(x, y, value, size=20, color='#dfe3e8', chinese=True):
    font = ImageFont.truetype(FONT_ZH if chinese else FONT_UI, size)
    draw.text((x, y), value, font=font, fill=color)
def centered(cx, y, value, size=20, color='#dfe3e8', chinese=True):
    font = ImageFont.truetype(FONT_ZH if chinese else FONT_UI, size)
    box = draw.textbbox((0, 0), value, font=font)
    draw.text((cx-(box[2]-box[0])/2, y), value, font=font, fill=color)
def icon(name, size, x, y):
    path = ROOT / (f'{name}.png' if size == 1024 else f'{name}-{size}.png')
    image = Image.open(path).convert('RGBA')
    board.paste(image, (x, y), image)

text(48, 33, 'Foliune', 35, chinese=False)
text(193, 46, '应用图标 · 方向候选', 23)
text(48, 96, '保留 F 识别线索，让几何、留白和材料建立品牌。当前未接入应用。', 18, '#8e98a4')
items = [('a-fold','A · 折页','银色折页 / 负形 F',''), ('b-frames','B · 叠影','照片层叠 / 开放构图',''), ('c-monogram','C · 刊印','浅底印记 / 切角几何','')]
for i, (name, title, description, badge) in enumerate(items):
    x = 40 + i * 464
    center = x + 216
    # Large inspection view uses the same vector master as the actual-size rows.
    image = Image.open(ROOT / f'{name}.png').convert('RGBA').resize((300,300), Image.Resampling.LANCZOS)
    board.paste(image, (x+66, 153), image)
    centered(center, 468, title, 27)
    centered(center, 508, description, 17, '#929daa')
    if badge:
        font = ImageFont.truetype(FONT_ZH, 14)
        draw.rounded_rectangle((x+309, 466, x+408, 491), radius=12, fill='#293039')
        draw.text((x+322, 471), badge, font=font, fill='#c6ced8')
    for y, bg, fg, label in [(566,'#1a1e24','#a8b1be','深色底'),(810,'#e7e9e8','#59616b','浅色底')]:
        draw.rounded_rectangle((x,y,x+432,y+220), radius=18, fill=bg)
        text(x+18, y+15, label, 15, fg)
        for size, offset in [(128,26),(64,211),(32,345)]:
            # Actual raster pixels, not a scaled screenshot.
            icon(name, size, x+offset, y+62+(128-size)//2)
            centered(x+offset+size/2, y+193, f'{size} px', 14, fg, False)
text(48, 1063, '矢量母版 · 1024 RGBA · 透明外留白 · 小尺寸按真实像素展示', 16, '#88929e')
board.save(ROOT / 'comparison.png')
print('comparison.png: 1440×1100; three 300px previews + actual 128/64/32px on light/dark backgrounds.')
