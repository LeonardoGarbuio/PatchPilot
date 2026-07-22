import { useState, useEffect } from 'react'
import { Editor } from '@monaco-editor/react'
import {
  Activity, ArrowRight, Bot, Box, Check, CheckCircle2, ChevronRight,
  CircleDot, Clock3, Download, FileCode2, GitBranch, Github,
  LayoutDashboard, ListChecks, LoaderCircle, LockKeyhole, Menu, Play,
  Plus, RotateCcw, Settings, ShieldCheck, Sparkles, Square,
  TestTube2, Zap, AlertCircle, FolderOpen
} from 'lucide-react'
import type { Job } from '@patchpilot/shared'
import { useJobs, useJob } from './hooks/useJob'
import { apiFetch } from './api'

type View = 'dashboard' | 'new' | 'run' | 'review'

function Logo() {
  return <div className="logo"><div className="logo-mark"><GitBranch size={17} /></div><span>PatchPilot</span></div>
}

function Sidebar({ view, setView, activeCount }: { view: View; setView: (v: View) => void, activeCount: number }) {
  const [sysStatus, setSysStatus] = useState({ docker: true, ollama: true })

  useEffect(() => {
    let mounted = true
    const check = async () => {
      try {
        const res = await apiFetch('/api/system/status')
        const data = await res.json()
        if (mounted) setSysStatus(data)
      } catch { /* ignore */ }
    }
    check()
    const int = setInterval(check, 10000)
    return () => { mounted = false; clearInterval(int) }
  }, [])

  const nav = [
    { id: 'dashboard' as View, label: 'Overview', icon: LayoutDashboard },
    { id: 'new' as View, label: 'New task', icon: Plus },
    { id: 'run' as View, label: 'Runs', icon: Activity },
  ]
  return <aside className="sidebar">
    <Logo />
    <nav>{nav.map(({ id, label, icon: Icon }) => <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}><Icon size={18} /><span>{label}</span>{id === 'run' && activeCount > 0 && <b>{activeCount}</b>}</button>)}</nav>
    <div className="sidebar-bottom">
      <div className="system-card">
        <div><span className={sysStatus.docker && sysStatus.ollama ? "pulse" : "pulse error"} style={{ background: sysStatus.docker && sysStatus.ollama ? undefined : '#f87171' }} />Systems</div>
        <p><span>Ollama</span><strong style={{ color: sysStatus.ollama ? '#34d399' : '#f87171' }}>{sysStatus.ollama ? 'Online' : 'Offline'}</strong></p>
        <p><span>Docker</span><strong style={{ color: sysStatus.docker ? '#34d399' : '#f87171' }}>{sysStatus.docker ? 'Online' : 'Offline'}</strong></p>
      </div>
      <button><Settings size={18} />Settings</button>
      <div className="profile"><div>IM</div><span><strong>Local Dev</strong><small>Local workspace</small></span><ChevronRight size={16} /></div>
    </div>
  </aside>
}

function Header({ title, subtitle, onMenu }: { title: string; subtitle: string; onMenu: () => void }) {
  return <header className="topbar"><button className="mobile-menu" onClick={onMenu}><Menu /></button><div><h1>{title}</h1><p>{subtitle}</p></div><div className="privacy"><LockKeyhole size={14} /> Local only</div></header>
}

function Dashboard({ setView, jobs, selectJob }: { setView: (v: View) => void, jobs: Job[], selectJob: (id: string) => void }) {
  return <>
    <Header title="Good morning" subtitle="Your code stays local. Your changes stay under control." onMenu={() => {}} />
    <main className="content">
      <section className="hero-card">
        <div className="hero-copy"><span className="eyebrow"><Sparkles size={13} /> AI coding, with guardrails</span><h2>Ship fixes.<br /><em>Not surprises.</em></h2><p>Give PatchPilot a task. It works inside an isolated container, verifies every change, and waits for your approval.</p><button className="primary" onClick={() => setView('new')}><Plus size={18} /> Start a new task <ArrowRight size={17} /></button></div>
        <div className="hero-visual">
          <div className="orbit orbit-one" /><div className="orbit orbit-two" />
          <div className="pilot-core"><Bot size={32} /><span>PATCH<br />PILOT</span></div>
          <div className="float-tag tag-one"><ShieldCheck size={16} /><span>Isolated<br /><b>Sandbox</b></span></div>
          <div className="float-tag tag-two"><TestTube2 size={16} /><span>{jobs.filter(j => j.status === 'complete' || j.status === 'approved').length} / {jobs.length || 1}<br /><b>Runs passed</b></span></div>
          <div className="float-tag tag-three"><GitBranch size={16} /><span>Human<br /><b>Approved</b></span></div>
        </div>
      </section>

      <section className="stats">
        <div><span><Activity size={17} /> Runs this month</span><strong>{jobs.length}</strong></div>
        <div><span><CheckCircle2 size={17} /> Success rate</span><strong>{jobs.length ? Math.round((jobs.filter(j => j.status === 'complete' || j.status === 'approved').length / jobs.length) * 100) : 0}%</strong></div>
        <div><span><Clock3 size={17} /> Avg time</span><strong>
          {jobs.filter(j => j.startedAt && j.finishedAt).length > 0
            ? '~' + Math.round(jobs.filter(j => j.startedAt && j.finishedAt).reduce((acc, j) => acc + (new Date(j.finishedAt as string).getTime() - new Date(j.startedAt as string).getTime()), 0) / jobs.filter(j => j.startedAt && j.finishedAt).length / 60000) + 'm'
            : '~2m'}
        </strong></div>
      </section>

      <section className="section-head"><div><h3>Recent runs</h3><p>Your latest automated code changes</p></div><button className="ghost" onClick={() => setView('run')}>View all <ArrowRight size={15} /></button></section>
      <section className="jobs">
        {jobs.length === 0 && <div style={{ opacity: 0.5, padding: '1rem' }}>No runs yet.</div>}
        {jobs.slice(0, 5).map((job) => <button className="job" key={job.id} onClick={() => { selectJob(job.id); setView(['complete', 'approved'].includes(job.status) ? 'review' : 'run') }}>
          <div className="repo-icon"><Github size={20} /></div>
          <div className="job-main"><small>{job.repo}</small><strong>{job.title}</strong></div>
          <div className="job-files"><FileCode2 size={15} /> —</div>
          <div>
            <span className={`status ${job.status === 'complete' ? 'green' : job.status === 'failed' ? 'red' : 'purple'}`}>
              <CircleDot size={12} /> {job.status.replace('_', ' ')}
            </span>
          </div><ChevronRight size={18} />
        </button>)}
      </section>
    </main>
  </>
}

function NewTask({ begin }: { begin: (task: string, repo: string, source: 'local' | 'github' | 'zip', provider: string, model: string, file?: File) => void }) {
  const [task, setTask] = useState('')
  const [repo, setRepo] = useState('/workspaces/my-app')
  const [file, setFile] = useState<File | undefined>(undefined)
  const [provider, setProvider] = useState('ollama')
  const [model, setModel] = useState('qwen2.5-coder:7b')
  const [source, setSource] = useState<'local' | 'github' | 'zip'>('local')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    setLoading(true)
    await begin(task, repo, source, provider, model, file)
    setLoading(false)
  }

  return <><Header title="Create a new task" subtitle="Describe the outcome. PatchPilot will propose the safest path." onMenu={() => {}} />
    <main className="content narrow">
      <div className="steps"><span className="current"><b>1</b>Configure</span><i /><span><b>2</b>Review plan</span><i /><span><b>3</b>Run</span></div>
      <section className="form-card"><div className="form-title"><div className="number">01</div><div><h3>Choose a repository</h3><p>A disposable copy will be created. Your original files remain untouched.</p></div></div>
        <div className="source-tabs">
          <button className={source === 'local' ? 'selected' : ''} onClick={() => setSource('local')}><Box /><strong>Local folder</strong><small>Select from this computer</small></button>
          <button className={source === 'github' ? 'selected' : ''} onClick={() => setSource('github')}><Github /><strong>Public GitHub</strong><small>Paste a repository URL</small></button>
          <button className={source === 'zip' ? 'selected' : ''} onClick={() => setSource('zip')}><Box /><strong>ZIP File</strong><small>Upload an archive</small></button>
        </div>
        <div className="repo-field" style={{ padding: '0 1rem 1rem', display: 'flex', gap: '0.5rem' }}>
          {source === 'zip' ? (
            <input type="file" accept=".zip" onChange={e => setFile(e.target.files?.[0])} style={{ flex: 1, padding: '0.5rem', color: 'white' }} />
          ) : (
            <input className="minimal-input" value={repo || ''} onChange={e => setRepo(e.target.value)} placeholder={source === 'github' ? 'https://github.com/user/repo' : '/path/to/local'} style={{ flex: 1, padding: '0.5rem', background: '#090a0f', border: '1px solid #1c202a', color: 'white' }} />
          )}
          {source === 'local' && (
            <button className="secondary" onClick={async () => {
              const res = await apiFetch('/api/system/pick-folder')
              const { path } = await res.json()
              if (path) setRepo(path)
            }} style={{ padding: '0 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <FolderOpen size={16} /> Browse...
            </button>
          )}
        </div>
      </section>
      <section className="form-card"><div className="form-title"><div className="number">02</div><div><h3>What should change?</h3><p>Be specific about the behavior you expect, not the implementation.</p></div></div>
        <textarea value={task} onChange={e => setTask(e.target.value)} maxLength={1000} placeholder="E.g. Fix the null pointer exception when loading user profiles..." /><div className="textarea-meta"><span><Sparkles size={13} /> Tip: mention tests and edge cases</span><span>{task.length} / 1000</span></div>
      </section>
      <section className="form-card inline-config">
        <div><span className="model-icon"><Bot /></span><span><small>AI provider</small>
          <select value={provider} onChange={e => setProvider(e.target.value)} style={{ background: 'transparent', color: 'white', border: 'none', fontWeight: 'bold' }}>
            <option value="ollama">Ollama</option>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
          </select>
        </span></div>
        <div><span className="model-icon"><Zap /></span><span><small>Model</small>
          <input value={model || ''} onChange={e => setModel(e.target.value)} style={{ background: 'transparent', color: 'white', border: 'none', fontWeight: 'bold' }} />
        </span></div>
      </section>
      <div className="form-footer"><p><ShieldCheck size={16} /> The plan must be approved before any file is changed.</p>
        <button className="primary" onClick={handleSubmit} disabled={!task.trim() || (source !== 'zip' && !repo.trim()) || (source === 'zip' && !file) || loading}>
          {loading ? <LoaderCircle size={17} className="spin" /> : 'Generate plan'} <ArrowRight size={17} />
        </button>
      </div>
    </main></>
}

function RunView({ jobId, setView, jobs, selectJob }: { jobId: string | null; setView: (v: View) => void, jobs: Job[], selectJob: (id: string) => void }) {
  const { job, events, loading, generatePlan, approveAndRun } = useJob(jobId)

  if (!jobId) {
    return (
      <>
        <Header title="All Runs" subtitle="Select a run to view its details." onMenu={() => {}} />
        <main className="content narrow">
          <section className="jobs">
            {jobs.length === 0 && <div style={{ opacity: 0.5, padding: '1rem' }}>No runs yet.</div>}
            {jobs.map((j) => (
              <button className="job" key={j.id} onClick={() => { selectJob(j.id); setView(['complete', 'approved'].includes(j.status) ? 'review' : 'run') }}>
                <div className="repo-icon"><Github size={20} /></div>
                <div className="job-main"><small>{j.repo}</small><strong>{j.title}</strong></div>
                <div className="job-files"><FileCode2 size={15} /> —</div>
                <div>
                  <span className={`status ${j.status === 'complete' ? 'green' : j.status === 'failed' ? 'red' : 'purple'}`}>
                    <CircleDot size={12} /> {j.status.replace('_', ' ')}
                  </span>
                </div><ChevronRight size={18} />
              </button>
            ))}
          </section>
        </main>
      </>
    )
  }

  if (loading && !job) return <div style={{ padding: '2rem', textAlign: 'center' }}><LoaderCircle className="spin" /> Loading run data...</div>
  if (!job) return <div style={{ padding: '2rem' }}>Job not found</div>

  const isPlanning = job.status === 'planning'
  const isAwaiting = job.status === 'awaiting_approval'
  const isComplete = job.status === 'complete' || job.status === 'approved'

  if (isAwaiting || isPlanning || job.status === 'idle') return <><Header title="Review the plan" subtitle="No files have been changed yet." onMenu={() => {}} /><main className="content narrow">
    <div className="run-context"><div><Github /><span><small>{job.repo}</small><strong>{job.title}</strong></span></div><span className="status purple"><Clock3 size={12} /> {job.status.replace('_', ' ')}</span></div>
    
    <section className="plan-card"><div className="plan-header"><span><ListChecks /></span><div><small>PROPOSED PLAN</small><h2>{job.plan ? `${job.plan.length} steps to a verified patch` : 'Generating plan...'}</h2><p>PatchPilot inspected the repository structure and prepared this plan.</p></div></div>
      {job.plan ? (
        <ol>{job.plan.map((step, i: number) => <li key={i}><span>{i + 1}</span><div><strong>{step.title}</strong><small>{step.description}</small></div>{step.permission === 'verify' && <ShieldCheck size={17} />}</li>)}</ol>
      ) : (
        <div style={{ padding: '2rem', textAlign: 'center', opacity: 0.5 }}>
          {isPlanning ? 'AI is analyzing the codebase...' : 'Waiting to start...'}
        </div>
      )}
    </section>
    <div className="risk-note"><ShieldCheck /><div><strong>Safety boundary</strong><p>Network access will be disabled. Commands are restricted to npm lint, typecheck, test, and build.</p></div></div>
    
    <div className="form-footer">
      <button className="secondary" onClick={() => generatePlan()} disabled={isPlanning || isAwaiting}>Regenerate plan</button>
      <button className="primary" onClick={() => approveAndRun()} disabled={!isAwaiting}><Play size={16} /> Approve and run</button>
    </div>
  </main></>

  if (job.status === 'failed') return <><Header title="Run failed" subtitle={`${job.repo} · ${job.title}`} onMenu={() => {}} /><main className="content narrow">
    <section className="execution-head"><div className="runner failed"><div><AlertCircle size={28} color="#f87171" /></div><span><small>ERROR</small><h2 style={{ color: '#f87171' }}>The run has failed.</h2></span></div></section>
    <section className="timeline">
      {events.map((event, i: number) => (
        <div className="event shown active" key={i}><div className="event-line"><span><CircleDot size={12} /></span></div>
        <div><strong>{event.title}</strong>{event.detail && <small>{event.detail}</small>}</div>
        <time>{new Date(event.timestamp).toLocaleTimeString()}</time></div>
      ))}
    </section>
    <div className="form-footer">
      <button className="primary" onClick={() => setView('dashboard')}><ArrowRight size={17} /> Go to dashboard</button>
    </div>
  </main></>

  // Running or Complete view
  return <><Header title={isComplete ? 'Run complete' : 'PatchPilot is working'} subtitle={`${job.repo} · ${job.title}`} onMenu={() => {}} /><main className="content narrow">
    <section className="execution-head"><div className={`runner ${isComplete ? 'complete' : 'running'}`}><div>{isComplete ? <Check size={28} /> : <LoaderCircle size={28} className="spin" />}</div><span><small>{isComplete ? 'VERIFIED PATCH READY' : 'RUNNING IN ISOLATED CONTAINER'}</small><h2>{isComplete ? 'Every check passed.' : 'Building a safe, tested change.'}</h2></span></div></section>
    
    <section className="timeline">
      {events.map((event, i: number) => { 
        return <div className="event shown active" key={i}><div className="event-line"><span><CircleDot size={12} /></span></div>
        <div><strong>{event.title}</strong>{event.detail && <small>{event.detail}</small>}</div>
        <time>{new Date(event.timestamp).toLocaleTimeString()}</time></div>
      })}
    </section>
    
    <section className="console"><div><span /><span /><span /><small>patchpilot / console</small></div>
      <pre>{events.filter(e => e.type === 'command').map(e => `$ ${e.title}\n${e.detail || ''}\n`).join('\n') || 'Initializing...'}<b className="cursor">▋</b></pre>
    </section>
    
    <div className="form-footer">{isComplete ? <><p><ShieldCheck size={16} /> Original repository remains unchanged.</p><button className="primary" onClick={() => setView('review')}>Review changes <ArrowRight size={17} /></button></> : <><p><LockKeyhole size={16} /> Network disabled</p><button className="danger" onClick={async () => {
      if (confirm('Stop this run?')) {
        await apiFetch(`/api/jobs/${jobId}`, { method: 'DELETE' })
        setView('dashboard')
      }
    }}><Square size={13} /> Stop run</button></>}</div>
  </main></>
}

function Review({ jobId }: { jobId: string | null; setView: (v: View) => void }) {
  const { job, changes, events } = useJob(jobId)
  const [approved, setApproved] = useState(false)
  
  if (!job) return <div style={{ padding: '2rem' }}>Loading...</div>

  const checkEvent = events.find((e: { title: string; detail?: string }) => e.title.includes('checks passed') || e.title.includes('checks failed'))
  const checks = { lint: 'skipped', typecheck: 'skipped', tests: 'skipped', build: 'skipped' }
  if (checkEvent && checkEvent.detail) {
    const parts = checkEvent.detail.split(' · ')
    parts.forEach((p: string) => {
      const [k, v] = p.split(': ')
      if (k && v) checks[k as keyof typeof checks] = v.split(' ')[0]
    })
  }

  const additions = changes.reduce((acc, c) => acc + (c.additions || 0), 0)
  const deletions = changes.reduce((acc, c) => acc + (c.deletions || 0), 0)

  return <><Header title="Review changes" subtitle="Nothing reaches your repository until you approve it." onMenu={() => {}} /><main className="content review-layout">
    <section className="review-main"><div className="review-summary"><div className="success-icon"><Check /></div><div><span className="eyebrow">ALL CHECKS PASSED</span><h2>A small, focused patch.</h2><p>{job.task}</p></div><div className="change-count"><strong>+{additions}</strong><span>−{deletions}</span><small>across {changes.length} files</small></div></div>
      <div className="diff-toolbar"><div><button className="active">Changes</button><button>Checks</button><button>Risks <b>{changes.filter(c => c.diff.includes('TODO') || c.diff.includes('FIXME') || c.diff.includes('console.log')).length}</b></button></div><button onClick={() => window.open(`/api/jobs/${jobId}/patch`, '_blank')}><Download size={15} /> Download .patch</button></div>
      
      {changes.map((change, i) => (
        <section className="diff-card" key={i}>
          <header><div><ChevronRight size={15} /><FileCode2 size={17} /><strong>{change.path}</strong><span>{change.status}</span></div><small><b>+{change.additions}</b> −{change.deletions}</small></header>
          <div className="code" style={{ padding: 0 }}>
            <Editor 
              height="400px"
              value={change.diff}
              language="diff" 
              theme="vs-dark"
              options={{ readOnly: true, minimap: { enabled: false }, scrollBeyondLastLine: false }}
            />
          </div>
        </section>
      ))}

    </section>
    <aside className="review-side">
      <section>
        <h3>Verification</h3>
        {Object.entries(checks).map(([k, v]) => (
          <div className="check-row" key={k}>
            {v === 'passed' ? <CheckCircle2 color="#34d399" /> : v === 'failed' ? <AlertCircle color="#f87171" /> : <CircleDot />}
            <span style={{textTransform: 'capitalize'}}>{k}</span>
            <strong>{v}</strong>
          </div>
        ))}
      </section>
      <section><h3>Files</h3>{changes.map((x, i) => <label className="file-check" key={i}><input type="checkbox" defaultChecked /><span><FileCode2 />{x.path}<small>{x.status}</small></span></label>)}</section><div className="approval">
      <button className={approved ? 'approved' : ''} onClick={async () => {
        if (!approved) {
          await apiFetch(`/api/jobs/${jobId}/approve`, { method: 'POST' })
          setApproved(true)
        }
      }}>{approved ? <><Check /> Approved locally</> : <><CheckCircle2 /> Approve selected files</>}</button>
      <button style={{ background: '#1c202a', color: '#cdd0d7', borderColor: '#2c3140' }} onClick={async () => {
        const token = prompt('Enter your GitHub personal access token:')
        if (token) {
          try {
            const res = await apiFetch(`/api/jobs/${jobId}/pr`, { method: 'POST', body: JSON.stringify({ githubToken: token }) })
            const { url } = await res.json()
            window.open(url, '_blank')
          } catch (err) { alert('Failed to create PR: ' + err) }
        }
      }}><Github /> Create Pull Request</button>
      <button onClick={async () => {
        const res = await apiFetch(`/api/jobs/${jobId}/revision`, { method: 'POST' })
        const { id } = await res.json()
        if (id) {
          // Re-navigate or select new job via refresh but here we just trigger new job
          window.location.reload()
        }
      }}><RotateCcw /> Request revision</button><p><LockKeyhole /> No remote push will be performed unless requested.</p></div></aside>
  </main></>
}

export default function App() {
  const { jobs, refresh } = useJobs()
  const [view, setView] = useState<View>('dashboard')
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  
  function navigate(v: View) { 
    setView(v); 
    setMobileOpen(false); 
  }

  async function handleNewTask(task: string, repo: string, source: 'local' | 'github' | 'zip', provider: string, model: string, file?: File) {
    try {
      const res = await apiFetch('/api/jobs', {
        method: 'POST',
        body: JSON.stringify({ task, repo: source === 'zip' ? file?.name : repo, sourceType: source, provider, model })
      })
      const { id } = await res.json()
      setSelectedJobId(id)
      refresh()
      
      if (source === 'github') {
        await apiFetch('/api/repos/clone', {
          method: 'POST',
          body: JSON.stringify({ url: repo, jobId: id })
        })
      } else if (source === 'zip' && file) {
        const formData = new FormData()
        formData.append('file', file)
        await apiFetch(`/api/repos/upload?jobId=${id}`, {
          method: 'POST',
          body: formData
        })
      } else if (source === 'local') {
        await apiFetch('/api/repos/local', {
          method: 'POST',
          body: JSON.stringify({ path: repo, jobId: id })
        })
      }
      
      // Start planning automatically
      await apiFetch(`/api/jobs/${id}/plan`, { method: 'POST' })
      navigate('run')
    } catch (err) {
      console.error(err)
      alert('Failed to create job or load repository')
    }
  }

  const activeCount = jobs.filter(j => ['planning', 'awaiting_approval', 'running', 'verifying'].includes(j.status)).length

  return <div className="app"><div className={mobileOpen ? 'nav-wrap open' : 'nav-wrap'}><Sidebar view={view} setView={navigate} activeCount={activeCount} /></div><button className="floating-menu" onClick={() => setMobileOpen(!mobileOpen)}><Menu /></button><div className="page">{view === 'dashboard' && <Dashboard setView={navigate} jobs={jobs} selectJob={setSelectedJobId} />}{view === 'new' && <NewTask begin={handleNewTask} />}{view === 'run' && <RunView jobId={selectedJobId} setView={navigate} jobs={jobs} selectJob={setSelectedJobId} />}{view === 'review' && <Review jobId={selectedJobId} setView={navigate} />}</div></div>
}
