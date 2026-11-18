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

行政归属使用 Natural Earth 同一 `v5.1.2` 标签下的 1:10m Admin-1 与 Admin-0，两层图层版本均为 `5.1.1`，同样属 public domain。行政多边形同时用于本机点位反查、常态省州界和选中轮廓。以上地形底图提供陆地与湖泊。 [Admin-1 图层](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-1-states-provinces/) · [Admin-0 图层](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-0-countries/)

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

常态边界从同一套量化后的多边形提取。生成器收集同属一个国家、归属 ID 不同的相邻地区共边，并把连续边合成路径。路径保留共边顶点，使常态边界与选中轮廓深度放大时仍重合。海岸、国界和已经归并的次级行政线不进入这一层。

选中轮廓按地区 ID 生成。归并区抵消各下级面之间重合的边，填充保留多部件和行政飞地的内环；描边省略地理数据在 `±180°` 切分面时形成的人工闭合段。选中轮廓使用 1:10m 的行政区海岸，地形底图使用 1:50m 的海岸，近看两层海岸细节会有差异。
