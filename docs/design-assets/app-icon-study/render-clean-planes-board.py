from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
ROOT=Path(__file__).resolve().parent
ZH='/System/Library/Fonts/STHeiti Light.ttc'
UI='/Library/Fonts/SF-Pro-Display-Regular.otf'
board=Image.new('RGB',(1440,1230),'#101216'); draw=ImageDraw.Draw(board)
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
text(206,46,'C · 双面几何稿',24)
text(48,98,'移除厚轮廓与阴影，只在 F 本体中区分两块中性受光面。黑底和主外形保持。',18,'#939eab')
place('c-clean-planes',512,78,150)
center(334,670,'一体外轮廓 · 两块大面 · 无描边与投影',18,'#c3cbd5')
text(700,164,'分层方式对照',22)
text(700,202,'旧厚版用户未认可；本稿先作视觉对照。',16,'#939eab')
items=[('c-refined','平版'),('c-depth','旧厚版'),('c-clean-planes','双面稿')]
for i,(name,label) in enumerate(items):
 x=684+i*236
 place(name,200,x,256)
 center(x+100,480,label,19,'#e2e5e9' if i==2 else '#a5aeb9')
text(700,552,'正面：横臂与右侧竖干，柔白 #e7e7e4',18,'#bdc6d1')
text(700,592,'次平面：竖干左大面，中性银灰 #b4b4b2',18,'#bdc6d1')
text(700,632,'脊线在上臂根轻折，不增加第三轮廓',18,'#bdc6d1')
for x,bg,fg,label in [(48,'#1c2026','#a9b3bf','深色底'),(744,'#e8eae9','#59636e','浅色底')]:
 draw.rounded_rectangle((x,750,x+648,1168),radius=20,fill=bg)
 text(x+22,772,label+' · 每组依次 平版 / 旧厚版 / 双面稿',16,fg)
 for i,(name,_) in enumerate(items): place(name,128,x+62+i*172,820,True)
 center(x+298,956,'128 px',15,fg)
 for i,(name,_) in enumerate(items): place(name,64,x+54+i*82,1014,True)
 for i,(name,_) in enumerate(items): place(name,32,x+438+i*48,1030,True)
 center(x+168,1100,'64 px',15,fg); center(x+502,1100,'32 px',15,fg)
text(48,1197,'SVG 视觉稿 · 1024 RGBA · 小尺寸按真实像素显示 · 未替换生产图标',16,'#8b96a3')
board.save(ROOT/'clean-planes-board.png')
print('clean-planes-board.png: 1440×1230; hero / 3-way comparison / actual 128,64,32px dark-light.')
