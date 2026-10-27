'use strict'

const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen } = require('electron')
const path = require('path')
const fs = require('fs')
const { POS, freshCard, applyRating, previewsFor } = require('./srs')
const { loadFrom } = require('./data/deck')

// Windows paints a black rectangle behind a transparent window when the GPU
// compositor is on. The plant has to sit on the desktop, so leave that off.
if (process.platform === 'win32') app.disableHardwareAcceleration()

// Review keys stay inside this window. Do not register a global shortcut.
const ROOT = __dirname
const DAILY_CHOICES = [10, 20, 30, 50]
const SOON_MS = 30 * 60 * 1000
const DECK_FILES = ['vocab-a.txt', 'vocab-b.txt', 'decks.txt']

let win = null
let tray = null
let quitting = false
let progress = null
let dataDir = path.join(ROOT, 'data')
let words = []
let byId = new Map()
let session = []
let revealedId = null
let boundsTimer = null
let petMode = false

function progressFile() {
  return path.join(dataDir, 'progress.json')
}

function dayKey(now) {
  const d = new Date(now)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return d.getFullYear() + '-' + month + '-' + day
}

function validBounds(bounds) {
  if (!bounds) return null
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) return null
  return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
}

function cleanSenses(list) {
  if (!Array.isArray(list)) return []
  return list
    .filter((sense) => sense && sense.pos && sense.zh)
    .map((sense) => ({ pos: String(sense.pos), zh: String(sense.zh) }))
}

function cleanCustom(list, blocked) {
  if (!Array.isArray(list)) return []
  const seen = new Set()
  const out = []
  list.forEach((item) => {
    if (!item || typeof item.word !== 'string') return
    const word = item.word.trim().replace(/\s+/g, ' ')
    const id = String(item.id || word).trim().toLowerCase()
    if (!word || !id || seen.has(id) || blocked.has(id)) return
    const senses = cleanSenses(item.senses)
    if (!senses.length) return
    seen.add(id)
    out.push({
      id,
      word,
      phonetic: String(item.phonetic || ''),
      senses,
      custom: true
    })
  })
  return out
}

function defaultProgress() {
  return {
    version: 1,
    settings: { alwaysOnTop: false, dailyNew: 20, bounds: null, pet: false, petBounds: null },
    cards: {},
    customWords: [],
    overrides: {},
    hidden: []
  }
}

function normalizeProgress(data) {
  const next = defaultProgress()
  if (!data || typeof data !== 'object') return next
  if (data.settings && typeof data.settings === 'object') {
    next.settings.alwaysOnTop = !!data.settings.alwaysOnTop
    next.settings.pet = !!data.settings.pet
    if (DAILY_CHOICES.includes(data.settings.dailyNew)) next.settings.dailyNew = data.settings.dailyNew
    next.settings.bounds = validBounds(data.settings.bounds)
    next.settings.petBounds = validBounds(data.settings.petBounds)
  }
  if (data.cards && typeof data.cards === 'object') next.cards = data.cards
  next.customWords = Array.isArray(data.customWords) ? data.customWords : []
  next.hidden = Array.isArray(data.hidden) ? data.hidden.filter((id) => typeof id === 'string' && id) : []
  if (data.overrides && typeof data.overrides === 'object') next.overrides = data.overrides
  return next
}

function readProgress() {
  const file = progressFile()
  const candidates = [file, file + '.tmp']
  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue
      return normalizeProgress(JSON.parse(fs.readFileSync(candidate, 'utf8')))
    } catch (err) {
      console.error('PROGRESS_READ', candidate, err.message)
      try { fs.renameSync(candidate, candidate + '.bad') } catch (_) {}
    }
  }
  return defaultProgress()
}

function saveProgress() {
  fs.mkdirSync(dataDir, { recursive: true })
  const file = progressFile()
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(progress, null, 2), 'utf8')
  if (fs.existsSync(file)) fs.rmSync(file)
  fs.renameSync(tmp, file)
}

function hiddenSet() {
  return new Set(progress.hidden || [])
}

function applyOverride(word) {
  const over = progress.overrides && progress.overrides[word.id]
  const senses = cleanSenses(over && over.senses)
  if (!senses.length) return { ...word, custom: false }
  return {
    id: word.id,
    word: over.word ? String(over.word) : word.word,
    phonetic: over.phonetic != null ? String(over.phonetic) : word.phonetic,
    senses,
    custom: false
  }
}

function indexWords() {
  const starter = loadFrom(dataDir)
  const hidden = hiddenSet()
  const blocked = new Set(starter.map((word) => word.id))
  const base = []
  starter.forEach((word) => {
    if (hidden.has(word.id)) return
    base.push(applyOverride(word))
  })
  const custom = cleanCustom(progress.customWords, blocked).filter((word) => !hidden.has(word.id))
  progress.customWords = custom
  words = base.concat(custom)
  byId = new Map(words.map((word) => [word.id, word]))
}

function buildSession(now) {
  const today = dayKey(now)
  let introducedToday = 0
  Object.values(progress.cards).forEach((card) => {
    if (card && card.introducedOn === today) introducedToday += 1
  })
  const due = []
  const unseen = []
  words.forEach((word) => {
    const card = progress.cards[word.id]
    if (!card) {
      unseen.push(word.id)
      return
    }
    if (typeof card.due === 'number' && card.due <= now) due.push({ id: word.id, due: card.due })
  })
  due.sort((a, b) => a.due - b.due)
  const slots = Math.max(0, progress.settings.dailyNew - introducedToday)
  return due.map((item) => item.id).concat(unseen.slice(0, slots))
}

function countIntroducedToday(now) {
  const today = dayKey(now)
  let count = 0
  Object.values(progress.cards).forEach((card) => {
    if (card && card.introducedOn === today) count += 1
  })
  return count
}

function view() {
  const now = Date.now()
  let due = 0
  Object.values(progress.cards).forEach((card) => {
    if (card && typeof card.due === 'number' && card.due <= now) due += 1
  })
  let unseen = 0
  words.forEach((word) => {
    if (!progress.cards[word.id]) unseen += 1
  })
  return {
    card: publicCard(false),
    queueLeft: session.length,
    due,
    unseen,
    introducedToday: countIntroducedToday(now),
    dailyNew: progress.settings.dailyNew,
    deckSize: words.length,
    alwaysOnTop: !!progress.settings.alwaysOnTop,
    pet: petMode,
    pos: POS
  }
}

function publicCard(includeSenses) {
  while (session.length) {
    const word = byId.get(session[0])
    if (word) {
      const card = {
        id: word.id,
        word: word.word,
        phonetic: word.phonetic,
        senseCount: word.senses.length,
        custom: !!word.custom
      }
      if (includeSenses) card.senses = word.senses
      return card
    }
    session.shift()
  }
  return null
}

function payload(extra) {
  return Object.assign({ ok: true }, view(), extra || {})
}

function pushRefresh() {
  if (win && !win.isDestroyed()) win.webContents.send('desk:refresh')
}

function pushMode() {
  if (win && !win.isDestroyed()) win.webContents.send('desk:mode', { pet: petMode })
}

function armSoon(id, due) {
  const wait = due - Date.now()
  if (wait <= 0 || wait > SOON_MS) return
  setTimeout(() => {
    if (session.includes(id)) return
    const card = progress.cards[id]
    if (!card || card.due > Date.now() + 1500) return
    session.push(id)
    pushRefresh()
  }, Math.max(500, wait))
}

function rememberBounds() {
  if (!win || win.isDestroyed() || !win.isVisible() || win.isMinimized()) return
  clearTimeout(boundsTimer)
  boundsTimer = setTimeout(() => {
    if (!win || win.isDestroyed() || !win.isVisible()) return
    const bounds = win.getBounds()
    if (petMode) progress.settings.petBounds = bounds
    else progress.settings.bounds = bounds
    saveProgress()
  }, 400)
}

function boundsOnScreen(bounds) {
  const box = validBounds(bounds)
  if (!box) return null
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  const visible = screen.getAllDisplays().some((display) => {
    const area = display.workArea
    return cx >= area.x && cx < area.x + area.width && cy >= area.y && cy < area.y + area.height
  })
  return visible ? box : null
}

function defaultBounds() {
  const area = screen.getPrimaryDisplay().workArea
  const width = 400
  const height = 640
  return {
    x: Math.max(area.x, area.x + area.width - width - 28),
    y: Math.max(area.y, area.y + area.height - height - 28),
    width,
    height
  }
}

function defaultPetBounds() {
  const area = screen.getPrimaryDisplay().workArea
  const width = 168
  const height = 210
  return {
    x: Math.max(area.x, area.x + area.width - width - 24),
    y: Math.max(area.y, area.y + area.height - height - 24),
    width,
    height
  }
}

function showWin() {
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function applyChrome() {
  if (!win || win.isDestroyed()) return
  if (petMode) {
    const box = boundsOnScreen(progress.settings.petBounds) || defaultPetBounds()
    win.setResizable(true)
    win.setMinimumSize(140, 180)
    win.setMaximumSize(220, 260)
    win.setBounds(box)
    win.setResizable(false)
    win.setSkipTaskbar(true)
    win.setAlwaysOnTop(true, 'floating')
    win.setHasShadow(false)
    return
  }
  const box = boundsOnScreen(progress.settings.bounds) || defaultBounds()
  win.setResizable(true)
  win.setMaximumSize(4000, 4000)
  win.setMinimumSize(360, 520)
  win.setBounds(box)
  win.setSkipTaskbar(false)
  win.setAlwaysOnTop(!!progress.settings.alwaysOnTop, 'floating')
  win.setHasShadow(false)
}

function setPet(on) {
  const next = !!on
  if (next === petMode) return payload()
  if (win && !win.isDestroyed() && win.isVisible()) {
    const bounds = win.getBounds()
    if (petMode) progress.settings.petBounds = bounds
    else progress.settings.bounds = bounds
  }
  petMode = next
  progress.settings.pet = petMode
  applyChrome()
  saveProgress()
  if (tray) tray.setContextMenu(buildMenu())
  pushMode()
  if (!petMode) showWin()
  return payload()
}

function setPin(on) {
  progress.settings.alwaysOnTop = !!on
  if (win && !win.isDestroyed() && !petMode) win.setAlwaysOnTop(!!on, 'floating')
  saveProgress()
  if (tray) tray.setContextMenu(buildMenu())
  return payload()
}

function openStudy() {
  if (petMode) setPet(false)
  else showWin()
}

function buildMenu() {
  return Menu.buildFromTemplate([
    { label: '打开学习窗口', click: () => openStudy() },
    { label: '变成桌宠', click: () => setPet(true) },
    { label: '隐藏', click: () => { if (win) win.hide() } },
    { type: 'separator' },
    {
      label: '置顶',
      type: 'checkbox',
      checked: !!progress.settings.alwaysOnTop,
      click: (item) => setPin(item.checked)
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        quitting = true
        app.quit()
      }
    }
  ])
}

function createTray() {
  const image = nativeImage.createFromPath(path.join(ROOT, 'icon.png'))
  tray = new Tray(image)
  tray.setToolTip('Desk')
  tray.setContextMenu(buildMenu())
  tray.on('click', () => openStudy())
}

function createWindow() {
  petMode = !!progress.settings.pet
  const initial = petMode
    ? (boundsOnScreen(progress.settings.petBounds) || defaultPetBounds())
    : (boundsOnScreen(progress.settings.bounds) || defaultBounds())
  win = new BrowserWindow({
    x: initial.x,
    y: initial.y,
    width: initial.width,
    height: initial.height,
    minWidth: petMode ? 140 : 360,
    minHeight: petMode ? 180 : 520,
    maxWidth: petMode ? 220 : undefined,
    maxHeight: petMode ? 260 : undefined,
    resizable: !petMode,
    show: false,
    frame: false,
    thickFrame: false,
    roundedCorners: false,
    transparent: true,
    hasShadow: false,
    skipTaskbar: petMode,
    title: 'Desk',
    autoHideMenuBar: true,
    icon: path.join(ROOT, 'icon.png'),
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })
  win.setMenu(null)
  if (petMode || progress.settings.alwaysOnTop) win.setAlwaysOnTop(true, 'floating')
  win.once('ready-to-show', () => {
    win.show()
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.on('close', (event) => {
    if (quitting) return
    if (!tray || tray.isDestroyed()) return
    event.preventDefault()
    win.hide()
  })
  win.on('move', rememberBounds)
  win.on('resize', rememberBounds)
  win.loadFile(path.join(ROOT, 'index.html'), { query: { pet: petMode ? '1' : '0' } })
}

function topUp(limit) {
  const inSession = new Set(session)
  let added = 0
  for (const word of words) {
    if (added >= limit) break
    if (inSession.has(word.id) || progress.cards[word.id]) continue
    session.push(word.id)
    inSession.add(word.id)
    added += 1
  }
  return added
}

function readEntry(source) {
  const word = String(source.word || '').trim().replace(/\s+/g, ' ')
  const phonetic = String(source.phonetic || '').trim()
  if (!/^[A-Za-z][A-Za-z' -]{0,79}$/.test(word)) {
    return { error: '英文用字母写，可以有空格或连字符' }
  }
  if (phonetic.length > 80) return { error: '音标太长了' }
  const senses = []
  for (const row of source.senses || []) {
    const pos = String(row.pos || '').trim()
    const zh = String(row.zh || '').trim()
    if (!zh) continue
    if (!POS.includes(pos)) return { error: '词性要用 n. / v. / adj. 这类标记' }
    if (zh.length > 80) return { error: '一条释义请短一点' }
    senses.push({ pos, zh })
  }
  if (!senses.length) return { error: '至少写一条中文释义' }
  if (senses.length > 12) return { error: '释义太多了' }
  return { word, phonetic, senses }
}

function resolveDataDir() {
  if (!app.isPackaged) return path.join(ROOT, 'data')
  const beside = path.join(path.dirname(process.execPath), 'data')
  fs.mkdirSync(beside, { recursive: true })
  const bundled = path.join(process.resourcesPath, 'data')
  DECK_FILES.forEach((name) => {
    const target = path.join(beside, name)
    if (fs.existsSync(target)) return
    const source = path.join(bundled, name)
    if (fs.existsSync(source)) fs.copyFileSync(source, target)
  })
  return beside
}

ipcMain.handle('desk:load', () => payload())

ipcMain.handle('desk:reveal', (_event, id) => {
  if (!session.length || session[0] !== id) return { ok: false }
  const word = byId.get(id)
  if (!word) return { ok: false }
  revealedId = id
  const card = progress.cards[id] || freshCard()
  return {
    ok: true,
    senses: word.senses,
    previews: previewsFor(card, Date.now(), session.length)
  }
})

ipcMain.handle('desk:word', (_event, id) => {
  const word = byId.get(id)
  if (!word) return { ok: false, error: '没有这个词' }
  return {
    ok: true,
    word: {
      id: word.id,
      word: word.word,
      phonetic: word.phonetic || '',
      senses: word.senses,
      custom: !!word.custom
    }
  }
})

ipcMain.handle('desk:rate', (_event, id, rating) => {
  if (![1, 2, 3, 4].includes(rating)) return { ok: false, error: '先显示释义' }
  if (revealedId !== id || !session.length || session[0] !== id) return { ok: false, error: '先显示释义' }
  const now = Date.now()
  const prev = progress.cards[id] || freshCard()
  const queueLength = session.length
  const next = applyRating(prev, rating, now, queueLength)
  next.introducedOn = prev.introducedOn || dayKey(now)
  progress.cards[id] = next
  saveProgress()
  session.shift()
  revealedId = null
  if (rating === 1 && queueLength > 1) {
    session.splice(Math.min(3, session.length), 0, id)
  } else if (!session.includes(id)) {
    armSoon(id, next.due)
  }
  return payload()
})

ipcMain.handle('desk:add-word', (_event, input) => {
  const entry = readEntry(input || {})
  if (entry.error) return { ok: false, error: entry.error }
  const id = entry.word.toLowerCase()
  if (byId.has(id) || hiddenSet().has(id)) return { ok: false, error: '词库里已经有这个词' }
  progress.customWords.push({
    id,
    word: entry.word,
    phonetic: entry.phonetic,
    senses: entry.senses,
    custom: true
  })
  saveProgress()
  indexWords()
  session = session.filter((item) => item !== id)
  const at = session.length ? 1 : 0
  session.splice(at, 0, id)
  return payload({ queuedNext: at === 1 })
})

ipcMain.handle('desk:update-word', (_event, input) => {
  const source = input || {}
  const id = String(source.id || '')
  const existing = byId.get(id)
  if (!existing) return { ok: false, error: '没有这个词' }
  const entry = readEntry(source)
  if (entry.error) return { ok: false, error: entry.error }
  if (existing.custom) {
    const item = progress.customWords.find((word) => word.id === id)
    if (!item) return { ok: false, error: '没有这个词' }
    item.word = entry.word
    item.phonetic = entry.phonetic
    item.senses = entry.senses
  } else {
    progress.overrides[id] = {
      word: entry.word,
      phonetic: entry.phonetic,
      senses: entry.senses
    }
  }
  saveProgress()
  indexWords()
  const updated = byId.get(id)
  return payload({ senses: updated ? updated.senses : entry.senses })
})

ipcMain.handle('desk:delete-word', (_event, id) => {
  const word = byId.get(id)
  if (!word) return { ok: false, error: '没有这个词' }
  if (word.custom) {
    progress.customWords = progress.customWords.filter((item) => item.id !== id)
    delete progress.cards[id]
  } else if (!progress.hidden.includes(id)) {
    progress.hidden.push(id)
  }
  if (progress.overrides) delete progress.overrides[id]
  saveProgress()
  indexWords()
  session = session.filter((item) => item !== id)
  if (revealedId === id) revealedId = null
  return payload()
})

ipcMain.handle('desk:pin', (_event, on) => setPin(!!on))

ipcMain.handle('desk:pet', (_event, on) => setPet(!!on))

ipcMain.handle('desk:daily-new', (_event, n) => {
  if (!DAILY_CHOICES.includes(n)) return { ok: false }
  const previous = progress.settings.dailyNew
  progress.settings.dailyNew = n
  saveProgress()
  if (n > previous) {
    const freshInQueue = session.filter((item) => !progress.cards[item]).length
    const slots = Math.max(0, n - countIntroducedToday(Date.now()) - freshInQueue)
    topUp(slots)
  }
  return payload()
})

ipcMain.handle('desk:more-new', () => {
  const added = topUp(10)
  revealedId = null
  return payload({ added })
})

ipcMain.handle('desk:hide', () => {
  if (win) win.hide()
  return { ok: true }
})

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.exit(0)
} else {
  app.on('second-instance', () => openStudy())
  app.whenReady().then(() => {
    app.setAppUserModelId('local.desk.vocabulary')
    Menu.setApplicationMenu(null)
    dataDir = resolveDataDir()
    progress = readProgress()
    indexWords()
    session = buildSession(Date.now())
    Object.entries(progress.cards).forEach(([id, card]) => {
      if (!session.includes(id) && card && typeof card.due === 'number') armSoon(id, card.due)
    })
    saveProgress()
    createWindow()
    createTray()
  }).catch((err) => {
    console.error('DESK_ERROR', err)
    app.exit(1)
  })
  app.on('before-quit', () => {
    quitting = true
  })
  app.on('window-all-closed', () => {
    if (quitting) app.quit()
  })
}
