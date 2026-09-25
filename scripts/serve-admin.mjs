import http from 'node:http'
import { readFile } from 'node:fs/promises'
const files = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/admin.css': 'admin.css',
  '/admin.js': 'admin.js',
  '/config.js': 'config.js',
}
http
  .createServer(async (req, res) => {
    const name = files[new URL(req.url, 'http://localhost').pathname]
    if (!name) {
      res.writeHead(404).end()
      return
    }
    try {
      const data = await readFile(`admin/${name}`)
      res
        .writeHead(200, {
          'Content-Type': name.endsWith('.css')
            ? 'text/css'
            : name.endsWith('.js')
              ? 'text/javascript'
              : 'text/html',
          'Cache-Control': 'no-store',
        })
        .end(data)
    } catch {
      res.writeHead(500).end()
    }
  })
  .listen(9001, '127.0.0.1', () =>
    console.log('Admin preview: http://localhost:9001'),
  )
