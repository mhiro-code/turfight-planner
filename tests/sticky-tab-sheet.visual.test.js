#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');

const REPO_ROOT = path.resolve(__dirname, '..');
const VIEWPORTS = [
  { name: 'PC', width: 1440, height: 1000 },
  { name: 'iPad', width: 1024, height: 768 },
  { name: 'iPhone', width: 390, height: 844 }
];
const STATES = [
  { name: '1タブ', setup: 'one' },
  { name: '中央active', setup: 'middle' },
  { name: '末尾active', setup: 'last' }
];

function findBrowserExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ].filter(Boolean);
  const executable = candidates.find(candidate => fs.existsSync(candidate));
  assert.ok(executable, 'Chrome/Edgeが見つかりません。CHROME_PATHを指定してください。');
  return executable;
}

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}

async function startStaticServer() {
  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url, 'http://127.0.0.1');
      const relative = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '') || 'index.html';
      const filePath = path.resolve(REPO_ROOT, relative);
      if (filePath !== REPO_ROOT && !filePath.startsWith(REPO_ROOT + path.sep)) {
        response.writeHead(403);
        response.end('Forbidden');
        return;
      }
      const body = await fsPromises.readFile(filePath);
      response.writeHead(200, { 'Content-Type': contentType(filePath) });
      response.end(body);
    } catch (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500);
      response.end(error.message);
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server;
}

async function waitFor(read, description, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`${description}を${timeoutMs}ms以内に確認できませんでした${lastError ? `: ${lastError.message}` : ''}`);
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      else pending.resolve(message.result);
    });
  }

  static async connect(webSocketUrl) {
    const socket = new WebSocket(webSocketUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    return new CdpClient(socket);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, 5000);
      this.pending.set(id, {
        method,
        resolve: value => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: error => {
          clearTimeout(timeout);
          reject(error);
        }
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

async function evaluate(cdp, expression) {
  const response = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  }
  return response.result.value;
}

async function waitForApp(cdp, expectedTabCount) {
  await waitFor(async () => evaluate(cdp, `(async () => {
    const readState = () => {
      const cards = Array.from(document.querySelectorAll('.horseCard'));
      const active = document.querySelector('.planTab.active');
      const summary = document.querySelector('.stickyPlanControls .summary');
      return {
        readyState: document.readyState,
        tabCount: document.querySelectorAll('.planTab').length,
        activePlanId: active ? active.getAttribute('data-plan-id') : null,
        cardCount: cards.length,
        unitControlCount: document.querySelectorAll('.unitControls').length,
        cards: cards.map(card => ({
          units: Number(card.querySelector('.units').value),
          selected: card.classList.contains('selected')
        })),
        bridgeLeft: summary ? getComputedStyle(summary).getPropertyValue('--active-tab-bridge-left') : '',
        bridgeWidth: summary ? getComputedStyle(summary).getPropertyValue('--active-tab-bridge-width') : ''
      };
    };
    const isReady = state =>
      state.readyState === 'complete' &&
      state.tabCount === ${expectedTabCount} &&
      Boolean(state.activePlanId) &&
      state.cardCount > 0 &&
      state.unitControlCount === state.cardCount &&
      state.cards.every(card => card.selected === (card.units > 0));
    const first = readState();
    await new Promise(resolve => requestAnimationFrame(resolve));
    const second = readState();
    await new Promise(resolve => requestAnimationFrame(resolve));
    const third = readState();
    return isReady(first) &&
      isReady(second) &&
      isReady(third) &&
      JSON.stringify(first) === JSON.stringify(second) &&
      JSON.stringify(second) === JSON.stringify(third);
  })()`), `アプリ初期表示（${expectedTabCount}タブ）`);
}

async function resetToOneTab(cdp) {
  const previousLoaderId = (await cdp.send('Page.getFrameTree')).frameTree.frame.loaderId;
  await evaluate(cdp, `localStorage.clear()`);
  await cdp.send('Page.reload', { ignoreCache: true });
  await waitFor(async () => {
    const loaderId = (await cdp.send('Page.getFrameTree')).frameTree.frame.loaderId;
    return loaderId !== previousLoaderId ? loaderId : null;
  }, 'reload後の新document世代');
  await waitForApp(cdp, 1);
}

async function createFiveTabs(cdp) {
  await evaluate(cdp, `(async () => {
    for (let i = 0; i < 4; i++) {
      document.querySelector('.planTabAdd').click();
      await new Promise(resolve => setTimeout(resolve, 3));
    }
    return document.querySelectorAll('.planTab').length;
  })()`);
  await waitFor(async () => evaluate(cdp, `document.querySelectorAll('.planTab').length === 5`), '5タブ作成');
  await waitForApp(cdp, 5);
}

async function activateTab(cdp, index) {
  await evaluate(cdp, `(() => {
    const tabs = Array.from(document.querySelectorAll('.planTab'));
    const tab = tabs[${index} < 0 ? tabs.length - 1 : ${index}];
    tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    tab.click();
    return tab.getAttribute('data-plan-id');
  })()`);
  await waitFor(async () => evaluate(cdp, `(() => {
    const tabs = Array.from(document.querySelectorAll('.planTab'));
    const expected = tabs[${index} < 0 ? tabs.length - 1 : ${index}];
    return expected.classList.contains('active');
  })()`), 'activeタブ切替');
  await waitForApp(cdp, 5);
}

async function enterScrollFadeState(cdp) {
  return evaluate(cdp, `(async () => {
    const sticky = document.querySelector('.stickyPlanControls');
    const detail = document.querySelector('.planSheetBody');
    const header = document.querySelector('.appHeader');
    const scroller = document.querySelector('main');
    const fadeStyle = getComputedStyle(sticky, '::after');
    const brandValue = getComputedStyle(document.documentElement).getPropertyValue('--brand-accent').trim();
    const colorProbe = document.createElement('span');
    colorProbe.style.color = brandValue;
    document.body.appendChild(colorProbe);
    const brand = getComputedStyle(colorProbe).color;
    colorProbe.remove();
    const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    scroller.scrollTo(0, Math.min(160, maxScroll));
    await new Promise(resolve => requestAnimationFrame(resolve));
    await new Promise(resolve => requestAnimationFrame(resolve));
    return {
      viewport: { width: innerWidth, height: innerHeight },
      scrollY: scroller.scrollTop,
      stickyRect: ${rectToPlain.toString()}(sticky.getBoundingClientRect()),
      detailRect: ${rectToPlain.toString()}(detail.getBoundingClientRect()),
      headerBottom: header.getBoundingClientRect().bottom,
      fadeHeight: Number.parseFloat(fadeStyle.height),
      fadeBackgroundImage: fadeStyle.backgroundImage,
      stickyBoxShadow: getComputedStyle(sticky).boxShadow,
      brand
    };
  })()`);
}

function rectToPlain(rect) {
  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height
  };
}

async function readLayout(cdp) {
  return evaluate(cdp, `(() => {
    const active = document.querySelector('.planTab.active');
    const summary = document.querySelector('.stickyPlanControls .summary');
    const detail = document.querySelector('.planSheetBody');
    const sticky = document.querySelector('.stickyPlanControls');
    const cards = Array.from(document.querySelectorAll('.horseCard'));
    const lastCard = cards[cards.length - 1];
    const rootStyle = getComputedStyle(document.documentElement);
    const activeStyle = getComputedStyle(active);
    const summaryStyle = getComputedStyle(summary);
    const detailStyle = getComputedStyle(detail);
    const fadeStyle = getComputedStyle(sticky, '::after');
    const separator = rootStyle.getPropertyValue('--separator').trim();
    const brand = rootStyle.getPropertyValue('--brand-accent').trim();
    const normalize = value => {
      const probe = document.createElement('span');
      probe.style.color = value;
      document.body.appendChild(probe);
      const normalized = getComputedStyle(probe).color;
      probe.remove();
      return normalized;
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      activeText: active.textContent.trim(),
      activeRect: ${rectToPlain.toString()}(active.getBoundingClientRect()),
      summaryRect: ${rectToPlain.toString()}(summary.getBoundingClientRect()),
      detailRect: ${rectToPlain.toString()}(detail.getBoundingClientRect()),
      lastCardRect: ${rectToPlain.toString()}(lastCard.getBoundingClientRect()),
      brand: normalize(brand),
      separator: normalize(separator),
      active: {
        backgroundColor: activeStyle.backgroundColor,
        borderBottomWidth: activeStyle.borderBottomWidth
      },
      summary: {
        borderTopColor: summaryStyle.borderTopColor,
        borderTopWidth: summaryStyle.borderTopWidth,
        borderLeftColor: summaryStyle.borderLeftColor,
        borderLeftWidth: summaryStyle.borderLeftWidth,
        borderRightColor: summaryStyle.borderRightColor,
        borderRightWidth: summaryStyle.borderRightWidth,
        borderBottomWidth: summaryStyle.borderBottomWidth,
        borderRadius: summaryStyle.borderRadius
      },
      detail: {
        borderLeftColor: detailStyle.borderLeftColor,
        borderLeftWidth: detailStyle.borderLeftWidth,
        borderRightColor: detailStyle.borderRightColor,
        borderRightWidth: detailStyle.borderRightWidth,
        borderBottomColor: detailStyle.borderBottomColor,
        borderBottomWidth: detailStyle.borderBottomWidth
      },
      fadePointerEvents: fadeStyle.pointerEvents,
      allHorseCardUnitsZero: cards.every(card => Number(card.querySelector('.units').value) === 0),
      horseCardsStateConsistent: cards.every(card =>
        card.classList.contains('selected') === (Number(card.querySelector('.units').value) > 0)
      ),
      horseCardsBrandFree: cards.every(card => {
        const style = getComputedStyle(card);
        return style.borderTopColor !== normalize(brand) &&
          style.borderRightColor !== normalize(brand) &&
          style.borderBottomColor !== normalize(brand) &&
          style.borderLeftColor !== normalize(brand);
      }),
      zeroUnitHorseCardsNeutral: cards.every(card => {
        if (Number(card.querySelector('.units').value) > 0) return true;
        const style = getComputedStyle(card);
        return style.borderTopColor === normalize(separator) &&
          style.borderRightColor === normalize(separator) &&
          style.borderBottomColor === normalize(separator) &&
          style.borderLeftColor === normalize(separator);
      })
    };
  })()`);
}

function paethPredictor(left, up, upperLeft) {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  if (upDistance <= upperLeftDistance) return up;
  return upperLeft;
}

function decodePng(buffer) {
  const signature = buffer.subarray(0, 8).toString('hex');
  assert.equal(signature, '89504e470d0a1a0a', 'スクリーンショットがPNGではありません');
  let offset = 8;
  let width;
  let height;
  let bitDepth;
  let colorType;
  let interlace;
  const compressed = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += length + 12;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      compressed.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  assert.equal(bitDepth, 8, '8-bit PNGのみ対応しています');
  assert.ok(colorType === 2 || colorType === 6, `未対応のPNG colorTypeです: ${colorType}`);
  assert.equal(interlace, 0, 'interlace PNGは未対応です');
  const channels = colorType === 6 ? 4 : 3;
  const rowBytes = width * channels;
  const inflated = zlib.inflateSync(Buffer.concat(compressed));
  const pixels = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y++) {
    const sourceOffset = y * (rowBytes + 1);
    const filter = inflated[sourceOffset];
    const rowOffset = y * rowBytes;
    const priorOffset = rowOffset - rowBytes;
    for (let x = 0; x < rowBytes; x++) {
      const raw = inflated[sourceOffset + 1 + x];
      const left = x >= channels ? pixels[rowOffset + x - channels] : 0;
      const up = y > 0 ? pixels[priorOffset + x] : 0;
      const upperLeft = y > 0 && x >= channels ? pixels[priorOffset + x - channels] : 0;
      let value;
      if (filter === 0) value = raw;
      else if (filter === 1) value = raw + left;
      else if (filter === 2) value = raw + up;
      else if (filter === 3) value = raw + Math.floor((left + up) / 2);
      else if (filter === 4) value = raw + paethPredictor(left, up, upperLeft);
      else throw new Error(`未対応のPNG filterです: ${filter}`);
      pixels[rowOffset + x] = value & 0xff;
    }
  }
  return {
    width,
    height,
    pixel(x, y) {
      const safeX = Math.max(0, Math.min(width - 1, Math.round(x)));
      const safeY = Math.max(0, Math.min(height - 1, Math.round(y)));
      const index = safeY * rowBytes + safeX * channels;
      return [pixels[index], pixels[index + 1], pixels[index + 2], channels === 4 ? pixels[index + 3] : 255];
    }
  };
}

function rgbFromCss(cssColor) {
  const match = cssColor.match(/\d+(?:\.\d+)?/g);
  assert.ok(match && match.length >= 3, `色をRGBへ変換できません: ${cssColor}`);
  return match.slice(0, 3).map(Number);
}

function closeToColor(pixel, expected, tolerance = 12) {
  return expected.every((channel, index) => Math.abs(pixel[index] - channel) <= tolerance);
}

function colorDistance(actual, expected) {
  return Math.sqrt(expected.reduce((sum, channel, index) => {
    const delta = actual[index] - channel;
    return sum + delta * delta;
  }, 0));
}

function lineHasColor(image, x, top, expected) {
  for (let y = Math.floor(top) - 1; y <= Math.ceil(top) + 2; y++) {
    if (closeToColor(image.pixel(x, y), expected)) return true;
  }
  return false;
}

async function captureScreenshot(cdp) {
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false
  });
  return decodePng(Buffer.from(result.data, 'base64'));
}

function collectScrollFadeFailures(layout, image) {
  const failures = [];
  const brandRgb = rgbFromCss(layout.brand);
  const brandDistanceThreshold = 10;
  const fadeEvidenceThreshold = 8;
  const fadeTop = Math.round(layout.stickyRect.bottom);
  const fadeHeight = Math.round(layout.fadeHeight);
  const yOffsets = [1, Math.floor(fadeHeight / 2), fadeHeight - 1];
  const sides = [
    {
      name: 'left',
      borderX: Math.round(layout.detailRect.left),
      innerX: Math.round(layout.detailRect.left) + 1
    },
    {
      name: 'right',
      borderX: Math.round(layout.detailRect.right) - 1,
      innerX: Math.round(layout.detailRect.right) - 2
    }
  ];

  if (layout.scrollY <= 0) {
    failures.push(`scroll-fade state was not reached: scrollY=${layout.scrollY}`);
  }
  const stickyTopDelta = Math.abs(layout.stickyRect.top - layout.headerBottom);
  if (stickyTopDelta > 1) {
    failures.push(
      `sticky control is not pinned below header: stickyTop=${layout.stickyRect.top.toFixed(2)}, ` +
      `headerBottom=${layout.headerBottom.toFixed(2)}, delta=${stickyTopDelta.toFixed(2)}`
    );
  }
  if (fadeHeight < 3) {
    failures.push(`fade height is too small to sample: ${layout.fadeHeight}`);
    return failures;
  }

  for (const side of sides) {
    const borderSamples = yOffsets.map(offset => {
      const y = fadeTop + offset;
      const actual = image.pixel(side.borderX, y);
      return {
        x: side.borderX,
        y,
        actual,
        distance: colorDistance(actual, brandRgb)
      };
    });
    for (const sample of borderSamples) {
      if (sample.distance > brandDistanceThreshold) {
        failures.push(
          `${side.name} outer border lost in fade: x=${sample.x}, y=${sample.y}, ` +
          `expectedBrand=rgb(${brandRgb.join(',')}), actual=rgb(${sample.actual.slice(0, 3).join(',')}), ` +
          `distance=${sample.distance.toFixed(2)}, threshold<=${brandDistanceThreshold}`
        );
      }
    }

    const baselineY = fadeTop + fadeHeight + 3;
    const baseline = image.pixel(side.innerX, baselineY);
    const innerSamples = yOffsets.map(offset => {
      const y = fadeTop + offset;
      const actual = image.pixel(side.innerX, y);
      return {
        x: side.innerX,
        y,
        actual,
        distanceFromBaseline: colorDistance(actual, baseline)
      };
    });
    const maximumFadeEvidence = Math.max(...innerSamples.map(sample => sample.distanceFromBaseline));
    if (maximumFadeEvidence < fadeEvidenceThreshold) {
      failures.push(
        `${side.name} inner fade/shadow missing: x=${side.innerX}, ` +
        `samples=${innerSamples.map(sample => `y${sample.y}:rgb(${sample.actual.slice(0, 3).join(',')})`).join(' | ')}, ` +
        `baseline=y${baselineY}:rgb(${baseline.slice(0, 3).join(',')}), ` +
        `maxDistance=${maximumFadeEvidence.toFixed(2)}, threshold>=${fadeEvidenceThreshold}`
      );
    }
  }

  return failures;
}

function collectFailures(layout, image) {
  const failures = [];
  const brand = layout.brand;
  const geometryDelta = layout.activeRect.bottom - layout.summaryRect.top;
  const expectStyle = (actual, expected, label) => {
    if (actual !== expected) failures.push(`${label}: expected ${expected}, actual ${actual}`);
  };
  if (Math.abs(geometryDelta) > 1) {
    failures.push(`active下端-summary上端: 差${geometryDelta.toFixed(2)}px（許容<=1px）`);
  }
  expectStyle(layout.summary.borderTopColor, brand, 'summary border-top color');
  expectStyle(layout.summary.borderTopWidth, '1px', 'summary border-top width');
  expectStyle(layout.summary.borderLeftColor, brand, 'summary border-left color');
  expectStyle(layout.summary.borderLeftWidth, '1px', 'summary border-left width');
  expectStyle(layout.summary.borderRightColor, brand, 'summary border-right color');
  expectStyle(layout.summary.borderRightWidth, '1px', 'summary border-right width');
  expectStyle(layout.summary.borderBottomWidth, '0px', 'summary border-bottom width');
  expectStyle(layout.summary.borderRadius, '0px', 'summary border-radius');
  expectStyle(layout.fadePointerEvents, 'none', 'fade pointer-events');

  const brandRgb = rgbFromCss(brand);
  const centerX = (layout.activeRect.left + layout.activeRect.right) / 2;
  const leftX = (layout.summaryRect.left + layout.activeRect.left) / 2;
  const rightX = (layout.activeRect.right + layout.summaryRect.right) / 2;
  if (lineHasColor(image, centerX, layout.summaryRect.top, brandRgb)) {
    failures.push('active白面の下にsummary topのpink線が露出している');
  }
  if (!lineHasColor(image, leftX, layout.summaryRect.top, brandRgb)) {
    failures.push('active左区間にbrand pinkのsummary top線がない');
  }
  if (!lineHasColor(image, rightX, layout.summaryRect.top, brandRgb)) {
    failures.push('active右区間にbrand pinkのsummary top線がない');
  }

  expectStyle(layout.detail.borderLeftColor, brand, 'detail wrapper border-left color');
  expectStyle(layout.detail.borderLeftWidth, '1px', 'detail wrapper border-left width');
  expectStyle(layout.detail.borderRightColor, brand, 'detail wrapper border-right color');
  expectStyle(layout.detail.borderRightWidth, '1px', 'detail wrapper border-right width');
  expectStyle(layout.detail.borderBottomColor, brand, 'detail wrapper border-bottom color');
  expectStyle(layout.detail.borderBottomWidth, '1px', 'detail wrapper border-bottom width');
  const leftDelta = Math.abs(layout.detailRect.left - layout.summaryRect.left);
  const rightDelta = Math.abs(layout.detailRect.right - layout.summaryRect.right);
  const verticalDelta = Math.abs(layout.detailRect.top - layout.summaryRect.bottom);
  if (leftDelta > 1) failures.push(`summary-detail左辺が不連続: 差${leftDelta.toFixed(2)}px`);
  if (rightDelta > 1) failures.push(`summary-detail右辺が不連続: 差${rightDelta.toFixed(2)}px`);
  if (verticalDelta > 1) failures.push(`summary直下-detail上端が不連続: 差${verticalDelta.toFixed(2)}px`);
  if (layout.detailRect.bottom < layout.lastCardRect.bottom) {
    failures.push('detail wrapperが最終horseCardを囲っていない');
  }
  if (!layout.allHorseCardUnitsZero) {
    failures.push('初期検証状態にunits>0のhorseCardが残っている');
  }
  if (!layout.horseCardsStateConsistent) {
    failures.push('horseCardのselected classとunitsが不整合');
  }
  if (!layout.horseCardsBrandFree) {
    failures.push(`個別horseCardがbrand pink(${brand})で囲われている`);
  }
  if (!layout.zeroUnitHorseCardsNeutral) {
    failures.push(`個別horseCardのborderがneutral(${layout.separator})ではない`);
  }
  return failures;
}

test('sticky tab sheetのpink外形とactive白面が全画面幅・全active位置で連続する', { timeout: 20000 }, async t => {
  const browserExecutable = findBrowserExecutable();
  const server = await startStaticServer();
  const serverAddress = server.address();
  const appUrl = `http://127.0.0.1:${serverAddress.port}/index.html`;
  const profileDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'tf-sticky-tab-sheet-'));
  const browserProcess = childProcess.spawn(browserExecutable, [
    '--headless=new',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-background-networking',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    '--window-size=1440,1000',
    appUrl
  ], { stdio: 'ignore' });
  let browserSpawnError;
  browserProcess.once('error', error => {
    browserSpawnError = error;
  });
  let cdp;
  try {
    const devToolsFile = path.join(profileDir, 'DevToolsActivePort');
    const devToolsContents = await waitFor(async () => {
      if (browserSpawnError) throw browserSpawnError;
      try {
        return await fsPromises.readFile(devToolsFile, 'utf8');
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    }, 'Chrome DevTools port');
    const debugPort = Number(devToolsContents.split(/\r?\n/)[0]);
    const pageTarget = await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const targets = await response.json();
      return targets.find(target => target.type === 'page' && target.url === appUrl);
    }, '検証ページ');
    cdp = await CdpClient.connect(pageTarget.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await waitForApp(cdp, 1);

    for (const viewport of VIEWPORTS) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: false
      });
      await resetToOneTab(cdp);
      for (const state of STATES) {
        if (state.setup === 'middle') {
          await createFiveTabs(cdp);
          await activateTab(cdp, 2);
        } else if (state.setup === 'last') {
          await activateTab(cdp, -1);
        }
        await t.test(`${viewport.name} / ${state.name}`, async () => {
          const layout = await readLayout(cdp);
          assert.deepEqual(layout.viewport, { width: viewport.width, height: viewport.height });
          const screenshot = await captureScreenshot(cdp);
          const failures = collectFailures(layout, screenshot);
          assert.deepEqual(failures, [], failures.join('\n'));
        });
      }
      await resetToOneTab(cdp);
      await t.test(`${viewport.name} / scroll-fade outer border pixels`, async () => {
        const layout = await enterScrollFadeState(cdp);
        assert.deepEqual(layout.viewport, { width: viewport.width, height: viewport.height });
        const screenshot = await captureScreenshot(cdp);
        const failures = collectScrollFadeFailures(layout, screenshot);
        assert.deepEqual(failures, [], failures.join('\n'));
      });
    }
  } finally {
    if (cdp) cdp.close();
    if (browserProcess.pid && !browserProcess.killed) browserProcess.kill();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    const resolvedProfile = path.resolve(profileDir);
    const resolvedTemp = path.resolve(os.tmpdir()) + path.sep;
    if (resolvedProfile.startsWith(resolvedTemp) && path.basename(resolvedProfile).startsWith('tf-sticky-tab-sheet-')) {
      await fsPromises.rm(resolvedProfile, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
    }
  }
});
