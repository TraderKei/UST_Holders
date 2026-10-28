"""Developer-side stdlib verification, never deployed to the C server.

Usage: python tests/c/verify_ust_v2_json.py <compiled-C-test-executable>
Fixtures replace Altibase queries; this is not a real-driver integration test.
"""
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
DATASET = '00000000-0000-4000-8000-000000000001'
FAILURES = ('no-current', 'query-error', 'bad-count', 'bad-source', 'bad-number',
            'large-number', 'comma-number', 'leading-zero', 'too-precise',
            'allocation-error', 'growth-error', 'bad-month-order', 'invalid-utf8',
            'empty-number', 'nan-number', 'exponent-number')


def fixture(data, path):
    meta = data['meta']
    keys = ('schema_version', 'first_month', 'latest_month', 'is_preliminary',
            'history_join', 'transaction_start', 'overlap_rows',
            'overlap_differences', 'cross_checks', 'historical_only_entities')
    groups = [
        [[DATASET]],
        [[meta[k] for k in keys] + [len(data[k]) for k in ('countries', 'months', 'records')]],
        [[s['file'], s['url'], s['downloaded_at'], s['sha256'], code]
         for s, code in zip(meta['sources'], ('T3', 'T5', 'HIST'))],
        [[c[k] for k in ('country_name', 'country_code', 'region', 'record_type', 'rank_eligible')]
         for c in data['countries']],
        [[m] for m in data['months']],
        [r[:9] + ['T3' if r[9] == 0 else 'HIST'] for r in data['records']],
    ]
    with path.open('wb') as stream:
        stream.write(b'USTFIX1\n')
        for rows in groups:
            stream.write(f'{len(rows)}\n{len(rows[0])}\n'.encode('ascii'))
            for row in rows:
                for cell in row:
                    if cell is None:
                        stream.write(b'-1\n')
                    else:
                        value = ('Y' if cell else 'N') if isinstance(cell, bool) else str(cell)
                        encoded = value.encode('utf-8')
                        stream.write(f'{len(encoded)}\n'.encode('ascii') + encoded + b'\n')


def verify(executable):
    data = json.loads((ROOT / 'dashboard/public/data/tic.json').read_text(encoding='utf-8'))
    data['records'].sort(key=lambda row: (row[0], row[1]))
    with tempfile.TemporaryDirectory(prefix='ust-c-fixtures-') as directory:
        path = Path(directory) / 'input.cells'

        def run(expected, failure=None):
            fixture(expected, path)
            result = subprocess.run([str(executable), str(path)] + ([failure] if failure else []),
                                    check=True, capture_output=True)
            if failure:
                assert not result.stdout
                print(result.stderr.decode().strip())
                return
            actual = json.loads(result.stdout)
            for key in ('countries', 'months', 'records'):
                assert actual[key] == expected[key], key
            for key, value in expected['meta'].items():
                if key not in ('source_mode', 'status'):
                    assert actual['meta'][key] == value, key
            assert actual['meta']['dataset_id'] == DATASET
            assert actual['meta']['source_mode'] == 'altibase'

        run(data)
        for failure in FAILURES:
            run(data, failure)
        special = copy.deepcopy(data)
        special['countries'][0]['country_name'] = '한글 "quoted" \\ path\n\t\r\b\f\x01 😀'
        special['countries'][0]['region'] = None
        special['records'][0][2:9] = [0, None, -10.125, 1.001, 10, -3.5, None]
        run(special)
        print(f"PASS standard-C writer: {len(data['records'])} rows; all arrays/meta; "
              f"escaping, UTF-8, null/zero/negative/decimal; {len(FAILURES)} failures. "
              'Actual Altibase integration not tested.')


if __name__ == '__main__':
    verify(Path(sys.argv[1]).resolve())
