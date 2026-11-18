# Natural Earth 底图来源

作品地图内置 Natural Earth 1:50m 地理矢量。上游版本固定为 `v5.1.2`，陆地层为 `4.0.0`，湖泊层为 `5.0.0`。采用 public domain 数据，保留陆地及湖泊多边形，没有行政边界、地名或街道数据。 [物理矢量版本](https://www.naturalearthdata.com/downloads/50m-physical-vectors/) · [使用条款](https://www.naturalearthdata.com/about/terms-of-use/)

| 图层 | 上游 GeoJSON | SHA-256 |
| --- | --- | --- |
| 陆地 | [ne_50m_land.geojson](https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_land.geojson) | `e874b27a51d146452be360cafb3cc50c86001074a67d534113e6534682f9826b` |
| 湖泊 | [ne_50m_lakes.geojson](https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_lakes.geojson) | `d350b75978b26fe839b797c2c529b2fb8f47fb3983c03f4964e36d5df9378a52` |

更新底图时，在本目录下载两份指定版本的 GeoJSON 并核对散列，然后运行以下转换。经度作为横坐标，纬度取反作为纵坐标。坐标保留四位小数，保留所有多边形及其内环，移除环尾的重复起点并以 SVG 的 `Z` 闭合。绘制时使用 `evenodd` 保留内环。应用直接读取生成的 `natural-earth.json`。

```sh
for layer in land lakes; do
  curl -fsSLO "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_${layer}.geojson"
done
LC_ALL=C shasum -a 256 ne_50m_land.geojson ne_50m_lakes.geojson

python3 - <<'PY'
from pathlib import Path
import json

def svg_number(value):
    if abs(value) < 0.00005:
        return '0'
    return f'{value:.4f}'.rstrip('0').rstrip('.')

paths = {}
for layer in ('land', 'lakes'):
    data = json.loads(Path(f'ne_50m_{layer}.geojson').read_text())
    polygons = []
    for feature in data['features']:
        geometry = feature['geometry']
        assert geometry['type'] in {'Polygon', 'MultiPolygon'}
        polygons.extend([geometry['coordinates']] if geometry['type'] == 'Polygon' else geometry['coordinates'])
    rings = []
    for polygon in polygons:
        for ring in polygon:
            assert ring[0] == ring[-1]
            rings.append('M' + ' '.join(f'{svg_number(lon)},{svg_number(-lat)}' for lon, lat in ring[:-1]) + 'Z')
    paths[layer] = ''.join(rings)

Path('natural-earth.json').write_text(json.dumps(paths, separators=(',', ':')) + '\n')
PY
```

## 作品地区归属与边界

全球省级及同级行政归属使用 Natural Earth 同一 `v5.1.2` 标签下的 1:10m Admin-1 与 Admin-0，两层图层版本均为 `5.1.1`，同样属 public domain。作品地图使用行政多边形在本机反查点位所属地区，底图的陆地与湖泊来自前述 1:50m 数据。 [Admin-1 图层](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-1-states-provinces/) · [Admin-0 图层](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-0-countries/)

| 图层 | 上游 GeoJSON | SHA-256 |
| --- | --- | --- |
| Admin-1 | [ne_10m_admin_1_states_provinces.geojson](https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_1_states_provinces.geojson) | `22d0e3ad85eb3e27f17cabf8ba2d50e554fbc27a87796ff891d958185da62fb5` |
| Admin-0 | [ne_10m_admin_0_countries.geojson](https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_0_countries.geojson) | `239eec57ac17f100a11e2536cffc56752c318b50ae765b0918ff7aab4ce8f255` |

在本目录重新生成地区包，先核对下载文件的散列。

```sh
for layer in admin_1_states_provinces admin_0_countries; do
  curl -fsSLO "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_${layer}.geojson"
done
LC_ALL=C shasum -a 256 ne_10m_admin_1_states_provinces.geojson ne_10m_admin_0_countries.geojson

python3 build-natural-earth-regions.py ne_10m_admin_1_states_provinces.geojson ne_10m_admin_0_countries.geojson
```

地区包同时保存中英文地区和国家名称，按当前界面语言显示。中文优先取上游中文字段，英文优先使用上游英文名称，部分归并地区使用通行英文名称。法国和意大利按大区、西班牙按自治区或自治市、英国按构成国归并，沿用上游记录中的大区或地理单位。香港、澳门、台湾及明确以整地作为地区单位的城市国家使用 Admin-0 轮廓。其余地区使用有名称的 Admin-1 多边形，同名地区按上游地区 ID 区分。

生成脚本保留多部件、内环和日期线两侧的多边形，将坐标量化到 0.0001°，约为赤道处的 11 米。脚本以增量整数编码几何，省去原始 GeoJSON 的无关字段。带常态共边的地区包约 7.3 MB，通过本地应用资源按需加载。应用以空间网格筛选多边形，再检查点位归属。未命中或命中多个不同地区的点位不分配地区。

地区包保留从同一套量化多边形提取的行政区共边，用于几何核对。生成器收集同属一个国家、归属 ID 不同的相邻地区共边，并把连续边合成路径。海岸、国界和已经归并的次级行政线不进入这一层。

几何测试按地区 ID 生成轮廓，核对归并区和共边。生成时抵消各下级面之间重合的边，保留多部件和行政飞地的内环，省略数据在 `±180°` 切分面时形成的人工描边闭合段。

## 中国地级行政归属

中国地级归属使用 Cheng, Rui、Hu, Yunfeng、Xiao, Chiwei 和 Wang, Yanjun 发布的 CTAmap v2.0《CTAmap: A continuous vector dataset of Chinese administrative divisions from 2000 to 2026》，采用 2026 年 1 月 1 日快照的 `T2026_prefecture.gpkg`。原件使用 WGS 84（EPSG:4326），以 CC BY 4.0 发布。Foliune 提取地级市、地区、自治州、盟，按行政区划代码关联既有省级 ID，将边界简化、量化并重新编码为 `china-city-regions.json`。直辖市、港澳台及省直辖县级行政区沿用已有地区粒度。 [Zenodo 数据档案](https://doi.org/10.5281/zenodo.22179207) · [发布说明](https://www.shengshixian.com/pages/9f2c41/) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)

原件通过 Zenodo 所列的 MD5 `2c935849e66db951eeb7cc368cbb563c` 核对。下方命令使用同一原件的 SHA-256。在本目录执行。

```sh
curl -fsSLO 'https://zenodo.org/records/22179207/files/T2026_prefecture.gpkg'
printf '%s\n' '6a35915313444d4e669fdc147eade4eb50d67489c38c00f340d871baa624ad85  T2026_prefecture.gpkg' | LC_ALL=C shasum -a 256 -c
npx --yes mapshaper@0.8.5 T2026_prefecture.gpkg \
  -filter '["地级市","地区","自治州","盟"].includes(地级类)' \
  -filter-fields 区划码,地名,ENG_NAME \
  -clean gap-width=0 snap-interval=0.0000001 \
  -simplify dp interval=100m keep-shapes \
  -o format=geojson china-prefectures.geojson
python3 -B build-china-city-regions.py china-prefectures.geojson
```

Mapshaper 在约厘米级阈值下对齐原件的近重合共边，再按 100 米间隔做 Douglas–Peucker 简化。生成器保留多边形的独立部件和可量化内环，将经纬度量化到 0.0001°。行政边缘附近的归属受源精度、简化及 GPS 误差影响。三沙市按源数据的离散岛礁面匹配。

生成包共 333 条地级归属，含 293 个地级市、7 个地区、30 个自治州、3 个盟，对应 27 个省级 ID。核对了所有量化面及其共边，333 个代表点均可反查回自身。经纬度样本覆盖杭州、宁波、成都、阿坝藏族羌族自治州、三沙市永兴岛，以及继续按省级匹配的北京和湖北仙桃。
