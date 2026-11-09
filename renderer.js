'use strict'

if (new URLSearchParams(location.search).get('pet') === '1') {
  document.documentElement.classList.add('pet')
}

const stage = document.getElementById('stage')
const footer = document.getElementById('meta')
const adder = document.getElementById('adder')
const pinBtn = document.getElementById('pin')
const petBtn = document.getElementById('pet')
const addBtn = document.getElementById('add')
const browseBtn = document.getElementById('browse')
const closeBtn = document.getElementById('close')
const expandBtn = document.getElementById('expand')
const petWord = document.getElementById('pet-word')

let state = null
let revealed = false
let senses = null
let previews = null
let addOpen = false
let editorMode = 'add'
let draft = null
let confirmDelete = false
let feedback = null
let submitLock = false
let spellDraft = ''
let spellDraftId = null
let spellNote = ''
let browse = null

function el(tag, cls, text) {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text != null) node.textContent = text
  return node
}

function dot() {
  return el('span', 'dot', '·')
}

function renderPetWord() {
  if (!petWord) return
  const card = state && state.card
  if (!card) {
    petWord.textContent = ''
    return
  }
  petWord.textContent = card.spell ? (card.label || '') : card.word
}

function resetCard() {
  revealed = false
  senses = null
  previews = null
  confirmDelete = false
  feedback = null
}

function gradeName(grade) {
  if (grade === 4) return '轻松'
  if (grade === 5) return '已会'
  return '记得'
}

function senseList(list) {
  const box = el('div', 'senses')
  ;(list || []).forEach((sense) => {
    const block = el('div', 'sense-block')
    const row = el('div', 'sense')
    row.append(el('span', 'pos', sense.pos), el('span', 'zh', sense.zh))
    block.append(row)
    ;(sense.sentences || []).forEach((sentence) => {
      const line = el('p', 'sentence')
      line.append(el('span', 'sentence-en', sentence.en))
      if (sentence.zh) line.append(el('span', 'sentence-zh', sentence.zh))
      block.append(line)
    })
    box.append(block)
  })
  return box
}

function shortcutLine() {
  let action = '先看词，再回忆'
  if (browse && browse.view === 'card') action = '← → 翻看 · F 检索 · L 列表 · C 逐词 · S 句子 · E 编辑 · Esc 返回'
  else if (browse) action = 'F 检索 · L 列表 · C 逐词 · S 句子 · E 编辑 · ↑↓ 选择 · Esc 返回'
  else if (feedback) action = '空格继续'
  else if (state && state.card && state.card.spell) action = '回车确认 · 写错再写一次'
  else if (state && state.card && !revealed) action = '空格释义 · E 更改 · D 删除 · A 加词 · P 置顶 · M 桌宠 · B 词表'
  else if (state && state.card) action = '1忘了 2模糊 3记得 4轻松 0已会 · E 更改 · D 删除'
  else if (state && !state.deckSize) action = '可以先加几个词'
  else if (state && state.unseen) action = '回车把剩下的新词加上 · B 词表'
  return '只在本窗口 · ' + action
}

function renderFooter() {
  footer.replaceChildren()
  if (!state) return
  footer.append(
    el('span', null, '到期 ' + state.due),
    dot(),
    el('span', null, '这一批 ' + state.queueLeft),
    dot(),
    el('span', null, '词库 ' + state.deckSize)
  )
  footer.append(document.createElement('br'))
  footer.append(el('span', null, '未学 ' + state.unseen))
  footer.append(document.createElement('br'))
  footer.append(el('span', null, shortcutLine()))
}

function renderDone() {
  const unseen = state.unseen || 0
  const title = unseen ? '这一批先到这里' : '这一轮先到这里'
  stage.append(el('h1', 'rest-title', title))
  const copy = unseen
    ? '还剩 ' + unseen + ' 个新词没进这一轮。回车可以把它们都加进来。'
    : '到时间的词会自己回来。按 M 收成桌宠，或从右上角收到托盘。'
  stage.append(el('p', 'rest-copy', copy))
  const actions = el('div', 'rest-actions')
  if (unseen) {
    const more = el('button', 'primary', '加上剩下的新词')
    more.type = 'button'
    more.addEventListener('click', moreNew)
    actions.append(more)
  }
  const add = el('button', 'ghost', '加词')
  add.type = 'button'
  add.addEventListener('click', openAdd)
  actions.append(add)
  stage.append(actions)
}

function cardActions(card) {
  const row = el('div', 'card-actions')
  const edit = el('button', 'link', '更改 E')
  edit.type = 'button'
  edit.addEventListener('click', openEdit)
  const del = el('button', 'link danger', confirmDelete ? '确认删除 D' : '删除 D')
  del.type = 'button'
  del.addEventListener('click', () => {
    if (!confirmDelete) {
      confirmDelete = true
      renderStage()
      return
    }
    removeWord(card.id)
  })
  row.append(edit, del)
  stage.append(row)
  if (confirmDelete) {
    const note = card.custom
      ? '确认后，这个自加词和它的复习记录都会去掉。'
      : '确认后不再复习这个词。词表文件不会被改掉。'
    const line = el('p', 'note', note)
    const cancel = el('button', 'link', '取消')
    cancel.type = 'button'
    cancel.addEventListener('click', () => {
      confirmDelete = false
      renderStage()
    })
    line.append(document.createTextNode(' '), cancel)
    stage.append(line)
  }
}

function renderEmpty() {
  stage.append(el('h1', 'rest-title', '词库是空的'))
  stage.append(el('p', 'rest-copy', '右上角可以加词。以后把词表放进 data\\vocab\u2011KY.txt，从托盘退出再打开。'))
  const actions = el('div', 'rest-actions')
  const add = el('button', 'primary', '加词')
  add.type = 'button'
  add.addEventListener('click', openAdd)
  actions.append(add)
  stage.append(actions)
}

function renderMiss() {
  stage.append(el('p', 'prompt', '写法是这个'))
  const shown = feedback.word || ''
  stage.append(el('h1', shown.length > 14 ? 'word long' : 'word', shown))
  if (feedback.phonetic) stage.append(el('p', 'phonetic', feedback.phonetic))
  stage.append(senseList(feedback.senses))
  stage.append(el('p', 'hint', '看一眼。空格或回车看下一个，过几个词还会再遇到。'))
  const actions = el('div', 'spell-actions')
  const next = el('button', 'primary', '继续')
  next.type = 'button'
  next.addEventListener('click', dismissMiss)
  actions.append(next)
  stage.append(actions)
}

function renderSpellCard(card) {
  if (spellDraftId !== card.id) {
    spellDraft = ''
    spellDraftId = card.id
    spellNote = ''
  }
  stage.append(el('p', 'prompt', '凭中文写出英文'))
  stage.append(el('p', 'count', '写对按「' + gradeName(card.grade) + '」安排下次'))
  stage.append(senseList(card.senses))
  const input = el('input', 'spell-input')
  input.type = 'text'
  input.value = spellDraft
  input.autocomplete = 'off'
  input.spellcheck = false
  input.lang = 'en'
  input.maxLength = 80
  input.placeholder = '英文'
  input.setAttribute('aria-label', '写出英文')
  input.addEventListener('input', () => { spellDraft = input.value })
  stage.append(input)
  const hint = spellNote || '回车确认。写错先再写一次，还错就过几个词再来。'
  stage.append(el('p', spellNote ? 'hint spell-note' : 'hint', hint))
  const actions = el('div', 'spell-actions')
  const go = el('button', 'primary', '写好了')
  go.type = 'button'
  go.addEventListener('click', submitSpell)
  const back = el('button', 'link', '返回')
  back.type = 'button'
  back.addEventListener('click', cancelSpell)
  actions.append(go, back)
  stage.append(actions)
}

function filteredBrowse() {
  const q = String(browse.query || '').trim().toLowerCase()
  let list = browse.words.filter((word) => {
    if (!q) return true
    if (String(word.word || '').toLowerCase().includes(q)) return true
    return (word.senses || []).some((sense) => {
      if (String(sense.zh || '').toLowerCase().includes(q)) return true
      return (sense.sentences || []).some((sentence) => {
        return (String(sentence.en || '') + ' ' + String(sentence.zh || '')).toLowerCase().includes(q)
      })
    })
  })
  if (browse.sort === 'alpha') {
    list = list.slice().sort((a, b) => String(a.word).localeCompare(String(b.word), 'en'))
  }
  return list
}

function browseTool(label, on, click) {
  const button = el('button', on ? 'ghost on' : 'ghost', label)
  button.type = 'button'
  button.addEventListener('click', click)
  return button
}

function renderBrowseBar(shown, total) {
  const bar = el('div', 'browse-bar')
  const search = el('input', 'browse-search')
  search.type = 'search'
  search.value = browse.query || ''
  search.placeholder = '检索英文或中文  F'
  search.setAttribute('aria-label', '检索英文或中文')
  search.addEventListener('input', () => {
    browse.query = search.value
    browse.index = 0
    browse.focusSearch = true
    render()
  })
  bar.append(search)
  const tools = el('div', 'browse-tools')
  tools.append(
    browseTool('列表 L', browse.view === 'list', () => { browse.view = 'list'; browse.focusSearch = false; render() }),
    browseTool('逐词 C', browse.view === 'card', () => { browse.view = 'card'; browse.focusSearch = false; render() }),
    browseTool('句子 S', browse.view === 'sentence', () => { browse.view = 'sentence'; browse.focusSearch = false; render() }),
    browseTool(browse.sort === 'alpha' ? 'A–Z V' : '词序 V', false, () => {
      browse.sort = browse.sort === 'alpha' ? 'deck' : 'alpha'
      browse.focusSearch = false
      render()
    })
  )
  const edit = browseTool(browse.editing ? '完成编辑 E' : '编辑模式 E', browse.editing, () => {
    browse.editing = !browse.editing
    browse.focusSearch = false
    if (!browse.editing && addOpen) closeAdd()
    render()
  })
  edit.classList.add('edit-mode')
  tools.append(edit)
  bar.append(tools)
  bar.append(el('p', 'count', shown + ' / ' + total + (browse.editing ? ' · 编辑模式' : '')))
  stage.append(bar)
  if (browse.focusSearch) {
    search.focus()
    const end = search.value.length
    try { search.setSelectionRange(end, end) } catch (_) {}
  }
}

function renderBrowseList(list) {
  if (!list.length) {
    stage.append(el('p', 'rest-copy', browse.query ? '没有符合的词。' : '词库是空的。'))
    return
  }
  list.forEach((item, index) => {
    const line = el('div', 'word-line')
    const row = el('button', index === browse.index ? 'word-row on' : 'word-row')
    row.type = 'button'
    const head = el('span', 'row-head')
    head.append(el('span', 'row-word', item.word))
    if (item.phonetic) head.append(el('span', 'row-phon', item.phonetic))
    row.append(head)
    const zh = item.senses && item.senses[0] ? item.senses[0].zh : ''
    if (zh) row.append(el('span', 'row-zh', zh))
    row.addEventListener('click', () => {
      browse.view = 'card'
      browse.index = index
      browse.focusSearch = false
      render()
    })
    line.append(row)
    if (browse.editing) {
      const edit = el('button', 'ghost slim edit-word', '更改 G')
      edit.type = 'button'
      edit.addEventListener('click', () => openBrowseEdit(item.id))
      line.append(edit)
    }
    stage.append(line)
  })
}

function renderBrowseCard(list) {
  if (!list.length) {
    stage.append(el('p', 'rest-copy', browse.query ? '没有符合的词。' : '词库是空的。'))
    return
  }
  const index = Math.min(Math.max(browse.index, 0), list.length - 1)
  browse.index = index
  const item = list[index]
  stage.append(el('p', 'count', '逐词 ' + (index + 1) + ' / ' + list.length))
  stage.append(el('h1', item.word.length > 14 ? 'word long' : 'word', item.word))
  if (item.phonetic) stage.append(el('p', 'phonetic', item.phonetic))
  stage.append(senseList(item.senses))
  const edge = index === 0 ? '已经是第一个。' : index === list.length - 1 ? '已经是最后一个。' : ''
  stage.append(el('p', 'hint', edge + '左右方向键翻看。'))
  const actions = el('div', 'rest-actions')
  const prev = el('button', 'ghost', '上一个')
  prev.type = 'button'
  prev.addEventListener('click', () => stepBrowse(-1))
  const next = el('button', 'ghost', '下一个')
  next.type = 'button'
  next.addEventListener('click', () => stepBrowse(1))
  actions.append(prev, next)
  if (browse.editing) {
    const edit = el('button', 'primary edit-word', '更改 G')
    edit.type = 'button'
    edit.addEventListener('click', () => openBrowseEdit(item.id))
    actions.append(edit)
  }
  stage.append(actions)
}

function renderBrowseSentences(list) {
  const withSentences = list.filter((word) => (word.senses || []).some((sense) => sense.sentences && sense.sentences.length))
  if (!withSentences.length) {
    stage.append(el('h1', 'rest-title', '还没有例句'))
    stage.append(el('p', 'rest-copy', browse.editing
      ? '按 G 给当前词的某一条词义加上英文句子，可以附一句中文。'
      : '先按 E 打开编辑模式，再给某一条词义加句子。'))
    return
  }
  withSentences.forEach((item) => {
    const block = el('section', 'sentence-card')
    const head = el('div', 'sentence-head')
    head.append(el('h2', null, item.word))
    if (browse.editing) {
      const edit = el('button', 'ghost slim edit-word', '更改 G')
      edit.type = 'button'
      edit.addEventListener('click', () => openBrowseEdit(item.id))
      head.append(edit)
    }
    block.append(head)
    ;(item.senses || []).forEach((sense) => {
      if (!sense.sentences || !sense.sentences.length) return
      const senseRow = el('div', 'sense')
      senseRow.append(el('span', 'pos', sense.pos), el('span', 'zh', sense.zh))
      block.append(senseRow)
      sense.sentences.forEach((sentence) => {
        const line = el('p', 'sentence')
        line.append(el('span', 'sentence-en', sentence.en))
        if (sentence.zh) line.append(el('span', 'sentence-zh', sentence.zh))
        block.append(line)
      })
    })
    stage.append(block)
  })
}

function renderBrowse() {
  const total = browse.words.length
  const list = filteredBrowse()
  renderBrowseBar(list.length, total)
  if (!total) {
    stage.append(el('p', 'rest-copy', '没有可以翻看的词。Esc 回到背词。'))
    return
  }
  if (browse.view === 'card') renderBrowseCard(list)
  else if (browse.view === 'sentence') renderBrowseSentences(list)
  else renderBrowseList(list)
  const back = el('button', 'link back-study', '回到背词')
  back.type = 'button'
  back.addEventListener('click', closeBrowse)
  stage.append(back)
}

function renderStage() {
  stage.replaceChildren()
  if (!state) {
    stage.append(el('p', 'hint', '正在打开词库…'))
    return
  }
  if (browse) {
    confirmDelete = false
    renderBrowse()
    return
  }
  if (feedback) {
    confirmDelete = false
    renderMiss()
    return
  }
  if (!state.card) {
    confirmDelete = false
    spellDraft = ''
    spellDraftId = null
    if (!state.deckSize) renderEmpty()
    else renderDone()
    return
  }
  const card = state.card
  if (card.spell) {
    confirmDelete = false
    renderSpellCard(card)
    return
  }
  const word = el('h1', card.word.length > 14 ? 'word long' : 'word', card.word)
  stage.append(word)
  if (card.phonetic) stage.append(el('p', 'phonetic', card.phonetic))
  if (!revealed) {
    const recall = el('div', 'recall')
    recall.append(el('p', 'count', card.senseCount + ' 个义项'))
    recall.append(el('p', 'prompt', '先回忆这些义项'))
    const button = el('button', 'reveal', '显示释义')
    button.type = 'button'
    button.addEventListener('click', reveal)
    recall.append(button, el('p', 'hint', '空格或回车'))
    stage.append(recall)
    cardActions(card)
    return
  }
  stage.append(el('p', 'count', card.senseCount + ' 个义项'))
  stage.append(senseList(senses))
  const rates = el('div', 'rates')
  ;[
    ['1', '忘了', 1],
    ['2', '模糊', 2],
    ['3', '记得', 3],
    ['4', '轻松', 4],
    ['0', '已会', 0]
  ].forEach(([key, label, mark]) => {
    const button = el('button', mark === 0 ? 'rate wide' : 'rate')
    button.type = 'button'
    button.append(el('span', 'rate-name', key + '  ' + label))
    const previewKey = mark === 0 ? '5' : key
    button.append(el('small', null, (previews && previews[previewKey]) || ''))
    button.addEventListener('click', () => choose(mark))
    rates.append(button)
  })
  stage.append(rates)
  stage.append(el('p', 'hint', '3、4、0 先往后排几个词，再凭中文默写。写对才算。'))
  cardActions(card)
}

function renderPin() {
  const on = !!(state && state.alwaysOnTop)
  pinBtn.classList.toggle('on', on)
  pinBtn.setAttribute('aria-pressed', on ? 'true' : 'false')
  pinBtn.textContent = on ? '已置顶 P' : '置顶 P'
}

function render() {
  stage.classList.toggle('browsing', !!browse)
  renderStage()
  renderFooter()
  renderPin()
  renderPetWord()
  if (addOpen || feedback || petActive() || !state || !state.card || !state.card.spell) return
  const input = stage.querySelector('.spell-input')
  if (input) {
    input.focus()
    const end = input.value.length
    try { input.setSelectionRange(end, end) } catch (_) {}
  }
}

function typingTarget(node) {
  if (!node) return false
  const tag = node.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

function petActive() {
  return document.documentElement.classList.contains('pet')
}

async function reveal() {
  if (!state || !state.card || state.card.spell || revealed || addOpen || petActive() || feedback) return
  const res = await window.desk.reveal(state.card.id)
  if (!res || !res.ok) return
  revealed = true
  senses = res.senses
  previews = res.previews
  render()
}

async function rate(n) {
  if (!revealed || addOpen || petActive() || feedback || !state || !state.card || state.card.spell) return
  const res = await window.desk.rate(state.card.id, n)
  if (!res || !res.ok) return
  resetCard()
  state = res
  render()
}

async function choose(mark) {
  if (!revealed || addOpen || petActive() || feedback || !state || !state.card || state.card.spell) return
  if (mark === 1 || mark === 2) {
    rate(mark)
    return
  }
  const rating = mark === 0 ? 5 : mark
  const res = await window.desk.mark(state.card.id, rating)
  if (!res || !res.ok) return
  resetCard()
  state = res
  render()
}

function dismissMiss() {
  if (!feedback) return
  feedback = null
  render()
}

async function submitSpell() {
  if (submitLock || feedback || addOpen || browse || !state || !state.card || !state.card.spell) return
  const input = stage.querySelector('.spell-input')
  const typed = input ? input.value : spellDraft
  const id = state.card.id
  submitLock = true
  const res = await window.desk.spell(id, typed)
  submitLock = false
  if (!res || !res.ok) return
  if (!res.match && res.retry) {
    spellDraft = ''
    spellNote = '不对，再写一次'
    render()
    return
  }
  spellDraft = ''
  spellDraftId = null
  spellNote = ''
  resetCard()
  state = res
  if (!res.match && res.card && res.card.spell && res.card.id === id) {
    spellNote = '不对。先放下，过一会儿再写。'
    spellDraftId = id
  }
  render()
}

function stepBrowse(delta) {
  if (!browse || !browse.words.length) return
  const next = browse.index + delta
  if (next < 0 || next >= browse.words.length) return
  browse.index = next
  render()
}

async function openBrowse() {
  if (!state || petActive() || addOpen) return
  const res = await window.desk.browse()
  if (!res || !res.ok) return
  feedback = null
  confirmDelete = false
  browse = { words: res.words || [], index: 0, query: '', view: 'list', editing: false, sort: 'deck', focusSearch: false }
  render()
}

function closeBrowse() {
  if (!browse) return
  browse = null
  render()
}

function toggleBrowse() {
  if (browse) closeBrowse()
  else openBrowse()
}

async function cancelSpell() {
  if (submitLock || !state || !state.card || !state.card.spell) return
  const res = await window.desk.cancelSpell(state.card.id)
  if (!res || !res.ok) return
  spellDraft = ''
  spellDraftId = null
  state = res
  revealed = true
  senses = res.senses || []
  previews = res.previews || null
  feedback = null
  confirmDelete = false
  render()
}

async function togglePin() {
  if (!state || petActive()) return
  const res = await window.desk.setAlwaysOnTop(!state.alwaysOnTop)
  if (!res || !res.ok) return
  state = res
  renderPin()
  renderFooter()
}

async function cycleDaily() {
  if (!state) return
  const order = [10, 20, 30, 50]
  const index = order.indexOf(state.dailyNew)
  const next = order[(index + 1) % order.length]
  const res = await window.desk.setDailyNew(next)
  if (!res || !res.ok) return
  const keepReveal = revealed && state.card && res.card && res.card.id === state.card.id && !res.card.spell
  state = res
  if (!keepReveal) resetCard()
  render()
}

async function moreNew() {
  const res = await window.desk.moreNew()
  if (!res || !res.ok) return
  resetCard()
  state = res
  render()
}

async function removeWord(id) {
  const res = await window.desk.deleteWord(id)
  if (!res || !res.ok) return
  resetCard()
  state = res
  if (browse) {
    const listed = await window.desk.browse()
    if (listed && listed.ok) browse.words = listed.words || []
    const list = filteredBrowse()
    if (browse.index >= list.length) browse.index = Math.max(0, list.length - 1)
  }
  render()
}

async function enterPet() {
  browse = null
  closeAdd()
  const res = await window.desk.setPet(true)
  if (res && res.ok) state = res
  document.documentElement.classList.add('pet')
  renderPetWord()
}

async function leavePet() {
  const res = await window.desk.setPet(false)
  if (res && res.ok) state = res
  document.documentElement.classList.remove('pet')
  render()
}

function openAdd() {
  if (!state || petActive()) return
  browse = null
  feedback = null
  addOpen = true
  editorMode = 'add'
  confirmDelete = false
  const pos = state.pos || ['n.', 'v.']
  draft = {
    word: '',
    phonetic: '',
    senses: [
      { pos: pos[0] || 'n.', zh: '' },
      { pos: pos[1] || 'v.', zh: '' }
    ]
  }
  render()
  renderEditor(true)
}

async function openEdit() {
  if (!state || !state.card || state.card.spell || feedback || petActive()) return
  const res = await window.desk.getWord(state.card.id)
  if (!res || !res.ok || !res.word) return
  addOpen = true
  editorMode = 'edit'
  confirmDelete = false
  draft = {
    id: res.word.id,
    word: res.word.word,
    phonetic: res.word.phonetic || '',
    custom: !!res.word.custom,
    senses: (res.word.senses || []).map((sense) => ({
      pos: sense.pos,
      zh: sense.zh,
      sentences: (sense.sentences || []).map((sentence) => ({ en: sentence.en || '', zh: sentence.zh || '' }))
    }))
  }
  if (!draft.senses.length) {
    const pos = (state.pos && state.pos[0]) || 'n.'
    draft.senses.push({ pos, zh: '', sentences: [] })
  }
  renderEditor(false)
}

async function openBrowseEdit(id) {
  if (!browse || !browse.editing || !state || petActive()) return
  const res = await window.desk.getWord(id)
  if (!res || !res.ok || !res.word) return
  addOpen = true
  editorMode = 'edit'
  confirmDelete = false
  draft = {
    id: res.word.id,
    word: res.word.word,
    phonetic: res.word.phonetic || '',
    custom: !!res.word.custom,
    senses: (res.word.senses || []).map((sense) => ({
      pos: sense.pos,
      zh: sense.zh,
      sentences: (sense.sentences || []).map((sentence) => ({ en: sentence.en || '', zh: sentence.zh || '' }))
    }))
  }
  if (!draft.senses.length) {
    const pos = (state.pos && state.pos[0]) || 'n.'
    draft.senses.push({ pos, zh: '', sentences: [] })
  }
  renderEditor(false)
}

function closeAdd() {
  const was = addOpen
  addOpen = false
  editorMode = 'add'
  draft = null
  adder.classList.add('hidden')
  adder.replaceChildren()
  if (!was || petActive() || feedback || !state || !state.card || !state.card.spell) return
  const input = stage.querySelector('.spell-input')
  if (input) input.focus()
}

function renderEditor(focusWord) {
  adder.classList.remove('hidden')
  adder.replaceChildren()
  const editing = editorMode === 'edit'
  adder.append(el('h2', null, editing ? '更改这个词' : '添加一个词'))
  const lead = editing
    ? (draft.custom
      ? '改的是你自己加的词。复习记录还留在原来的词上。'
      : '改动记在进度里，词表文件不会被改掉。复习记录还留在原来的词上。')
    : '至少写一条中文释义。词性可以有多条。'
  adder.append(el('p', 'lead', lead))

  adder.append(el('label', null, '英文'))
  const wordInput = el('input')
  wordInput.value = draft.word
  wordInput.autocomplete = 'off'
  wordInput.spellcheck = false
  wordInput.addEventListener('input', () => { draft.word = wordInput.value })
  adder.append(wordInput)

  adder.append(el('label', null, '音标，可以空着'))
  const phonInput = el('input')
  phonInput.value = draft.phonetic
  phonInput.autocomplete = 'off'
  phonInput.spellcheck = false
  phonInput.addEventListener('input', () => { draft.phonetic = phonInput.value })
  adder.append(phonInput)

  adder.append(el('label', null, '词性和释义'))
  const rows = el('div', 'rows')
  draft.senses.forEach((sense, index) => {
    const row = el('div', 'row')
    const select = el('select')
    ;(state.pos || []).forEach((pos) => {
      const option = el('option', null, pos)
      option.value = pos
      if (pos === sense.pos) option.selected = true
      select.append(option)
    })
    if (sense.pos && !(state.pos || []).includes(sense.pos)) {
      const option = el('option', null, sense.pos)
      option.value = sense.pos
      option.selected = true
      select.append(option)
    }
    select.addEventListener('change', () => { draft.senses[index].pos = select.value })
    const input = el('input')
    input.value = sense.zh
    input.placeholder = '中文释义'
    input.addEventListener('input', () => { draft.senses[index].zh = input.value })
    const remove = el('button', 'iconbtn', '×')
    remove.type = 'button'
    remove.title = '去掉这一条'
    remove.addEventListener('click', () => {
      if (draft.senses.length === 1) return
      draft.senses.splice(index, 1)
      renderEditor(false)
    })
    row.append(select, input, remove)
    rows.append(row)
    if (editing && browse && browse.editing) {
      if (!Array.isArray(sense.sentences)) sense.sentences = []
      sense.sentences.forEach((sentence, sentenceIndex) => {
        const sentenceRow = el('div', 'sentence-row')
        const en = el('input')
        en.value = sentence.en || ''
        en.placeholder = '这条词义的英文句子'
        en.addEventListener('input', () => { draft.senses[index].sentences[sentenceIndex].en = en.value })
        const zh = el('input')
        zh.value = sentence.zh || ''
        zh.placeholder = '中文，可以空着'
        zh.addEventListener('input', () => { draft.senses[index].sentences[sentenceIndex].zh = zh.value })
        const removeSentence = el('button', 'iconbtn', '×')
        removeSentence.type = 'button'
        removeSentence.title = '去掉这一句'
        removeSentence.addEventListener('click', () => {
          draft.senses[index].sentences.splice(sentenceIndex, 1)
          renderEditor(false)
        })
        sentenceRow.append(en, zh, removeSentence)
        rows.append(sentenceRow)
      })
      const addSentence = el('button', 'link', '给这条词义加例句')
      addSentence.type = 'button'
      addSentence.addEventListener('click', () => {
        draft.senses[index].sentences.push({ en: '', zh: '' })
        renderEditor(false)
      })
      rows.append(addSentence)
    }
  })
  adder.append(rows)

  const extra = el('button', 'link', '再加一条释义')
  extra.type = 'button'
  extra.addEventListener('click', () => {
    const pos = (state.pos && state.pos[0]) || 'n.'
    draft.senses.push({ pos, zh: '', sentences: [] })
    renderEditor(false)
  })
  adder.append(extra)

  const err = el('p', 'err', '')
  adder.append(err)

  const actions = el('div', 'adder-actions')
  const cancel = el('button', 'ghost', '取消')
  cancel.type = 'button'
  cancel.addEventListener('click', closeAdd)
  const save = el('button', 'primary', '保存')
  save.type = 'button'
  save.addEventListener('click', () => saveEditor(err))
  actions.append(cancel, save)
  adder.append(actions)
  if (focusWord) wordInput.focus()
  else {
    const inputs = adder.querySelectorAll('.row input')
    const last = inputs[inputs.length - 1]
    if (last) last.focus()
  }
}

async function saveEditor(err) {
  const editing = editorMode === 'edit'
  const editedId = draft && draft.id
  const res = editing
    ? await window.desk.updateWord(draft)
    : await window.desk.addWord(draft)
  if (!res || !res.ok) {
    err.textContent = (res && res.error) || '没有保存'
    return
  }
  const same = editing && state && state.card && draft.id === state.card.id
  const queuedNext = !!res.queuedNext
  closeAdd()
  if (same && revealed && res.senses && !(res.card && res.card.spell)) {
    senses = res.senses
    feedback = null
  } else if (!queuedNext) {
    resetCard()
  } else {
    feedback = null
  }
  confirmDelete = false
  state = res
  if (browse) {
    const listed = await window.desk.browse()
    if (listed && listed.ok) browse.words = listed.words || []
    if (editedId) {
      const at = filteredBrowse().findIndex((word) => word.id === editedId)
      if (at >= 0) browse.index = at
    }
  }
  render()
}

async function reloadIfIdle() {
  if (addOpen || revealed || feedback || browse || (state && state.card && state.card.spell)) return
  const res = await window.desk.load()
  if (!res || !res.ok || addOpen || revealed || feedback) return
  state = res
  if (typeof res.pet === 'boolean') {
    document.documentElement.classList.toggle('pet', res.pet)
  }
  render()
}

document.addEventListener('keydown', (event) => {
  if (!document.hasFocus()) return
  if (event.repeat) return
  if ((event.key === 'm' || event.key === 'M') && !event.ctrlKey && !event.metaKey && !event.altKey && !addOpen && !typingTarget(document.activeElement)) {
    event.preventDefault()
    if (petActive()) leavePet()
    else enterPet()
    return
  }
  if (petActive()) return
  if (!addOpen && !typingTarget(document.activeElement)) {
    if (event.key === 'a' || event.key === 'A') {
      event.preventDefault()
      openAdd()
      return
    }
    if (event.key === 'p' || event.key === 'P') {
      event.preventDefault()
      togglePin()
      return
    }
  }
  if (browse && !addOpen) {
    if (typingTarget(document.activeElement)) {
      if (event.key === 'Escape') {
        event.preventDefault()
        browse.focusSearch = false
        document.activeElement.blur()
        render()
      }
      return
    }
    const key = event.key.toLowerCase()
    if (key === 'f') {
      event.preventDefault()
      browse.focusSearch = true
      render()
    } else if (key === 'l' || key === 'c' || key === 's') {
      event.preventDefault()
      browse.view = key === 'l' ? 'list' : key === 'c' ? 'card' : 'sentence'
      browse.focusSearch = false
      render()
    } else if (key === 'v') {
      event.preventDefault()
      browse.sort = browse.sort === 'alpha' ? 'deck' : 'alpha'
      browse.focusSearch = false
      render()
    } else if (key === 'e') {
      event.preventDefault()
      browse.editing = !browse.editing
      browse.focusSearch = false
      if (!browse.editing && addOpen) closeAdd()
      render()
    } else if (key === 'g' && browse.editing) {
      event.preventDefault()
      const list = filteredBrowse()
      const item = list[Math.min(Math.max(browse.index, 0), Math.max(list.length - 1, 0))]
      if (item) openBrowseEdit(item.id)
    } else if ((browse.view === 'list' || browse.view === 'card') && (event.key === 'ArrowDown' || event.key === 'ArrowRight')) {
      event.preventDefault()
      stepBrowse(1)
    } else if ((browse.view === 'list' || browse.view === 'card') && (event.key === 'ArrowUp' || event.key === 'ArrowLeft')) {
      event.preventDefault()
      stepBrowse(-1)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      if (browse.editing) {
        browse.editing = false
        render()
      } else closeBrowse()
    } else if (event.key === 'b' || event.key === 'B') {
      event.preventDefault()
      closeBrowse()
    }
    return
  }
  const spelling = !!(state && state.card && state.card.spell)
  if (typingTarget(document.activeElement)) {
    if (addOpen && event.key === 'Escape') {
      event.preventDefault()
      closeAdd()
    } else if (addOpen && event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      const err = adder.querySelector('.err')
      if (err) saveEditor(err)
    } else if (!addOpen && spelling && event.key === 'Escape') {
      event.preventDefault()
      cancelSpell()
    } else if (!addOpen && spelling && event.key === 'Enter' && !event.isComposing) {
      event.preventDefault()
      submitSpell()
    }
    return
  }
  if (addOpen) {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeAdd()
    }
    return
  }
  if (feedback) {
    if (event.key === ' ' || event.key === 'Enter' || event.key === 'Escape') {
      event.preventDefault()
      dismissMiss()
    }
    return
  }
  if (spelling) {
    if (event.key === 'Escape') {
      event.preventDefault()
      cancelSpell()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      submitSpell()
    }
    return
  }
  if (event.key === 'b' || event.key === 'B') {
    event.preventDefault()
    toggleBrowse()
    return
  }
  if (!state || !state.card) {
    if (event.key === 'Enter' && state && state.unseen && state.deckSize) {
      event.preventDefault()
      moreNew()
    }
    return
  }
  if (event.key === ' ' || event.key === 'Enter') {
    event.preventDefault()
    if (!revealed) reveal()
    return
  }
  if (revealed && (event.key === '1' || event.key === '2' || event.key === '3' || event.key === '4' || event.key === '0')) {
    event.preventDefault()
    choose(event.key === '0' ? 0 : Number(event.key))
    return
  }
  if (event.key === 'e' || event.key === 'E') {
    event.preventDefault()
    openEdit()
    return
  }
  if (event.key === 'd' || event.key === 'D') {
    event.preventDefault()
    if (!confirmDelete) {
      confirmDelete = true
      render()
      return
    }
    removeWord(state.card.id)
  }
})

pinBtn.addEventListener('click', togglePin)
petBtn.addEventListener('click', enterPet)
expandBtn.addEventListener('click', leavePet)
browseBtn.addEventListener('click', () => {
  if (addOpen) closeAdd()
  toggleBrowse()
})
addBtn.addEventListener('click', () => {
  if (addOpen) closeAdd()
  else openAdd()
})
closeBtn.addEventListener('click', () => window.desk.hide())

if (!window.desk) {
  stage.textContent = '请双击 start.bat 打开。'
} else {
  window.desk.onRefresh(reloadIfIdle)
  window.desk.onMode((mode) => {
    const pet = !!(mode && mode.pet)
    document.documentElement.classList.toggle('pet', pet)
    if (pet) closeAdd()
    renderPetWord()
  })
  window.desk.load().then((res) => {
    state = res
    if (res && res.pet) document.documentElement.classList.add('pet')
    render()
  }).catch(() => {
    stage.textContent = '词库没有打开。'
  })
}
