'use strict'

const fs = require('fs')
const path = require('path')
const { POS } = require('../srs')

const POS_SET = new Set(POS)

function parse(text, fileLabel) {
  const seen = new Set()
  const words = []
  const lines = text.split(/\r?\n/)
  lines.forEach((line, index) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return
    const parts = trimmed.split('|')
    if (parts.length < 4) {
      throw new Error(fileLabel + ':' + (index + 1) + ' needs a word, a phonetic, and two senses')
    }
    const word = parts[0].trim()
    const phonetic = parts[1].trim()
    if (!word) throw new Error(fileLabel + ':' + (index + 1) + ' empty word')
    if (!phonetic) throw new Error('Missing phonetic: ' + word)
    const senses = parts.slice(2).map((chunk) => {
      const cut = chunk.indexOf(':')
      if (cut <= 0) throw new Error('Bad sense for ' + word + ': ' + chunk)
      const pos = chunk.slice(0, cut).trim()
      const zh = chunk.slice(cut + 1).trim()
      if (!POS_SET.has(pos)) throw new Error('Bad part of speech "' + pos + '" on ' + word)
      if (!zh) throw new Error('Empty meaning for ' + word)
      return { pos, zh }
    })
    if (senses.length < 2) throw new Error('Need at least two senses: ' + word)
    const id = word.toLowerCase()
    if (seen.has(id)) throw new Error('Duplicate word: ' + word)
    seen.add(id)
    words.push({ id, word, phonetic, senses })
  })
  return words
}

function listDeckFiles(dir) {
  const listPath = path.join(dir, 'decks.txt')
  if (!fs.existsSync(listPath)) return ['vocab-a.txt', 'vocab-b.txt']
  const names = []
  fs.readFileSync(listPath, 'utf8').split(/\r?\n/).forEach((line) => {
    const name = line.trim()
    if (!name || name.startsWith('#')) return
    if (!/^[\w.-]+\.txt$/.test(name) || name.toLowerCase() === 'decks.txt') {
      throw new Error('词表文件名不合法: ' + name)
    }
    names.push(name)
  })
  if (!names.length) throw new Error('decks.txt 里没有词表文件')
  return names
}

function loadFrom(dir) {
  const words = []
  const seen = new Set()
  listDeckFiles(dir).forEach((name) => {
    const full = path.join(dir, name)
    if (!fs.existsSync(full)) throw new Error('找不到词表: ' + name)
    parse(fs.readFileSync(full, 'utf8'), name).forEach((word) => {
      if (seen.has(word.id)) throw new Error('Duplicate word: ' + word.word)
      seen.add(word.id)
      words.push(word)
    })
  })
  return words
}

module.exports = { loadFrom }
