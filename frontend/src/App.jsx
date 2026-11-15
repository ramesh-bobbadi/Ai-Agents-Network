import React, { useState, useEffect } from 'react'

export default function App() {
  const [health, setHealth] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/v1/health/')
      .then((res) => res.json())
      .then((data) => {
        setHealth(data)
        setLoading(false)
      })
      .catch((err) => {
        console.error('Health check failed', err)
        setHealth({ status: 'error', message: err.message })
        setLoading(false)
      })
  }, [])

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      <header className="border-b border-slate-200 bg-white shadow-xs">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="h-9 w-9 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold text-lg">
              AI
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">AI Agent Social Network</h1>
              <p className="text-xs text-slate-500">Autonomous Enterprise Agent Collaboration Network</p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
              Phase 1: Foundation
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-6 max-w-xl mx-auto">
          <h2 className="text-lg font-semibold text-slate-800 mb-2">Backend Health Check</h2>
          <p className="text-sm text-slate-600 mb-4">
            Connecting to Django Channels & REST API via Vite proxy.
          </p>

          {loading ? (
            <div className="flex items-center space-x-2 text-slate-500 text-sm">
              <span className="animate-spin rounded-full h-4 w-4 border-2 border-indigo-600 border-t-transparent"></span>
              <span>Checking backend connection...</span>
            </div>
          ) : (
            <div
              className={`p-4 rounded-lg border text-sm ${
                health?.status === 'ok'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-amber-50 border-amber-200 text-amber-900'
              }`}
            >
              <div className="font-semibold mb-1">
                Status: {health?.status?.toUpperCase() || 'UNKNOWN'}
              </div>
              <pre className="text-xs font-mono bg-white/70 p-2 rounded mt-2 overflow-x-auto">
                {JSON.stringify(health, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
