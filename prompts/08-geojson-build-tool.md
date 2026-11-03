# 08 · A GeoJSON build tool

**Use it when:** map data arrives as downloaded files (emailed zips, PDFs, CSV or shapefile exports, a controller's dump) and you want it on a map, safely and repeatably.
**Fill in:** `<source>` (a short folder name, e.g. `soil`), `<what the files are>`, `<what the map should show>`, `<a source total to check against>`, `<output kind>`.
**Read first:** `docs/playbook/06-data-pipeline.md` (all of it).

```text
Goal
Write a Python tool, tools/<source>/build_<source>.py, that reads <what the files are> from
inbox/<source>/ and writes data/maps/<output kind>-<season>.geojson showing <what the map should show>.
Read docs/playbook/06-data-pipeline.md first, and start from its tool skeleton.

What to build
- tools/<source>/README.md: where the files come from, the one command to run, what good output looks like,
  and what to do when a check fails.
- tools/<source>/FORMAT.md: the output schema (top-level kind and meta, every property per layer, units).
- tools/<source>/overrides.json: hand corrections keyed by a stable id (start empty: {}). Overridden items
  get "set_by_hand": true in the output.
- The tool:
  - Run as python3 -I tools/<source>/build_<source>.py <season>. It adds only its own folder to sys.path.
  - Standard library first. If a package is really needed, use tools/<source>/.venv and document it.
  - It reads every file in inbox/<source>/ in sorted order, and never extracts or renames anything on disk.
    Nested zips are opened in memory with zipfile.ZipFile(io.BytesIO(...)).
  - Every read is wrapped in except UNREADABLE (the tuple from the doc). It prints one line per skipped file
    or member saying why, and carries on.
  - Binary headers are parsed defensively (clamp counts to what the file can hold).
  - Duplicates: skip identical files by content hash, and drop repeated records by hashing each record.
  - Impossible values are dropped by explicit thresholds, with a count printed per job.
  - Classification uses explicit rules, and each decision is printed.
  - Output follows the GeoJSON contract: kind, meta (season, as_of, source, totals, classes),
    properties.layer on every feature, style hints in properties, and precomputed 'label' Point features.
  - Self-checks: compare the output with <a source total to check against>, and check no duplicate ids and
    at least one feature. On failure, print "!! N CHECKS FAILED", write nothing, and exit 1.
    On success, print "All checks OK."
  - Byte-identical output: sorted inputs, features sorted by id, coordinates rounded to 6 decimals,
    json.dumps(..., separators=(',', ':'), sort_keys=True).
- If this data also gets a public share version, a second output in data/shares/ that REFUSES to write if any
  private field or text remains (check against an explicit list of private property names and patterns).
- inbox/<source>/ stays gitignored. Commit only the tool, its docs, overrides.json and the GeoJSON output.

Constraints
- Never open, print or commit the downloaded files' contents beyond what the output needs.
- No network access from the tool.
- Don't change the viewer in this task. If the viewer needs a new kind, say so and stop.

Acceptance checks
- With a test inbox you create from made-up files (a good zip, a zip inside a zip, a duplicate file, a
  corrupt file and an empty file), the tool skips the bad ones with clear messages and builds the rest.
- Running it twice gives the same shasum for the output.
- Deliberately breaking the total check makes it exit 1 and write nothing.
- The output opens in the map (or in geojson.io-style tooling) with features in the right place: [lng, lat].
- git status shows nothing from inbox/ staged.

How to verify (show me)
- The full console output of one run on the test inbox.
- shasum of the output from two runs.
- A screenshot of the output drawn on the map at 390x844.
```
