import test from 'node:test'
import assert from 'node:assert'
import { isAllowedCommand } from './index.js'

test('isAllowedCommand allows valid commands', () => {
  assert.strictEqual(isAllowedCommand('npm test'), true)
  assert.strictEqual(isAllowedCommand('npm run lint'), true)
  assert.strictEqual(isAllowedCommand('cargo test'), true)
  assert.strictEqual(isAllowedCommand('go test ./...'), true)
})

test('isAllowedCommand blocks shell chaining', () => {
  assert.strictEqual(isAllowedCommand('npm test && cat /etc/passwd'), false)
  assert.strictEqual(isAllowedCommand('npm run lint ; rm -rf /'), false)
  assert.strictEqual(isAllowedCommand('cargo test | grep secret'), false)
  assert.strictEqual(isAllowedCommand('npm test || echo failed'), false)
  assert.strictEqual(isAllowedCommand('npm test `whoami`'), false)
  assert.strictEqual(isAllowedCommand('npm test $(whoami)'), false)
})

test('isAllowedCommand blocks unknown commands', () => {
  assert.strictEqual(isAllowedCommand('npm install'), false)
  assert.strictEqual(isAllowedCommand('cat package.json'), false)
  assert.strictEqual(isAllowedCommand('node dist/index.js'), false)
})
