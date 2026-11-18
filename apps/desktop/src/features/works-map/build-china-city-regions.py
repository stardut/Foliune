"""Pack the simplified CTAmap prefecture GeoJSON for offline region lookup."""

import argparse
import base64
from importlib import import_module
import json
from pathlib import Path

encoding = import_module('build-natural-earth-regions')

# GB/T 2260 province prefix to Natural Earth Admin-1 code.
PROVINCES = {
    '13': '1811', '14': '1805', '15': '1838', '21': '1813', '22': '1828', '23': '1839',
    '32': '1818', '33': '1820', '34': '1179', '35': '1178', '36': '1817', '37': '1814',
    '41': '1812', '42': '1807', '43': '1808', '44': '1180', '45': '1152', '46': '1775',
    '51': '1809', '52': '1153', '53': '1810', '54': '1662',
    '61': '1804', '62': '1150', '63': '1151', '64': '1803', '65': '1756',
}


def build(source, output):
    prefectures = sorted(json.loads(source.read_text(encoding='utf8'))['features'],
                         key=lambda feature: feature['properties']['区划码'])
    natural_earth_source = Path(__file__).with_name('natural-earth-regions.json')
    natural_earth_labels = json.loads(natural_earth_source.read_text(encoding='utf8'))['labels']
    natural_earth_ids = {label[0] for label in natural_earth_labels}

    labels = []
    parents = []
    geometry = bytearray()
    for index, feature in enumerate(prefectures):
        properties = feature['properties']
        code = properties['区划码']
        labels.append([f'CHN:city-{code}', properties['地名'], '中国', properties['ENG_NAME'], 'China'])
        parents.append(f'CHN:CHN-{PROVINCES[code[:2]]}')
        offset = len(geometry)
        for exterior, *interiors in encoding.polygons(feature):
            outer = encoding.quantize_ring(exterior)
            if not outer:
                continue
            holes = (ring for ring in map(encoding.quantize_ring, interiors) if ring)
            encoding.encode_polygon(index, [outer, *holes], geometry)
        if len(geometry) == offset:
            raise ValueError(f'No geometry for prefecture {code}')

    if not labels or len({label[0] for label in labels}) != len(labels) or any(not all(label) for label in labels):
        raise ValueError('Expected prefectures with unique codes and complete names')
    if set(parents) - natural_earth_ids:
        raise ValueError('A prefecture references a missing Natural Earth province')

    payload = {
        'labels': labels,
        'parents': parents,
        'geometry': base64.b64encode(geometry).decode('ascii'),
        'boundaries': '',
        'merged': [],
    }
    output.write_text(json.dumps(payload, separators=(',', ':'), ensure_ascii=False) + '\n', encoding='utf8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path, nargs='?', default=Path(__file__).with_name('china-city-regions.json'))
    args = parser.parse_args()
    build(args.source, args.output)
