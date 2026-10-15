import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dashboard = join(root, 'dashboard');
const css = await readFile(join(dashboard, 'standalone-dist', 'sites-project.css'), 'utf8');
const js = await readFile(join(dashboard, 'standalone-dist', 'standalone.js'), 'utf8');
const markup = await readFile(join(dashboard, 'standalone-dist', 'prerendered.html'), 'utf8');
const data = (await readFile(join(dashboard, 'public', 'data', 'tic.json'), 'utf8'))
  .replaceAll('<', '\\u003c');
JSON.parse(data);
if (!markup.includes('<main class="terminal"') || !markup.includes('<table') ||
    markup.includes('스냅샷을 불러오는 중')) {
  throw new Error('미리 렌더링된 대시보드 화면이 누락됐습니다.');
}

const html = `<!doctype html>
<html lang="ko" class="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>국가별 미국 국채 보유현황 | TIC Monitor</title>
  <meta name="description" content="미국 재무부 TIC 실제 데이터 기반 국가별 미국채 보유액 및 수요 변화 분석">
  <style>${css.replaceAll('</style', '<\\/style')}</style>
</head>
<body>
  <div id="static-root">${markup}</div>
  <div id="interactive-root" hidden></div>
  <script id="tic-data" type="application/json">${data}</script>
  <script>${js.replaceAll('</script', '<\\/script')}</script>
</body>
</html>`;

const output = join(root, 'UST_Holders_v1.html');
await writeFile(output, html, 'utf8');
console.log(`${output} (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MiB)`);
