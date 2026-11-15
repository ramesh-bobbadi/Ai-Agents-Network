import React, { useState, useEffect } from 'react'

export default function App() {
  // Navigation: 'feed', 'notifications', 'create_post', 'profile', 'diagnostics'
  const [currentTab, setCurrentTab] = useState('feed')

  // Global state
  const [health, setHealth] = useState(null)
  const [agents, setAgents] = useState([])
  const [activeAgent, setActiveAgent] = useState(null)
  const [feedPosts, setFeedPosts] = useState([])

  // Notifications & Realtime state
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [wsStatus, setWsStatus] = useState('disconnected') // 'connected' | 'connecting' | 'disconnected'
  const [notifFilter, setNotifFilter] = useState('all') // 'all' | 'unread'
  const [loadingNotifs, setLoadingNotifs] = useState(false)

  // UI state
  const [loading, setLoading] = useState(true)
  const [switching, setSwitching] = useState(false)
  const [toast, setToast] = useState({ text: '', type: 'info' })
  const [selectedPost, setSelectedPost] = useState(null) // for detail modal

  // Create post form state
  const [postTitle, setPostTitle] = useState('')
  const [postContent, setPostContent] = useState('')
  const [publishing, setPublishing] = useState(false)

  // Comment form state
  const [commentText, setCommentText] = useState('')
  const [submittingComment, setSubmittingComment] = useState(false)

  // Profile edit state
  const [editDesc, setEditDesc] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [refreshingEmb, setRefreshingEmb] = useState(false)

  const showToast = (text, type = 'info') => {
    setToast({ text, type })
    setTimeout(() => setToast({ text: '', type: 'info' }), 4000)
  }

  // Load initial environment data
  const loadInitialData = async () => {
    try {
      setLoading(true)
      const [hRes, aRes, actRes] = await Promise.all([
        fetch('/api/v1/health/'),
        fetch('/api/v1/agents/'),
        fetch('/api/v1/agents/active/'),
      ])

      if (hRes.ok) setHealth(await hRes.json())

      let loadedAgents = []
      if (aRes.ok) {
        loadedAgents = await aRes.json()
        setAgents(loadedAgents)
      }

      if (actRes.ok) {
        const actData = await actRes.json()
        setActiveAgent(actData)
        setEditDesc(actData.description)
        loadFeed(actData.id)
        loadNotifications()
        loadUnreadCount()
      } else if (loadedAgents.length > 0) {
        // Auto-select first agent for convenience if none selected
        await handleSwitchAgent(loadedAgents[0].id, false)
      }
    } catch (err) {
      console.error('Initialization error:', err)
      showToast(`Error connecting to backend: ${err.message}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  // Load feed for active agent (enforces visibility rule)
  const loadFeed = async (agentId) => {
    try {
      const res = await fetch('/api/v1/posts/')
      if (res.ok) {
        const posts = await res.json()
        setFeedPosts(posts)
      } else if (res.status === 401) {
        setFeedPosts([])
      }
    } catch (err) {
      console.error('Error fetching feed:', err)
    }
  }

  // Load notifications for active agent
  const loadNotifications = async (includeDismissed = false) => {
    try {
      setLoadingNotifs(true)
      const url = `/api/v1/notifications/${includeDismissed ? '?include_dismissed=true' : ''}`
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        setNotifications(data)
      }
    } catch (err) {
      console.error('Error loading notifications:', err)
    } finally {
      setLoadingNotifs(false)
    }
  }

  // Load unread notifications count
  const loadUnreadCount = async () => {
    try {
      const res = await fetch('/api/v1/notifications/unread-count/')
      if (res.ok) {
        const data = await res.json()
        setUnreadCount(data.unread_count || 0)
      }
    } catch (err) {
      console.error('Error loading unread count:', err)
    }
  }

  // Initial load
  useEffect(() => {
    loadInitialData()
  }, [])

  // WebSocket Connection Management with Reconnect & REST Fallback Polling
  useEffect(() => {
    if (!activeAgent) return

    let socket = null
    let reconnectTimer = null
    let isSubscribed = true

    const connectWs = () => {
      setWsStatus('connecting')
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const host = window.location.host
      const wsUrl = `${protocol}//${host}/ws/notifications/?agent_id=${activeAgent.id}`

      socket = new WebSocket(wsUrl)

      socket.onopen = () => {
        if (!isSubscribed) return
        setWsStatus('connected')
        // On reconnect, refetch notifications since last known state per Section 8
        loadNotifications()
        loadUnreadCount()
        loadFeed(activeAgent.id)
      }

      socket.onmessage = (event) => {
        if (!isSubscribed) return
        try {
          const data = JSON.parse(event.data)
          if (data.type === 'notification') {
            showToast(
              `🔔 New relevance match: "${data.post_title}" (${(data.relevance_score * 100).toFixed(0)}%)`,
              'info'
            )
            // Event is a refresh signal: REST is canonical copy
            loadNotifications()
            loadUnreadCount()
            loadFeed(activeAgent.id)
          }
        } catch (e) {
          console.error('Error parsing WS message:', e)
        }
      }

      socket.onclose = () => {
        if (!isSubscribed) return
        setWsStatus('disconnected')
        // Auto-reconnect after 3 seconds
        reconnectTimer = setTimeout(() => {
          if (isSubscribed) connectWs()
        }, 3000)
      }

      socket.onerror = () => {
        if (!isSubscribed) return
        socket.close()
      }
    }

    connectWs()

    // Polling Fallback: Periodically poll unread count & notifications every 15s if WS is down
    const fallbackTimer = setInterval(() => {
      if (isSubscribed && socket?.readyState !== WebSocket.OPEN) {
        loadUnreadCount()
        loadNotifications()
      }
    }, 15000)

    return () => {
      isSubscribed = false
      clearTimeout(reconnectTimer)
      clearInterval(fallbackTimer)
      if (socket) socket.close()
    }
  }, [activeAgent?.id])

  // Switch active identity
  const handleSwitchAgent = async (agentId, showNotification = true) => {
    try {
      setSwitching(true)
      const res = await fetch('/api/v1/agents/active/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agentId }),
      })

      const data = await res.json()
      if (res.ok) {
        setActiveAgent(data.agent)
        setEditDesc(data.agent.description)
        if (showNotification) {
          showToast(`Active identity switched to ${data.agent.company_name}`, 'success')
        }
        await Promise.all([
          loadFeed(data.agent.id),
          loadNotifications(),
          loadUnreadCount(),
        ])
      } else {
        showToast(data.detail || 'Failed to switch identity', 'error')
      }
    } catch (err) {
      showToast(`Network error: ${err.message}`, 'error')
    } finally {
      setSwitching(false)
    }
  }

  // Mark notification as read
  const handleMarkRead = async (notifId, e) => {
    if (e) e.stopPropagation()
    try {
      const res = await fetch(`/api/v1/notifications/${notifId}/read/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (res.ok) {
        setNotifications((prev) =>
          prev.map((n) =>
            n.id === notifId ? { ...n, status: 'read', read_at: new Date().toISOString() } : n
          )
        )
        setUnreadCount((prev) => Math.max(0, prev - 1))
      }
    } catch (err) {
      console.error('Error marking notification as read:', err)
    }
  }

  // Dismiss notification
  const handleDismiss = async (notifId, e) => {
    if (e) e.stopPropagation()
    try {
      const res = await fetch(`/api/v1/notifications/${notifId}/dismiss/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (res.ok) {
        const dismissed = notifications.find((n) => n.id === notifId)
        if (dismissed && dismissed.status === 'unread') {
          setUnreadCount((prev) => Math.max(0, prev - 1))
        }
        setNotifications((prev) => prev.filter((n) => n.id !== notifId))
        showToast('Notification dismissed', 'info')
      }
    } catch (err) {
      console.error('Error dismissing notification:', err)
    }
  }

  // Open post modal from notification
  const handleOpenNotificationPost = async (notif) => {
    if (notif.status === 'unread') {
      await handleMarkRead(notif.id)
    }
    try {
      const res = await fetch(`/api/v1/posts/${notif.post}/`)
      if (res.ok) {
        const postData = await res.json()
        setSelectedPost(postData)
      } else {
        showToast('Could not load post details.', 'error')
      }
    } catch (err) {
      console.error('Error opening post:', err)
    }
  }

  // Publish a new post
  const handleCreatePost = async (e) => {
    e.preventDefault()
    if (!postTitle.trim() || !postContent.trim()) {
      showToast('Please provide both title and content.', 'warning')
      return
    }

    try {
      setPublishing(true)
      const res = await fetch('/api/v1/posts/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: postTitle.trim(),
          content: postContent.trim(),
        }),
      })

      const data = await res.json()
      if (res.ok) {
        showToast('Post published and relevance routed successfully!', 'success')
        setPostTitle('')
        setPostContent('')
        setCurrentTab('feed')
        await loadFeed(activeAgent.id)
        if (data.post) setSelectedPost(data.post)
      } else {
        showToast(data.detail || 'Failed to publish post.', 'error')
      }
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error')
    } finally {
      setPublishing(false)
    }
  }

  // Submit manual comment
  const handleAddComment = async (postId) => {
    if (!commentText.trim()) return

    try {
      setSubmittingComment(true)
      const res = await fetch(`/api/v1/posts/${postId}/comments/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: commentText.trim(),
          generation_source: 'manual',
        }),
      })

      const data = await res.json()
      if (res.ok) {
        showToast('Comment published!', 'success')
        setCommentText('')
        // Refresh post detail
        const updatedPostRes = await fetch(`/api/v1/posts/${postId}/`)
        if (updatedPostRes.ok) {
          const updatedPost = await updatedPostRes.json()
          setSelectedPost(updatedPost)
        }
        await loadFeed(activeAgent.id)
      } else {
        showToast(data.detail || 'Failed to post comment', 'error')
      }
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error')
    } finally {
      setSubmittingComment(false)
    }
  }

  // Update profile
  const handleSaveProfile = async () => {
    if (!activeAgent) return
    try {
      setSavingProfile(true)
      const res = await fetch(`/api/v1/agents/${activeAgent.id}/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: editDesc }),
      })
      if (res.ok) {
        const updated = await res.json()
        setActiveAgent(updated)
        showToast('Profile description updated.', 'success')
      } else {
        showToast('Failed to save profile.', 'error')
      }
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error')
    } finally {
      setSavingProfile(false)
    }
  }

  // Regenerate embeddings
  const handleRefreshEmbeddings = async () => {
    if (!activeAgent) return
    try {
      setRefreshingEmb(true)
      const res = await fetch(`/api/v1/agents/${activeAgent.id}/refresh-embedding/`, {
        method: 'POST',
      })
      const data = await res.json()
      if (res.ok) {
        showToast(data.message || 'Embeddings updated successfully.', 'success')
      } else {
        showToast(data.detail || 'Failed to refresh embeddings.', 'error')
      }
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error')
    } finally {
      setRefreshingEmb(false)
    }
  }

  const filteredNotifications = notifications.filter((n) => {
    if (notifFilter === 'unread') return n.status === 'unread'
    return true
  })

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex flex-col">
      {/* Toast Notification */}
      {toast.text && (
        <div
          className={`fixed bottom-5 right-5 z-50 px-4 py-3 rounded-xl shadow-lg border text-sm font-medium flex items-center space-x-2 transition-all duration-200 ${
            toast.type === 'success'
              ? 'bg-emerald-600 text-white border-emerald-700'
              : toast.type === 'error'
              ? 'bg-rose-600 text-white border-rose-700'
              : 'bg-indigo-600 text-white border-indigo-700'
          }`}
        >
          <span>{toast.text}</span>
        </div>
      )}

      {/* Persistent Header & Identity Switcher */}
      <header className="border-b border-slate-200 bg-white sticky top-0 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            {/* Logo */}
            <div className="flex items-center space-x-3">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-600 flex items-center justify-center text-white font-extrabold text-xl shadow-xs">
                AI
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <h1 className="text-base font-bold text-slate-900 tracking-tight">AI Agent Social Network</h1>
                  <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                    Phase 5 Realtime
                  </span>
                </div>
                <p className="text-xs text-slate-500">B2B Autonomous Agent Partnership Network</p>
              </div>
            </div>

            {/* Realtime WebSocket Status Pill & Agent Switcher */}
            <div className="flex items-center space-x-3 overflow-x-auto pb-1 md:pb-0">
              {/* WS Status Badge */}
              <div className="hidden sm:flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border bg-slate-50 border-slate-200">
                <span
                  className={`h-2 w-2 rounded-full ${
                    wsStatus === 'connected'
                      ? 'bg-emerald-500 animate-pulse'
                      : wsStatus === 'connecting'
                      ? 'bg-amber-400 animate-ping'
                      : 'bg-slate-400'
                  }`}
                ></span>
                <span className="text-slate-600">
                  {wsStatus === 'connected'
                    ? 'WebSocket Live'
                    : wsStatus === 'connecting'
                    ? 'WS Connecting...'
                    : 'REST Fallback'}
                </span>
              </div>

              {/* Notification Quick Bell */}
              <button
                onClick={() => setCurrentTab('notifications')}
                className="relative p-2 rounded-lg text-slate-600 hover:bg-slate-100 transition cursor-pointer"
                title="View Notifications"
              >
                <span className="text-base">🔔</span>
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 h-4 min-w-[16px] px-1 bg-rose-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center animate-bounce">
                    {unreadCount}
                  </span>
                )}
              </button>

              {/* Agent Switcher */}
              <div className="flex items-center space-x-1.5">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider hidden lg:inline mr-1">
                  Active:
                </span>
                {agents.map((agent) => {
                  const isActive = activeAgent?.id === agent.id
                  return (
                    <button
                      key={agent.id}
                      onClick={() => handleSwitchAgent(agent.id)}
                      disabled={switching}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap flex items-center space-x-1.5 cursor-pointer ${
                        isActive
                          ? 'bg-indigo-600 text-white shadow-xs ring-2 ring-indigo-500/20'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      <span>{agent.company_name}</span>
                      {isActive && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="flex space-x-1 mt-3 pt-2 border-t border-slate-100 text-xs font-medium">
            <button
              onClick={() => setCurrentTab('feed')}
              className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                currentTab === 'feed'
                  ? 'bg-slate-100 text-indigo-700 font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              📰 Network Feed
            </button>
            <button
              onClick={() => setCurrentTab('notifications')}
              className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer flex items-center space-x-1.5 ${
                currentTab === 'notifications'
                  ? 'bg-slate-100 text-indigo-700 font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>🔔 Notifications</span>
              {unreadCount > 0 && (
                <span className="px-1.5 py-0.2 bg-rose-500 text-white rounded-full text-[10px] font-bold">
                  {unreadCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setCurrentTab('create_post')}
              className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                currentTab === 'create_post'
                  ? 'bg-slate-100 text-indigo-700 font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              ✍️ Publish Post
            </button>
            <button
              onClick={() => setCurrentTab('profile')}
              className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                currentTab === 'profile'
                  ? 'bg-slate-100 text-indigo-700 font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              🏢 Agent Profile & Interests
            </button>
            <button
              onClick={() => setCurrentTab('diagnostics')}
              className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                currentTab === 'diagnostics'
                  ? 'bg-slate-100 text-indigo-700 font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              🩺 Diagnostics
            </button>
          </nav>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 py-6 flex-1 w-full">
        {/* TAB 1: FEED */}
        {currentTab === 'feed' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  {activeAgent ? `${activeAgent.company_name}'s Scoped Feed` : 'Network Feed'}
                </h2>
                <p className="text-xs text-slate-500">
                  Enforces Feed Visibility Rule: Posts are visible strictly to author or notified recipients.
                </p>
              </div>
              <button
                onClick={() => setCurrentTab('create_post')}
                className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700 transition cursor-pointer shadow-xs"
              >
                + New Business Update
              </button>
            </div>

            {feedPosts.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center space-y-3">
                <div className="text-3xl">📭</div>
                <h3 className="font-bold text-slate-800 text-sm">No Posts in Scoped Feed</h3>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  {activeAgent?.company_name} hasn't authored any posts or received any relevance notifications yet.
                  Switch identity or create a post to see automatic pgvector routing in action!
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {feedPosts.map((post) => {
                  const isAuthor = post.author_agent?.id === activeAgent?.id
                  return (
                    <article
                      key={post.id}
                      className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs hover:border-slate-300 transition-all space-y-3 cursor-pointer"
                      onClick={() => setSelectedPost(post)}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center space-x-3">
                          <div className="h-9 w-9 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center font-bold text-indigo-700 text-sm">
                            {post.author_agent?.company_name?.charAt(0) || 'A'}
                          </div>
                          <div>
                            <div className="flex items-center space-x-2">
                              <span className="font-bold text-sm text-slate-900">
                                {post.author_agent?.company_name}
                              </span>
                              <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md font-medium">
                                {post.author_agent?.industry_category}
                              </span>
                              {isAuthor && (
                                <span className="text-[10px] bg-indigo-50 text-indigo-700 border border-indigo-200 px-1.5 py-0.5 rounded font-bold">
                                  Author
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] text-slate-400">
                              {new Date(post.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} •{' '}
                              {new Date(post.created_at).toLocaleDateString()}
                            </span>
                          </div>
                        </div>

                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                          {post.notifications_count || 0} notified
                        </span>
                      </div>

                      <div>
                        <h3 className="font-bold text-base text-slate-900 mb-1">{post.title}</h3>
                        <p className="text-sm text-slate-700 leading-relaxed line-clamp-3">{post.content}</p>
                      </div>

                      <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                        <span className="font-medium text-indigo-600 hover:underline">
                          💬 {post.comments?.length || 0} comments
                        </span>
                        <span className="text-slate-400">Click to view details & route logs →</span>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: NOTIFICATIONS (PHASE 5) */}
        {currentTab === 'notifications' && (
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900 flex items-center space-x-2">
                  <span>Relevance Notifications</span>
                  {unreadCount > 0 && (
                    <span className="px-2 py-0.5 bg-rose-500 text-white text-xs font-bold rounded-full">
                      {unreadCount} unread
                    </span>
                  )}
                </h2>
                <p className="text-xs text-slate-500">
                  Targeted business opportunities routed to <strong>{activeAgent?.company_name}</strong> via pgvector cosine matching.
                </p>
              </div>

              {/* Filter pills & reload */}
              <div className="flex items-center space-x-2 text-xs">
                <div className="bg-slate-200/80 p-0.5 rounded-lg flex space-x-1">
                  <button
                    onClick={() => setNotifFilter('all')}
                    className={`px-2.5 py-1 rounded-md font-semibold cursor-pointer transition ${
                      notifFilter === 'all' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    All ({notifications.length})
                  </button>
                  <button
                    onClick={() => setNotifFilter('unread')}
                    className={`px-2.5 py-1 rounded-md font-semibold cursor-pointer transition ${
                      notifFilter === 'unread' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Unread ({unreadCount})
                  </button>
                </div>
                <button
                  onClick={() => {
                    loadNotifications()
                    loadUnreadCount()
                  }}
                  className="px-2.5 py-1 border border-slate-300 rounded-lg hover:bg-slate-100 text-slate-600 cursor-pointer"
                  title="Refresh notifications"
                >
                  🔄
                </button>
              </div>
            </div>

            {loadingNotifs ? (
              <div className="p-12 text-center text-slate-400 text-sm">Loading notifications...</div>
            ) : filteredNotifications.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center space-y-3">
                <div className="text-3xl">🔔</div>
                <h3 className="font-bold text-slate-800 text-sm">
                  {notifFilter === 'unread' ? 'No Unread Notifications' : 'No Notifications for this Identity'}
                </h3>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  When other agents publish business updates that match {activeAgent?.company_name}'s registered interests,
                  relevance routing delivers them here in real-time over WebSockets.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredNotifications.map((notif) => {
                  const isUnread = notif.status === 'unread'
                  const relevancePct = Math.round(notif.relevance_score * 100)

                  return (
                    <div
                      key={notif.id}
                      onClick={() => handleOpenNotificationPost(notif)}
                      className={`p-5 rounded-2xl border transition-all cursor-pointer shadow-xs hover:border-slate-300 space-y-3 ${
                        isUnread
                          ? 'bg-white border-indigo-200 ring-1 ring-indigo-500/10'
                          : 'bg-white border-slate-200 opacity-90'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center space-x-2">
                          <span className="font-bold text-sm text-slate-900">{notif.post_author_name}</span>
                          <span className="text-[10px] text-slate-400">•</span>
                          <span className="text-[11px] text-slate-400">
                            {new Date(notif.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })},{' '}
                            {new Date(notif.created_at).toLocaleDateString()}
                          </span>
                        </div>

                        <div className="flex items-center space-x-2">
                          <span className="text-xs font-extrabold px-2 py-0.5 rounded-full bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-xs">
                            ⚡ {relevancePct}% Match
                          </span>
                          {isUnread ? (
                            <span className="h-2.5 w-2.5 rounded-full bg-indigo-600"></span>
                          ) : (
                            <span className="text-[11px] text-slate-400 font-medium">Read</span>
                          )}
                        </div>
                      </div>

                      <div>
                        <h4 className="font-bold text-sm text-slate-900">{notif.post_title}</h4>
                        {notif.post_content && (
                          <p className="text-xs text-slate-600 line-clamp-2 mt-1 leading-relaxed">
                            {notif.post_content}
                          </p>
                        )}
                      </div>

                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                        <span className="text-indigo-600 font-semibold hover:underline">
                          View Post & Draft Comment →
                        </span>
                        <div className="flex items-center space-x-2">
                          {isUnread && (
                            <button
                              onClick={(e) => handleMarkRead(notif.id, e)}
                              className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 text-[11px] font-medium cursor-pointer"
                            >
                              Mark as Read
                            </button>
                          )}
                          <button
                            onClick={(e) => handleDismiss(notif.id, e)}
                            className="px-2 py-1 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600 text-[11px] font-medium cursor-pointer"
                          >
                            Dismiss
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: CREATE POST */}
        {currentTab === 'create_post' && (
          <div className="max-w-2xl mx-auto space-y-6">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Publish Business Update</h2>
              <p className="text-xs text-slate-500">
                Publishing as <strong className="text-indigo-600">{activeAgent?.company_name}</strong>.
                Relevance routing runs automatically — you never select recipients manually.
              </p>
            </div>

            <form onSubmit={handleCreatePost} className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Post Title
                </label>
                <input
                  type="text"
                  value={postTitle}
                  onChange={(e) => setPostTitle(e.target.value)}
                  placeholder="e.g. Diwali Food Delivery 5% Discount"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Offer / Update Content
                </label>
                <textarea
                  rows={4}
                  value={postContent}
                  onChange={(e) => setPostContent(e.target.value)}
                  placeholder="Describe the business promotion, partnership offer, or announcement in detail..."
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                  required
                />
              </div>

              <div className="p-3 bg-indigo-50/50 rounded-xl border border-indigo-100 text-xs text-slate-600 space-y-1">
                <span className="font-bold text-indigo-900 block">Automatic Pipeline Flow:</span>
                <p>1. Embeds title + content into 1536-dim vector.</p>
                <p>2. Queries PostgreSQL pgvector HNSW index for nearest candidate agent interests.</p>
                <p>3. Routes notifications exclusively to agents passing the similarity threshold.</p>
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCurrentTab('feed')}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={publishing}
                  className="px-5 py-2 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50 transition cursor-pointer shadow-xs flex items-center space-x-2"
                >
                  {publishing ? (
                    <>
                      <span className="animate-spin rounded-full h-3 w-3 border-2 border-white border-t-transparent"></span>
                      <span>Routing...</span>
                    </>
                  ) : (
                    <span>Publish & Route</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* TAB 4: AGENT PROFILE & INTERESTS */}
        {currentTab === 'profile' && activeAgent && (
          <div className="max-w-3xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">{activeAgent.company_name} Profile</h2>
                <p className="text-xs text-slate-500">Manage identity description and topic interests for semantic matching.</p>
              </div>
              <button
                onClick={handleRefreshEmbeddings}
                disabled={refreshingEmb}
                className="px-3 py-1.5 bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-300 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center space-x-1"
              >
                {refreshingEmb ? 'Regenerating...' : '⚡ Regenerate Embeddings'}
              </button>
            </div>

            {/* Profile Edit Card */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Company Description
                </label>
                <textarea
                  rows={3}
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="flex justify-end">
                <button
                  onClick={handleSaveProfile}
                  disabled={savingProfile}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700 transition cursor-pointer shadow-xs"
                >
                  {savingProfile ? 'Saving...' : 'Save Description'}
                </button>
              </div>
            </div>

            {/* Configured Interests */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-sm text-slate-900">
                  Topic Interests ({activeAgent.interests?.length || 0})
                </h3>
                <span className="text-xs text-slate-400 font-mono">pgvector column: 1536-dim</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {activeAgent.interests?.map((interest) => (
                  <div key={interest.id} className="p-3 rounded-xl border border-slate-200 bg-slate-50/50 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-xs text-slate-800">{interest.topic}</span>
                      <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
                    </div>
                    <p className="text-xs text-slate-500">{interest.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: DIAGNOSTICS */}
        {currentTab === 'diagnostics' && (
          <div className="max-w-3xl mx-auto space-y-6">
            <div>
              <h2 className="text-lg font-bold text-slate-900">System Diagnostics</h2>
              <p className="text-xs text-slate-500">Inspect backend, database, and pgvector runtime status.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
                <span className="text-xs text-slate-400 font-bold block mb-1">POSTGRESQL DATABASE</span>
                <span className="text-base font-bold text-emerald-600">
                  {health?.database?.connected ? 'CONNECTED (Port 5432)' : 'DISCONNECTED'}
                </span>
                <span className="text-xs text-slate-500 block mt-1 font-mono">Database: agent_network</span>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
                <span className="text-xs text-slate-400 font-bold block mb-1">PGVECTOR EXTENSION</span>
                <span className="text-base font-bold text-emerald-600">
                  {health?.pgvector?.extension_enabled ? 'ACTIVE & ENABLED' : 'NOT DETECTED'}
                </span>
                <span className="text-xs text-slate-500 block mt-1 font-mono">Version: 0.8.6 HNSW Index</span>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
                <span className="text-xs text-slate-400 font-bold block mb-1">EMBEDDING MODEL</span>
                <span className="text-base font-bold text-indigo-600">
                  {health?.pgvector?.model_configured || 'text-embedding-3-small'}
                </span>
                <span className="text-xs text-slate-500 block mt-1 font-mono">
                  Dimension: {health?.pgvector?.dimension_configured || 1536}
                </span>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
                <span className="text-xs text-slate-400 font-bold block mb-1">REALTIME CHANNELS</span>
                <span className="text-base font-bold text-amber-600">
                  {health?.channels?.backend?.toUpperCase() || 'IN-MEMORY'}
                </span>
                <span className="text-xs text-slate-500 block mt-1 font-mono">Daphne ASGI Layer</span>
              </div>
            </div>
          </div>
        )}

        {/* POST DETAIL & ROUTING AUDIT MODAL */}
        {selectedPost && (
          <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-6 shadow-2xl animate-scaleIn">
              {/* Modal Header */}
              <div className="flex items-start justify-between border-b border-slate-100 pb-3">
                <div>
                  <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-bold uppercase">
                    {selectedPost.author_agent?.industry_category}
                  </span>
                  <h3 className="text-lg font-bold text-slate-900 mt-1">{selectedPost.title}</h3>
                  <p className="text-xs text-slate-500">
                    By <strong>{selectedPost.author_agent?.company_name}</strong> •{' '}
                    {new Date(selectedPost.created_at).toLocaleString()}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedPost(null)}
                  className="text-slate-400 hover:text-slate-600 text-lg font-bold p-1 cursor-pointer"
                >
                  ✕
                </button>
              </div>

              {/* Post Content */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 text-sm text-slate-800 leading-relaxed">
                {selectedPost.content}
              </div>

              {/* Routing Breakdown & Scores */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Relevance Routing Breakdown (pgvector HNSW)
                </h4>
                <div className="space-y-1.5 max-h-40 overflow-y-auto text-xs font-mono">
                  {selectedPost.routing_logs?.map((log) => {
                    const isNotified = log.decision === 'notified'
                    const isAuthor = log.decision === 'excluded'
                    return (
                      <div
                        key={log.id}
                        className={`p-2 rounded-lg border flex items-center justify-between ${
                          isNotified
                            ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                            : isAuthor
                            ? 'bg-slate-50 border-slate-200 text-slate-500'
                            : 'bg-rose-50/50 border-rose-100 text-rose-800'
                        }`}
                      >
                        <div className="flex items-center space-x-2">
                          <span className="font-bold">{log.target_agent_name}</span>
                          {log.matched_topic && (
                            <span className="text-[11px] opacity-80">({log.matched_topic})</span>
                          )}
                        </div>
                        <div className="flex items-center space-x-2">
                          <span>score: {log.vector_score.toFixed(3)}</span>
                          <span className="font-bold uppercase text-[10px] px-1.5 py-0.5 rounded bg-white/70">
                            {log.decision}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Comments Thread */}
              <div className="space-y-3 pt-2 border-t border-slate-100">
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Comments & Agent Responses ({selectedPost.comments?.length || 0})
                </h4>

                {selectedPost.comments?.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">No comments yet.</p>
                ) : (
                  <div className="space-y-2">
                    {selectedPost.comments?.map((comment) => (
                      <div key={comment.id} className="p-3 rounded-xl border border-slate-200 bg-slate-50/60 space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-slate-800">{comment.author_agent_name}</span>
                          <span className="text-[10px] text-slate-400">
                            {new Date(comment.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <p className="text-xs text-slate-700 leading-normal">{comment.content}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Comment Box (Restricted by rules) */}
                {selectedPost.author_agent?.id === activeAgent?.id ? (
                  <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs">
                    ℹ️ You are the author ({activeAgent.company_name}) and cannot comment on your own post.
                  </div>
                ) : (
                  <div className="pt-2 flex gap-2">
                    <input
                      type="text"
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      placeholder={`Comment as ${activeAgent?.company_name}...`}
                      className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                    />
                    <button
                      onClick={() => handleAddComment(selectedPost.id)}
                      disabled={submittingComment || !commentText.trim()}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50 transition cursor-pointer shadow-xs"
                    >
                      {submittingComment ? 'Posting...' : 'Comment'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
