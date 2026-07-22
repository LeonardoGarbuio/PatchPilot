import { test, expect } from 'vitest'
import { isAllowedCommand } from './index.js'

test('isAllowedCommand allows valid commands', () => {
  expect(isAllowedCommand(['npm', 'test'])).toBe(true)
  expect(isAllowedCommand(['npm', 'run', 'lint'])).toBe(true)
  expect(isAllowedCommand(['cargo', 'test'])).toBe(true)
  expect(isAllowedCommand(['go', 'test', './...'])).toBe(true)
})

test('isAllowedCommand blocks shell chaining', () => {
  expect(isAllowedCommand(['npm', 'test', '&&', 'cat', '/etc/passwd'])).toBe(false)
  expect(isAllowedCommand(['npm', 'run', 'lint', ';', 'rm', '-rf', '/'])).toBe(false)
  expect(isAllowedCommand(['cargo', 'test', '|', 'grep', 'secret'])).toBe(false)
  expect(isAllowedCommand(['npm', 'test', '||', 'echo', 'failed'])).toBe(false)
  expect(isAllowedCommand(['npm', 'test', '`whoami`'])).toBe(false)
  expect(isAllowedCommand(['npm', 'test', '$(whoami)'])).toBe(false)
})

test('isAllowedCommand blocks unknown commands', () => {
  expect(isAllowedCommand(['npm', 'install'])).toBe(false)
  expect(isAllowedCommand(['cat', 'package.json'])).toBe(false)
  expect(isAllowedCommand(['node', 'dist/index.js'])).toBe(false)
})
