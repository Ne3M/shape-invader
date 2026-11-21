import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const STATS_DIR = 'stats';

/** Every .csv under stats/, in any sub-folder. */
function csvFiles(dir: string): string[] {
  try {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return csvFiles(path);
      return name.toLowerCase().endsWith('.csv') ? [path] : [];
    });
  } catch {
    return [];
  }
}

/**
 * Dev only: the stats dashboard (tools/stats.html) reads the Umami exports from stats/ through
 * /__stats/files. Answered only to this computer, even when the dev server is open to the network.
 */
function statsFiles(): Plugin {
  return {
    name: 'stats-files',
    apply: 'serve',
    configureServer(server) {
      // The raw exports are never served as files (the dev server can be open to the network).
      server.middlewares.use(`/${STATS_DIR}/`, (_req, res) => {
        res.statusCode = 404;
        res.end();
      });
      server.middlewares.use('/__stats/files', (req, res) => {
        const ip = req.socket.remoteAddress ?? '';
        if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) {
          res.statusCode = 403;
          res.end('Stats are only available on this computer.');
          return;
        }
        const files = csvFiles(STATS_DIR).map((path) => ({
          name: relative(STATS_DIR, path).replace(/\\/g, '/'),
          text: readFileSync(path, 'utf8'),
        }));
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(files));
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [statsFiles()],
});
