#!/usr/bin/env node
/**
 * harness 网关：面板的唯一写入口，项目的只读数据源。
 *
 *   node server.mjs --repo <仓库路径> [--port 7001] [--branch main] [--no-push] [--token xxx]
 *
 * 端点：
 *   GET  /api/graph   -> { graph, sha }
 *   PUT  /api/graph   -> 校验 + commit(+push)，{ graph, sha }；sha 不匹配 409
 *   GET  /api/bundle  -> { sha, graph, skillsIndex }（带 ETag）
 *   GET  /install     -> 新机器装技能包的脚本（bash / powershell）
 *   POST /api/ai      -> 占位（501），密钥将来只在服务端
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ---------------- 参数 ----------------
function arg(name, fallback = '') {
  const i = process.argv.indexOf(name)
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : fallback
}
const REPO = path.resolve(arg('--repo', path.resolve(__dirname, '../..')))
const PORT = Number(arg('--port', '7001'))
const BRANCH = arg('--branch', 'main')
const PUSH = !process.argv.includes('--no-push')
const TOKEN = arg('--token', process.env.HARNESS_TOKEN || '')
const GRAPH_FILE = path.join(REPO, 'routing', 'graph.json')
const MAX_BODY = 4 * 1024 * 1024

// ---------------- git ----------------
function git(args, opts = {}) {
  return execFileSync('git', args, {
    cwd: REPO,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  }).trim()
}
const headSha = () => git(['rev-parse', 'HEAD'])

// ---------------- 校验 ----------------
function validateGraph(graph) {
  const errors = []
  const warnings = []

  if (!graph || typeof graph !== 'object' || Array.isArray(graph)) {
    return { errors: ['graph 必须是对象'], warnings }
  }
  if (!Array.isArray(graph.categories)) errors.push('categories 必须是数组')
  if (!Array.isArray(graph.skills)) errors.push('skills 必须是数组')
  if (errors.length) return { errors, warnings }

  const catIds = new Set()
  const byId = new Map()
  for (const c of graph.categories) {
    if (!c || typeof c.id !== 'string' || !c.id.trim()) {
      errors.push(`分类缺少 id：${JSON.stringify(c).slice(0, 60)}`)
      continue
    }
    if (catIds.has(c.id)) errors.push(`分类 id 重复：${c.id}`)
    catIds.add(c.id)
    byId.set(c.id, c)
    if (!c.name || !String(c.name).trim()) errors.push(`分类 ${c.id} 缺少 name`)
  }

  for (const c of graph.categories) {
    if (!c || !c.id) continue
    if (c.parentId && !catIds.has(c.parentId)) errors.push(`分类 ${c.id} 的 parentId 不存在：${c.parentId}`)
    let cur = c
    let guard = 0
    while (cur && cur.parentId) {
      if (++guard > 100) { errors.push(`分类 ${c.id} 的 parentId 形成环`); break }
      const parent = byId.get(cur.parentId)
      if (!parent) break
      if (parent.id === c.id) { errors.push(`分类 ${c.id} 的 parentId 形成环`); break }
      cur = parent
    }
  }

  const skillIds = new Set()
  const triggerOwner = new Map()
  for (const s of graph.skills) {
    if (!s || typeof s.id !== 'string' || !s.id.trim()) {
      errors.push(`skill 缺少 id：${JSON.stringify(s).slice(0, 60)}`)
      continue
    }
    if (skillIds.has(s.id)) errors.push(`skill id 重复：${s.id}`)
    skillIds.add(s.id)

    if (!s.name || !String(s.name).trim()) errors.push(`skill ${s.id} 缺少 name`)
    if (!s.categoryId || !catIds.has(s.categoryId)) errors.push(`skill ${s.id} 的分类不存在：${s.categoryId}`)

    if (!Array.isArray(s.triggers) || s.triggers.filter((t) => String(t).trim()).length === 0) {
      errors.push(`skill ${s.id} 至少需要一个触发词`)
    }

    if (typeof s.path !== 'string' || !s.path.startsWith('../skills/')) {
      errors.push(`skill ${s.id} 的 path 必须是 ../skills/<目录>`)
    } else {
      const dir = path.resolve(path.dirname(GRAPH_FILE), s.path)
      if (!fs.existsSync(dir)) {
        errors.push(`skill ${s.id} 的目录不存在：${path.relative(REPO, dir)}`)
      } else if (!fs.existsSync(path.join(dir, 'SKILL.md'))) {
        errors.push(`skill ${s.id} 的目录里没有 SKILL.md：${path.relative(REPO, dir)}`)
      }
    }

    for (const t of s.triggers || []) {
      const k = String(t).trim().toLowerCase()
      if (!k) continue
      if (!triggerOwner.has(k)) triggerOwner.set(k, new Set())
      triggerOwner.get(k).add(s.id)
    }
  }

  for (const [trigger, owners] of triggerOwner) {
    if (owners.size > 1) warnings.push(`触发词「${trigger}」被多个 skill 共用：${[...owners].join(', ')}`)
  }

  return { errors, warnings }
}

// ---------------- HTTP 小工具 ----------------
const json = (res, code, obj, extra = {}) => {
  const body = JSON.stringify(obj, null, 2)
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...extra,
  })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new Error('请求体过大（>4MB）'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch (e) {
        reject(new Error(`JSON 解析失败：${e.message}`))
      }
    })
    req.on('error', reject)
  })
}

function cors(req, res) {
  const origin = req.headers.origin
  if (origin) {
    res.setHeader('access-control-allow-origin', origin)
    res.setHeader('access-control-allow-methods', 'GET,PUT,POST,OPTIONS')
    res.setHeader('access-control-allow-headers', 'content-type,authorization')
    res.setHeader('vary', 'origin')
  }
}

function authed(req) {
  if (!TOKEN) return true
  const h = req.headers.authorization || ''
  return h === `Bearer ${TOKEN}`
}

// ---------------- 路由 ----------------
const server = http.createServer(async (req, res) => {
  cors(req, res)
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    return res.end()
  }

  const url = new URL(req.url, 'http://localhost')
  const route = url.pathname

  try {
    if (route === '/health') return json(res, 200, { ok: true, repo: REPO, branch: BRANCH })

    if (route === '/api/graph' && req.method === 'GET') {
      const graph = JSON.parse(fs.readFileSync(GRAPH_FILE, 'utf8'))
      return json(res, 200, { graph, sha: headSha() })
    }

    if (route === '/api/bundle' && req.method === 'GET') {
      const graph = JSON.parse(fs.readFileSync(GRAPH_FILE, 'utf8'))
      const sha = headSha()
      const payload = {
        sha,
        generatedAt: new Date().toISOString(),
        graph,
        skillsIndex: (graph.skills || []).map((s) => ({
          id: s.id,
          name: s.name,
          path: s.path,
          triggers: s.triggers || [],
          antiTriggers: s.antiTriggers || [],
          tags: s.tags || [],
          status: s.status || 'active',
        })),
      }
      if (req.headers['if-none-match'] === sha) {
        res.writeHead(304)
        return res.end()
      }
      return json(res, 200, payload, { etag: sha })
    }

    if (route === '/api/graph' && req.method === 'PUT') {
      if (!authed(req)) return json(res, 401, { errors: ['未授权'] })

      const body = await readBody(req)
      const current = headSha()
      if (body.sha && body.sha !== current) {
        return json(res, 409, {
          errors: ['仓库已被更新，请先重新加载'],
          sha: current,
        })
      }

      const { errors, warnings } = validateGraph(body.graph)
      if (errors.length) return json(res, 400, { errors, warnings })

      const next = JSON.stringify(body.graph, null, 2) + '\n'
      const before = fs.readFileSync(GRAPH_FILE, 'utf8')
      if (before === next) return json(res, 200, { ok: true, sha: current, unchanged: true, warnings })

      fs.writeFileSync(GRAPH_FILE, next, 'utf8')

      const skillCount = body.graph.skills.length
      const catCount = body.graph.categories.length
      const msg = `routing: 更新路由图（${skillCount} 个 skill / ${catCount} 个分类）`

      try {
        git(['add', 'routing/graph.json'])
        git(['commit', '-m', msg])
        if (PUSH) git(['push', 'origin', `HEAD:${BRANCH}`])
      } catch (e) {
        // 提交失败时回滚工作区文件，避免留下脏状态
        try { fs.writeFileSync(GRAPH_FILE, before, 'utf8') } catch { /* 忽略 */ }
        return json(res, 500, { errors: [`git 操作失败：${(e.stderr || e.message).toString().trim()}`] })
      }

      return json(res, 200, { ok: true, sha: headSha(), pushed: PUSH, warnings })
    }

    if (route === '/install' || route === '/install.sh') {
      const script = `#!/bin/sh
set -eu
REPO="${process.env.HARNESS_REPO_URL || 'https://github.com/zhaoxiaodao3-wq/SKILL-ROUTE.git'}"
TMP="$(mktemp -d)"
echo "cloning $REPO"
git clone --depth 1 "$REPO" "$TMP/skill-route"
mkdir -p "$HOME/.agents/skills"
cp -R "$TMP/skill-route/skills/." "$HOME/.agents/skills/"
rm -rf "$TMP"
echo "已安装到 ~/.agents/skills："
ls "$HOME/.agents/skills"
`
      res.writeHead(200, { 'content-type': 'text/x-shellscript; charset=utf-8' })
      return res.end(script)
    }

    if (route === '/install.ps1') {
      const script = `$ErrorActionPreference = 'Stop'
$repo = '${process.env.HARNESS_REPO_URL || 'https://github.com/zhaoxiaodao3-wq/SKILL-ROUTE.git'}'
$tmp = Join-Path $env:TEMP ("skill-route-" + [guid]::NewGuid().ToString('N'))
git clone --depth 1 $repo $tmp
$dest = Join-Path $HOME '.agents\\skills'
New-Item -ItemType Directory -Force $dest | Out-Null
Copy-Item (Join-Path $tmp 'skills\\*') $dest -Recurse -Force
Remove-Item $tmp -Recurse -Force
Write-Host "已安装到 $dest"
Get-ChildItem $dest | Select-Object -ExpandProperty Name
`
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      return res.end(script)
    }

    if (route === '/api/ai' && req.method === 'POST') {
      return json(res, 501, { errors: ['AI 代理尚未实现（密钥只在服务端）'] })
    }

    return json(res, 404, { errors: [`未知端点：${req.method} ${route}`] })
  } catch (e) {
    return json(res, 500, { errors: [String(e.message || e)] })
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`harness gateway  http://127.0.0.1:${PORT}`)
  console.log(`  repo:   ${REPO}`)
  console.log(`  branch: ${BRANCH}${PUSH ? '' : '（--no-push）'}`)
  console.log(`  token:  ${TOKEN ? '已启用' : '未设置（仅建议本机使用）'}`)
})
