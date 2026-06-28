#!/usr/bin/env python3
"""
braindump.py - Convert a plain-text brain dump into a LocalPlan JSON file.

Usage:
    python3 braindump.py                    # reads from stdin
    python3 braindump.py input.txt          # reads from file
    python3 braindump.py -o out.json        # specify output file

Brain dump format (one item per line):

    track: item text
    track: item text (priority)
    track: item text [Soon]
    track: item text -- note text
    track > Section Name: item text
    # comments are ignored
    -- blank lines are ignored

The four standard horizons are: Now, Soon, Later, Someday.
The default horizon is Now.
The priority flag (priority) stars the item for Today view.

Examples:

    home: plan meals for the week
    home: grocery run (priority)
    home: deep clean the kitchen [Soon]
    family: schedule pediatrician appointment -- youngest needs flu shot
    family > Now: pickup roster for soccer (priority)
    self: book annual physical
    wellness: daily journaling (priority)

Use `--seed` to produce deterministic IDs for regression testing:

    python3 braindump.py --seed 123 braindump.example.txt -o out.json
"""

import argparse
import json
import re
import sys
import time
import random
import string
from pathlib import Path


HORIZONS = {
    "now": "now",
    "soon": "soon",
    "later": "later",
    "someday": "someday",
}

HORIZON_TO_SECTION = {
    "now": "Now",
    "soon": "Soon",
    "later": "Later",
    "someday": "Someday",
}

DEFAULT_HORIZON = "now"
DEFAULT_SECTION_NAME = "Now"

DETERMINISTIC_TIME_MS = None


def set_deterministic_seed(seed: int):
    """Seed the random generator and make time-based IDs repeatable."""
    random.seed(seed)
    global DETERMINISTIC_TIME_MS
    DETERMINISTIC_TIME_MS = 1700000000000


def make_uid(prefix: str) -> str:
    """Generate a unique-ish ID similar to the JS uid() function."""
    suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=6))
    timestamp = DETERMINISTIC_TIME_MS if DETERMINISTIC_TIME_MS is not None else int(time.time() * 1000)
    return f"{prefix}_{timestamp}_{suffix}"


def parse_line(line: str):
    """
    Parse one brain dump line into a structured tuple:
        (track_name, section_name, item_text, priority_bool, detail_or_none)

    Returns None if the line is a comment or blank.
    """
    raw = line.strip()
    if not raw or raw.startswith("#"):
        # Comments and blank lines are silently skipped (not warnings).
        return "skip_quiet"

    # Split track[/section] from the item text on the first colon.
    if ":" not in raw:
        # No colon means this isn't a valid item line; warn but skip.
        print(f"  ! skipped (no colon): {raw}", file=sys.stderr)
        return None

    track_part, item_part = raw.split(":", 1)
    track_part = track_part.strip()
    item_part = item_part.strip()

    if not track_part or not item_part:
        print(f"  ! skipped (empty track or item): {raw}", file=sys.stderr)
        return None

    # Handle "track > Section" syntax for explicit section naming.
    explicit_section = None
    if ">" in track_part:
        track_name, explicit_section = [p.strip() for p in track_part.split(">", 1)]
    else:
        track_name = track_part

    # Extract detail/note after "--".
    detail = None
    if "--" in item_part:
        item_text, detail_part = item_part.split("--", 1)
        item_text = item_text.strip()
        detail = detail_part.strip() or None
    else:
        item_text = item_part

    # Extract horizon tag in [brackets].
    horizon = DEFAULT_HORIZON
    section_name = DEFAULT_SECTION_NAME
    horizon_match = re.search(r"\[([^\]]+)\]", item_text)
    if horizon_match:
        tag = horizon_match.group(1).strip().lower()
        if tag in HORIZONS:
            horizon = HORIZONS[tag]
            section_name = HORIZON_TO_SECTION[horizon]
        else:
            # Unknown horizon tag - treat the bracket text as a custom section name.
            section_name = horizon_match.group(1).strip()
        item_text = (item_text[: horizon_match.start()] + item_text[horizon_match.end():]).strip()

    # Explicit section overrides everything.
    if explicit_section:
        section_name = explicit_section
        # Try to infer horizon from the section name.
        lowered = explicit_section.lower()
        if lowered in HORIZONS:
            horizon = HORIZONS[lowered]

    # Extract priority flag.
    priority = False
    priority_match = re.search(r"\(priority\)", item_text, re.IGNORECASE)
    if priority_match:
        priority = True
        item_text = (item_text[: priority_match.start()] + item_text[priority_match.end():]).strip()

    # Clean up dangling whitespace.
    item_text = re.sub(r"\s+", " ", item_text).strip()

    if not item_text:
        print(f"  ! skipped (item became empty after parsing): {raw}", file=sys.stderr)
        return None

    return (track_name, section_name, horizon, item_text, priority, detail)


def slugify(name: str) -> str:
    """Lowercase, replace non-alphanumerics with underscores, used for track ids."""
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_") or "track"


def build_plan(lines, existing_plan=None):
    """
    Build the LocalPlan JSON structure from parsed lines.

    If existing_plan is provided, items are merged into it instead of starting fresh.
    """
    plan = existing_plan or {
        "planTitle": "My Plan",
        "planSubtitle": "A place to keep track of what matters.",
        "tracks": [],
    }

    # Index existing tracks for fast lookup (case-insensitive).
    track_index = {t["title"].lower(): t for t in plan["tracks"]}

    parsed_count = 0
    skipped_count = 0

    for raw in lines:
        result = parse_line(raw)
        if result == "skip_quiet":
            continue
        if result is None:
            skipped_count += 1
            continue

        track_name, section_name, horizon, item_text, priority, detail = result

        # Find or create the track.
        track = track_index.get(track_name.lower())
        if track is None:
            track = {
                "id": slugify(track_name) + "_" + make_uid("t").split("_", 1)[1],
                "icon": track_name.strip()[0].upper() if track_name.strip() else "?",
                "title": track_name,
                "subtitle": "Click to add a description",
                "open": True,
                "sections": [],
            }
            plan["tracks"].append(track)
            track_index[track_name.lower()] = track

        # Find or create the section within this track.
        section = next((s for s in track["sections"] if s["name"].lower() == section_name.lower()), None)
        if section is None:
            section = {
                "name": section_name,
                "horizon": horizon,
                "items": [],
            }
            track["sections"].append(section)

        # Build the item.
        item = {
            "id": make_uid("item"),
            "text": item_text,
            "done": False,
        }
        if priority:
            item["priority"] = True
        if detail:
            item["detail"] = detail

        section["items"].append(item)
        parsed_count += 1

    return plan, parsed_count, skipped_count


def read_input(source):
    """Read brain dump from a file path or from stdin."""
    if source is None:
        print("Paste your brain dump. Hit Ctrl+D (Mac/Linux) or Ctrl+Z then Enter (Windows) when done.\n", file=sys.stderr)
        return sys.stdin.read().splitlines()
    path = Path(source)
    if not path.exists():
        print(f"Error: file not found: {source}", file=sys.stderr)
        sys.exit(1)
    return path.read_text(encoding="utf-8").splitlines()


def main():
    parser = argparse.ArgumentParser(
        description="Convert a plain-text brain dump into a LocalPlan JSON file.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("input", nargs="?", help="Input file (omit for stdin)")
    parser.add_argument("-o", "--output", default=None, help="Output file (default: braindump-YYYY-MM-DD.json)")
    parser.add_argument("-m", "--merge", default=None, help="Merge into an existing LocalPlan JSON file instead of starting fresh")
    parser.add_argument("--seed", type=int, default=None, help="Seed the ID generator for deterministic output")
    args = parser.parse_args()

    if args.seed is not None:
        set_deterministic_seed(args.seed)

    lines = read_input(args.input)

    existing_plan = None
    if args.merge:
        merge_path = Path(args.merge)
        if not merge_path.exists():
            print(f"Error: merge file not found: {args.merge}", file=sys.stderr)
            sys.exit(1)
        try:
            existing_plan = json.loads(merge_path.read_text(encoding="utf-8"))
            if not isinstance(existing_plan.get("tracks"), list):
                print(f"Error: {args.merge} doesn't look like a LocalPlan JSON file.", file=sys.stderr)
                sys.exit(1)
        except json.JSONDecodeError as e:
            print(f"Error: could not parse {args.merge}: {e}", file=sys.stderr)
            sys.exit(1)

    plan, parsed, skipped = build_plan(lines, existing_plan)

    if parsed == 0:
        print("\nNo items parsed. Nothing to write.", file=sys.stderr)
        sys.exit(1)

    if args.output:
        out_path = Path(args.output)
    else:
        date_str = time.strftime("%Y-%m-%d")
        out_path = Path(f"braindump-{date_str}.json")

    out_path.write_text(json.dumps(plan, indent=2), encoding="utf-8")

    track_count = len(plan["tracks"])
    print(f"\n  Wrote {parsed} items across {track_count} track(s) to {out_path}", file=sys.stderr)
    if skipped > 0:
        print(f"  Skipped {skipped} line(s) - see warnings above.", file=sys.stderr)
    print(f"\n  Open LocalPlan, click 'Restore from file', and pick {out_path}.", file=sys.stderr)


if __name__ == "__main__":
    main()
