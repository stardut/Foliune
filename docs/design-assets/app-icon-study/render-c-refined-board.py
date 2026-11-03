from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
ROOT = Path(__file__).resolve().parent
ZH = '/System/Library/Fonts/STHeiti Light.ttc'
UI = '/Library/Fonts/SF-Pro-Display-Regular.otf'
board = Image.new('RGB', (1440,1140), '#101216')
draw = ImageDraw.Draw(board)
def text(x,y,value,size=20,color='#e2e5e9',english=False):
    draw.text((x,y),value,font=ImageFont.truetype(UI if english else ZH,size),fill=color)
def center(x,y,value,size=18,color='#a5aeb9'):
    font=ImageFont.truetype(ZH,size)
    box=draw.textbbox((0,0),value,font=font)
    draw.text((x-(box[2]-box[0])/2,y),value,font=font,fill=color)
def place(name,size,x,y,actual=False):
    image=Image.open(ROOT/(f'{name}-{size}.png' if actual else f'{name}.png')).convert('RGBA')
    if not actual: image=image.resize((size,size),Image.Resampling.LANCZOS)
    board.paste(image,(x,y),image)
text(48,34,'Foliune',35,english=True)
text(206,46,'C · 深色精修',24)
text(48,98,'沿已选 C 方向收敛一稿：近黑同底、柔白一体轮廓，不增加图案或高光装饰。',18,'#939eab')
place('c-refined',512,78,150)
center(334,670,'主稿 · #15171a / #e2e5e9',19,'#c3cbd5')
text(756,164,'同色轮廓对照',22)
text(756,202,'旧 C 仅换同色，几何保留；新稿调整轮廓。',16,'#939eab')
place('c-original-dark',228,740,246)
place('c-refined',228,1036,246)
center(854,492,'旧 C',19)
center(1150,492,'精修主稿',19,'#e2e5e9')
text(756,552,'长短横臂重新配比，留白节奏更清楚',18,'#bdc6d1')
text(756,592,'内角加入柔和弧度，两端斜切保持一致',18,'#bdc6d1')
text(756,632,'底端安静平收，减少尖锐和速度感',18,'#bdc6d1')
for x,bg,fg,label in [(48,'#1c2026','#a9b3bf','深色底 · 真实尺寸'),(744,'#e8eae9','#59636e','浅色底 · 真实尺寸')]:
    draw.rounded_rectangle((x,750,x+648,1060),radius=20,fill=bg)
    text(x+24,774,label,18,fg)
    for size,offset in [(128,60),(64,300),(32,508)]:
        place('c-refined',size,x+offset,838+(128-size)//2,True)
        center(x+offset+size/2,1006,f'{size} px',16,fg)
text(48,1095,'矢量主稿 · 已生成应用资源 · 透明外留白 · Dock 待验收',16,'#8b96a3')
board.save(ROOT/'c-refined-board.png')
print('c-refined-board.png: 1440×1140; 512px hero, same-color contour comparison, actual small sizes on dark/light.')
