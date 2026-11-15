#!/usr/bin/env python3
"""Writes the synthetic test files in tests/fixtures/ and the values the viewer must show for them
(tests/fixtures/expected.json). All tracks are generated from formulas; no recorded GPS data.

Run with `python3 -B tools/make-fixtures.py` (no bytecode next to the script).
"""
import json
import math
import struct
from datetime import datetime, timedelta, timezone
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / 'tests' / 'fixtures'
NS10 = 'http://www.topografix.com/GPX/1/0'
NS11 = 'http://www.topografix.com/GPX/1/1'
EARTH_RADIUS_M = 6371008.8  # mean Earth radius, same as viewer/gpx.js
START = datetime(2026, 1, 1, 9, 0, 0, tzinfo=timezone.utc)
FIT_EPOCH = datetime(1989, 12, 31, 0, 0, 0, tzinfo=timezone.utc)


def iso(t):
    return t.strftime('%Y-%m-%dT%H:%M:%SZ')


def haversine(a, b):
    lat1, lon1, lat2, lon2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(h))


def loop(lat0, lon0, n, radius, start, step_s, ele=None, phase=0.0):
    """n points on a wobbly loop around (lat0, lon0); radius in degrees of latitude."""
    pts = []
    for i in range(n):
        a = phase + 2 * math.pi * i / (n - 1)
        r = radius * (1 + 0.25 * math.sin(3 * a))
        lat = lat0 + r * math.sin(a)
        lon = lon0 + r * math.cos(a) / math.cos(math.radians(lat0))
        p = {'lat': round(lat, 6), 'lon': round(lon, 6)}
        if start is not None:
            p['time'] = start + timedelta(seconds=step_s * i)
        if ele is not None:
            p['ele'] = round(ele[0] + ele[1] * math.sin(a), 1)
        pts.append(p)
    return pts


def line(lat0, lon0, lat1, lon1, n, start, step_s):
    return [{'lat': round(lat0 + (lat1 - lat0) * i / (n - 1), 6),
             'lon': round(lon0 + (lon1 - lon0) * i / (n - 1), 6),
             'time': start + timedelta(seconds=step_s * i)} for i in range(n)]


def pt_xml(tag, p, indent):
    inner = ''
    if 'ele' in p:
        inner += f'<ele>{p["ele"]}</ele>'
    if 'time' in p:
        inner += f'<time>{iso(p["time"])}</time>'
    if 'name' in p:
        inner += f'<name>{p["name"]}</name>'
    if 'description' in p:
        inner += f'<desc><![CDATA[{p["description"]}]]></desc>'
    return f'{indent}<{tag} lat="{p["lat"]}" lon="{p["lon"]}">{inner}</{tag}>\n'


def gpx_doc(ns, version, head, body):
    return (f'<?xml version="1.0" encoding="UTF-8"?>\n'
            f'<gpx version="{version}" creator="make-fixtures" xmlns="{ns}">\n{head}{body}</gpx>\n')


def fit_crc(data):
    crc = 0
    for byte in data:
        crc ^= byte
        for _ in range(8):
            crc = (crc >> 1) ^ 0xA001 if crc & 1 else crc >> 1
    return crc & 0xFFFF


def fit_definition(local, global_number, fields, developer_fields=()):
    has_developer = bool(developer_fields)
    header = 0x40 | local | (0x20 if has_developer else 0)
    out = bytearray([header, 0, 0])
    out += struct.pack('<H', global_number)
    out.append(len(fields))
    for number, size, base_type in fields:
        out += bytes([number, size, base_type])
    if has_developer:
        out.append(len(developer_fields))
        for number, size, developer_index in developer_fields:
            out += bytes([number, size, developer_index])
    return bytes(out)


def fit_record(local, payload, compressed_offset=None):
    if compressed_offset is None:
        header = local
    else:
        header = 0x80 | ((local & 0x03) << 5) | (compressed_offset & 0x1F)
    return bytes([header]) + payload


def fit_string(value, size):
    return value.encode('utf-8')[:size].ljust(size, b'\0')


def fit_timestamp(value):
    return int((value - FIT_EPOCH).total_seconds())


def fit_semicircles(degrees):
    return round(degrees * 0x80000000 / 180)


def fit_file(data):
    header = bytearray([14, 0x20])
    header += struct.pack('<H', 21158)
    header += struct.pack('<I', len(data))
    header += b'.FIT'
    header += struct.pack('<H', fit_crc(header))
    body = header + data
    return bytes(body) + struct.pack('<H', fit_crc(body))


def track_xml(name, segments):
    s = f'  <trk>\n    <name>{name}</name>\n'
    for seg in segments:
        s += '    <trkseg>\n' + ''.join(pt_xml('trkpt', p, '      ') for p in seg) + '    </trkseg>\n'
    return s + '  </trk>\n'


def expected(tracks=(), routes=(), waypoints=()):
    segments = [seg for _, segs in tracks for seg in segs]
    track_pts = [p for seg in segments for p in seg]
    dist = sum(haversine((a['lat'], a['lon']), (b['lat'], b['lon']))
               for seg in segments for a, b in zip(seg, seg[1:]))
    if not segments:
        dist = sum(haversine((a['lat'], a['lon']), (b['lat'], b['lon']))
                   for _, rte in routes for a, b in zip(rte, rte[1:]))
    route_pts = [p for _, r in routes for p in r]
    timeline = track_pts if track_pts else route_pts if route_pts else list(waypoints)
    times = sorted(p['time'] for p in timeline if 'time' in p)
    return {
        'tracks': len(tracks),
        'segments': len(segments),
        'routes': len(routes),
        'waypoints': len(waypoints),
        # A GPX file has no polygons, so nothing is drawn as an area beneath the line.
        'areas': 0,
        'points': len(track_pts),
        'distanceMeters': round(dist, 1),
        'start': iso(times[0]) if times else None,
        'end': iso(times[-1]) if times else None,
        'durationSeconds': int((times[-1] - times[0]).total_seconds()) if times else None,
        'elevation': any('ele' in p for p in track_pts),
    }


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    files, exp = {}, {}

    # One track with time and elevation.
    hike = loop(46.55, 7.98, 121, 0.02, START, 30, ele=(1500, 300))
    files['track-time-ele.gpx'] = gpx_doc(NS11, '1.1',
        f'  <metadata>\n    <name>Synthetic hike</name>\n    <time>{iso(START)}</time>\n  </metadata>\n',
        track_xml('Loop', [hike]))
    exp['track-time-ele.gpx'] = expected(tracks=[('Loop', [hike])])

    # Two tracks, the first with two segments (a pause between them).
    t2 = START + timedelta(days=1)
    seg_a = line(46.60, 8.00, 46.62, 8.04, 40, t2, 20)
    seg_b = line(46.62, 8.05, 46.60, 8.09, 40, t2 + timedelta(hours=1), 20)
    seg_c = loop(46.58, 8.06, 50, 0.01, t2 + timedelta(hours=4), 25, phase=1.0)
    multi = [('Morning', [seg_a, seg_b]), ('Afternoon', [seg_c])]
    files['multi-segment.gpx'] = gpx_doc(NS11, '1.1', '', ''.join(track_xml(n, s) for n, s in multi))
    exp['multi-segment.gpx'] = expected(tracks=multi)

    # A continuous trail with one bad GPS sample. The two surrounding edges are implausible jumps, but the
    # viewer should collapse them into one sampling anomaly rather than call the line a data break.
    anomaly_time = START + timedelta(days=1, hours=8)
    anomaly = line(46.70, 8.10, 46.71, 8.14, 12, anomaly_time, 20)
    anomaly[5] = {**anomaly[5], 'lat': anomaly[5]['lat'] + 0.01}
    files['gps-anomaly.gpx'] = gpx_doc(NS11, '1.1', '', track_xml('GPS anomaly', [anomaly]))
    exp['gps-anomaly.gpx'] = expected(tracks=[('GPS anomaly', [anomaly])])

    # Three time-continuous spikes along one route. At overview zoom their GPS labels should merge into one
    # anomaly-band label while keeping the cyan line overlays and the full anomaly count in the summary.
    anomaly_band = line(46.80, 8.20, 46.82, 8.24, 30, anomaly_time + timedelta(hours=1), 20)
    for index in (5, 14, 23):
        anomaly_band[index] = {
            **anomaly_band[index],
            'lat': anomaly_band[index]['lat'] + 0.01,
        }
    files['gps-anomaly-band.gpx'] = gpx_doc(
        NS11, '1.1', '', track_xml('GPS anomaly band', [anomaly_band]))
    exp['gps-anomaly-band.gpx'] = expected(tracks=[('GPS anomaly band', [anomaly_band])])

    # One real recording break plus one in-segment speed spike. Both measurements belong to the same
    # "track anomalies" summary cell.
    mixed = line(46.90, 8.30, 46.92, 8.34, 20, anomaly_time + timedelta(hours=2), 20)
    mixed[6] = {**mixed[6], 'lat': mixed[6]['lat'] + 0.01}
    second_half = [{**point, 'lat': point['lat'] + 0.02} for point in mixed[10:]]
    mixed_segments = [mixed[:10], second_half]
    files['mixed-anomalies.gpx'] = gpx_doc(
        NS11, '1.1', '', track_xml('Mixed anomalies', mixed_segments))
    exp['mixed-anomalies.gpx'] = expected(tracks=[('Mixed anomalies', mixed_segments)])

    # A dense group of photo stops. All ordinary pins should cluster at a whole-route zoom, while the semantic
    # danger point stays readable as an individual pin and keyboard selection can surface any raw stop.
    dense_wpts = []
    for i in range(60):
        angle = 2 * math.pi * i / 60
        point = {
            'lat': round(30.0 + 0.00025 * math.sin(angle), 8),
            'lon': round(100.0 + 0.00025 * math.cos(angle), 8),
            'name': f'Photo stop {i + 1}',
        }
        if i % 3 == 0:
            point['description'] = '<img src="photo.png">'
        dense_wpts.append(point)
    dense_wpts[0] = {'lat': 30.0, 'lon': 100.0, 'name': '危险陡崖'}
    dense_placemarks = ''
    for point in dense_wpts:
        description = (f'<description><![CDATA[{point["description"]}]]></description>'
                       if 'description' in point else '')
        dense_placemarks += ('    <Placemark>'
                             f'<name>{point["name"]}</name>{description}'
                             '<Point><coordinates>'
                             f'{point["lon"]},{point["lat"]},0'
                             '</coordinates></Point></Placemark>\n')
    files['dense-waypoints.kml'] = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>'
        '<name>Dense waypoints</name>\n'
        f'{dense_placemarks}</Document></kml>\n')
    exp['dense-waypoints.kml'] = expected(waypoints=dense_wpts)

    # Waypoints and a planned route, no track and no timestamps.
    wpts = [{'lat': 46.57, 'lon': 7.95, 'name': 'Start'},
            {'lat': 46.59, 'lon': 7.99, 'name': 'Viewpoint'},
            {'lat': 46.56, 'lon': 8.02, 'name': 'Hut'}]
    rte = [{'lat': 46.57, 'lon': 7.95}, {'lat': 46.58, 'lon': 7.96}, {'lat': 46.59, 'lon': 7.99},
           {'lat': 46.58, 'lon': 8.01}, {'lat': 46.56, 'lon': 8.02}, {'lat': 46.555, 'lon': 8.03}]
    body = ''.join(pt_xml('wpt', w, '  ') for w in wpts)
    body += '  <rte>\n    <name>Planned route</name>\n' + ''.join(pt_xml('rtept', p, '    ') for p in rte) + '  </rte>\n'
    files['waypoints-route.gpx'] = gpx_doc(NS11, '1.1', '', body)
    exp['waypoints-route.gpx'] = expected(routes=[('Planned route', rte)], waypoints=wpts)

    # GPX 1.0 (name and time directly under <gpx>), written with a byte order mark.
    t3 = START + timedelta(days=2)
    old = line(46.50, 7.90, 46.53, 7.97, 30, t3, 60)
    files['gpx10.gpx'] = '\ufeff' + gpx_doc(NS10, '1.0',
        f'  <name>Old format</name>\n  <time>{iso(t3)}</time>\n', track_xml('Old track', [old]))
    exp['gpx10.gpx'] = expected(tracks=[('Old track', [old])])

    # Starts as GPX but is cut off: CanHandle accepts it, the viewer shows its error page.
    files['truncated.gpx'] = files['track-time-ele.gpx'][:len(files['track-time-ele.gpx']) // 2]
    exp['truncated.gpx'] = {'error': True}

    # FIT activity with native and compressed timestamps, elevation, a course point and a developer field.
    # The developer field proves that vendor metrics are skipped without shifting every following record.
    fit_start = START + timedelta(days=5)
    fit_points = [
        {
            'lat': 46.50 + i * 0.0002,
            'lon': 7.90 + i * 0.0003,
            'ele': 1500 + i * 5,
            'time': fit_start + timedelta(seconds=15 * i),
        }
        for i in range(5)
    ]
    fit_course_point = {
        'lat': fit_points[2]['lat'],
        'lon': fit_points[2]['lon'],
        'name': 'Hut',
        'time': fit_points[2]['time'],
    }
    timestamp_field = (253, 4, 0x86)
    record_fields = [
        timestamp_field,
        (0, 4, 0x85),   # position_lat, sint32
        (1, 4, 0x85),   # position_long, sint32
        (2, 2, 0x84),   # altitude, uint16
        (3, 1, 0x02),   # heart_rate, uint8
        (5, 4, 0x86),   # distance, uint32
    ]
    course_point_fields = [
        (1, 4, 0x86),
        (2, 4, 0x85),
        (3, 4, 0x85),
        (4, 4, 0x86),
        (5, 1, 0x00),
        (6, 16, 0x07),
    ]
    fit_data = bytearray()
    fit_data += fit_definition(4, 0, [(0, 1, 0x00)])
    fit_data += fit_record(4, bytes([4]))  # file_id type: activity
    fit_data += fit_definition(2, 31, [(5, 32, 0x07)])
    fit_data += fit_record(2, fit_string('Synthetic FIT', 32))
    fit_data += fit_definition(1, 18, [
        timestamp_field,
        (7, 4, 0x86),   # total_elapsed_time, scale 1000
        (8, 4, 0x86),   # total_timer_time, scale 1000
        (9, 4, 0x86),   # total_distance, scale 100
    ])
    fit_distance = sum(
        haversine((a['lat'], a['lon']), (b['lat'], b['lon']))
        for a, b in zip(fit_points, fit_points[1:])
    )
    fit_data += fit_record(1, (
        struct.pack('<I', fit_timestamp(fit_points[-1]['time']))
        + struct.pack('<III', 3_600_000, 3_300_000, round(fit_distance * 100))
    ))
    fit_data += fit_definition(3, 32, course_point_fields)
    fit_data += fit_record(3, (
        struct.pack('<I', fit_timestamp(fit_course_point['time']))
        + struct.pack('<iiI', fit_semicircles(fit_course_point['lat']),
                      fit_semicircles(fit_course_point['lon']), round(fit_distance * 50))
        + bytes([0])
        + fit_string(fit_course_point['name'], 16)
    ))
    fit_data += fit_definition(0, 20, record_fields, developer_fields=[(0, 2, 0)])
    for index, point in enumerate(fit_points):
        values = (
            struct.pack('<iiHBI',
                        fit_semicircles(point['lat']),
                        fit_semicircles(point['lon']),
                        round((point['ele'] + 500) * 5),
                        118 + index,
                        round(haversine((fit_points[0]['lat'], fit_points[0]['lon']),
                                        (point['lat'], point['lon'])) * 100))
            + b'\x01\x02'
        )
        if index == 0:
            fit_data += fit_record(0, struct.pack('<I', fit_timestamp(point['time'])) + values)
        else:
            fit_data += fit_record(0, values,
                                   compressed_offset=fit_timestamp(point['time']) & 0x1F)
    files['synthetic.fit'] = fit_file(bytes(fit_data))
    exp['synthetic.fit'] = expected(
        tracks=[('Synthetic FIT', [fit_points])],
        waypoints=[fit_course_point],
    )
    exp['synthetic.fit']['durationSeconds'] = 3600

    # A valid workout framing with no GPS records must reach a readable error instead of being previewed as
    # an empty map.
    no_gps = (
        fit_definition(4, 0, [(0, 1, 0x00)])
        + fit_record(4, bytes([5]))  # file_id type: workout
        + fit_definition(1, 18, [(7, 4, 0x86), (8, 4, 0x86)])
        + fit_record(1, struct.pack('<II', 600_000, 600_000))
    )
    files['no-gps.fit'] = fit_file(no_gps)
    exp['no-gps.fit'] = {'error': True}

    bad_crc = bytearray(files['synthetic.fit'])
    bad_crc[-1] ^= 0xFF
    files['bad-crc.fit'] = bytes(bad_crc)
    exp['bad-crc.fit'] = {'error': True}
    files['truncated.fit'] = files['synthetic.fit'][:-100]
    exp['truncated.fit'] = {'error': True}

    # A long file name on a tall, narrow window. The card is only as wide as its longest line, so the name is
    # part of the fixture: this is the width that used to push the corner switches onto the card.
    t5 = START + timedelta(days=4)
    traverse = loop(46.42, 7.66, 181, 0.03, t5, 40, ele=(2600, 420), phase=0.4)
    long_name = '2026-02-01-alpine-snow-traverse-1793781751910.gpx'
    files[long_name] = gpx_doc(NS11, '1.1', '', track_xml('Alpine snow traverse', [traverse]))
    exp[long_name] = expected(tracks=[('Alpine snow traverse', [traverse])])

    # A track that runs across rather than around: the landscape overlay gathers the figures into the top-left
    # corner and puts the track in the band below, and only a track that runs the width of that band can show
    # the band is being used. Written here but deliberately left out of expected.json: the overlay test measures
    # it in pixels, while the viewer test has no summary numbers for it to compare.
    t6 = datetime(2026, 5, 2, 7, 0, 0, tzinfo=timezone.utc)
    across = [{'lat': round(30.02 + 0.03 * i / 239, 6),
               'lon': round(100.00 + 0.62 * i / 239, 6),
               'ele': round(420 + 70 * math.sin(math.pi * i / 239), 1),
               'time': t6 + timedelta(seconds=30 * i)} for i in range(240)]
    (OUT / 'wide-track.gpx').write_bytes(
        gpx_doc(NS11, '1.1', '', track_xml('East-west traverse', [across])).encode('utf-8'))

    # Rejected by CanHandle.
    files['empty.gpx'] = ''
    files['broken.gpx'] = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="x"<trk>\n'
    # A DOCTYPE with an external entity: accepted, and the entity is never resolved (no XXE).
    files['doctype.gpx'] = ('<?xml version="1.0" encoding="UTF-8"?>\n'
                            '<!DOCTYPE gpx [<!ENTITY ext SYSTEM "file:///nonexistent/fixture.txt">]>\n'
                            f'<gpx version="1.1" creator="make-fixtures" xmlns="{NS11}"><name>&ext;</name></gpx>\n')
    # The root element starts after the first 64 KB that CanHandle reads: rejected.
    files['late-root.gpx'] = ('<?xml version="1.0" encoding="UTF-8"?>\n<!--' + ' ' * (64 * 1024) + '-->\n'
                              f'<gpx version="1.1" creator="make-fixtures" xmlns="{NS11}"></gpx>\n')
    files['not-gpx.gpx'] = ('<?xml version="1.0" encoding="UTF-8"?>\n'
                            '<kml xmlns="http://www.opengis.net/kml/2.2"><Document/></kml>\n')

    for name, content in files.items():
        (OUT / name).write_bytes(content if isinstance(content, bytes) else content.encode('utf-8'))
    # Merged into whatever is already there rather than replacing it: this script writes the GPX fixtures,
    # and the KML/KMZ ones (and their expected numbers) are checked in beside them. Rewriting the file from
    # scratch silently dropped thirteen entries the first time it was run.
    known = json.loads((OUT / 'expected.json').read_text(encoding='utf-8')) if (OUT / 'expected.json').exists() else {}
    detect = known.get('detect', {})
    # Anything already listed keeps the answer it was given: a few of these were corrected by hand against
    # what the detector actually does (not-gpx.gpx is accepted), and a formula here would undo that.
    detect.setdefault('truncated.fit', False)
    for name in sorted(files):
        detect.setdefault(name, name not in (
            'empty.gpx', 'broken.gpx', 'not-gpx.gpx', 'late-root.gpx', 'truncated.fit',
        ))
    viewer = known.get('viewer', {})
    # Shallow merge per fixture: the numbers come from here, while keys this script does not produce (areas,
    # elevation, the line and marker counts) stay as checked in.
    for name, values in exp.items():
        viewer[name] = {**viewer.get(name, {}), **values}
    # Bytes, not text mode: the same LF line endings on Windows (CI checks the files are unchanged).
    (OUT / 'expected.json').write_bytes(
        (json.dumps({'detect': detect, 'viewer': viewer}, indent=2) + '\n').encode('utf-8'))
    print(f'{len(files)} fixtures written to {OUT.name}/, {len(detect)} known to the tests')


if __name__ == '__main__':
    main()
