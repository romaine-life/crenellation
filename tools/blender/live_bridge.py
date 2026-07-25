import json
import queue
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import bpy


HOST = "127.0.0.1"
PORT = 8765
TASKS = queue.Queue()
GLOBALS = {"bpy": bpy}


class Task:
    def __init__(self, code):
        self.code = code
        self.done = threading.Event()
        self.result = None
        self.error = None


def run_pending_tasks():
    while True:
        try:
            task = TASKS.get_nowait()
        except queue.Empty:
            break

        try:
            exec(task.code, GLOBALS)
            task.result = {"ok": True}
        except Exception as exc:  # Report exceptions to the calling client.
            task.error = repr(exc)
        finally:
            task.done.set()

    return 0.1


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path != "/health":
            self._send_json(404, {"ok": False, "error": "not found"})
            return
        self._send_json(200, {"ok": True, "service": "chess-tactics-blender-bridge"})

    def do_POST(self):
        if self.path != "/run":
            self._send_json(404, {"ok": False, "error": "not found"})
            return

        length = int(self.headers.get("Content-Length", "0"))
        payload = json.loads(self.rfile.read(length) or b"{}")
        code = payload.get("code")
        if not isinstance(code, str) or not code.strip():
            self._send_json(400, {"ok": False, "error": "missing code"})
            return

        task = Task(code)
        TASKS.put(task)
        task.done.wait(timeout=30)

        if not task.done.is_set():
            self._send_json(504, {"ok": False, "error": "timed out"})
        elif task.error:
            self._send_json(500, {"ok": False, "error": task.error})
        else:
            self._send_json(200, task.result)

    def log_message(self, fmt, *args):
        print(f"Blender bridge: {fmt % args}")


def start_server():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    print(f"Chess Tactics Blender bridge listening on http://{HOST}:{PORT}")


if not bpy.app.timers.is_registered(run_pending_tasks):
    bpy.app.timers.register(run_pending_tasks, persistent=True)

start_server()
