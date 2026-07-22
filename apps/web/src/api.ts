let isAuthenticated = false
let authPromise: Promise<void> | null = null

export async function ensureAuthenticated() {
  if (isAuthenticated) return
  if (authPromise) return authPromise
  
  authPromise = (async () => {
    try {
      const checkRes = await fetch('/api/auth/me', { method: 'GET' })
      if (checkRes.ok) {
        isAuthenticated = true
        return
      }
    } catch {}

    // Create an anonymous user with a secure random password
  const num = Math.floor(Math.random() * 1000000)
  const email = `local${num}@patchpilot.dev`
  const password = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0')).join('')

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name: 'Local Dev' })
    })

    if (!res.ok) {
      throw new Error('Auto-registration failed')
    }
    
    isAuthenticated = true
  } catch (err) {
    console.error('Failed to authenticate', err)
    throw err
  }
  })()
  
  try {
    await authPromise
  } finally {
    authPromise = null
  }
}

export async function apiFetch(endpoint: string, options: RequestInit = {}) {
  await ensureAuthenticated()
  const headers = new Headers(options.headers || {})
  
  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json')
  }

  const res = await fetch(endpoint, {
    ...options,
    headers
  })
  
  if (!res.ok) {
    let msg = res.statusText
    try {
      const err = await res.json()
      msg = err.error || msg
    } catch {}
    throw new Error(msg)
  }
  
  return res
}

export async function getToken() {
  // getToken is no longer used since we use cookies
  return ''
}
