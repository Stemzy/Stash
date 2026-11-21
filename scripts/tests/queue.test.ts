// Run: npx tsx scripts/tests/queue.test.ts
// Queue logic with a fake runner: limits, order, pause/resume, cancel, retry, restore.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { JobQueue, type JobRecord, type Outcome, type Runner } from '../../electron/services/jobs/queue'

let passed = 0
const test = async (name: string, fn: () => Promise<void> | void) => {
  await fn()
  passed++
  console.log(`  ✓ ${name}`)
}
const tick = () => new Promise((r) => setTimeout(r, 5))

function rec(title: string): JobRecord {
  return {
    job: { id: randomUUID(), createdAt: '', source: { url: 'https://x.test/' + title, extractor: 'X', title }, spec: { kind: 'audio', format: 'mp3', quality: { mode: 'original' } }, output: { directory: '/d', filename: title }, status: 'queued', percent: 0, simulated: false },
    request: { kind: 'audio', req: { url: 'https://x.test', spec: { kind: 'audio', format: 'mp3', quality: { mode: 'original' } }, directory: '/d', filename: title, meta: { title, extractor: 'X' } } },
    resume: false,
    attempts: 1
  }
}

/** A runner whose jobs finish only when the test says so. */
function controllable() {
  const pending = new Map<string, { done: (o: Outcome) => void; signal: AbortSignal; resume: boolean }>()
  const runner: Runner = (r, signal) =>
    new Promise((done) => {
      pending.set(r.job.id, { done, signal, resume: r.resume })
      signal.addEventListener('abort', () => done({ ok: false, code: 'CANCELED' }))
    })
  return { runner, pending }
}

async function main() {
  await test('runs at most N at once, in order', async () => {
    const { runner, pending } = controllable()
    const q = new JobQueue({ run: runner, changed: () => {}, dropTemp: () => {} })
    q.setConcurrency(2)
    const [a, b, c] = [rec('a'), rec('b'), rec('c')]
    ;[a, b, c].forEach((r) => q.add(r))
    await tick()
    assert.deepEqual([...pending.keys()], [a.job.id, b.job.id])
    assert.equal(q.get(c.job.id)!.job.status, 'queued')
    pending.get(a.job.id)!.done({ ok: true, path: '/d/a.mp3', note: '' })
    await tick()
    assert.equal(q.get(a.job.id)!.job.status, 'completed')
    assert.ok(pending.has(c.job.id), 'c starts when a slot frees')
  })

  await test('reorder changes which waiting job starts next', async () => {
    const { runner, pending } = controllable()
    const q = new JobQueue({ run: runner, changed: () => {}, dropTemp: () => {} })
    q.setConcurrency(1)
    const [a, b, c] = [rec('a'), rec('b'), rec('c')]
    ;[a, b, c].forEach((r) => q.add(r))
    q.reorder([c.job.id, b.job.id])
    pending.get(a.job.id)!.done({ ok: true, path: '/x', note: '' })
    await tick()
    assert.ok(pending.has(c.job.id) && !pending.has(b.job.id))
  })

  await test('pause keeps progress for resume; resume continues it', async () => {
    const { runner, pending } = controllable()
    const q = new JobQueue({ run: runner, changed: () => {}, dropTemp: () => {} })
    const a = rec('a')
    q.add(a)
    await tick()
    q.pause(a.job.id)
    await tick()
    assert.equal(q.get(a.job.id)!.job.status, 'paused')
    assert.equal(q.get(a.job.id)!.resume, true)
    pending.clear()
    q.resume(a.job.id)
    await tick()
    assert.equal(pending.get(a.job.id)!.resume, true, 'runner told to continue the partial download')
  })

  await test('cancel: running → canceled; paused → canceled and temp dropped', async () => {
    const { runner } = controllable()
    const dropped: string[] = []
    const q = new JobQueue({ run: runner, changed: () => {}, dropTemp: (id) => dropped.push(id) })
    q.setConcurrency(1)
    const [a, b] = [rec('a'), rec('b')]
    q.add(a)
    q.add(b)
    await tick()
    q.cancel(a.job.id)
    await tick()
    assert.equal(q.get(a.job.id)!.job.status, 'canceled')
    q.pause(b.job.id)
    await tick()
    q.cancel(b.job.id)
    assert.equal(q.get(b.job.id)!.job.status, 'canceled')
    assert.ok(dropped.includes(b.job.id))
  })

  await test('failure is reported with a plain message; retry runs the same entry', async () => {
    const { runner, pending } = controllable()
    const q = new JobQueue({ run: runner, changed: () => {}, dropTemp: () => {} })
    const a = rec('a')
    q.add(a)
    await tick()
    pending.get(a.job.id)!.done({ ok: false, code: 'NETWORK', detail: 'x' })
    await tick()
    const failed = q.get(a.job.id)!.job
    assert.equal(failed.status, 'failed')
    assert.match(failed.error!.message, /connection/)
    pending.clear()
    assert.equal(q.retry(a.job.id), true)
    await tick()
    assert.ok(pending.has(a.job.id))
    assert.equal(q.get(a.job.id)!.attempts, 2)
    assert.equal(q.get(a.job.id)!.job.error, undefined)
  })

  await test('restore: jobs interrupted by quitting come back paused, not running', async () => {
    const { runner, pending } = controllable()
    const q = new JobQueue({ run: runner, changed: () => {}, dropTemp: () => {} })
    const a = rec('a')
    a.job.status = 'downloading'
    const b = rec('b')
    b.job.status = 'completed'
    q.restore([a, b], 3)
    assert.equal(q.get(a.job.id)!.job.status, 'paused')
    assert.equal(q.get(a.job.id)!.resume, true)
    assert.equal(q.get(b.job.id)!.job.status, 'completed')
    assert.equal(q.concurrency, 3)
    assert.equal(pending.size, 0, 'nothing starts by itself after a restart')
  })

  await test('only finished jobs can be removed; concurrency is clamped 1–4', async () => {
    const { runner } = controllable()
    const q = new JobQueue({ run: runner, changed: () => {}, dropTemp: () => {} })
    const a = rec('a')
    q.add(a)
    assert.equal(q.remove(a.job.id), false)
    q.setConcurrency(99)
    assert.equal(q.concurrency, 2)
  })

  console.log(`\n${passed} passed`)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
