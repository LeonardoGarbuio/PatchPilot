import { useState, useEffect, useCallback } from 'react'
import { fetchEventSource } from '@microsoft/fetch-event-source'
import { apiFetch } from '../api'
import type { Job, RunEvent, FileChange } from '@patchpilot/shared'

export function useJobs() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)

  const fetchJobs = useCallback(async () => {
    try {
      const res = await apiFetch('/api/jobs')
      const data = await res.json()
      setJobs(data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchJobs()
  }, [fetchJobs])

  return { jobs, loading, refresh: fetchJobs }
}

export function useJob(jobId: string | null) {
  const [job, setJob] = useState<Job | null>(null)
  const [events, setEvents] = useState<RunEvent[]>([])
  const [changes, setChanges] = useState<FileChange[]>([])
  const [loading, setLoading] = useState(false)

  const fetchJob = useCallback(async () => {
    if (!jobId) return
    setLoading(true)
    try {
      const res = await apiFetch(`/api/jobs/${jobId}`)
      const data = await res.json()
      setJob(data)
      setEvents(data.events || [])
      setChanges(data.changes || [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [jobId])

  useEffect(() => {
    fetchJob()
    
    // Fallback polling for robust updates
    const interval = setInterval(() => {
      setJob(currentJob => {
        if (currentJob && ['planning', 'running', 'verifying'].includes(currentJob.status)) {
          fetchJob()
        }
        return currentJob
      })
    }, 3000)
    
    return () => clearInterval(interval)
  }, [fetchJob])

  // Listen to SSE
  useEffect(() => {
    if (!jobId) return
    const controller = new AbortController()

    async function connect() {
      fetchEventSource(`/api/jobs/${jobId}/stream`, {
        method: 'GET',
        credentials: 'include',
        signal: controller.signal,
        onmessage(msg) {
          if (!msg.data) return
          try {
            const payload = JSON.parse(msg.data)
            if (payload.event === 'status_change') {
              setJob(prev => prev ? { ...prev, status: payload.data.status } : null)
            } else if (payload.event === 'plan_ready') {
              setJob(prev => prev ? { ...prev, plan: payload.data.plan } : null)
            } else if (payload.event === 'run_event') {
              setEvents(prev => [...prev, payload.data])
            } else if (payload.event === 'complete') {
              // Refresh to get final changes
              fetchJob()
            }
          } catch (e) {
            console.error('Failed to parse SSE message', e)
          }
        },
        onerror(err) {
          console.error('SSE error:', err)
          // rethrow to retry or close
        }
      })
    }
    
    connect()

    return () => {
      controller.abort()
    }
  }, [jobId, fetchJob])

  const generatePlan = async () => {
    if (!jobId) return
    await apiFetch(`/api/jobs/${jobId}/plan`, { method: 'POST' })
  }

  const approveAndRun = async () => {
    if (!jobId) return
    await apiFetch(`/api/jobs/${jobId}/run`, { method: 'POST' })
  }

  return { job, events, changes, loading, generatePlan, approveAndRun }
}
