"""Recover rounded furniture from the blue furniture paths in the styled plans.

The old door extractor also collected cubic segments belonging to tables. Keep
the original curves for an exact exclusion and sample the closed furniture
outline once at build time, rather than doing SVG analysis in the browser.
"""
from collections import defaultdict, deque
import json
import math
from pathlib import Path
import re
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
TOKEN = re.compile(r'[MLCHVZ]|-?(?:\d*\.)?\d+')


def furniture_edges(path):
    root = ET.parse(path).getroot()
    edges = []
    for element in root.iter():
        if element.get('stroke') != '#7396aa':
            continue
        transform = list(map(float, re.findall(r'-?(?:\d*\.)?\d+', element.get('transform', ''))))
        if len(transform) != 6:
            raise ValueError('Unexpected furniture transform')
        a, b, c, d, e, f = transform
        def convert(p):
            x, y = p
            return [round((a*x+c*y+e)*1800/842, 2), round((b*x+d*y+f)*1800/842, 2)]
        tokens = TOKEN.findall(element.get('d', ''))
        i, command, position, start = 0, None, None, None
        while i < len(tokens):
            if tokens[i].isalpha():
                command = tokens[i]
                i += 1
            if command == 'Z':
                if position != start:
                    edges.append(([convert(position), convert(start)], None))
                position = start
                continue
            count = {'M': 2, 'L': 2, 'C': 6, 'H': 1, 'V': 1}[command]
            values = list(map(float, tokens[i:i+count]))
            i += count
            if command == 'M':
                start = position = values
                command = 'L'
                continue
            end = values[-2:] if command in ('L', 'C') else [values[0], position[1]] if command == 'H' else [position[0], values[0]]
            curve = None
            if command == 'C':
                curve = [convert(p) for p in [position, values[:2], values[2:4], end]]
                points = [[round(sum(weight*p[k] for weight, p in zip(((1-t)**3, 3*(1-t)**2*t, 3*(1-t)*t*t, t**3), curve)), 2) for k in (0, 1)] for t in [j/8 for j in range(9)]]
            else:
                points = [convert(position), convert(end)]
            edges.append((points, curve))
            position = end
    return edges


def recover(geometry, edges):
    nodes, adjacency, bins = [], defaultdict(list), defaultdict(list)
    def node(point):
        key = tuple(math.floor(v/.2) for v in point)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for index in bins[key[0]+dx, key[1]+dy]:
                    if math.dist(nodes[index], point) <= .15:
                        return index
        index = len(nodes)
        nodes.append(point)
        bins[key].append(index)
        return index
    endpoints = []
    for index, (points, _) in enumerate(edges):
        a, b = node(points[0]), node(points[-1])
        endpoints.append((a, b))
        adjacency[a].append((b, index))
        adjacency[b].append((a, index))
    removed, tables, seen = [], [], set()
    table_edges = set()
    for match, (_, curve) in enumerate(edges):
        if curve is None:
            continue
        a, b = endpoints[match]
        queue, previous = deque([b]), {b: None}
        while queue and a not in previous:
            current = queue.popleft()
            for nxt, index in adjacency[current]:
                if index == match or nxt in previous:
                    continue
                previous[nxt] = (current, index)
                queue.append(nxt)
        if a not in previous:
            continue
        route, current = [], a
        while current != b:
            parent, index = previous[current]
            route.append((parent, current, index))
            current = parent
        route.reverse()
        cycle = frozenset([match]+[index for _, _, index in route])
        points = list(edges[match][0])
        for start, end, index in route:
            segment = edges[index][0]
            if endpoints[index][0] != start:
                segment = list(reversed(segment))
            points.extend(segment[1:])
        if math.dist(points[0], points[-1]) < .2:
            points.pop()
        area = abs(sum(p[0]*q[1]-q[0]*p[1] for p, q in zip(points, points[1:]+points[:1])))/2
        width = max(p[0] for p in points)-min(p[0] for p in points)
        height = max(p[1] for p in points)-min(p[1] for p in points)
        if area < 400 or min(width, height) < 18 or max(width, height) < 35 or max(width, height) > 240:
            continue
        table_edges.update(cycle)
        if cycle not in seen:
            tables.append(points)
            seen.add(cycle)
    for door in geometry.get('doorSwings', []):
        if any(edges[i][1] and max(math.dist(a, b) for a, b in zip(door, edges[i][1])) < .12 for i in table_edges):
            removed.append(door)
    return {'excludedDoorCurves': removed, 'tables': tables}


if __name__ == '__main__':
    data = json.loads((ROOT/'atlas/official-data.json').read_text(encoding='utf8'))
    corrections = {}
    for floor in data['floors']:
        level = floor['level']
        if not 2 <= level <= 7:
            continue
        corrections[level] = recover(floor['geometry'], furniture_edges(ROOT/f'atlas/studio-floor-{level}.svg'))
        item = corrections[level]
        print(f"Floor {level}: {len(item['excludedDoorCurves'])} furniture arcs, {len(item['tables'])} curved tables")
    target = ROOT/'atlas/map-furniture.js'
    target.write_text('// Generated by tools/build_curved_tables.py from source furniture paths.\nconst corrections = '+json.dumps(corrections, separators=(',', ':'))+';\n\nexport function applyFurnitureCorrections(data) {\n  for (const floor of data.floors) {\n    const correction = corrections[floor.level];\n    if (!correction) continue;\n    const excluded = new Set(correction.excludedDoorCurves.map(curve => JSON.stringify(curve)));\n    floor.geometry.doorSwings = (floor.geometry.doorSwings || []).filter(curve => !excluded.has(JSON.stringify(curve)));\n    floor.geometry.curvedTables = correction.tables;\n  }\n}\n', encoding='utf8')
