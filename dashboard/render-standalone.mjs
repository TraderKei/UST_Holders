import { createServer } from 'vite';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { readFile, writeFile } from 'node:fs/promises';

const server = await createServer({
  configFile: 'standalone.vite.config.ts',
  server: { middlewareMode: true },
  appType: 'custom',
});
try {
  const { DashboardPage } = await server.ssrLoadModule('/app/page.tsx');
  const data = JSON.parse(await readFile('public/data/tic.json', 'utf8'));
  const html = renderToString(React.createElement(DashboardPage, { data }));
  await writeFile('standalone-dist/prerendered.html', html, 'utf8');
  console.log(`Rendered dashboard HTML: ${html.length} characters`);
} finally {
  await server.close();
}
