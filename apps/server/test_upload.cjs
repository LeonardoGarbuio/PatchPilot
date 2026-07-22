const fs = require('fs')
const path = require('path')

async function testUpload() {
  // Create a dummy zip
  const AdmZip = require('adm-zip')
  const zip = new AdmZip()
  zip.addFile('test.txt', Buffer.from('hello world'))
  const zipBuffer = zip.toBuffer()

  const formData = new FormData()
  formData.append('file', new Blob([zipBuffer]), 'test.zip')

  console.log('Sending upload...')
  const fetch = globalThis.fetch
  const res = await fetch('http://localhost:3001/api/repos/upload?jobId=test_id', {
    method: 'POST',
    body: formData
  })
  
  console.log(res.status, await res.text())
}
testUpload().catch(console.error)
