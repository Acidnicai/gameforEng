'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desk', {
  load: () => ipcRenderer.invoke('desk:load'),
  reveal: (id) => ipcRenderer.invoke('desk:reveal', id),
  rate: (id, rating) => ipcRenderer.invoke('desk:rate', id, rating),
  mark: (id, rating) => ipcRenderer.invoke('desk:mark', id, rating),
  spell: (id, typed) => ipcRenderer.invoke('desk:spell', id, typed),
  cancelSpell: (id) => ipcRenderer.invoke('desk:cancel-spell', id),
  browse: () => ipcRenderer.invoke('desk:browse'),
  addWord: (word) => ipcRenderer.invoke('desk:add-word', word),
  updateWord: (word) => ipcRenderer.invoke('desk:update-word', word),
  getWord: (id) => ipcRenderer.invoke('desk:word', id),
  deleteWord: (id) => ipcRenderer.invoke('desk:delete-word', id),
  setAlwaysOnTop: (on) => ipcRenderer.invoke('desk:pin', on),
  setPet: (on) => ipcRenderer.invoke('desk:pet', on),
  setDailyNew: (n) => ipcRenderer.invoke('desk:daily-new', n),
  moreNew: () => ipcRenderer.invoke('desk:more-new'),
  hide: () => ipcRenderer.invoke('desk:hide'),
  onRefresh: (cb) => {
    ipcRenderer.on('desk:refresh', () => cb())
  },
  onMode: (cb) => {
    ipcRenderer.on('desk:mode', (_event, mode) => cb(mode))
  }
})
