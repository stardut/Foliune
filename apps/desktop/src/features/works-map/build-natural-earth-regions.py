"""Pack the pinned Natural Earth GeoJSON layers for offline region lookup."""

import argparse
import base64
from collections import defaultdict
import json
from pathlib import Path

PRECISION = 10_000
POINT_STRIDE = 180 * PRECISION + 1

WHOLE_REGIONS = {
    'HKG': ('香港特别行政区', '中国', 'Hong Kong SAR', 'China'),
    'MAC': ('澳门特别行政区', '中国', 'Macao SAR', 'China'),
    'TWN': ('台湾', '中国', 'Taiwan', 'China'),
    'SGP': ('新加坡', '新加坡', 'Singapore', 'Singapore'),
    'MCO': ('摩纳哥', '摩纳哥', 'Monaco', 'Monaco'),
    'VAT': ('梵蒂冈', '梵蒂冈', 'Vatican City', 'Vatican City'),
}

UK_REGIONS = {
    'ENG': ('英格兰', 'England'),
    'SCT': ('苏格兰', 'Scotland'),
    'WLS': ('威尔士', 'Wales'),
    'NIR': ('北爱尔兰', 'Northern Ireland'),
}
UPPER_REGIONS = {
    'FRA': {
        'Auvergne-Rhône-Alpes': '奥弗涅-罗讷-阿尔卑斯大区',
        'Bourgogne-Franche-Comté': '勃艮第-弗朗什-孔泰大区',
        'Bretagne': '布列塔尼大区',
        'Centre-Val de Loire': '中央-卢瓦尔河谷大区',
        'Corse': '科西嘉大区',
        'Grand Est': '大东部大区',
        'Guadeloupe': '瓜德罗普',
        'Guyane française': '法属圭亚那',
        'Hauts-de-France': '上法兰西大区',
        'Île-de-France': '法兰西岛大区',
        'Martinique': '马提尼克',
        'Mayotte': '马约特',
        'Normandie': '诺曼底大区',
        'Nouvelle-Aquitaine': '新阿基坦大区',
        'Occitanie': '奥克西塔尼大区',
        'Pays de la Loire': '卢瓦尔河地区大区',
        "Provence-Alpes-Côte-d'Azur": '普罗旺斯-阿尔卑斯-蓝色海岸大区',
        'Réunion': '留尼汪',
    },
    'ITA': {
        'Abruzzo': '阿布鲁佐大区',
        'Apulia': '普利亚大区',
        'Basilicata': '巴西利卡塔大区',
        'Calabria': '卡拉布里亚大区',
        'Campania': '坎帕尼亚大区',
        'Emilia-Romagna': '艾米利亚-罗马涅大区',
        'Friuli-Venezia Giulia': '弗留利-威尼斯朱利亚大区',
        'Lazio': '拉齐奥大区',
        'Liguria': '利古里亚大区',
        'Lombardia': '伦巴第大区',
        'Marche': '马尔凯大区',
        'Molise': '莫利塞大区',
        'Piemonte': '皮埃蒙特大区',
        'Sardegna': '撒丁大区',
        'Sicily': '西西里大区',
        'Toscana': '托斯卡纳大区',
        'Trentino-Alto Adige': '特伦蒂诺-上阿迪杰大区',
        'Umbria': '翁布里亚大区',
        "Valle d'Aosta": '瓦莱达奥斯塔大区',
        'Veneto': '威尼托大区',
    },
    'ESP': {
        'Andalucía': '安达卢西亚自治区',
        'Aragón': '阿拉贡自治区',
        'Asturias': '阿斯图里亚斯自治区',
        'Canary Is.': '加那利群岛自治区',
        'Cantabria': '坎塔布里亚自治区',
        'Castilla y León': '卡斯蒂利亚-莱昂自治区',
        'Castilla-La Mancha': '卡斯蒂利亚-拉曼恰自治区',
        'Cataluña': '加泰罗尼亚自治区',
        'Ceuta': '休达自治市',
        'Extremadura': '埃斯特雷马杜拉自治区',
        'Foral de Navarra': '纳瓦拉自治区',
        'Galicia': '加利西亚自治区',
        'Islas Baleares': '巴利阿里群岛自治区',
        'La Rioja': '拉里奥哈自治区',
        'Madrid': '马德里自治区',
        'Melilla': '梅利利亚自治市',
        'Murcia': '穆尔西亚自治区',
        'País Vasco': '巴斯克自治区',
        'Valenciana': '巴伦西亚自治区',
    },
}

ENGLISH_UPPER_NAMES = {
    'FRA': {
        'Bretagne': 'Brittany', 'Corse': 'Corsica', 'Guyane française': 'French Guiana',
        'Normandie': 'Normandy',
    },
    'ITA': {
        'Lombardia': 'Lombardy', 'Piemonte': 'Piedmont', 'Sardegna': 'Sardinia',
        'Toscana': 'Tuscany', "Valle d'Aosta": 'Aosta Valley',
    },
    'ESP': {
        'Andalucía': 'Andalusia', 'Aragón': 'Aragon', 'Canary Is.': 'Canary Islands',
        'Cataluña': 'Catalonia', 'Foral de Navarra': 'Navarre',
        'Islas Baleares': 'Balearic Islands', 'País Vasco': 'Basque Country',
        'Valenciana': 'Valencian Community',
    },
}

CHINESE_NAMES = {
    'AUS': {'Jervis Bay Territory': '杰维斯湾领地'},
    'CAN': {'Yukon': '育空地区', 'Nunavut': '努纳武特地区'},
    'JPN': {'Tokyo': '东京都'},
}


def display_name(properties):
    code = properties['adm0_a3']
    source = properties['name']
    chinese = (CHINESE_NAMES.get(code, {}).get(source)
               or properties['name_zh'] or properties['name_zht'])
    if not chinese:
        return properties['name_en'] or source
    kind = properties['type_en']
    if kind == 'State' and code in {'AUS', 'DEU', 'USA'} and not chinese.endswith(('州', '邦')):
        return chinese + '州'
    if code == 'CAN' and kind == 'Province' and not chinese.endswith('省'):
        return chinese + '省'
    if code == 'JPN' and kind == 'Prefecture' and not chinese.endswith(('县', '縣')):
        return chinese + '县'
    return chinese


def admin1_region(properties, countries):
    code = properties['adm0_a3']
    if code in WHOLE_REGIONS or code == 'ATA' or properties['adm1_code'] == 'PFA+00?':
        return None
    country, country_en = countries[code]
    if code == 'GBR':
        subdivision = properties['gu_a3']
        name, name_en = UK_REGIONS[subdivision]
        return f'{code}:{subdivision}', name, country, name_en, country_en
    if code in UPPER_REGIONS:
        subdivision = properties['region']
        name_en = ENGLISH_UPPER_NAMES.get(code, {}).get(subdivision, subdivision)
        return f'{code}:{subdivision}', UPPER_REGIONS[code][subdivision], country, name_en, country_en

    name = display_name(properties)
    if name:
        name_en = properties['name_en'] or properties['name']
        return f'{code}:{properties["adm1_code"]}', name, country, name_en, country_en
    return None


def varint(value, output):
    while value >= 128:
        output.append((value & 127) | 128)
        value >>= 7
    output.append(value)


def signed(value, output):
    varint(2 * value if value >= 0 else -2 * value - 1, output)


def quantize_ring(ring):
    assert ring[0] == ring[-1]
    quantized = []
    for lon, lat in ring[:-1]:
        point = round(lon * PRECISION), round(lat * PRECISION)
        if not quantized or point != quantized[-1]:
            quantized.append(point)
    if quantized and quantized[0] == quantized[-1]:
        quantized.pop()
    if len(set(quantized)) < 3:
        return []
    return quantized


def encode_line(line, output):
    varint(len(line), output)
    previous_lon = previous_lat = 0
    for lon, lat in line:
        signed(lon - previous_lon, output)
        signed(lat - previous_lat, output)
        previous_lon, previous_lat = lon, lat


def encode_polygon(region, rings, output):
    geometry = bytearray()
    varint(len(rings), geometry)
    for ring in rings:
        encode_line(ring, geometry)
    longitude, latitude = zip(*rings[0])
    varint(region, output)
    for bound in (min(longitude), min(latitude), max(longitude), max(latitude)):
        signed(bound, output)
    varint(len(geometry), output)
    output.extend(geometry)


def point_key(point):
    lon, lat = point
    return (lon + 180 * PRECISION) * POINT_STRIDE + lat + 90 * PRECISION


def point_from_key(key):
    lon, lat = divmod(key, POINT_STRIDE)
    return lon - 180 * PRECISION, lat - 90 * PRECISION


def collect_shared_edges(rings, region, labels, owners, shared):
    for ring in rings:
        previous = ring[-1]
        for current in ring:
            if not (current[0] == previous[0] and abs(current[0]) == 180 * PRECISION):
                a, b = point_key(previous), point_key(current)
                edge = (a, b) if a < b else (b, a)
                owner = owners.setdefault(edge, region)
                if owner != region and labels[owner][2] == labels[region][2]:
                    shared.add(edge)
            previous = current


def boundary_chains(edges):
    neighbors = defaultdict(dict)
    for start, end in sorted(edges):
        neighbors[start][end] = None
        neighbors[end][start] = None
    junctions = {point for point, adjacent in neighbors.items() if len(adjacent) != 2}

    def take_chain(start):
        chain = [point_from_key(start)]
        current = start
        while neighbors[current]:
            next_point = next(iter(neighbors[current]))
            del neighbors[current][next_point]
            del neighbors[next_point][current]
            current = next_point
            chain.append(point_from_key(current))
            if current in junctions:
                break
        return chain

    for start in sorted(junctions):
        while neighbors[start]:
            yield take_chain(start)
    for start in neighbors:
        if neighbors[start]:
            yield take_chain(start)


def polygons(feature):
    geometry = feature['geometry']
    assert geometry['type'] in {'Polygon', 'MultiPolygon'}
    coordinates = geometry['coordinates']
    return [coordinates] if geometry['type'] == 'Polygon' else coordinates


def build(admin1_path, admin0_path, output_path):
    admin0 = json.loads(admin0_path.read_text())['features']
    admin1 = json.loads(admin1_path.read_text())['features']
    countries = {p['ADM0_A3']: (p['NAME_ZH'] or p['NAME_EN'] or p['NAME'], p['NAME_EN'] or p['NAME'])
                 for p in (f['properties'] for f in admin0)}
    countries['CHN'] = ('中国', 'China')
    regions = defaultdict(list)
    feature_counts = defaultdict(int)
    for feature in admin1:
        key = admin1_region(feature['properties'], countries)
        if key is not None:
            regions[key].extend(polygons(feature))
            feature_counts[key] += 1
    for feature in admin0:
        code = feature['properties']['ADM0_A3']
        if code in WHOLE_REGIONS:
            regions[(f'{code}:whole', *WHOLE_REGIONS[code])].extend(polygons(feature))

    labels = sorted(regions)
    assert len({key[0] for key in labels}) == len(labels)
    geometry = bytearray()
    owners = {}
    shared = set()
    for index, label in enumerate(labels):
        for polygon in regions[label]:
            outer = quantize_ring(polygon[0])
            if not outer:
                continue
            rings = [outer, *(ring for ring in map(quantize_ring, polygon[1:]) if ring)]
            encode_polygon(index, rings, geometry)
            collect_shared_edges(rings, index, labels, owners, shared)
    boundary_data = bytearray()
    for chain in boundary_chains(shared):
        encode_line(chain, boundary_data)
    payload = {
        'labels': labels,
        'geometry': base64.b64encode(geometry).decode('ascii'),
        'boundaries': base64.b64encode(boundary_data).decode('ascii'),
        'merged': [index for index, label in enumerate(labels) if feature_counts[label] > 1],
    }
    output_path.write_text(json.dumps(payload, separators=(',', ':'), ensure_ascii=False) + '\n', encoding='utf8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('admin1', type=Path)
    parser.add_argument('admin0', type=Path)
    parser.add_argument('output', type=Path, nargs='?', default=Path(__file__).with_name('natural-earth-regions.json'))
    args = parser.parse_args()
    build(args.admin1, args.admin0, args.output)
