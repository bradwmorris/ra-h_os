#!/usr/bin/env python3
"""Minimal HTTP server that mimics llama.cpp's /v1/models endpoint.

Used by the llama-cpp-with-mock-servers edge-case scenario to verify
install.sh reaches the right ports without spinning up a real llama.cpp +
GGUF model (~1 GB on disk + non-trivial CPU/RAM at runtime).

install.sh only probes the endpoint via `curl -sf URL >/dev/null` and
discards the response body, so any 200 response is sufficient.

Usage: llama-cpp-mock-server PORT [PORT ...]
"""
import http.server
import socketserver
import sys
import threading


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"object":"list","data":[{"id":"mock"}]}')

    def log_message(self, *args, **kwargs):
        pass


def serve(port: int) -> None:
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", port), Handler) as srv:
        srv.serve_forever()


if __name__ == "__main__":
    ports = [int(p) for p in sys.argv[1:]]
    if not ports:
        print("Usage: llama-cpp-mock-server PORT [PORT ...]", file=sys.stderr)
        sys.exit(1)
    for p in ports:
        threading.Thread(target=serve, args=(p,), daemon=True).start()
    threading.Event().wait()
