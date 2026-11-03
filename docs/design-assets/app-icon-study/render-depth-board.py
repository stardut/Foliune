from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
ROOT=Path(__file__).resolve().parent
ZH='/System/Library/Fonts/STHeiti Light.ttc'
UI='/Library/Fonts/SF-Pro-Display-Regular.otf'
board=Image.new('RGB',(1440,1140),'#101216')
draw=ImageDraw.Draw(board)
def text(x,y,value,size=20,color='#e2e5e9',english=False):
 draw.text((x,y),value,font=ImageFont.truetype(UI if english else ZH,size),fill=color)
def center(x,y,value,size=18,color='#a5aeb9'):
 font=ImageFont.truetype(ZH,size); box=draw.textbbox((0,0),value,font=font)
 draw.text((x-(box[2]-box[0])/2,y),value,font=font,fill=color)
def place(name,size,x,y,actual=False):
 image=Image.open(ROOT/(f'{name}-{size}.png' if actual else f'{name}.png')).convert('RGBA')
 if not actual: image=image.resize((size,size),Image.Resampling.LANCZOS)
 board.paste(image,(x,y),image)
text(48,34,'Foliune',35,english=True)
text(206,46,'C · 材质层次稿',24)
text(48,98,'保留一体 F 与近黑底，以柔银正面、薄侧缘和近距投影建立层次。已生成应用资源。',18,'#939eab')
place('c-depth',512,78,150)
center(334,670,'材质主稿 · 背景 #15171a',19,'#c3cbd5')
text(756,164,'平版与材质版对照',22)
text(756,202,'正面轮廓一致；变化限定在标记自身。',16,'#939eab')
place('c-refined',228,740,246)
place('c-depth',228,1036,246)
center(854,492,'旧平版',19)
center(1150,492,'材质层次稿',19,'#e2e5e9')
text(756,552,'柔银明暗：平缓变化，不做强镜面高光',18,'#bdc6d1')
text(756,592,'臂根切面：沿内部转折连续展开',18,'#bdc6d1')
text(756,632,'薄侧缘与近距影：将 F 与黑底分开',18,'#bdc6d1')
for x,bg,fg,label in [(48,'#1c2026','#a9b3bf','深色底 · 每组左平版 / 右材质'),(744,'#e8eae9','#59636e','浅色底 · 每组左平版 / 右材质')]:
 draw.rounded_rectangle((x,750,x+648,1060),radius=20,fill=bg)
 text(x+24,774,label,18,fg)
 for size,offset in [(128,20),(64,330),(32,528)]:
  y=838+(128-size)//2
  place('c-refined',size,x+offset,y,True)
  place('c-depth',size,x+offset+size+8,y,True)
  center(x+offset+size+4,1006,f'{size} px',16,fg)
text(48,1095,'SVG 材质主稿 · 已生成应用资源 · 透明外留白 · 实际 Dock 待验证',16,'#8b96a3')
board.save(ROOT/'depth-board.png')
print('depth-board.png: 1440×1140; hero / flat-depth comparison / actual paired 128,64,32px dark-light.')
