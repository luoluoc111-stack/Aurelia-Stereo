// Local preview only. Run: node dev-server.cjs
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = fs.realpathSync(__dirname);
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mp3':'audio/mpeg', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png', '.svg':'image/svg+xml', '.pdf':'application/pdf' };
const server = http.createServer((req, res) => {
    if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    try {
        const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
        const target = fs.realpathSync(path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname)));
        if (!target.startsWith(root + path.sep) || !fs.statSync(target).isFile()) { res.writeHead(403); res.end(); return; }
        const size = fs.statSync(target).size;
        let start = 0, end = size - 1;
        if (req.headers.range) {
            const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
            if (!range || (!range[1] && !range[2])) { res.writeHead(416, { 'Content-Range':`bytes */${size}` }); res.end(); return; }
            start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
            end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
            if (start > end || start >= size) { res.writeHead(416, { 'Content-Range':`bytes */${size}` }); res.end(); return; }
        }
        res.writeHead(req.headers.range ? 206 : 200, {
            'Content-Type':types[path.extname(target)] || 'application/octet-stream',
            'Content-Length':Math.max(0, end - start + 1),
            'Accept-Ranges':'bytes', 'Cache-Control':'no-cache',
            ...(req.headers.range ? { 'Content-Range':`bytes ${start}-${end}/${size}` } : {})
        });
        if (req.method === 'HEAD' || !size) { res.end(); return; }
        const stream = fs.createReadStream(target, { start, end });
        stream.on('error', error => { console.error('Preview read error:', error); res.destroy(); });
        res.on('close', () => stream.destroy());
        stream.pipe(res);
    } catch (error) {
        res.writeHead(error.code === 'ENOENT' ? 404 : 400);
        res.end('Preview resource unavailable');
    }
});
server.on('error', error => { console.error('Preview server:', error.message); process.exitCode = 1; });
server.listen(8000, '127.0.0.1', () => console.log('Receiver preview: http://127.0.0.1:8000 — Ctrl+C to stop'));
