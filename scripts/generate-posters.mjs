/**
 * 通用 MBTI 角色海报生成脚本
 *
 * 用法：node generate-posters.mjs <配置文件.json>
 *
 * 配置文件格式见 README 或下方 CONFIG SCHEMA 注释。
 * 所有路径相对于项目根目录（即 scripts/ 的父目录）。
 */

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── CONFIG SCHEMA ──
// {
//   "mbtiFile":   "workspace/XX图鉴/XX-MBTI角色分析.md",   -- MBTI 分析 md
//   "quotesFile": "workspace/XX图鉴/XX-角色台词表.md",       -- 台词表 md
//   "photosDir":  "images/XX剧照",                          -- 角色剧照目录（文件名=角色名.jpg）
//   "outputDir":  "images/XX图文",                           -- PNG 输出目录
//   "template":   "templates/图鉴海报页模板.html",            -- （可选）自定义模板
//   "quotePicks": { "角色名": 台词编号(1-based), ... }       -- 每个角色选用的台词编号
// }

// ── 读取配置 ──
const configPath = process.argv[2];
if (!configPath) {
  console.error('用法: node generate-posters.mjs <配置文件.json>');
  console.error('');
  console.error('配置文件示例:');
  console.error(JSON.stringify({
    mbtiFile: "workspace/XX图鉴/XX-MBTI角色分析.md",
    quotesFile: "workspace/XX图鉴/XX-角色台词表.md",
    photosDir: "images/XX剧照",
    outputDir: "images/XX图文",
    quotePicks: { "角色A": 1, "角色B": 3 }
  }, null, 2));
  process.exit(1);
}

const config = JSON.parse(readFileSync(resolve(ROOT, configPath), 'utf-8'));
const mbtiMd = readFileSync(resolve(ROOT, config.mbtiFile), 'utf-8');
const quotesMd = readFileSync(resolve(ROOT, config.quotesFile), 'utf-8');
const photosDir = resolve(ROOT, config.photosDir);
const outputDir = resolve(ROOT, config.outputDir);
const quotePicks = config.quotePicks || {};

// ── 运行 face detection ──
console.log('Running face detection...');
const faceJson = execSync(`python3 "${resolve(__dirname, 'detect-faces.py')}" "${photosDir}"`, { encoding: 'utf-8' });
const facePositions = JSON.parse(faceJson);
console.log('Face positions:', facePositions);

// ── 解析 MBTI 分析 ──
function parseMBTI(md) {
  const characters = [];
  const sections = md.split(/^## \d+）/m).slice(1);

  for (const section of sections) {
    const lines = section.trim().split('\n');
    const headerMatch = lines[0].match(/^(.+?)\s*·\s*(\w+)（(.+?)）/);
    if (!headerMatch) continue;

    const name = headerMatch[1].trim();
    const mbti = headerMatch[2].trim();
    const stack = headerMatch[3].replace(/-/g, ' - ').trim();

    const functions = [];
    const fnNameMap = {
      'Se': '外倾感觉', 'Si': '内倾感觉',
      'Ne': '外倾直觉', 'Ni': '内倾直觉',
      'Te': '外倾思维', 'Ti': '内倾思维',
      'Fe': '外倾情感', 'Fi': '内倾情感'
    };

    let summary = '';
    const fullText = section;

    const summaryMatch = fullText.match(/\*\*总结\*\*：(.+?)$/ms);
    if (summaryMatch) {
      summary = summaryMatch[1].trim();
    }

    for (const role of ['主导', '辅助', '第三', '劣势']) {
      const pattern = new RegExp(`\\*\\*${role}\\s+(\\w+)（(.+?)）\\*\\*：(.+?)(?=\\*\\*(?:辅助|第三|劣势|总结)|$)`, 's');
      const match = fullText.match(pattern);
      if (match) {
        const abbr = match[1].trim();
        const fullName = fnNameMap[abbr] || match[2].trim();
        const text = match[3].trim();
        functions.push({ abbr, role, fullName, text });
      }
    }

    characters.push({ name, mbti, stack, functions, summary });
  }
  return characters;
}

// ── 解析台词表 ──
function parseQuotes(md) {
  const quotes = {};
  const sections = md.split(/^## \d+）/m).slice(1);

  for (const section of sections) {
    const lines = section.trim().split('\n');
    const nameMatch = lines[0].match(/^(.+?)（/);
    if (!nameMatch) continue;
    const name = nameMatch[1].trim();

    const quoteList = [];
    for (const line of lines) {
      // 匹配多种引号格式：""、""、''
      const qMatch = line.match(/^\d+\.\s+[""'「](.+?)[""'」](?:——[""'「](.+?)[""'」])?$/);
      if (qMatch) {
        quoteList.push(qMatch[2] ? `${qMatch[1]}——${qMatch[2]}` : qMatch[1]);
      }
    }
    quotes[name] = quoteList;
  }
  return quotes;
}

// ── 将正文拆成分点 ──
function splitIntoPoints(text) {
  const sentences = [];
  let current = '';
  for (let i = 0; i < text.length; i++) {
    current += text[i];
    if (text[i] === '。' || (text[i] === '；' && current.length > 20)) {
      sentences.push(current.trim());
      current = '';
    }
  }
  if (current.trim()) sentences.push(current.trim());

  if (sentences.length <= 1) {
    return { points: [text], summary: '' };
  }

  const summary = sentences[sentences.length - 1];
  const bodyParts = sentences.slice(0, -1);

  const points = [];
  let buf = '';
  for (const s of bodyParts) {
    if (buf && (buf + s).length > 80) {
      points.push(buf);
      buf = s;
    } else {
      buf = buf ? buf + s : s;
    }
  }
  if (buf) points.push(buf);

  return { points, summary };
}

// ── 查找角色图片（支持 jpg/png/webp） ──
function findPhoto(name) {
  for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) {
    const p = resolve(photosDir, name + ext);
    if (existsSync(p)) return p;
  }
  return null;
}

// ── 生成 HTML ──
function generateHTML(char, quotes, imgPath, facePos) {
  const quoteList = quotes[char.name] || [];
  const pickIdx = quotePicks[char.name];
  const selectedQuote = pickIdx && quoteList[pickIdx - 1] ? quoteList[pickIdx - 1] : (quoteList[0] || '');
  const quoteHTML = selectedQuote
    ? `<div class="quote-section">
        <p>「${selectedQuote}」</p>
      </div>`
    : '';

  const fnHTML = char.functions.map(fn => {
    const { points, summary } = splitIntoPoints(fn.text);
    const itemsHTML = points.map(p =>
      `<div class="tree-item"><div class="tree-content">${p}</div></div>`
    ).join('\n              ');
    const summaryHTML = summary
      ? `<div class="tree-summary">${summary}</div>`
      : '';

    return `
        <div class="function-node">
          <div class="circle-tag">
            <span class="abbr">${fn.abbr}</span>
            <span class="role">${fn.role}</span>
          </div>
          <div class="function-card">
            <h3>${fn.fullName}</h3>
            <div class="tree-container">
              ${itemsHTML}
              ${summaryHTML}
            </div>
          </div>
        </div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${char.name} MBTI 深度解读海报</title>
  <style>
    :root {
      --bg-top: #f4eee7;
      --bg-bottom: #d8c8bb;
      --ink: #1a1516;
      --muted: #715f68;
      --gold: #c39c72;
      --wine: #7c4f61;
      --card: rgba(255, 248, 242, 0.65);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      background: #111;
      font-family: 'Noto Serif SC', 'Songti SC', 'STSong', serif;
      color: var(--ink);
      padding: 20px 0;
    }

    .poster-container {
      width: 540px;
      position: relative;
      background:
        radial-gradient(circle at top left, rgba(255, 255, 255, 0.95), transparent 32%),
        radial-gradient(circle at 85% 14%, rgba(208, 182, 155, 0.6), transparent 26%),
        linear-gradient(180deg, var(--bg-top) 0%, #ecdcca 32%, var(--bg-bottom) 100%);
      box-shadow: 0 28px 70px rgba(0, 0, 0, 0.5);
      overflow: hidden;
      isolation: isolate;
    }

    .grain {
      position: absolute; inset: 0; opacity: 0.1;
      background-image:
        linear-gradient(rgba(90, 67, 63, 0.2) 1px, transparent 1px),
        linear-gradient(90deg, rgba(90, 67, 63, 0.2) 1px, transparent 1px);
      background-size: 4px 4px;
      mix-blend-mode: multiply; z-index: 0; pointer-events: none;
    }

    .hero-section { position: relative; width: 100%; height: 400px; z-index: 1; }
    .hero-section img {
      width: 100%; height: 100%;
      object-fit: cover;
      object-position: ${facePos.x_pct}% ${facePos.y_pct}%;
      filter: saturate(0.85) contrast(1.1) brightness(0.9);
    }
    .hero-section::after {
      content: ''; position: absolute; inset: 0;
      background: linear-gradient(180deg, transparent 40%, var(--bg-top) 100%);
      pointer-events: none;
    }

    .content-wrapper { position: relative; padding: 0 32px 56px; z-index: 2; margin-top: -80px; }

    .header-title { position: relative; margin-bottom: 24px; display: flex; flex-direction: column; align-items: flex-start; }
    .mbti-badge {
      font-family: sans-serif; font-size: 14px; letter-spacing: 4px; font-weight: 900;
      color: #fff; background: var(--ink); padding: 6px 16px; margin-bottom: 12px;
      border-radius: 4px; box-shadow: 0 8px 20px rgba(26, 21, 22, 0.2);
    }
    .character-name {
      font-size: 48px; font-weight: 900; letter-spacing: 2px;
      color: var(--ink); line-height: 1.1;
      text-shadow: 0 4px 16px rgba(255, 255, 255, 0.9);
    }
    .function-stack {
      font-family: sans-serif; font-size: 13px; letter-spacing: 4px;
      color: var(--wine); margin-top: 12px; font-weight: 900; text-transform: uppercase;
    }

    .quote-section { position: relative; margin: 40px 0; padding-left: 24px; border-left: 3px solid var(--gold); }
    .quote-section p { font-size: 18px; line-height: 1.6; font-style: italic; color: var(--ink); font-weight: 700; letter-spacing: 1px; }

    .summary-section { margin-bottom: 48px; }
    .summary-bento {
      position: relative;
      background: linear-gradient(145deg, rgba(255, 255, 255, 0.7), rgba(255, 255, 255, 0.2));
      border-radius: 20px; padding: 28px 24px;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.04), inset 0 1px 0 rgba(255, 255, 255, 0.9);
      border: 1px solid rgba(255, 255, 255, 0.5);
      backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
    }
    .summary-bento p { font-size: 14.5px; line-height: 1.9; color: #3b3034; text-align: justify; }

    .cognitive-functions { display: flex; flex-direction: column; gap: 36px; padding-left: 24px; }
    .function-node { position: relative; display: flex; align-items: flex-start; }

    .circle-tag {
      position: absolute; left: -28px; top: 16px; width: 72px; height: 72px;
      border-radius: 50%; background: #fdfaf7; border: 3px solid var(--gold);
      box-shadow: 0 8px 24px rgba(184, 138, 88, 0.25);
      display: flex; flex-direction: column; justify-content: center; align-items: center; z-index: 5;
    }
    .circle-tag::after {
      content: ''; position: absolute; right: -12px; top: 50%; transform: translateY(-50%);
      width: 12px; height: 3px; background: var(--gold);
    }
    .circle-tag .abbr { font-family: sans-serif; font-size: 24px; font-weight: 900; color: var(--ink); line-height: 1; margin-bottom: 2px; }
    .circle-tag .role { font-size: 10px; font-weight: 700; color: var(--wine); letter-spacing: 1px; }

    .function-card {
      width: 100%; margin-left: 24px; padding: 20px 24px 24px 36px;
      background: var(--card); border-left: 4px solid var(--gold);
      border-radius: 0 20px 20px 0;
      backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
      box-shadow: 0 12px 30px rgba(0, 0, 0, 0.05);
    }
    .function-card h3 { font-size: 16px; color: var(--ink); margin-bottom: 16px; font-weight: 900; letter-spacing: 1px; }

    .tree-container { position: relative; padding-left: 14px; display: flex; flex-direction: column; gap: 16px; }
    .tree-container::before {
      content: ''; position: absolute; left: 0; top: 8px; bottom: 8px;
      width: 1px; background: rgba(184, 138, 88, 0.4);
    }

    .tree-item { position: relative; line-height: 1.6; }
    .tree-item::before {
      content: ''; position: absolute; left: -14px; top: 10px;
      width: 10px; height: 1px; background: rgba(184, 138, 88, 0.4);
    }
    .tree-item::after {
      content: ''; position: absolute; left: -17.5px; top: 6.5px;
      width: 6px; height: 6px; border-radius: 50%;
      background: var(--gold); box-shadow: 0 0 6px var(--gold);
    }
    .tree-content { font-size: 14px; color: #3b3034; text-align: justify; line-height: 1.75; }

    .tree-summary {
      position: relative; margin-top: 4px; padding-top: 16px;
      border-top: 1px dashed rgba(184, 138, 88, 0.4);
      font-size: 14px; font-weight: 700; color: var(--wine);
      line-height: 1.75; text-align: justify;
    }
  </style>
</head>
<body>
  <div class="poster-container">
    <div class="grain"></div>
    <div class="hero-section">
      <img src="${imgPath}" alt="${char.name}剧照">
    </div>
    <div class="content-wrapper">
      <div class="header-title">
        <div class="mbti-badge">${char.mbti}</div>
        <h1 class="character-name">${char.name}</h1>
        <div class="function-stack">${char.stack}</div>
      </div>
      ${quoteHTML}
      <div class="summary-section">
        <div class="summary-bento">
          <p>${char.summary}</p>
        </div>
      </div>
      <div class="cognitive-functions">
        ${fnHTML}
      </div>
    </div>
  </div>
</body>
</html>`;
}

// ── 主程序 ──
async function main() {
  const characters = parseMBTI(mbtiMd);
  const quotes = parseQuotes(quotesMd);

  console.log(`Parsed ${characters.length} characters`);
  console.log(`Quotes for: ${Object.keys(quotes).join(', ')}`);

  const tempDir = resolve(ROOT, 'scripts/temp-posters');
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(tempDir, { recursive: true });

  const htmlFiles = [];
  for (const char of characters) {
    const photoPath = findPhoto(char.name);
    if (!photoPath) {
      console.warn(`[WARN] 未找到 ${char.name} 的剧照，跳过`);
      continue;
    }
    const imgPath = `file://${photoPath}`;
    const facePos = facePositions[char.name] || { x_pct: 50, y_pct: 35 };
    const html = generateHTML(char, quotes, imgPath, facePos);
    const htmlPath = resolve(tempDir, `${char.name}.html`);
    writeFileSync(htmlPath, html, 'utf-8');
    htmlFiles.push({ name: char.name, path: htmlPath });
    console.log(`Generated HTML: ${char.name}`);
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 580, height: 800 },
    deviceScaleFactor: 2,
  });

  for (const { name, path } of htmlFiles) {
    const page = await context.newPage();
    await page.goto(`file://${path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    const poster = await page.$('.poster-container');
    if (!poster) {
      console.error(`No poster found for ${name}`);
      await page.close();
      continue;
    }

    const outputPath = resolve(outputDir, `${name}.png`);
    await poster.screenshot({ path: outputPath, type: 'png' });
    console.log(`Saved PNG: ${outputPath}`);
    await page.close();
  }

  await browser.close();
  console.log('\nDone! All posters generated.');
}

main().catch(console.error);
