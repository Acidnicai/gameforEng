'use strict'

const POS = ['n.', 'v.', 'adj.', 'adv.', 'prep.', 'conj.', 'pron.', 'art.', 'num.', 'aux.', 'phrase']
const MIN_EASE = 1.3
const MAX_EASE = 3
const DAY = 24 * 60 * 60 * 1000
const MINUTE = 60 * 1000

function clampEase(n) {
  const clamped = Math.min(MAX_EASE, Math.max(MIN_EASE, n))
  return Math.round(clamped * 100) / 100
}

function roundDays(n) {
  return Math.round(n * 100) / 100
}

function freshCard() {
  return {
    ease: 2.5,
    intervalDays: 0,
    reps: 0,
    lapses: 0,
    due: 0,
    reviews: 0,
    introducedOn: null
  }
}

function schedule(card, rating, now) {
  const c = {
    ease: typeof card.ease === 'number' ? card.ease : 2.5,
    intervalDays: typeof card.intervalDays === 'number' ? card.intervalDays : 0,
    reps: card.reps || 0,
    lapses: card.lapses || 0,
    due: card.due || 0,
    reviews: (card.reviews || 0) + 1,
    introducedOn: card.introducedOn || null
  }

  if (rating === 1) {
    c.lapses += 1
    c.reps = 0
    c.intervalDays = 0
    c.ease = clampEase(c.ease - 0.2)
    c.due = now
    return c
  }

  if (rating === 2) {
    c.ease = clampEase(c.ease - 0.15)
    if (c.reps <= 0) {
      c.intervalDays = 0
      c.due = now + 10 * MINUTE
    } else {
      c.intervalDays = roundDays(Math.max(1, c.intervalDays * 1.2))
      c.due = now + c.intervalDays * DAY
    }
    return c
  }

  if (rating === 3) {
    if (c.reps <= 0) {
      c.reps = 1
      c.intervalDays = 1
    } else {
      c.reps += 1
      c.intervalDays = roundDays(Math.max(c.intervalDays * c.ease, 1))
    }
    c.due = now + c.intervalDays * DAY
    return c
  }

  if (rating === 4) {
    c.ease = clampEase(c.ease + 0.15)
    if (c.reps <= 0) {
      c.reps = 2
      c.intervalDays = 4
    } else {
      c.reps += 1
      c.intervalDays = roundDays(Math.max(c.intervalDays * c.ease * 1.3, 1))
    }
    c.due = now + c.intervalDays * DAY
    return c
  }

  throw new Error('bad rating')
}

function applyRating(card, rating, now, queueLength) {
  const next = schedule(card, rating, now)
  if (rating === 1 && queueLength <= 1) next.due = now + 10 * MINUTE
  return next
}

function humanizeGap(ms) {
  if (ms < 90 * 1000) return '马上再看'
  if (ms < 55 * MINUTE) return Math.max(1, Math.round(ms / MINUTE)) + ' 分钟后'
  if (ms < 20 * 60 * MINUTE) return Math.max(1, Math.round(ms / (60 * MINUTE))) + ' 小时后'
  const days = Math.max(1, Math.round(ms / DAY))
  return days + ' 天后'
}

function previewsFor(card, now, queueLength) {
  const base = card || freshCard()
  const out = {}
  for (const rating of [1, 2, 3, 4]) {
    const next = applyRating(base, rating, now, queueLength)
    out[String(rating)] = humanizeGap(next.due - now)
  }
  return out
}

module.exports = {
  POS,
  DAY,
  freshCard,
  schedule,
  applyRating,
  humanizeGap,
  previewsFor
}
