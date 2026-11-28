"""Read-only RC8 review of downloaded exact-SHA GitHub artifacts.

A locally saved review snapshot is NOT a signature. Obtain it freshly through
release-candidate-review.mjs and verify the GitHub identity before using it.
Never extracts archives, deploys, or marks manual acts as passed.
"""
import argparse
import hashlib
import io
import json
import re
import stat
import sys
import zipfile
from pathlib import Path

MAX_ZIP = 64 * 1024 * 1024
MAX_STATIC = 32 * 1024 * 1024
MAX_FILE = 8 * 1024 * 1024
WORKFLOWS = ("TeachApp", "TeachApp WebKit", "TeachApp Cloudflare",
             "TeachApp Delta synthetic", "TeachApp Platform synthetic",
             "TeachApp Firebase archive")
ARTIFACTS = ("teachapp-static-review", "teachapp-static-manifest", "teachapp-ui-smoke")
REQUIRED = {"index.html", "live/index.html", "manifest.webmanifest", "sw.js",
            "js/app.js", "js/public-view.js", "js/version.js", "vendor/xlsx.full.min.js"}


def require(ok, message):
    if not ok:
        raise ValueError(message)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def exact(value, keys):
    return type(value) is dict and set(value) == set(keys)


def positive(value):
    return type(value) is int and value > 0


def sha_ok(value):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{40}", value) is not None


def bounded_file(path, limit):
    path = Path(path)
    require(not path.is_symlink() and path.is_file(), "Not a regular local file")
    require(path.stat().st_size <= limit, "Input exceeds size budget")
    with path.open("rb") as stream:
        raw = stream.read(limit + 1)
    require(len(raw) <= limit, "Input exceeds size budget")
    return raw


def strict_json(raw):
    def pairs(rows):
        result = {}
        for key, value in rows:
            require(key not in result, "Duplicate JSON key")
            result[key] = value
        return result

    def bad_constant(_):
        raise ValueError("Invalid JSON number")

    return json.loads(raw.decode("utf-8"), object_pairs_hook=pairs, parse_constant=bad_constant)


def safe_name(name):
    return (isinstance(name, str) and len(name) <= 240 and
            re.fullmatch(r"[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*", name) is not None and
            all(part not in (".", "..") and not part.endswith(".") for part in name.split("/")))


def static_name(name):
    return name in REQUIRED or name == ".nojekyll" or re.fullmatch(
        r"(?:js/(?:[a-z0-9_-]+/)*[a-z0-9_-]+\.js|css/[a-z0-9_-]+\.css|icons/[a-z0-9_-]+\.(?:png|svg))", name) is not None


def inspect_zip(raw, *, total_limit, entry_limit, file_limit, read_contents):
    """No extraction: reject aliases, special files, traversal, encrypted entries and bombs."""
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        items = archive.infolist()
        require(0 < len(items) <= entry_limit, "ZIP entry budget exceeded")
        seen, files, dirs, total = set(), {}, set(), 0
        for item in items:
            name = item.filename.rstrip("/") if item.is_dir() else item.filename
            require(safe_name(name) and item.orig_filename == item.filename and name.casefold() not in seen,
                    "Unsafe or duplicate ZIP path")
            seen.add(name.casefold())
            mode = stat.S_IFMT(item.external_attr >> 16)
            require(mode in (0, stat.S_IFDIR if item.is_dir() else stat.S_IFREG), "Special file in ZIP")
            require(not item.flag_bits & 1 and item.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED),
                    "Unsupported ZIP entry")
            if item.is_dir():
                require(item.file_size == 0, "Invalid ZIP directory")
                dirs.add(name)
                continue
            total += item.file_size
            require(0 <= item.file_size <= file_limit and total <= total_limit, "ZIP expanded size budget exceeded")
            files[name] = archive.read(item) if read_contents else None
            if read_contents:
                require(len(files[name]) == item.file_size, "ZIP size mismatch")
        require(all(any(f.startswith(d + "/") for f in files) for d in dirs), "Unexpected ZIP directory")
        require(not any(any("/".join(f.split("/")[:i]).casefold() in
                            {n.casefold() for n in files} for i in range(1, len(f.split("/"))))
                        for f in files), "File/directory path collision")
        return files


def review_metadata(review, sha, expected_pr=116):
    require(sha_ok(sha) and exact(review, ("format", "sha", "base", "pr", "checks", "artifacts",
                                          "automaticReviewReady", "manualPending", "releaseAuthorized")) and
            review["format"] == 1 and review["sha"] == sha and sha_ok(review["base"]) and
            review["base"] != sha and positive(expected_pr) and expected_pr >= 116 and
            type(review["pr"]) is int and review["pr"] == expected_pr and
            review["automaticReviewReady"] is True and review["releaseAuthorized"] is False,
            "Review snapshot not ready or wrong SHA")
    checks = review["checks"]
    require(type(checks) is list and len(checks) == 12, "Incomplete CI evidence")
    seen, runs = set(), set()
    primary = None
    for row in checks:
        require(exact(row, ("name", "event", "id", "attempt", "status")) and
                row["name"] in WORKFLOWS and row["event"] in ("push", "pull_request") and
                positive(row["id"]) and positive(row["attempt"]) and row["status"] == "passed",
                "Invalid or unfinished CI evidence")
        key = (row["name"], row["event"])
        require(key not in seen and row["id"] not in runs, "Duplicate CI evidence")
        seen.add(key)
        runs.add(row["id"])
        if key == ("TeachApp", "push"):
            primary = row["id"]
    require(primary is not None, "Missing main push CI")
    rows = review["artifacts"]
    require(type(rows) is list and len(rows) == 3, "Incomplete artifact evidence")
    result, ids = {}, set()
    for row in rows:
        require(exact(row, ("name", "id", "digest", "bytes", "runId")) and row["name"] in ARTIFACTS and
                row["name"] not in result and positive(row["id"]) and row["id"] not in ids and
                row["runId"] == primary and positive(row["bytes"]) and row["bytes"] <= MAX_ZIP and
                isinstance(row["digest"], str) and re.fullmatch(r"sha256:[0-9a-f]{64}", row["digest"]),
                "Invalid artifact evidence")
        result[row["name"]] = row
        ids.add(row["id"])
    return result


def verify_archives(review, sha, paths, expected_pr=116):
    records = review_metadata(review, sha, expected_pr)
    require(set(paths) == set(ARTIFACTS), "Missing local artifact")
    raw = {}
    for name, record in records.items():
        data = bounded_file(paths[name], MAX_ZIP)
        require(len(data) == record["bytes"] and "sha256:" + digest(data) == record["digest"],
                "Artifact ZIP size or digest mismatch: " + name)
        raw[name] = data
    manifest_files = inspect_zip(raw["teachapp-static-manifest"], total_limit=1024 * 1024,
                                 entry_limit=4, file_limit=1024 * 1024, read_contents=True)
    require(set(manifest_files) == {"teachapp-static-manifest.json"}, "Unexpected manifest archive")
    manifest = strict_json(manifest_files["teachapp-static-manifest.json"])
    require(exact(manifest, ("format", "sha", "version", "files")) and manifest["format"] == 1 and
            manifest["sha"] == sha and isinstance(manifest["version"], str) and
            re.fullmatch(r"8\.0\.0(?:-rc\.[1-9][0-9]*)?", manifest["version"]) and
            type(manifest["files"]) is list and 0 < len(manifest["files"]) <= 1000,
            "Manifest SHA or format mismatch")
    package = inspect_zip(raw["teachapp-static-review"], total_limit=MAX_STATIC,
                          entry_limit=1500, file_limit=MAX_FILE, read_contents=True)
    require(REQUIRED | {".nojekyll"} <= set(package) and all(static_name(p) for p in package),
            "Missing or forbidden static path")
    paths_in_manifest = []
    for row in manifest["files"]:
        require(exact(row, ("path", "bytes", "sha256")) and isinstance(row["path"], str) and
                row["path"] in package and type(row["bytes"]) is int and row["bytes"] >= 0 and
                isinstance(row["sha256"], str) and re.fullmatch(r"[0-9a-f]{64}", row["sha256"]),
                "Invalid manifest file record")
        data = package[row["path"]]
        require(len(data) == row["bytes"] and digest(data) == row["sha256"], "Static file integrity mismatch")
        paths_in_manifest.append(row["path"])
    require(paths_in_manifest == sorted(package), "Missing, duplicate or extra static file")
    version = manifest["version"]
    worker = package["sw.js"].decode("utf-8")
    require(package[".nojekyll"] == b"" and
            package["js/version.js"].decode("utf-8").strip() == "export const APP_VERSION = '" + version + "';" and
            "const VERSION = 'v" + version + "';" in worker.splitlines(), "Static version mismatch")
    match = re.search(r"const PRECACHE = \[([\s\S]*?)\];", worker)
    require(match is not None and re.fullmatch(r"'\./[^'\r\n]*'(?:\s*,\s*'\./[^'\r\n]*')*\s*,?",
                                               match.group(1).strip()), "Invalid static precache")
    precache = [p[2:] for p in re.findall(r"'([^']+)'", match.group(1))]
    require(len(precache) == len(set(precache)) and "" in precache and "index.html" in precache and
            set(package) == (set(precache) - {""}) | {"sw.js", ".nojekyll"}, "Static precache mismatch")
    # UI artifact provenance and bounded structure only; never interpret screenshots.
    ui = inspect_zip(raw["teachapp-ui-smoke"], total_limit=MAX_ZIP, entry_limit=1000,
                     file_limit=MAX_FILE, read_contents=False)
    require(bool(ui), "Empty UI artifact")
    return {"sha": sha, "base": review["base"], "version": version, "staticFiles": len(package),
            "verifiedZipArtifacts": 3, "releaseAuthorized": False, "manualAcceptanceVerified": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pr", type=int, default=116, help="Expected review PR number (explicit for final candidate)")
    parser.add_argument("sha")
    parser.add_argument("review")
    parser.add_argument("static_zip")
    parser.add_argument("manifest_zip")
    parser.add_argument("ui_zip")
    args = parser.parse_args()
    try:
        review = strict_json(bounded_file(args.review, 1024 * 1024))
        result = verify_archives(review, args.sha, dict(zip(ARTIFACTS,
                                 (args.static_zip, args.manifest_zip, args.ui_zip))), expected_pr=args.pr)
        print(json.dumps(result, indent=2))
        return 0
    except (OSError, ValueError, TypeError, KeyError, zipfile.BadZipFile, RuntimeError, UnicodeError) as exc:
        print("Artifact review refused: " + str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
