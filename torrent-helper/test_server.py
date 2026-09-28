import json
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from server import (
    TorrentCreateService,
    build_create_args,
    create_server,
    parse_create_options,
    parse_trackers,
    resolve_source_path,
)


class TorrentCreateServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name) / "share"
        self.root.mkdir()
        self.nested = self.root / "Movies"
        self.nested.mkdir()
        self.source_file = self.nested / "film.mkv"
        self.source_file.write_bytes(b"data")

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_resolves_file_and_directory_inside_allowed_root(self):
        self.assertEqual(resolve_source_path(str(self.nested), [str(self.root)]), str(self.nested))
        self.assertEqual(resolve_source_path(str(self.source_file), [str(self.root)]), str(self.source_file))

    def test_rejects_path_outside_root_and_nonexistent_path(self):
        outside = Path(self.temp_dir.name) / "share-other"
        outside.mkdir()
        with self.assertRaises(PermissionError):
            resolve_source_path(str(outside), [str(self.root)])
        with self.assertRaises(FileNotFoundError):
            resolve_source_path(str(self.root / "missing"), [str(self.root)])

    def test_tracker_validation_accepts_supported_protocols(self):
        self.assertEqual(
            parse_trackers([
                "https://tracker.example/announce",
                "udp://tracker.example:80",
            ]),
            ["https://tracker.example/announce", "udp://tracker.example:80"],
        )

    def test_tracker_validation_rejects_unsupported_and_injected_values(self):
        with self.assertRaises(ValueError):
            parse_trackers(["file:///etc/passwd"])
        with self.assertRaises(ValueError):
            parse_trackers(["udp://tracker.example\n-p"])

    def test_private_torrents_require_a_tracker(self):
        with self.assertRaisesRegex(ValueError, "require at least one tracker"):
            parse_create_options({"private": True, "trackers": []})

    def test_cli_arguments_are_passed_as_separate_arguments(self):
        options = parse_create_options({
            "private": True,
            "trackers": ["https://tracker.example/announce"],
            "pieceSize": 1024,
            "comment": "A comment",
        })
        arguments = build_create_args("transmission-create", "/share/file name.mkv", "/tmp/out.torrent", options)
        self.assertEqual(arguments[-1], "/share/file name.mkv")
        self.assertIn("https://tracker.example/announce", arguments)
        self.assertIn("1024", arguments)

    def test_http_api_allows_same_host_and_limits_creation_to_configured_roots(self):
        config = {"allowed_roots": [str(self.root)], "port": 0}
        server = create_server(config, binary="unused")
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        address = server.server_address
        base_url = f"http://127.0.0.1:{address[1]}"
        try:
            preflight = urllib.request.Request(
                f"{base_url}/api/jobs",
                method="OPTIONS",
                headers={
                    "Origin": base_url,
                    "Access-Control-Request-Method": "POST",
                    "Access-Control-Request-Headers": "content-type",
                },
            )
            with urllib.request.urlopen(preflight) as response:
                self.assertEqual(response.status, 204)
                self.assertEqual(response.headers["Access-Control-Allow-Origin"], base_url)

            foreign_preflight = urllib.request.Request(
                f"{base_url}/api/jobs",
                method="OPTIONS",
                headers={"Origin": "http://attacker.invalid"},
            )
            with self.assertRaises(urllib.error.HTTPError) as denied:
                urllib.request.urlopen(foreign_preflight)
            self.assertEqual(denied.exception.code, 403)
            denied.exception.close()

            outside = Path(self.temp_dir.name) / "outside"
            outside.mkdir()
            body = json.dumps({"path": str(outside), "trackers": []}).encode()
            request = urllib.request.Request(
                f"{base_url}/api/jobs",
                data=body,
                method="POST",
                headers={"Content-Type": "application/json", "Origin": base_url},
            )
            with urllib.request.urlopen(request) as response:
                job_id = json.loads(response.read())["jobId"]
            for _ in range(100):
                request = urllib.request.Request(
                    f"{base_url}/api/jobs/{job_id}",
                    headers={"Origin": base_url},
                )
                with urllib.request.urlopen(request) as response:
                    job = json.loads(response.read())
                if job["state"] != "running":
                    break
                time.sleep(0.01)
            self.assertEqual(job["state"], "failed")
            self.assertIn("outside", job["error"])
        finally:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    unittest.main()