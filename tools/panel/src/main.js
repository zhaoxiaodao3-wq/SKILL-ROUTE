import MindMap from 'simple-mind-map'
import Drag from 'simple-mind-map/src/plugins/Drag.js'
import Search from 'simple-mind-map/src/plugins/Search.js'
import 'simple-mind-map/dist/simpleMindMap.esm.css'
import './style.css'

import { GRAPH, buildTree, treeToGraph, conflictMap, childCountMap } from './data.js'

// ---------------- 错误可视化（原型阶段，出错直接显示在页面上） ----------------
const errBox = document.getElementById('err')
function showErr(e) {
  errBox.classList.remove('hidden')
  errBox.textContent += `${e && (e.stack || e.message) || e}\n`
}
window.addEventListener('error', (e) => showErr(e.error || e.message))
window.addEventListener('unhandledrejection', (e) => showErr(e.reason))

const CONFLICTS = conflictMap(GRAPH)
const CHILD_COUNT = childCountMap(GRAPH)

// ---------------- 自定义节点 ----------------
function customNodeContent(node) {
  const d = node.getData()
  const el = document.createElement('div')
  el.className = `hm-node ${d.kind || ''}`

  const name = document.createElement('span')
  name.className = 'hm-name'
  name.textContent = d.text || ''
  el.append(name)

  if (d.kind === 'cat') {
    const b = document.createElement('span')
    b.className = 'hm-badge'
    b.textContent = `${CHILD_COUNT.get(d.id) ?? 0} 项`
    el.append(b)
  } else if (d.kind === 'skill') {
    const b = document.createElement('span')
    b.className = 'hm-badge'
    b.textContent = `${(d.triggers || []).length} 词`
    el.append(b)

    const c = CONFLICTS.get(d.id)
    if (c) {
      const w = document.createElement('span')
      w.className = 'hm-warn'
      w.textContent = `⚠${c}`
      el.append(w)
    }
  }

  return el
}

// ---------------- 初始化 ----------------
const stage = document.getElementById('stage')

function create(extra = {}) {
  return new MindMap({
    el: stage,
    data: buildTree(GRAPH),
    layout: 'logicalStructure',
    theme: 'default',
    isUseCustomNodeContent: true,
    customCreateNodeContent: customNodeContent,
    selectNewNode: false,
    defaultInsertSecondLevelNodeText: '新分类',
    defaultInsertBelowSecondLevelNodeText: '新 skill',
    ...extra,
  })
}

let mindMap
try {
  mindMap = create()
} catch (e) {
  showErr(e)
  throw e
}

// 插件必须在实例创建后手动挂载（构造参数里的 plugins 不是这个库的 API）
for (const p of [Drag, Search]) {
  try { mindMap.addPlugin(p) } catch (e) { showErr(e) }
}

// 自检标记：便于无头浏览器确认插件真的挂上了
document.body.dataset.search = mindMap.search ? 'ok' : 'missing'
document.body.dataset.drag = mindMap.drag ? 'ok' : 'missing'

setTimeout(() => {
  try { mindMap.view.fit() } catch (e) { showErr(e) }
}, 80)

// ---------------- 选中与抽屉 ----------------
const drawer = document.getElementById('drawer')
let currentId = null

function findByDataId(id) {
  const list = mindMap.renderer?.nodeList || []
  return list.find((n) => n.getData('id') === id) || null
}

function selectById(id) {
  const node = findByDataId(id)
  if (!node) return null
  try { mindMap.renderer.setNodeActive(node, true) } catch { /* 忽略 */ }
  try { mindMap.view.centerNode(node) } catch { /* 忽略 */ }
  return node
}

function refresh() {
  const data = mindMap.getData()
  try {
    mindMap.setData(data)
  } catch (e) {
    showErr(e)
  }
  if (currentId) selectById(currentId)
}

function openDrawer(node) {
  const d = node.getData()
  currentId = d.id
  drawer.classList.remove('hidden')

  if (d.kind !== 'skill') {
    drawer.innerHTML = `
      <h2>${escapeHtml(d.text || '')}</h2>
      <div class="kind">${d.kind === 'cat' ? '分类' : '根节点'}</div>
      <div class="field"><label>名称</label><input id="f-name" value="${escapeHtml(d.text || '')}"></div>
      <div class="field"><label>操作</label>
        <div style="color:#79839a;font-size:12px">Tab 加子级 · Enter 加同级 · Delete 删除 · 拖拽可改归属</div>
      </div>`
    drawer.querySelector('#f-name').onchange = (e) => {
      try { mindMap.execCommand('SET_NODE_TEXT', node, e.target.value) } catch (err) { showErr(err) }
    }
    return
  }

  drawer.innerHTML = `
    <h2>${escapeHtml(d.text || '')}</h2>
    <div class="kind">skill · ${escapeHtml(d.id || '')} · 风险 ${escapeHtml(d.risk || 'low')}</div>
    <div class="field"><label>名称</label><input id="f-name" value="${escapeHtml(d.text || '')}"></div>
    <div class="field"><label>描述</label><textarea id="f-desc">${escapeHtml(d.desc || '')}</textarea></div>
    <div class="field"><label>触发词（回车加，× 删）</label>
      <div class="chips" id="chips">
        ${(d.triggers || []).map((t, i) => `<span class="chip">${escapeHtml(t)}<button data-del="${i}">×</button></span>`).join('')}
        <span class="chip add"><input id="f-new" placeholder="+ 触发词"></span>
      </div>
    </div>
    <div class="field"><label>不适用（命中即否决）</label>
      <ul style="margin:0;padding-left:16px;color:#79839a;font-size:12px">
        ${(d.no || []).map((x) => `<li>${escapeHtml(x)}</li>`).join('') || '<li>（未设置）</li>'}
      </ul>
    </div>`

  const data = node.nodeData.data

  drawer.querySelector('#f-name').onchange = (e) => {
    try { mindMap.execCommand('SET_NODE_TEXT', node, e.target.value) } catch (err) { showErr(err) }
  }
  drawer.querySelector('#f-desc').onchange = (e) => {
    data.desc = e.target.value
    refresh()
  }
  drawer.querySelector('#f-new').onkeydown = (e) => {
    if (e.key !== 'Enter') return
    const v = e.target.value.trim()
    if (!v) return
    data.triggers = [...(data.triggers || []), v]
    refresh()
    const n2 = findByDataId(currentId)
    if (n2) openDrawer(n2)
  }
  drawer.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = () => {
      data.triggers.splice(Number(b.dataset.del), 1)
      refresh()
      const n2 = findByDataId(currentId)
      if (n2) openDrawer(n2)
    }
  })
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

// ---------------- 事件 ----------------
mindMap.on('node_click', (node) => openDrawer(node))
mindMap.on('node_active', (node) => { if (node) openDrawer(node) })
mindMap.on('draw_click', () => { drawer.classList.add('hidden'); currentId = null })

// ---------------- 顶栏 ----------------
document.getElementById('btn-fit').onclick = () => {
  try { mindMap.view.fit() } catch (e) { showErr(e) }
}

const searchInput = document.getElementById('search')
searchInput.onkeydown = (e) => {
  if (e.key !== 'Enter') return
  const q = searchInput.value.trim()
  if (!q) return
  if (!mindMap.search) return showErr('搜索插件未加载')
  try { mindMap.search.search(q) } catch (err) { showErr(err) }
}

// 支持 ?q=xxx 直接带搜索词打开（方便分享/自动化检查）
const initialQ = new URLSearchParams(location.search).get('q')
if (initialQ) {
  searchInput.value = initialQ
  setTimeout(() => {
    try { mindMap.search.search(initialQ) } catch (e) { showErr(e) }
  }, 300)
}

document.getElementById('btn-export').onclick = () => {
  const graph = treeToGraph(mindMap.getData())
  const blob = new Blob([JSON.stringify(graph, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'graph.json'
  a.click()
  URL.revokeObjectURL(a.href)
}

// ---------------- 试一句 ----------------
const testInput = document.getElementById('test')
const resultsBox = document.getElementById('results')

function score(skill, text) {
  const t = String(text).toLowerCase()
  if (!t.trim()) return { score: 0, reason: '' }
  const L = (x) => String(x).toLowerCase()
  const no = (skill.unsuitableConditions || []).filter((x) => L(x) && t.includes(L(x)))
  if (no.length) return { score: 0, reason: `命中不适用：${no.join(' / ')}` }
  const hits = (skill.triggers || []).filter((x) => t.includes(L(x)))
  const tags = (skill.semanticTags || []).filter((x) => t.includes(L(x)))
  return {
    score: Math.min(1, hits.length + tags.length * 0.2),
    reason: hits.length ? `触发词：${hits.join(' / ')}` : tags.length ? `语义标签：${tags.join(' / ')}` : '',
  }
}

testInput.oninput = () => {
  const q = testInput.value
  resultsBox.replaceChildren()
  if (!q.trim()) return

  const rows = GRAPH.skills
    .map((s) => ({ s, ...score(s, q) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)

  if (!rows.length) {
    const span = document.createElement('span')
    span.className = 'hint'
    span.textContent = '无命中 —— 这个词还没人认领，可以给合适的 skill 加触发词'
    resultsBox.append(span)
    return
  }

  for (const r of rows.slice(0, 4)) {
    const b = document.createElement('button')
    b.className = 'result'
    b.innerHTML = `<b>${escapeHtml(r.s.name)}</b> ${r.score.toFixed(2)}<span class="why">${escapeHtml(r.reason)}</span>`
    b.onclick = () => { selectById(r.s.id) }
    resultsBox.append(b)
  }
}
