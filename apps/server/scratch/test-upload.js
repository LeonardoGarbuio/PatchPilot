import fs from 'fs'
import path from 'path'

async function run() {
  // 1. Register to get cookie
  let res = await fetch('http://localhost:5174/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `test${Date.now()}@test.com`, password: 'password123456', name: 'Test' })
  })
  
  if (!res.ok) throw new Error('Register failed: ' + await res.text())
  
  const cookie = res.headers.get('set-cookie')
  
  // 2. Create job
  res = await fetch('http://localhost:5174/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ task: 'test test test', repo: 'test.zip', sourceType: 'zip', provider: 'ollama', model: 'qwen' })
  })
  
  if (!res.ok) throw new Error('Create job failed: ' + await res.text())
  
  const { id: jobId } = await res.json()
  
  // 3. Upload zip
  const formData = new FormData();
  // Using native fetch FormData with Blob
  const buffer = fs.readFileSync('test.zip')
  formData.append('file', new Blob([buffer], { type: 'application/zip' }), 'test.zip')
  
  res = await fetch(`http://localhost:5174/api/repos/upload?jobId=${jobId}`, {
    method: 'POST',
    headers: { cookie },
    body: formData
  })
  
  console.log('Upload response:', res.status, await res.text())
}

run().catch(console.error)
