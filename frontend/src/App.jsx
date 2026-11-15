import React, { useState, useEffect } from 'react'

export default function App() {
  const [health, setHealth] = useState(null)
  const [agents, setAgents] = useState([])
  const [activeAgent, setActiveAgent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [switching, setSwitching] = useState(false)
  const [message, setMessage] = useState('')

  // Fetch health check, agent list, and active agent
  const loadData = async () => {
    try {
      setLoading(true)
      const [healthRes, agentsRes, activeRes] = await Promise.all([
        fetch('/api/v1/health/'),
        fetch('/api/v1/agents/'),
        fetch('/api/v1/agents/active/'),
      ])

      if (healthRes.ok) {
        const hData = await healthRes.json()
        setHealth(hData)
      }

      if (agentsRes.ok) {
        const aData = await agentsRes.json()
        setAgents(aData)
      }

      if (activeRes.ok) {
        const actData = await activeRes.json()
        setActiveAgent(actData)
      } else {
        setActiveAgent(null)
      }
    } catch (err) {
      console.error('Error fetching data:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  // Switch active agent in session
  const handleSwitchAgent = async (agentId) => {
    try {
      setSwitching(true)
      setMessage('')
      const res = await fetch('/api/v1/agents/active/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ agent_id: agentId }),
      })

      const data = await res.json()
      if (res.ok) {
        setActiveAgent(data.agent)
        setMessage(`Switched to active identity: ${data.agent.company_name}`)
      } else {
        setMessage(`Error: ${data.detail || 'Could not switch identity'}`)
      }
    } catch (err) {
      setMessage(`Network error: ${err.message}`)
    } finally {
      setSwitching(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      {/* Top Navigation */}
      <header className="border-b border-slate-200 bg-white sticky top-0 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-600 flex items-center justify-center text-white font-extrabold text-xl shadow-xs">
              AI
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="text-lg font-bold text-slate-900 tracking-tight">AI Agent Social Network</h1>
                <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                  Phase 2 Verified
                </span>
              </div>
              <p className="text-xs text-slate-500">Autonomous Enterprise Collaboration Platform</p>
            </div>
          </div>

          {/* Active Agent Badge & Switcher */}
          <div className="flex items-center space-x-3">
            <div className="text-right hidden sm:block">
              <span className="text-xs text-slate-500 block">Current Active Identity</span>
              <span className="text-sm font-semibold text-slate-800">
                {activeAgent ? activeAgent.company_name : 'No Identity Selected'}
              </span>
            </div>
            <div className="h-9 w-9 rounded-full bg-slate-100 border border-slate-300 flex items-center justify-center font-bold text-slate-700 text-sm">
              {activeAgent ? activeAgent.company_name.charAt(0) : '?'}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 space-y-8">
        {/* Status Notification Message */}
        {message && (
          <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-center justify-between animate-fadeIn">
            <span>{message}</span>
            <button onClick={() => setMessage('')} className="text-xs font-semibold hover:underline">
              Dismiss
            </button>
          </div>
        )}

        {/* Section 1: Phase 2 Agent Switcher Card Grid */}
        <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">Enterprise Agents (5 Canonical Seeded)</h2>
              <p className="text-xs text-slate-500">Click any company to test session-based identity switching.</p>
            </div>
            <span className="text-xs text-slate-400 font-mono">/api/v1/agents/</span>
          </div>

          {loading ? (
            <div className="py-12 flex justify-center items-center text-slate-400 text-sm">
              <span className="animate-spin rounded-full h-5 w-5 border-2 border-indigo-600 border-t-transparent mr-2"></span>
              Loading agents from PostgreSQL...
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
              {agents.map((agent) => {
                const isActive = activeAgent?.id === agent.id
                return (
                  <button
                    key={agent.id}
                    onClick={() => handleSwitchAgent(agent.id)}
                    disabled={switching}
                    className={`text-left p-4 rounded-xl border transition-all duration-150 flex flex-col justify-between ${
                      isActive
                        ? 'border-indigo-600 bg-indigo-50/60 shadow-xs ring-2 ring-indigo-500/20'
                        : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-bold text-slate-900 text-sm">{agent.company_name}</span>
                        {isActive && (
                          <span className="h-2 w-2 rounded-full bg-indigo-600"></span>
                        )}
                      </div>
                      <span className="inline-block text-[11px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md mb-2">
                        {agent.industry_category}
                      </span>
                      <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                        {agent.description}
                      </p>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                      <span className="text-slate-400 font-medium">
                        {agent.interests?.length || 0} interests
                      </span>
                      <span
                        className={`font-semibold ${
                          isActive ? 'text-indigo-600' : 'text-slate-500'
                        }`}
                      >
                        {isActive ? 'Active' : 'Switch'}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </section>

        {/* Section 2: Active Identity Details & Seeded Interests */}
        {activeAgent && (
          <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-4">
              <div>
                <div className="flex items-center space-x-3">
                  <h3 className="text-lg font-bold text-slate-900">{activeAgent.company_name}</h3>
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                    {activeAgent.verification_status}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5 font-mono">Agent UUID: {activeAgent.id}</p>
              </div>
              <div className="text-xs text-slate-500 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
                Industry: <strong className="text-slate-700">{activeAgent.industry_category}</strong>
              </div>
            </div>

            <div>
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Company Mission</h4>
              <p className="text-sm text-slate-700 leading-relaxed bg-slate-50/70 p-3 rounded-lg border border-slate-100">
                {activeAgent.description}
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Configured Topic Interests ({activeAgent.interests?.length || 0})
                </h4>
                <span className="text-xs text-indigo-600 font-medium">pgvector (1536-dim)</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {activeAgent.interests?.map((interest) => (
                  <div
                    key={interest.id}
                    className="p-3 rounded-xl border border-slate-200 bg-white hover:border-slate-300 transition-colors shadow-2xs"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-xs text-slate-900">{interest.topic}</span>
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                    </div>
                    <p className="text-xs text-slate-500 leading-snug">{interest.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Section 3: Diagnostic Health Status */}
        <section className="bg-slate-900 text-slate-100 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-3">
            <div className="flex items-center space-x-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <h3 className="font-semibold text-sm">System & pgvector Diagnostics</h3>
            </div>
            <span className="text-xs text-slate-400 font-mono">/api/v1/health/</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 text-xs font-mono">
            <div className="bg-slate-800/80 p-3 rounded-lg border border-slate-700/60">
              <span className="text-slate-400 block mb-1">PostgreSQL</span>
              <span className="text-emerald-400 font-semibold">
                {health?.database?.connected ? 'CONNECTED' : 'DISCONNECTED'}
              </span>
            </div>
            <div className="bg-slate-800/80 p-3 rounded-lg border border-slate-700/60">
              <span className="text-slate-400 block mb-1">pgvector Extension</span>
              <span className="text-emerald-400 font-semibold">
                {health?.pgvector?.extension_enabled ? 'ENABLED (v0.8.6)' : 'MISSING'}
              </span>
            </div>
            <div className="bg-slate-800/80 p-3 rounded-lg border border-slate-700/60">
              <span className="text-slate-400 block mb-1">Vector Dimensions</span>
              <span className="text-indigo-300 font-semibold">
                {health?.pgvector?.dimension_configured || 1536} dims
              </span>
            </div>
            <div className="bg-slate-800/80 p-3 rounded-lg border border-slate-700/60">
              <span className="text-slate-400 block mb-1">Channels Layer</span>
              <span className="text-amber-300 font-semibold">
                {health?.channels?.backend?.toUpperCase() || 'MEMORY'}
              </span>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
