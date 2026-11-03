from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
ROOT=Path(__file__).resolve().parent
ZH='/System/Library/Fonts/STHeiti Light.ttc'; UI='/Library/Fonts/SF-Pro-Display-Regular.otf'
board=Image.new('RGB',(1440,1140),'#101216'); draw=ImageDraw.Draw(board)
def text(x,y,value,size=20,color='#e2e5e9',english=False):
 draw.text((x,y),value,font=ImageFont.truetype(UI if english else ZH,size),fill=color)
def center(x,y,value,size=18,color='#a5aeb9'):
 font=ImageFont.truetype(ZH,size); box=draw.textbbox((0,0),value,font=font)
 draw.text((x-(box[2]-box[0])/2,y),value,font=font,fill=color)
def place(name,size,x,y,actual=False):
 image=Image.open(ROOT/(f'{name}-{size}.png' if actual else f'{name}.png')).convert('RGBA')
 if not actual: image=image.resize((size,size),Image.Resampling.LANCZOS)
 board.paste(image,(x,y),image)
text(48,34,'Foliune',35,english=True); text(206,46,'C · 折面结构稿',24)
text(48,98,'宽正面、窄侧面、对应顶帽与底端收口；通过实际几何连接分面，不叠描边或阴影。',18,'#939eab')
place('c-fold-structure',512,78,150)
center(334,670,'100px 正面 / 24px 侧面 / 18px 窄转折',18,'#c3cbd5')
text(756,164,'失败双面稿与结构稿',22)
text(756,202,'先比较顶端、臂根与底端如何连接。',16,'#939eab')
place('c-clean-planes',228,740,246); place('c-fold-structure',228,1036,246)
center(854,492,'失败双面稿',19); center(1150,492,'折面结构稿',19,'#e2e5e9')
text(756,552,'顶帽：24 × 18 同向斜接，外形响应',18,'#bdc6d1')
text(756,592,'臂根：同向窄转折连接 92px 横臂',18,'#bdc6d1')
text(756,632,'底端：侧面斜收与顶帽平行，不悬空',18,'#bdc6d1')
for x,bg,fg,label in [(48,'#1c2026','#a9b3bf','深色底 · 每组左失败稿 / 右结构稿'),(744,'#e8eae9','#59636e','浅色底 · 每组左失败稿 / 右结构稿')]:
 draw.rounded_rectangle((x,750,x+648,1060),radius=20,fill=bg); text(x+24,774,label,17,fg)
 for size,offset in [(128,20),(64,330),(32,528)]:
  y=838+(128-size)//2
  place('c-clean-planes',size,x+offset,y,True); place('c-fold-structure',size,x+offset+size+8,y,True)
  center(x+offset+size+4,1006,f'{size} px',16,fg)
text(48,1095,'SVG 视觉稿 · 单一 #15171a 黑底 · 无滤镜 / 渐变 / 投影 · 未替换生产图标',16,'#8b96a3')
board.save(ROOT/'fold-structure-board.png')
print('fold-structure-board.png: 1440×1140; hero / failed-clean vs structure / actual paired 128,64,32px.')
