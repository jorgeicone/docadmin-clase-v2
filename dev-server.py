"""Servidor estatico con Cache-Control: no-store para desarrollo (sin cache de modulos ES)."""
import http.server, sys, os

PORT = 8765
ROOT = os.path.dirname(os.path.abspath(__file__))

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

if __name__ == '__main__':
    os.chdir(ROOT)
    with http.server.ThreadingHTTPServer(('', PORT), NoCacheHandler) as httpd:
        print(f'Serving {ROOT} at http://localhost:{PORT}')
        httpd.serve_forever()
