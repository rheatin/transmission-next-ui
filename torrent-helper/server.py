import base64
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

MAX_BODY_BYTES = 64 * 1024
MAX_TORRENT_BYTES = 64 * 1024 * 1024
MAX_JOBS = 2
JOB_TTL_SECONDS = 30 * 60
MAX_SOURCE_ENTRIES = 200_000
PIECE_SIZES = {256, 512, 1024, 2048, 4096, 8192, 16384}
CONFIG_PATH = os.environ.get("TORRENT_CREATE_CONFIG", "/config/torrent-create/config.json")


def is_within(root, target):
    try:
        return os.path.commonpath((root, target)) == root
    except ValueError:
        return False


def resolve_source_path(source, roots):
    if not isinstance(source, str) or not source or "\0" in source:
        raise ValueError("Enter an absolute source path")
    if not os.path.isabs(source):
        raise ValueError("Enter an absolute source path")

    resolved = os.path.realpath(source)
    if not os.path.exists(resolved):
        raise FileNotFoundError("Path does not exist or cannot be accessed")
    if not os.path.isfile(resolved) and not os.path.isdir(resolved):
        raise ValueError("Select a regular file or directory")

    allowed_roots = [os.path.realpath(root) for root in roots]
    if not any(is_within(root, resolved) for root in allowed_roots):
        raise PermissionError("Path is outside the configured source directories")
    return resolved


def assert_no_symlinks(source):
    if os.path.isfile(source):
        return

    visited = 0
    for current, directories, files in os.walk(source, followlinks=False):
        for name in directories + files:
            visited += 1
            if visited > MAX_SOURCE_ENTRIES:
                raise ValueError("Source contains too many filesystem entries")
            entry = os.path.join(current, name)
            if os.path.islink(entry):
                raise ValueError("Source contains a symbolic link")


def parse_trackers(trackers):
    if not isinstance(trackers, list) or len(trackers) > 32:
        raise ValueError("Provide up to 32 tracker URLs")

    result = []
    for tracker in trackers:
        if not isinstance(tracker, str):
            raise ValueError("Invalid tracker URL")
        value = tracker.strip()
        parsed = urlsplit(value)
        if (
            len(value) > 2048
            or "\r" in value
            or "\n" in value
            or "\0" in value
            or parsed.scheme.lower() not in {"http", "https", "udp"}
            or not parsed.netloc
        ):
            raise ValueError("Tracker URLs must use HTTP, HTTPS, or UDP")
        result.append(value)
    return result


def build_create_args(binary, source, output, options):
    args = [binary, "-o", output]
    if options["private"]:
        args.append("-p")
    if options["comment"]:
        args.extend(("-c", options["comment"]))
    for tracker in options["trackers"]:
        args.extend(("-t", tracker))
    if options["piece_size"] is not None:
        args.extend(("-s", str(options["piece_size"])))
    args.append(source)
    return args


def parse_create_options(body):
    if not isinstance(body, dict):
        raise ValueError("Invalid request body")
    trackers = parse_trackers(body.get("trackers", []))
    is_private = body.get("private", False)
    if not isinstance(is_private, bool):
        raise ValueError("Private must be a boolean")
    if is_private and not trackers:
        raise ValueError("Private torrents require at least one tracker")

    piece_size = body.get("pieceSize")
    if piece_size == "auto" or piece_size is None:
        piece_size = None
    elif isinstance(piece_size, int) and piece_size in PIECE_SIZES:
        pass
    else:
        raise ValueError("Unsupported piece size")

    comment = body.get("comment", "")
    if not isinstance(comment, str) or len(comment) > 1024 or "\0" in comment:
        raise ValueError("Comment must be 1024 characters or fewer")

    return {
        "trackers": trackers,
        "private": is_private,
        "piece_size": piece_size,
        "comment": comment.strip(),
    }


class TorrentCreateService:
    def __init__(self, config, binary="/usr/bin/transmission-create"):
        roots = config.get("allowed_roots")
        if not isinstance(roots, list) or not roots:
            raise ValueError("Configure at least one allowed source directory")
        self.roots = [os.path.realpath(root) for root in roots]
        self.binary = binary
        self.jobs = {}
        self.lock = threading.Lock()

    def create_job(self, body):
        options = parse_create_options(body)
        source = body.get("path")
        job_id = str(uuid.uuid4())
        job = {
            "id": job_id,
            "state": "running",
            "error": None,
            "metainfo": None,
            "process": None,
            "updated": time.monotonic(),
        }

        with self.lock:
            self._remove_expired_jobs()
            active_jobs = sum(item["state"] == "running" for item in self.jobs.values())
            if active_jobs >= MAX_JOBS:
                raise RuntimeError("Two torrent creation jobs are already running")
            self.jobs[job_id] = job

        thread = threading.Thread(
            target=self._run_job,
            args=(job, source, options),
            daemon=True,
        )
        thread.start()
        return job_id

    def _run_job(self, job, source, options):
        temporary_directory = None
        try:
            source_path = resolve_source_path(source, self.roots)
            assert_no_symlinks(source_path)
            temporary_directory = tempfile.mkdtemp(prefix="transmission-create-")
            torrent_path = os.path.join(temporary_directory, "created.torrent")
            process = subprocess.Popen(
                build_create_args(self.binary, source_path, torrent_path, options),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            with self.lock:
                job["process"] = process
            _, stderr = process.communicate()

            with self.lock:
                if job["state"] == "cancelled":
                    return
                if process.returncode != 0:
                    job["state"] = "failed"
                    job["error"] = stderr.strip()[-4000:] or "transmission-create failed"
                elif os.path.getsize(torrent_path) > MAX_TORRENT_BYTES:
                    job["state"] = "failed"
                    job["error"] = "Generated torrent metadata exceeds 64 MiB"
                else:
                    with open(torrent_path, "rb") as torrent_file:
                        job["metainfo"] = base64.b64encode(torrent_file.read()).decode("ascii")
                    job["state"] = "complete"
                job["process"] = None
                job["updated"] = time.monotonic()
        except (OSError, ValueError, PermissionError) as error:
            with self.lock:
                if job["state"] != "cancelled":
                    job["state"] = "failed"
                    job["error"] = str(error)
                job["process"] = None
                job["updated"] = time.monotonic()
        finally:
            if temporary_directory:
                shutil.rmtree(temporary_directory, ignore_errors=True)

    def get_job(self, job_id):
        with self.lock:
            self._remove_expired_jobs()
            job = self.jobs.get(job_id)
            if not job:
                return None
            return {key: job[key] for key in ("id", "state", "error", "metainfo")}

    def cancel_job(self, job_id):
        with self.lock:
            job = self.jobs.get(job_id)
            if not job:
                return False
            if job["state"] == "running":
                job["state"] = "cancelled"
                job["updated"] = time.monotonic()
                process = job.get("process")
                if process and process.poll() is None:
                    process.terminate()
            return True

    def _remove_expired_jobs(self):
        now = time.monotonic()
        expired = [
            job_id
            for job_id, job in self.jobs.items()
            if job["state"] != "running" and now - job["updated"] > JOB_TTL_SECONDS
        ]
        for job_id in expired:
            del self.jobs[job_id]


def load_config(config_path=CONFIG_PATH):
    with open(config_path, "r", encoding="utf-8") as config_file:
        return json.load(config_file)


def create_server(config, binary="/usr/bin/transmission-create"):
    service = TorrentCreateService(config, binary=binary)

    class Handler(BaseHTTPRequestHandler):
        server_version = "TransmissionTorrentCreate/1.0"

        def log_message(self, _format, *_args):
            return

        def _send(self, status, body=None, headers=None):
            payload = b"" if body is None else json.dumps(body).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(payload)))
            if headers:
                for name, value in headers.items():
                    self.send_header(name, value)
            self.end_headers()
            if payload:
                self.wfile.write(payload)

        def _origin_headers(self):
            origin = self.headers.get("Origin")
            if not origin:
                return {}
            origin_host = urlsplit(origin).hostname
            request_host = urlsplit("//" + self.headers.get("Host", "")).hostname
            if not origin_host or origin_host != request_host:
                return None
            return {
                "Access-Control-Allow-Origin": origin,
                "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type",
                "Access-Control-Max-Age": "600",
                "Vary": "Origin",
            }

        def _read_body(self):
            try:
                size = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                raise ValueError("Invalid content length") from None
            if size < 0 or size > MAX_BODY_BYTES:
                raise ValueError("Request body is too large")
            try:
                return json.loads(self.rfile.read(size).decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                raise ValueError("Invalid JSON body") from None

        def _handle_request(self):
            cors_headers = self._origin_headers()
            if cors_headers is None:
                self._send(403, {"error": "Origin is not allowed"})
                return
            if self.command == "OPTIONS":
                self._send(204, headers=cors_headers)
                return
            if self.path == "/healthz" and self.command == "GET":
                self._send(200, {"status": "ok"}, cors_headers)
                return

            route = urlsplit(self.path)
            match = re.fullmatch(r"/api/jobs(?:/([0-9a-f-]{36}))?", route.path)
            if not match:
                self._send(404, {"error": "Endpoint not found"}, cors_headers)
                return

            job_id = match.group(1)
            try:
                if self.command == "POST" and not job_id:
                    body = self._read_body()
                    new_job_id = service.create_job(body)
                    self._send(202, {"jobId": new_job_id}, cors_headers)
                elif self.command == "GET" and job_id:
                    job = service.get_job(job_id)
                    if not job:
                        self._send(404, {"error": "Torrent creation job was not found"}, cors_headers)
                    else:
                        self._send(200, job, cors_headers)
                elif self.command == "DELETE" and job_id:
                    if service.cancel_job(job_id):
                        self._send(200, {"id": job_id, "state": "cancelled"}, cors_headers)
                    else:
                        self._send(404, {"error": "Torrent creation job was not found"}, cors_headers)
                else:
                    self._send(404, {"error": "Endpoint not found"}, cors_headers)
            except ValueError as error:
                self._send(400, {"error": str(error)}, cors_headers)
            except RuntimeError as error:
                self._send(429, {"error": str(error)}, cors_headers)

        def do_OPTIONS(self):
            self._handle_request()

        def do_GET(self):
            self._handle_request()

        def do_POST(self):
            self._handle_request()

        def do_DELETE(self):
            self._handle_request()

    return ThreadingHTTPServer((config.get("host", "0.0.0.0"), int(config.get("port", 3001))), Handler)


def main():
    server = create_server(load_config())
    print("Transmission torrent creation service listening on port %s" % server.server_port, flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()