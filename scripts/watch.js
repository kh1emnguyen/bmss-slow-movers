#!/usr/bin/env node
/**
 * watch.js  —  auto-commit src/ changes to main
 * ─────────────────────────────────────────────
 * Run with:  npm run watch
 *
 * Watches src/ for file saves, debounces 3 s, then runs:
 *   bash scripts/git-sync.sh push "auto: <file> <time>"
 *
 * The post-commit hook (scripts/post-commit.sh) picks up every new commit
 * on main and immediately builds + deploys to gh-pages.
 *
 * Set up once with:  npm run setup
 */

import chokidar from 'chokidar'
import { execSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT      = path.resolve(__dirname, '..')

const DEBOUNCE_MS = 3000          // wait this long after last save before committing
const WATCH_DIRS  = ['src']       // relative to repo root

// ── state ────────────────────────────────────────────────────────────────────
let timer    = null
let lastFile = ''
let busy     = false              // prevent overlapping pushes

// ── helpers ───────────────────────────────────────────────────────────────────
function pad(n) { return String(n).padStart(2, '0') }

function timestamp() {
  const d = new Date()
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function push(file) {
  if (busy) {
    console.log('   ⏳ push already in progress — skipping')
    return
  }
  busy = true
  const rel = path.relative(ROOT, file)
  const msg = `auto: ${rel} @ ${timestamp()}`

  console.log(`\n⚡  ${rel}`)
  console.log(`    committing → "${msg}"`)

  try {
    execSync(`bash scripts/git-sync.sh push "${msg}"`, {
      cwd:   ROOT,
      stdio: 'inherit',
      shell: true,
    })
    console.log(`    ✓ pushed  (post-commit hook will deploy)\n`)
  } catch {
    console.error(`    ✗ push failed — check output above\n`)
  } finally {
    busy = false
  }
}

// ── watcher ───────────────────────────────────────────────────────────────────
const watcher = chokidar.watch(
  WATCH_DIRS.map(d => path.join(ROOT, d)),
  {
    ignoreInitial: true,
    ignored:       /(node_modules|\.git|dist)/,
    persistent:    true,
  }
)

watcher.on('all', (event, filePath) => {
  if (!['add', 'change'].includes(event)) return
  lastFile = filePath
  clearTimeout(timer)
  timer = setTimeout(() => push(lastFile), DEBOUNCE_MS)
})

console.log(`\n👀  Watching ${WATCH_DIRS.join(', ')}/ for changes`)
console.log(`    Pipeline: save → ${DEBOUNCE_MS / 1000}s debounce → commit → deploy\n`)
