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
  petWord.textContent = card ? card.word : ''
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
  const daily = el('button', 'link', '每日新词 ' + state.dailyNew)
  daily.type = 'button'
  daily.title = '点击切换 10、20、30、50'
  daily.addEventListener('click', cycleDaily)
  footer.append(daily, dot(), el('span', null, '按键只在本窗口有效'))
}

function renderDone() {
  const unseen = state.unseen || 0
  const title = unseen ? '这一批先到这里' : '这一轮先到这里'
  stage.append(el('h1', 'rest-title', title))
  const copy = unseen
    ? '还剩 ' + unseen + ' 个新词。明天会再来一些，也可以现在再看 10 个。'
    : '到时间的词会自己回来。可以收成桌宠，或从右上角收到托盘。'
  stage.append(el('p', 'rest-copy', copy))
  const actions = el('div', 'rest-actions')
  if (unseen) {
    const more = el('button', 'primary', '再看 10 个')
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
  const edit = el('button', 'link', '更改')
  edit.type = 'button'
  edit.addEventListener('click', openEdit)
  const del = el('button', 'link danger', confirmDelete ? '确认删除' : '删除')
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

function renderStage() {
  stage.replaceChildren()
  if (!state) {
    stage.append(el('p', 'hint', '正在打开词库…'))
    return
  }
  if (!state.card) {
    confirmDelete = false
    renderDone()
    return
  }
  const card = state.card
  const word = el('h1', card.word.length > 14 ? 'word long' : 'word', card.word)
  stage.append(word)
  if (card.phonetic) stage.append(el('p', 'phonetic', card.phonetic))
  stage.append(el('p', 'count', card.senseCount + ' 个义项'))
  if (!revealed) {
    stage.append(el('p', 'prompt', '先回忆这些义项'))
    const button = el('button', 'reveal', '显示释义')
    button.type = 'button'
    button.addEventListener('click', reveal)
    stage.append(button, el('p', 'hint', '空格'))
    cardActions(card)
    return
  }
  const list = el('div', 'senses')
  ;(senses || []).forEach((sense) => {
    const row = el('div', 'sense')
    row.append(el('span', 'pos', sense.pos), el('span', 'zh', sense.zh))
    list.append(row)
  })
  stage.append(list)
  const rates = el('div', 'rates')
  ;[
    ['1', '忘了'],
    ['2', '模糊'],
    ['3', '记得'],
    ['4', '轻松']
  ].forEach(([key, label]) => {
    const button = el('button', 'rate')
    button.type = 'button'
    button.append(el('span', 'rate-name', key + '  ' + label))
    button.append(el('small', null, (previews && previews[key]) || ''))
    button.addEventListener('click', () => rate(Number(key)))
    rates.append(button)
  })
  stage.append(rates)
  cardActions(card)
}

function renderPin() {
  const on = !!(state && state.alwaysOnTop)
  pinBtn.classList.toggle('on', on)
  pinBtn.setAttribute('aria-pressed', on ? 'true' : 'false')
  pinBtn.textContent = on ? '已置顶' : '置顶'
}

function render() {
  renderStage()
  renderFooter()
  renderPin()
  renderPetWord()
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
  if (!state || !state.card || revealed || addOpen || petActive()) return
  const res = await window.desk.reveal(state.card.id)
  if (!res || !res.ok) return
  revealed = true
  senses = res.senses
  previews = res.previews
  renderStage()
}

async function rate(n) {
  if (!revealed || addOpen || petActive() || !state || !state.card) return
  const res = await window.desk.rate(state.card.id, n)
  if (!res || !res.ok) return
  revealed = false
  senses = null
  previews = null
  confirmDelete = false
  state = res
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
  const keepReveal = revealed && state.card && res.card && res.card.id === state.card.id
  state = res
  if (!keepReveal) {
    revealed = false
    senses = null
    previews = null
    confirmDelete = false
  }
  render()
}

async function moreNew() {
  const res = await window.desk.moreNew()
  if (!res || !res.ok) return
  revealed = false
  senses = null
  previews = null
  confirmDelete = false
  state = res
  render()
}

async function removeWord(id) {
  const res = await window.desk.deleteWord(id)
  if (!res || !res.ok) return
  revealed = false
  senses = null
  previews = null
  confirmDelete = false
  state = res
  render()
}

async function enterPet() {
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
  renderEditor(true)
}

async function openEdit() {
  if (!state || !state.card || petActive()) return
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
    senses: (res.word.senses || []).map((sense) => ({ pos: sense.pos, zh: sense.zh }))
  }
  if (!draft.senses.length) {
    const pos = (state.pos && state.pos[0]) || 'n.'
    draft.senses.push({ pos, zh: '' })
  }
  renderEditor(false)
}

function closeAdd() {
  addOpen = false
  editorMode = 'add'
  draft = null
  adder.classList.add('hidden')
  adder.replaceChildren()
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
  })
  adder.append(rows)

  const extra = el('button', 'link', '再加一条释义')
  extra.type = 'button'
  extra.addEventListener('click', () => {
    const pos = (state.pos && state.pos[0]) || 'n.'
    draft.senses.push({ pos, zh: '' })
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
  if (same && revealed && res.senses) {
    senses = res.senses
  } else if (!queuedNext) {
    revealed = false
    senses = null
    previews = null
  }
  confirmDelete = false
  state = res
  render()
}

async function reloadIfIdle() {
  if (addOpen || revealed) return
  const res = await window.desk.load()
  if (!res || !res.ok || addOpen || revealed) return
  state = res
  if (typeof res.pet === 'boolean') {
    document.documentElement.classList.toggle('pet', res.pet)
  }
  render()
}

document.addEventListener('keydown', (event) => {
  if (!document.hasFocus() || petActive()) return
  if (typingTarget(document.activeElement)) {
    if (addOpen && event.key === 'Escape') {
      event.preventDefault()
      closeAdd()
    } else if (addOpen && event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      const err = adder.querySelector('.err')
      if (err) saveEditor(err)
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
  if (event.key === ' ' || event.key === 'Enter') {
    event.preventDefault()
    if (!revealed) reveal()
    return
  }
  if (revealed && (event.key === '1' || event.key === '2' || event.key === '3' || event.key === '4')) {
    event.preventDefault()
    rate(Number(event.key))
    return
  }
  if (event.key === 'p' || event.key === 'P') togglePin()
})

pinBtn.addEventListener('click', togglePin)
petBtn.addEventListener('click', enterPet)
expandBtn.addEventListener('click', leavePet)
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
