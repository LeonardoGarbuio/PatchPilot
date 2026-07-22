/**
 * Job state machine transitions
 *
 * idle → planning → awaiting_approval → running → verifying → complete
 *                                     ↘ failed
 * complete → approved | rejected
 */

import type { JobStatus } from './schemas/index.js'

const VALID_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  idle: ['planning', 'failed'],
  planning: ['awaiting_approval', 'failed'],
  awaiting_approval: ['running', 'rejected', 'failed'],
  running: ['verifying', 'failed'],
  verifying: ['complete', 'failed'],
  complete: ['approved', 'rejected'],
  approved: [],
  rejected: ['planning'], // allow re-run after rejection
  failed: ['planning'],   // allow retry
}

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false
}

export function assertTransition(from: JobStatus, to: JobStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid job state transition: ${from} → ${to}`)
  }
}

export function isTerminal(status: JobStatus): boolean {
  return VALID_TRANSITIONS[status].length === 0
}

export function isActive(status: JobStatus): boolean {
  return ['planning', 'running', 'verifying'].includes(status)
}
