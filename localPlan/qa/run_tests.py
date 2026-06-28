#!/usr/bin/env python3
import json
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
qa_dir = Path(__file__).resolve().parent
input_path = qa_dir / 'input.txt'
expected_path = qa_dir / 'expected.json'
actual_path = qa_dir / 'actual.json'

print('Running QA regression test for braindump.py...')
result = subprocess.run(
    [sys.executable, str(root / 'braindump.py'), '--seed', '123', str(input_path), '-o', str(actual_path)],
    capture_output=True,
    text=True,
)
if result.returncode != 0:
    print('ERROR: braindump.py failed to run')
    print(result.stdout)
    print(result.stderr)
    sys.exit(result.returncode)

with expected_path.open(encoding='utf-8') as f:
    expected = json.load(f)
with actual_path.open(encoding='utf-8') as f:
    actual = json.load(f)

if actual != expected:
    print('ERROR: expected JSON did not match actual output.')
    print('--- expected ---')
    print(json.dumps(expected, indent=2))
    print('--- actual ---')
    print(json.dumps(actual, indent=2))
    sys.exit(1)

print('PASS: actual output matches expected golden JSON.')
actual_path.unlink()
