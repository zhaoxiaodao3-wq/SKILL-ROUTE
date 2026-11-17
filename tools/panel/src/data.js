import graph from '@routing'

export const GRAPH = graph

export function skillNode(s) {
  return {
    data: {
      text: s.name,
      id: s.id,
      kind: 'skill',
      desc: s.userDescription || s.systemDescription || '',
      path: s.path,
      triggers: s.triggers || [],
      tags: s.semanticTags || [],
      no: s.unsuitableConditions || [],
      ok: s.applicableConditions || [],
      risk: s.riskLevel || 'low',
      status: s.status || 'active',
    },
    children: [],
  }
}

export function buildTree(g = GRAPH) {
  const root = { data: { text: 'Skill 路由', id: '__root__', kind: 'root' }, children: [] }

  const buildCat = (c) => {
    const node = { data: { text: c.name, id: c.id, kind: 'cat' }, children: [] }
    for (const sub of g.categories.filter((x) => x.parentId === c.id)) {
      node.children.push(buildCat(sub))
    }
    for (const s of g.skills.filter((x) => x.categoryId === c.id)) {
      node.children.push(skillNode(s))
    }
    return node
  }

  for (const c of g.categories.filter((x) => !x.parentId)) root.children.push(buildCat(c))
  return root
}

/** 树 → 路由图（导出用） */
export function treeToGraph(tree) {
  const categories = []
  const skills = []

  const walk = (node, parentCatId) => {
    for (const child of node.children || []) {
      const d = child.data || {}
      if (d.kind === 'cat') {
        categories.push({ id: d.id, name: d.text, parentId: parentCatId || null })
        walk(child, d.id)
      } else if (d.kind === 'skill') {
        skills.push({
          id: d.id,
          name: d.text,
          categoryId: parentCatId,
          userDescription: d.desc || '',
          path: d.path || '',
          triggers: d.triggers || [],
          semanticTags: d.tags || [],
          applicableConditions: d.ok || [],
          unsuitableConditions: d.no || [],
          riskLevel: d.risk || 'low',
          status: d.status || 'active',
        })
      }
    }
  }
  walk(tree, null)
  return { version: GRAPH.version ?? 1, updatedAt: new Date().toISOString().slice(0, 10), categories, skills }
}

/** 分类 → 直接子项数量（画布徽标用：不能在渲染时读 node.children，那时子节点还没建） */
export function childCountMap(g = GRAPH) {
  const m = new Map()
  for (const c of g.categories) m.set(c.id, 0)
  for (const c of g.categories) {
    if (c.parentId && m.has(c.parentId)) m.set(c.parentId, m.get(c.parentId) + 1)
  }
  for (const s of g.skills) {
    if (m.has(s.categoryId)) m.set(s.categoryId, m.get(s.categoryId) + 1)
  }
  return m
}

/** 触发词相同的 skill 对数，用于画布上的 ⚠ 徽标 */
export function conflictMap(g = GRAPH) {
  const byTrigger = new Map()
  for (const s of g.skills) {
    for (const t of s.triggers || []) {
      const k = String(t).trim().toLowerCase()
      if (!k) continue
      if (!byTrigger.has(k)) byTrigger.set(k, new Set())
      byTrigger.get(k).add(s.id)
    }
  }
  const out = new Map()
  for (const [, set] of byTrigger) {
    const ids = [...set]
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        out.set(ids[i], (out.get(ids[i]) || 0) + 1)
        out.set(ids[j], (out.get(ids[j]) || 0) + 1)
      }
    }
  }
  return out
}
