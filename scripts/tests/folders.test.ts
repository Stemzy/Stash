// Run: npx tsx scripts/tests/folders.test.ts
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { folderProblem, prepareDirectory, saveFailure } from '../../electron/lib/paths'
import { JOB_ERROR_TEXT } from '../../shared/job-errors'

let passed = 0
const test = async (name: string, fn: () => Promise<void> | void) => {
  await fn()
  passed++
  console.log(`  ✓ ${name}`)
}
const err = (code: string) => Object.assign(new Error(code), { code })

void (async () => {
  const base = mkdtempSync(join(tmpdir(), 'stash-folders-'))

  await test('a writable folder passes and the test file is cleaned up', async () => {
    const r = await prepareDirectory(base)
    assert.deepEqual(r, { ok: true, dir: base })
    assert.equal(readdirSync(base).length, 0)
  })

  await test('a missing download folder is created (e.g. a OneDrive Videos folder never made)', async () => {
    const dir = join(base, 'OneDrive', 'Videos')
    const r = await prepareDirectory(dir)
    assert.ok(r.ok && existsSync(dir))
  })

  await test('a path that runs through a file is reported as missing, not as a full disk', async () => {
    writeFileSync(join(base, 'afile'), 'x')
    const r = await prepareDirectory(join(base, 'afile', 'sub'))
    assert.ok(!r.ok && r.code === 'FOLDER_MISSING')
  })

  await test('bad input is refused', async () => {
    for (const bad of ['', 'relative/path', 42, null, 'C:\\a\u0000b']) assert.equal((await prepareDirectory(bad)).ok, false)
  })

  await test('Windows blocking the save (ransomware protection / permissions) is not called "full disk"', () => {
    for (const c of ['EPERM', 'EACCES', 'EROFS', 'EBUSY']) assert.equal(folderProblem(err(c), true), 'FOLDER_BLOCKED')
  })

  await test('only a real full drive says the drive is full', () => {
    assert.equal(folderProblem(err('ENOSPC'), true), 'DISK_FULL')
    assert.equal(folderProblem(err('EDQUOT'), true), 'DISK_FULL')
  })

  await test('a save failing part-way checks whether the folder still exists', async () => {
    assert.equal(await saveFailure(err('ENOENT'), join(base, 'gone')), 'FOLDER_MISSING')
    assert.equal(await saveFailure(err('EPERM'), base), 'FOLDER_BLOCKED')
    assert.equal(await saveFailure(err('ECONNRESET'), base), null)
  })

  await test('every problem has a message, and none tells users to run npm', () => {
    for (const c of ['FOLDER_BLOCKED', 'FOLDER_MISSING', 'DISK_FULL'] as const) assert.ok(JOB_ERROR_TEXT[c].length > 10)
    for (const t of Object.values(JOB_ERROR_TEXT)) assert.ok(!/npm /.test(t), t)
  })
  console.log(`\n${passed} passed`)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
