import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceBase = 'https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/';
const sourceFiles = ['slt_table3.txt', 'slt_table5.txt', 'slt3d_globl.csv'];
const marker = '<script id="tic-data" type="application/json">';
const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const directoryIndex = args.indexOf('--from-directory');
if (args.some((arg, index) => arg !== '--check' && arg !== '--from-directory' &&
    !(directoryIndex >= 0 && index === directoryIndex + 1)) ||
    (directoryIndex >= 0 && (!args[directoryIndex + 1] || args[directoryIndex + 1].startsWith('--')))) {
  throw new Error('Usage: node scripts/update-v2-data.mjs [--from-directory DIR] [--check]');
}
const sourceDirectory = directoryIndex >= 0 ? path.resolve(args[directoryIndex + 1]) : null;

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();

async function download(url) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {signal: AbortSignal.timeout(30000), headers: {'User-Agent': 'UST-Holders/1.0'}});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
      if (contentType && !['text', 'csv', 'octet-stream'].some((type) => contentType.includes(type))) {
        throw new Error(`Unexpected Content-Type: ${contentType}`);
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length || (response.headers.has('content-length') &&
          Number(response.headers.get('content-length')) !== bytes.length)) {
        throw new Error('Empty or partial download');
      }
      return bytes;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }
  throw new Error(`Download failed: ${url}: ${lastError.message}`);
}

const stage = await fs.mkdtemp(path.join(os.tmpdir(), 'ust-holders-'));
try {
  const rawDir = path.join(stage, 'raw');
  const dataPath = path.join(stage, 'tic.json');
  const validationPath = path.join(stage, 'validation.json');
  await fs.mkdir(rawDir);
  if (sourceDirectory) {
    for (const file of [...sourceFiles, 'manifest.json']) {
      await fs.copyFile(path.join(sourceDirectory, file), path.join(rawDir, file));
    }
  } else {
    const manifest = [];
    for (const file of sourceFiles) {
      const url = sourceBase + file;
      const bytes = await download(url);
      await fs.writeFile(path.join(rawDir, file), bytes);
      manifest.push({file, url, downloaded_at: new Date().toISOString(), sha256: sha256(bytes)});
      console.log(`Downloaded ${file} (${bytes.length} bytes)`);
    }
    await fs.writeFile(path.join(rawDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  }

  const env = {...process.env, TIC_RAW_DIR: rawDir, TIC_DATA_PATH: dataPath, TIC_VALIDATION_PATH: validationPath};
  for (const script of ['prepare-data.mjs', 'validate-data.mjs']) {
    const output = execFileSync(process.execPath, [path.join(root, 'scripts', script)], {env, encoding: 'utf8'});
    const report = JSON.parse(output);
    console.log(`${script}: ${report.status ?? 'PREPARED'}, ${report.latest} (${report.rows} rows)`);
  }

  const data = JSON.parse(await fs.readFile(dataPath, 'utf8'));
  const htmlPath = path.join(root, 'UST_Holders_v2.html');
  const html = await fs.readFile(htmlPath, 'utf8');
  const start = html.indexOf(marker);
  if (start < 0 || html.indexOf(marker, start + marker.length) >= 0) throw new Error('Expected one v2 data marker');
  const jsonStart = start + marker.length;
  const jsonEnd = html.indexOf('</script>', jsonStart);
  if (jsonEnd < 0) throw new Error('v2 data script is not closed');
  JSON.parse(html.slice(jsonStart, jsonEnd));
  const embedded = JSON.stringify(data).replaceAll('<', '\\u003c');
  const updatedHtml = html.slice(0, jsonStart) + embedded + html.slice(jsonEnd);
  if (checkOnly) {
    if (html !== updatedHtml) throw new Error('v2 embedded data differs from validated source data');
    console.log(`v2 data matches validated source data (${data.meta.latest_month})`);
  } else {
    const files = [
      ...sourceFiles.map((file) => [path.join(rawDir, file), path.join(root, 'data', 'raw', file)]),
      [path.join(rawDir, 'manifest.json'), path.join(root, 'data', 'raw', 'manifest.json')],
      [dataPath, path.join(root, 'dashboard', 'public', 'data', 'tic.json')],
      [validationPath, path.join(root, 'data', 'validation.json')],
    ];
    const previous = await Promise.all(files.map(async ([, target]) => [target, await fs.readFile(target)]));
    previous.push([htmlPath, Buffer.from(html)]);
    try {
      for (const [source, target] of files) await fs.copyFile(source, target);
      await fs.writeFile(htmlPath, updatedHtml);
    } catch (error) {
      await Promise.all(previous.map(([target, bytes]) => fs.writeFile(target, bytes)));
      throw error;
    }
    console.log(`Updated v2 HTML and local snapshot: ${data.meta.latest_month}`);
  }
} finally {
  if (path.dirname(stage) !== path.resolve(os.tmpdir()) || !path.basename(stage).startsWith('ust-holders-')) {
    throw new Error(`Refusing to remove unexpected staging path: ${stage}`);
  }
  await fs.rm(stage, {recursive: true, force: true});
}
