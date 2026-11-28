"""Synthetic archive review regressions and optional actual built-package rehearsal."""
import copy
import hashlib
import importlib.util
import io
import json
import os
import tempfile
import unittest
import warnings
import zipfile
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("release_artifacts", Path(__file__).resolve().parents[1] / "tools/release-artifacts.py")
R = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(R)
SHA = "a" * 40


def zipped(items):
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as z:
        for name, data in items:
            z.writestr(name, data)
    return out.getvalue()


def synthetic():
    files = {p: b"synthetic" for p in R.REQUIRED}
    version = "8.0.0-rc.8"
    files[".nojekyll"] = b""
    files["js/version.js"] = ("export const APP_VERSION = '" + version + "';\n").encode()
    files["sw.js"] = ("const VERSION = 'v" + version + "';\nconst PRECACHE = [" +
                      ",".join("'" + p + "'" for p in ["./"] +
                               ["./" + p for p in sorted(files) if p not in ("sw.js", ".nojekyll")]) + "];").encode()
    return files, make_manifest(files, version, SHA)


def make_manifest(files, version, sha):
    return {"format": 1, "sha": sha, "version": version,
            "files": [{"path": p, "bytes": len(files[p]), "sha256": hashlib.sha256(files[p]).hexdigest()}
                      for p in sorted(files)]}


def write_review(directory, files, manifest, ui=None, sha=SHA, extra=()):
    blobs = [zipped([*files.items(), *extra]),
             zipped([("teachapp-static-manifest.json", json.dumps(manifest).encode())]),
             ui if ui is not None else zipped([("synthetic.png", b"synthetic screenshot")])]
    paths, artifacts = {}, []
    for i, (name, raw) in enumerate(zip(R.ARTIFACTS, blobs)):
        path = Path(directory) / (name + ".zip")
        path.write_bytes(raw)
        paths[name] = path
        artifacts.append({"name": name, "id": 800 + i, "digest": "sha256:" + R.digest(raw),
                          "bytes": len(raw), "runId": 100})
    checks = [{"name": name, "event": event, "id": 100 + i * 2 + j,
               "attempt": 1, "status": "passed"} for i, name in enumerate(R.WORKFLOWS)
              for j, event in enumerate(("push", "pull_request"))]
    review = {"format": 1, "sha": sha, "base": "b" * 40, "pr": 116, "checks": checks,
              "artifacts": artifacts, "automaticReviewReady": True,
              "manualPending": ["manual"], "releaseAuthorized": False}
    return review, paths


class ReviewTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.files, self.manifest = synthetic()

    def check(self, **kw):
        return write_review(self.dir.name, self.files, self.manifest, **kw)

    def test_verify_and_raw_digest(self):
        review, paths = self.check()
        report = R.verify_archives(review, SHA, paths)
        self.assertEqual(report["staticFiles"], len(self.files))
        self.assertEqual(report["verifiedZipArtifacts"], 3)
        self.assertFalse(report["releaseAuthorized"])
        self.assertFalse(report["manualAcceptanceVerified"])
        path = paths[R.ARTIFACTS[0]]
        path.write_bytes(path.read_bytes() + b"x")
        with self.assertRaisesRegex(ValueError, "ZIP size or digest"):
            R.verify_archives(review, SHA, paths)

    def test_wrong_sha_unfinished_duplicate_ci_and_authorization(self):
        review, paths = self.check()
        for change in (lambda r: r.update(sha="c" * 40),
                       lambda r: r["checks"][0].update(status="pending"),
                       lambda r: r["checks"][1].update(id=100),
                       lambda r: r["artifacts"][1].update(runId=101),
                       lambda r: r.update(releaseAuthorized=True)):
            bad = copy.deepcopy(review)
            change(bad)
            with self.assertRaises(ValueError):
                R.verify_archives(bad, SHA, paths)

    def test_changed_static_even_with_matching_zip_digest(self):
        self.files["js/app.js"] = b"modified"
        review, paths = self.check()
        with self.assertRaisesRegex(ValueError, "Static file integrity"):
            R.verify_archives(review, SHA, paths)

    def test_forbidden_path_and_duplicate_and_symlink(self):
        for extra in [[("../escape", b"x")], [("server/private.js", b"x")],
                      [("JS/app.js", b"x")], [("js/app.js", b"x")]]:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", UserWarning)
                review, paths = self.check(extra=extra)
            with self.assertRaises(ValueError):
                R.verify_archives(review, SHA, paths)
        item = zipfile.ZipInfo("link")
        item.create_system = 3
        item.external_attr = 0o120777 << 16
        review, paths = self.check(ui=zipped([(item, b"target")]))
        with self.assertRaisesRegex(ValueError, "Special file"):
            R.verify_archives(review, SHA, paths)

    def test_no_unknown_manifest_fields_or_duplicate_keys(self):
        self.manifest["extra"] = "x"
        review, paths = self.check()
        with self.assertRaisesRegex(ValueError, "Manifest"):
            R.verify_archives(review, SHA, paths)
        with self.assertRaisesRegex(ValueError, "Duplicate JSON"):
            R.strict_json(b'{"sha":"a","sha":"b"}')

    def test_actual_static_package_when_supplied_by_ci(self):
        root, manifest_path = os.getenv("TEACHAPP_STATIC_REHEARSAL"), os.getenv("TEACHAPP_MANIFEST_REHEARSAL")
        if not root or not manifest_path:
            self.skipTest("Actual package supplied by CI after static build")
        root = Path(root)
        manifest = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
        files = {p.relative_to(root).as_posix(): p.read_bytes() for p in root.rglob("*") if p.is_file()}
        review, paths = write_review(self.dir.name, files, manifest, sha=manifest["sha"])
        result = R.verify_archives(review, manifest["sha"], paths)
        self.assertEqual(result["staticFiles"], len(files))
        self.assertFalse(result["releaseAuthorized"])
        print("RC8 ARCHIVE REHEARSAL PASS: actual built static files and manifest in synthetic ZIPs; no production approval.")


if __name__ == "__main__":
    unittest.main()
