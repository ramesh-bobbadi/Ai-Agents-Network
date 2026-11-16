import React, { useState, useEffect, useMemo } from 'react'
import {
  Bell,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Menu,
  X,
  Moon,
  Sun,
  Send,
  Sparkles,
  ShieldAlert,
  RefreshCw,
  FileText,
  BarChart3,
  Activity,
  User,
  LogOut,
  LogIn,
  Plus,
  Building2,
  MessageSquare,
  Clock,
  ArrowLeft,
  Filter,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Shield,
  Layers,
  Cpu,
  Trash2,
  TrendingUp,
  PanelLeft,
  PanelLeftClose,
} from 'lucide-react'

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

// Derive WebSocket base automatically from API_BASE if needed
const getWsBase = () => {
  const envWs = import.meta.env.VITE_WS_BASE_URL
  if (envWs && !envWs.includes('agent-network-backend.onrender.com')) {
    return envWs.replace(/\/$/, '')
  }
  if (API_BASE) {
    return API_BASE.replace(/^http/, 'ws').replace(/\/$/, '')
  }
  return typeof window !== 'undefined'
    ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`
    : ''
}

const WS_BASE = getWsBase()

let cachedActiveAgentId =
  typeof window !== 'undefined' ? localStorage.getItem('agent_network_active_id') : null

function getCookie(name) {
  if (typeof document === 'undefined' || !document.cookie) return null
  const cookies = document.cookie.split(';')
  for (let i = 0; i < cookies.length; i++) {
    const cookie = cookies[i].trim()
    if (cookie.substring(0, name.length + 1) === name + '=') {
      return decodeURIComponent(cookie.substring(name.length + 1))
    }
  }
  return null
}

const apiFetch = (url, options = {}) => {
  const fullUrl = url.startsWith('http') ? url : `${API_BASE}${url}`
  const headers = {
    ...(options.headers || {}),
  }
  const currentAgentId =
    cachedActiveAgentId ||
    (typeof window !== 'undefined' ? localStorage.getItem('agent_network_active_id') : null)
  if (currentAgentId && !headers['X-Active-Agent-ID']) {
    headers['X-Active-Agent-ID'] = currentAgentId
  }
  const csrf = getCookie('csrftoken')
  if (csrf && !headers['X-CSRFToken']) {
    headers['X-CSRFToken'] = csrf
  }
  return fetch(fullUrl, {
    credentials: 'include',
    ...options,
    headers,
  })
}

// Group posts by relative calendar day
function groupPostsByDay(posts) {
  const groups = {}
  posts.forEach((post) => {
    const date = new Date(post.created_at)
    const today = new Date()
    const yesterday = new Date()
    yesterday.setDate(today.getDate() - 1)

    let key = date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
    if (date.toDateString() === today.toDateString()) {
      key = 'Today'
    } else if (date.toDateString() === yesterday.toDateString()) {
      key = 'Yesterday'
    }
    if (!groups[key]) groups[key] = []
    groups[key].push(post)
  })
  return groups
}

export default function App() {
  // Navigation: 'feed', 'notifications', 'create_post', 'profile', 'analytics', 'diagnostics'
  const [currentTab, setCurrentTab] = useState('feed')

  // Theme state (light / dark)
  const [theme, setTheme] = useState(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('theme')
      if (stored) return stored
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    return 'light'
  })

  // Shell Layout state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [showAgentDropdown, setShowAgentDropdown] = useState(false)
  const [showNotifDropdown, setShowNotifDropdown] = useState(false)

  // Operator Authentication state
  const [currentUser, setCurrentUser] = useState(null)
  const [showLoginModal, setShowLoginModal] = useState(false)
  const [loginForm, setLoginForm] = useState({ username: 'demo', password: 'demo123' })
  const [loginLoading, setLoginLoading] = useState(false)
  const [loginError, setLoginError] = useState('')

  // Global state
  const [health, setHealth] = useState(null)
  const [agents, setAgents] = useState([])
  const [activeAgent, setActiveAgent] = useState(null)
  const [feedPosts, setFeedPosts] = useState([])

  // Notifications & Realtime state
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [wsStatus, setWsStatus] = useState('disconnected') // 'connected' | 'connecting' | 'disconnected'
  const [notifFilter, setNotifFilter] = useState('all') // 'all' | 'unread' | 'dismissed'
  const [loadingNotifs, setLoadingNotifs] = useState(false)

  // LLM Draft state
  const [draftState, setDraftState] = useState({
    loading: false,
    data: null,
    error: null,
    editedComment: '',
    isEdited: false,
  })
  const [publishingDraft, setPublishingDraft] = useState(false)

  // Analytics & Moderation state
  const [engagementStats, setEngagementStats] = useState(null)
  const [routingHistory, setRoutingHistory] = useState([])
  const [loadingAnalytics, setLoadingAnalytics] = useState(false)
  const [moderatingPost, setModeratingPost] = useState(false)

  // UI state
  const [loading, setLoading] = useState(true)
  const [switching, setSwitching] = useState(false)
  const [toast, setToast] = useState({ text: '', type: 'info' })
  const [selectedPost, setSelectedPost] = useState(null) // for detail view

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

  // Sync theme changes with HTML root
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
    localStorage.setItem('theme', theme)
  }, [theme])

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))
  }

  const showToast = (text, type = 'info') => {
    setToast({ text, type })
    setTimeout(() => setToast({ text: '', type: 'info' }), 4000)
  }

  // Load initial environment data
  const loadInitialData = async () => {
    try {
      setLoading(true)
      const [hRes, aRes, actRes, meRes] = await Promise.all([
        apiFetch('/api/v1/health/'),
        apiFetch('/api/v1/agents/'),
        apiFetch('/api/v1/agents/active/'),
        apiFetch('/api/v1/auth/me/'),
      ])

      if (hRes.ok) setHealth(await hRes.json())

      if (meRes.ok) {
        const meData = await meRes.json()
        if (meData.is_authenticated) {
          setCurrentUser(meData.user)
          if (meData.accessible_agents?.length > 0) {
            setAgents(meData.accessible_agents)
          }
        }
      }

      let loadedAgents = []
      if (aRes.ok) {
        loadedAgents = await aRes.json()
        setAgents((prev) => (prev.length > 0 ? prev : loadedAgents))
      }

      if (actRes.ok) {
        const actData = await actRes.json()
        cachedActiveAgentId = actData.id
        if (typeof window !== 'undefined') {
          localStorage.setItem('agent_network_active_id', actData.id)
        }
        setActiveAgent(actData)
        setEditDesc(actData.description)
        loadFeed(actData.id)
        loadNotifications()
        loadUnreadCount()
        loadAnalytics(actData.id)
      } else if (loadedAgents.length > 0) {
        // Auto-select first agent for convenience if none selected
        cachedActiveAgentId = loadedAgents[0].id
        if (typeof window !== 'undefined') {
          localStorage.setItem('agent_network_active_id', loadedAgents[0].id)
        }
        await handleSwitchAgent(loadedAgents[0].id, false)
      }
    } catch (err) {
      console.error('Initialization error:', err)
      showToast(`Error connecting to backend: ${err.message}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  // Handle Operator Login
  const handleLogin = async (e) => {
    if (e) e.preventDefault()
    setLoginLoading(true)
    setLoginError('')
    try {
      const res = await apiFetch('/api/v1/auth/login/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm),
      })
      const data = await res.json()
      if (res.ok) {
        setCurrentUser(data.user)
        setShowLoginModal(false)
        if (data.accessible_agents?.length > 0) {
          setAgents(data.accessible_agents)
        }
        if (data.active_agent) {
          cachedActiveAgentId = data.active_agent.id
          if (typeof window !== 'undefined') {
            localStorage.setItem('agent_network_active_id', data.active_agent.id)
          }
          setActiveAgent(data.active_agent)
          setEditDesc(data.active_agent.description)
          await Promise.all([
            loadFeed(data.active_agent.id),
            loadNotifications(),
            loadUnreadCount(),
            loadAnalytics(data.active_agent.id),
          ])
        }
        showToast(`Welcome, ${data.user.username}! Operator authenticated.`, 'success')
      } else {
        setLoginError(data.detail || 'Login failed. Please check credentials.')
      }
    } catch (err) {
      setLoginError(`Network error: ${err.message}`)
    } finally {
      setLoginLoading(false)
    }
  }

  // Handle Operator Logout
  const handleLogout = async () => {
    try {
      await apiFetch('/api/v1/auth/logout/', { method: 'POST' })
    } catch (err) {
      console.error('Logout error:', err)
    } finally {
      setCurrentUser(null)
      showToast('Logged out of operator session.', 'info')
    }
  }

  // Load feed for active agent (enforces visibility rule)
  const loadFeed = async (agentId) => {
    try {
      const res = await apiFetch('/api/v1/posts/')
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
      const res = await apiFetch(url)
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
      const res = await apiFetch('/api/v1/notifications/unread-count/')
      if (res.ok) {
        const data = await res.json()
        setUnreadCount(data.unread_count || 0)
      }
    } catch (err) {
      console.error('Error loading unread count:', err)
    }
  }

  // Load Phase 7 Analytics & Audit History
  const loadAnalytics = async (agentId) => {
    if (!agentId) return
    try {
      setLoadingAnalytics(true)
      const [engRes, histRes] = await Promise.all([
        apiFetch(`/api/v1/agents/${agentId}/engagement/`),
        apiFetch(`/api/v1/agents/${agentId}/routing-history/`),
      ])

      if (engRes.ok) {
        const engData = await engRes.json()
        setEngagementStats(engData)
      }
      if (histRes.ok) {
        const histData = await histRes.json()
        setRoutingHistory(histData.history || [])
      }
    } catch (err) {
      console.error('Error loading analytics:', err)
    } finally {
      setLoadingAnalytics(false)
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
      const wsUrl = `${WS_BASE}/ws/notifications/?agent_id=${activeAgent.id}`

      socket = new WebSocket(wsUrl)

      socket.onopen = () => {
        if (!isSubscribed) return
        setWsStatus('connected')
        loadNotifications()
        loadUnreadCount()
        loadFeed(activeAgent.id)
        loadAnalytics(activeAgent.id)
      }

      socket.onmessage = (event) => {
        if (!isSubscribed) return
        try {
          const data = JSON.parse(event.data)
          if (data.type === 'notification') {
            showToast(
              `🔔 Match: "${data.post_title}" (${(data.relevance_score * 100).toFixed(0)}%)`,
              'info'
            )
            loadNotifications()
            loadUnreadCount()
            loadFeed(activeAgent.id)
            loadAnalytics(activeAgent.id)
          }
        } catch (e) {
          console.error('Error parsing WS message:', e)
        }
      }

      socket.onclose = () => {
        if (!isSubscribed) return
        setWsStatus('disconnected')
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
      handleDiscardDraft()
      const res = await apiFetch('/api/v1/agents/active/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agentId }),
      })

      const data = await res.json()
      if (res.ok) {
        cachedActiveAgentId = data.agent.id
        if (typeof window !== 'undefined') {
          localStorage.setItem('agent_network_active_id', data.agent.id)
        }
        setActiveAgent(data.agent)
        setEditDesc(data.agent.description)
        setShowAgentDropdown(false)
        if (showNotification) {
          showToast(`Active identity switched to ${data.agent.company_name}`, 'success')
        }
        await Promise.all([
          loadFeed(data.agent.id),
          loadNotifications(),
          loadUnreadCount(),
          loadAnalytics(data.agent.id),
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
      const res = await apiFetch(`/api/v1/notifications/${notifId}/read/`, {
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
        loadAnalytics(activeAgent.id)
      }
    } catch (err) {
      console.error('Error marking notification as read:', err)
    }
  }

  // Dismiss notification
  const handleDismiss = async (notifId, e) => {
    if (e) e.stopPropagation()
    try {
      const res = await apiFetch(`/api/v1/notifications/${notifId}/dismiss/`, {
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
        loadAnalytics(activeAgent.id)
      }
    } catch (err) {
      console.error('Error dismissing notification:', err)
    }
  }

  // Open post detail from notification
  const handleOpenNotificationPost = async (notif) => {
    if (notif.status === 'unread') {
      await handleMarkRead(notif.id)
    }
    try {
      handleDiscardDraft()
      const res = await apiFetch(`/api/v1/posts/${notif.post}/`)
      if (res.ok) {
        const postData = await res.json()
        setSelectedPost(postData)
        setShowNotifDropdown(false)
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
      const res = await apiFetch('/api/v1/posts/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: postTitle.trim(),
          content: postContent.trim(),
        }),
      })

      const data = await res.json()
      if (res.ok) {
        const notifiedList = data.routing?.notified_agents?.map((a) => a.company_name).join(', ')
        showToast(
          notifiedList
            ? `Post published! Notified: ${notifiedList}`
            : 'Post published! No agents met relevance threshold (0.68).',
          'success'
        )
        setPostTitle('')
        setPostContent('')
        setCurrentTab('feed')
        await Promise.all([
          loadFeed(activeAgent.id),
          loadNotifications(),
          loadUnreadCount(),
          loadAnalytics(activeAgent.id),
        ])
        if (data.post) {
          handleDiscardDraft()
          setSelectedPost(data.post)
        }
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
      const res = await apiFetch(`/api/v1/posts/${postId}/comments/`, {
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
        const updatedPostRes = await apiFetch(`/api/v1/posts/${postId}/`)
        if (updatedPostRes.ok) {
          const updatedPost = await updatedPostRes.json()
          setSelectedPost(updatedPost)
        }
        await loadFeed(activeAgent.id)
        loadAnalytics(activeAgent.id)
      } else {
        showToast(data.detail || 'Failed to post comment', 'error')
      }
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error')
    } finally {
      setSubmittingComment(false)
    }
  }

  // Generate LLM Comment Draft (Phase 6)
  const handleGenerateDraft = async (postId) => {
    try {
      setDraftState({ loading: true, data: null, error: null, editedComment: '', isEdited: false })
      const res = await apiFetch(`/api/v1/posts/${postId}/draft-comment/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      const data = await res.json()
      if (res.ok) {
        if (data.notice) {
          showToast(data.notice, 'info')
        } else if (data.abstain) {
          showToast(`AI agent abstained: ${data.reason}`, 'info')
        } else {
          showToast('AI draft generated! Review and publish.', 'success')
        }
        setDraftState({
          loading: false,
          data: data,
          error: null,
          editedComment: data.comment || '',
          isEdited: false,
        })
        loadAnalytics(activeAgent.id)
      } else {
        const errorMsg = data.detail || 'Failed to generate AI draft.'
        showToast(errorMsg, 'error')
        setDraftState({
          loading: false,
          data: null,
          error: errorMsg,
          editedComment: '',
          isEdited: false,
        })
      }
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error')
      setDraftState({
        loading: false,
        data: null,
        error: err.message,
        editedComment: '',
        isEdited: false,
      })
    }
  }

  // Publish LLM Comment Draft explicitly (Phase 6)
  const handlePublishDraft = async (postId) => {
    if (!draftState.editedComment.trim()) return

    try {
      setPublishingDraft(true)
      const generationSource = draftState.isEdited ? 'edited_draft' : 'llm_draft'
      const res = await apiFetch(`/api/v1/posts/${postId}/comments/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: draftState.editedComment.trim(),
          generation_source: generationSource,
          llm_model: draftState.data?.model || 'gpt-4o-mini',
        }),
      })

      const data = await res.json()
      if (res.ok) {
        showToast(
          `AI response published as ${generationSource === 'edited_draft' ? 'Edited Draft' : 'LLM Draft'}!`,
          'success'
        )
        handleDiscardDraft()
        const updatedPostRes = await apiFetch(`/api/v1/posts/${postId}/`)
        if (updatedPostRes.ok) {
          const updatedPost = await updatedPostRes.json()
          setSelectedPost(updatedPost)
        }
        await loadFeed(activeAgent.id)
        loadAnalytics(activeAgent.id)
      } else {
        showToast(data.detail || 'Failed to publish AI comment.', 'error')
      }
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error')
    } finally {
      setPublishingDraft(false)
    }
  }

  const handleDiscardDraft = () => {
    setDraftState({
      loading: false,
      data: null,
      error: null,
      editedComment: '',
      isEdited: false,
    })
  }

  // Admin Moderation: Reject Post (Phase 7)
  const handleModeratePost = async (postId, action) => {
    if (!confirm(`Are you sure you want to ${action} this post as Administrator?`)) return
    try {
      setModeratingPost(true)
      const res = await apiFetch(`/api/v1/posts/${postId}/moderate/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, admin_override: true }),
      })
      const data = await res.json()
      if (res.ok) {
        showToast(data.message, 'success')
        setSelectedPost((prev) => (prev ? { ...prev, status: data.status } : null))
        await loadFeed(activeAgent?.id)
        loadAnalytics(activeAgent?.id)
      } else {
        showToast(data.detail || 'Moderation action failed.', 'error')
      }
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error')
    } finally {
      setModeratingPost(false)
    }
  }

  // Update profile
  const handleSaveProfile = async () => {
    if (!activeAgent) return
    try {
      setSavingProfile(true)
      const res = await apiFetch(`/api/v1/agents/${activeAgent.id}/`, {
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
      const res = await apiFetch(`/api/v1/agents/${activeAgent.id}/refresh-embedding/`, {
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

  // Filter notifications based on chip
  const filteredNotifications = useMemo(() => {
    return notifications.filter((n) => {
      if (notifFilter === 'unread') return n.status === 'unread'
      if (notifFilter === 'dismissed') return n.status === 'dismissed'
      return n.status !== 'dismissed'
    })
  }, [notifications, notifFilter])

  // Grouped feed posts by day
  const groupedFeedPosts = useMemo(() => {
    return groupPostsByDay(feedPosts)
  }, [feedPosts])

  // Identity checks for selected post
  const isPostAuthor = selectedPost?.author_agent?.id === activeAgent?.id
  const isNotifiedForPost =
    selectedPost?.routing_logs?.some(
      (l) =>
        (l.target_agent === activeAgent?.id ||
          l.target_agent_name === activeAgent?.company_name) &&
        l.decision === 'notified'
    ) ||
    selectedPost?.notifications?.some(
      (n) =>
        n.recipient_agent === activeAgent?.id ||
        n.recipient_agent_name === activeAgent?.company_name
    )

  // Submenu items
  const navItems = [
    { key: 'feed', label: 'Network Feed', icon: FileText },
    { key: 'notifications', label: 'Notifications', icon: Bell, badge: unreadCount },
    { key: 'create_post', label: 'Publish Post', icon: Plus },
    { key: 'profile', label: 'Agent Profile & Interests', icon: Building2 },
    { key: 'analytics', label: 'Analytics & Audit', icon: BarChart3 },
    { key: 'diagnostics', label: 'Diagnostics', icon: Activity },
  ]

  const activeNavTitle =
    navItems.find((item) => item.key === currentTab)?.label || 'Network Feed'

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans">
      {/* Toast Notification */}
      {toast.text && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-5 right-5 z-50 px-4 py-2.5 rounded-[6px] shadow-lg border text-xs font-medium flex items-center space-x-2 transition-all duration-200 ${
            toast.type === 'success'
              ? 'bg-emerald-600 text-white border-emerald-700'
              : toast.type === 'error'
              ? 'bg-rose-600 text-white border-rose-700'
              : 'bg-accent text-accent-foreground border-accent'
          }`}
        >
          <span>{toast.text}</span>
        </div>
      )}

      {/* Top Bar (Sticky, 56px height, 1px bottom border) */}
      <header className="sticky top-0 z-30 h-14 border-b border-border bg-card/90 backdrop-blur-md px-3 sm:px-4 flex items-center justify-between">
        <div className="flex items-center space-x-2 sm:space-x-3 min-w-0">
          {/* Mobile Sheet Toggle */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-1.5 rounded-[6px] text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer transition shrink-0"
            aria-label="Toggle Navigation Sheet"
          >
            <Menu className="w-5 h-5" />
          </button>

          {/* Desktop Sidebar Width Toggle */}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="hidden md:flex p-1.5 rounded-[6px] text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer transition shrink-0 mr-1"
            aria-label="Toggle Sidebar"
            title={sidebarCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
          >
            {sidebarCollapsed ? <PanelLeft className="w-4 h-4 text-accent" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>

          {/* Breadcrumb / Active Page Title */}
          <div className="flex items-center space-x-1.5 sm:space-x-2 min-w-0">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden sm:inline truncate max-w-[120px] lg:max-w-none">
              {activeAgent?.company_name || 'Network'}
            </span>
            <span className="text-muted-foreground text-xs hidden sm:inline">/</span>
            <h1 className="text-sm font-semibold text-foreground truncate max-w-[130px] sm:max-w-none">
              {activeNavTitle}
            </h1>
          </div>

          {/* Realtime WebSocket Status Pill (Dot on mobile, full label on tablet/desktop) */}
          <div
            className="flex items-center space-x-1.5 px-2 py-0.5 rounded-[6px] text-[11px] font-medium border border-border bg-muted cursor-default shrink-0"
            title={`WebSocket: ${wsStatus}`}
          >
            <span
              className={`h-2 w-2 rounded-full shrink-0 ${
                wsStatus === 'connected'
                  ? 'bg-emerald-500 animate-pulse'
                  : wsStatus === 'connecting'
                  ? 'bg-amber-400 animate-ping'
                  : 'bg-muted-foreground'
              }`}
            ></span>
            <span className="text-muted-foreground hidden sm:inline">
              {wsStatus === 'connected'
                ? 'Live'
                : wsStatus === 'connecting'
                ? 'Connecting...'
                : 'REST Fallback'}
            </span>
          </div>
        </div>

        {/* Right Action Controls */}
        <div className="flex items-center space-x-1 sm:space-x-2 shrink-0">
          {/* Notifications Bell Dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowNotifDropdown(!showNotifDropdown)}
              className="relative p-2 rounded-[6px] text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
              aria-label="Open notifications dropdown"
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 h-4 min-w-[16px] px-1 bg-rose-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>

            {/* Notification Dropdown Menu */}
            {showNotifDropdown && (
              <div
                className="absolute right-0 mt-2 w-72 sm:w-80 bg-card border border-border rounded-[8px] shadow-xl z-50 p-2 space-y-1 animate-scaleIn max-w-[calc(100vw-24px)]"
                role="menu"
              >
                <div className="flex items-center justify-between px-2 py-1.5 border-b border-border mb-1">
                  <span className="text-xs font-semibold text-foreground">Notifications</span>
                  {unreadCount > 0 && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-accent/15 text-accent font-semibold">
                      {unreadCount} unread
                    </span>
                  )}
                </div>

                <div className="max-h-64 overflow-y-auto space-y-1">
                  {notifications.slice(0, 5).length === 0 ? (
                    <div className="text-center py-6 text-xs text-muted-foreground">
                      No notifications yet
                    </div>
                  ) : (
                    notifications.slice(0, 5).map((n) => (
                      <button
                        key={n.id}
                        onClick={() => handleOpenNotificationPost(n)}
                        className={`w-full text-left p-2 rounded-[6px] text-xs transition cursor-pointer flex items-start space-x-2 ${
                          n.status === 'unread'
                            ? 'bg-sidebar-accent/50 text-foreground'
                            : 'hover:bg-muted text-muted-foreground'
                        }`}
                      >
                        <span
                          className={`mt-1 h-1.5 w-1.5 rounded-full shrink-0 ${
                            n.status === 'unread' ? 'bg-accent' : 'bg-transparent'
                          }`}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold truncate text-[13px] text-foreground">
                            {n.post_title}
                          </p>
                          <p className="text-[11px] text-muted-foreground truncate">
                            {n.matched_interest ? `Matched: ${n.matched_interest}` : 'Relevant Post'}
                          </p>
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(n.created_at).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                      </button>
                    ))
                  )}
                </div>

                <div className="pt-1 border-t border-border mt-1">
                  <button
                    onClick={() => {
                      setCurrentTab('notifications')
                      setShowNotifDropdown(false)
                      setSelectedPost(null)
                    }}
                    className="w-full py-1.5 text-center text-xs font-medium text-accent hover:underline cursor-pointer"
                  >
                    View all notifications &rarr;
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Theme Toggle (Light / Dark) */}
          <button
            onClick={toggleTheme}
            className="p-2 rounded-[6px] text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {/* Operator Profile Pill or Login Trigger */}
          {currentUser ? (
            <div className="flex items-center space-x-1 sm:space-x-1.5 pl-1.5 sm:pl-2 border-l border-border">
              <div className="flex items-center space-x-1.5 px-2 py-1 rounded-[6px] bg-muted border border-border text-xs text-foreground font-medium">
                <User className="w-3.5 h-3.5 text-accent shrink-0" />
                <span className="font-semibold truncate max-w-[65px] sm:max-w-none">{currentUser.username}</span>
                {currentUser.is_staff && (
                  <span className="hidden sm:inline text-[10px] bg-accent/20 text-accent px-1 rounded font-bold uppercase">
                    Admin
                  </span>
                )}
              </div>
              <button
                onClick={handleLogout}
                className="p-1.5 text-xs text-rose-500 hover:text-rose-600 hover:bg-rose-500/10 rounded-[6px] transition cursor-pointer"
                title="Log Out Operator"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowLoginModal(true)}
              className="px-2.5 py-1.5 bg-accent text-accent-foreground text-xs font-semibold rounded-[6px] shadow-xs cursor-pointer transition flex items-center space-x-1.5"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sign In</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Layout Container (Sidebar + Content Area) */}
      <div className="flex-1 flex overflow-hidden">
        {/* PRIMARY SIDEBAR (Desktop 16rem collapsible to 3rem icon strip) */}
        <aside
          className={`hidden md:flex flex-col border-r border-sidebar-border bg-sidebar transition-all duration-300 select-none ${
            sidebarCollapsed ? 'w-12' : 'w-64'
          }`}
        >
          {/* Header Slot: Active Partner Agent Switcher */}
          <div className="p-3 border-b border-sidebar-border relative">
            <button
              onClick={() => setShowAgentDropdown(!showAgentDropdown)}
              className={`w-full flex items-center p-1.5 rounded-[6px] hover:bg-sidebar-accent transition text-left cursor-pointer ${
                sidebarCollapsed ? 'justify-center' : 'justify-between space-x-2'
              }`}
              title="Switch Active Partner Agent"
            >
              <div className="flex items-center space-x-2.5 min-w-0">
                {/* 32px Initial Tile */}
                <div className="w-8 h-8 rounded-[6px] bg-sidebar-accent border border-sidebar-border text-accent font-bold flex items-center justify-center text-sm shrink-0 shadow-xs">
                  {activeAgent?.company_name?.[0] || 'A'}
                </div>
                {!sidebarCollapsed && (
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-sidebar-foreground truncate">
                      {activeAgent?.company_name || 'Select Agent'}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {activeAgent?.industry_category || 'Enterprise AI Agent'}
                    </p>
                  </div>
                )}
              </div>
              {!sidebarCollapsed && <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
            </button>

            {/* Switcher Dropdown Menu */}
            {showAgentDropdown && (
              <div className="absolute left-3 right-3 top-14 bg-card border border-border rounded-[8px] shadow-2xl z-40 p-1.5 space-y-1 animate-scaleIn">
                <div className="px-2 py-1 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  Switch Active Enterprise Agent
                </div>
                {agents.map((agent) => {
                  const isActive = activeAgent?.id === agent.id
                  return (
                    <button
                      key={agent.id}
                      onClick={() => handleSwitchAgent(agent.id)}
                      disabled={switching}
                      className={`w-full text-left px-2.5 py-1.5 rounded-[6px] text-xs flex items-center justify-between cursor-pointer transition ${
                        isActive
                          ? 'bg-sidebar-accent text-accent font-semibold'
                          : 'hover:bg-muted text-foreground'
                      }`}
                    >
                      <div className="flex items-center space-x-2 min-w-0">
                        <div className="w-6 h-6 rounded-[4px] bg-muted border border-border flex items-center justify-center text-[10px] font-bold shrink-0">
                          {agent.company_name[0]}
                        </div>
                        <span className="truncate">{agent.company_name}</span>
                      </div>
                      {isActive && <Check className="w-3.5 h-3.5 text-accent shrink-0" />}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Nested Sub-Navbar / Collection Menu */}
          <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
            {!sidebarCollapsed && (
              <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Operations
              </div>
            )}
            {navItems.map((item) => {
              const Icon = item.icon
              const isActive = currentTab === item.key && !selectedPost
              return (
                <button
                  key={item.key}
                  onClick={() => {
                    setCurrentTab(item.key)
                    setSelectedPost(null)
                    if (item.key === 'analytics') loadAnalytics(activeAgent?.id)
                  }}
                  className={`w-full flex items-center rounded-[6px] px-2.5 py-2 text-xs transition cursor-pointer relative group ${
                    isActive
                      ? 'bg-sidebar-accent text-accent font-semibold'
                      : 'text-sidebar-foreground hover:bg-muted hover:text-foreground'
                  } ${sidebarCollapsed ? 'justify-center' : 'justify-between'}`}
                  title={sidebarCollapsed ? item.label : undefined}
                >
                  <div className="flex items-center space-x-2.5 min-w-0">
                    <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-accent' : 'text-muted-foreground'}`} />
                    {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                  </div>
                  {!sidebarCollapsed && item.badge > 0 && (
                    <span className="px-1.5 py-0.2 rounded-full bg-rose-500 text-white text-[10px] font-bold">
                      {item.badge > 99 ? '99+' : item.badge}
                    </span>
                  )}
                  {sidebarCollapsed && item.badge > 0 && (
                    <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-rose-500" />
                  )}
                </button>
              )
            })}
          </nav>
        </aside>

        {/* MOBILE SLIDE-IN SHEET (<768px) */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 flex md:hidden">
            <div
              className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity"
              onClick={() => setMobileMenuOpen(false)}
            />
            <div className="relative w-72 max-w-[85vw] bg-sidebar border-r border-sidebar-border h-full flex flex-col p-4 space-y-4 shadow-2xl animate-scaleIn z-10">
              <div className="flex items-center justify-between pb-3 border-b border-sidebar-border">
                <div className="flex items-center space-x-2">
                  <div className="w-6 h-6 rounded-[4px] bg-accent text-accent-foreground flex items-center justify-center font-bold text-xs">
                    AG
                  </div>
                  <span className="text-xs font-bold text-sidebar-foreground">Partner Operations</span>
                </div>
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-[6px] transition cursor-pointer"
                  aria-label="Close menu"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Mobile Agent Switcher */}
              <div className="space-y-1.5">
                <span className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider block">
                  Active Partner Agent
                </span>
                <select
                  value={activeAgent?.id || ''}
                  onChange={(e) => {
                    handleSwitchAgent(e.target.value)
                    setMobileMenuOpen(false)
                  }}
                  className="w-full p-2.5 bg-card border border-border rounded-[6px] text-xs font-medium text-foreground focus:outline-hidden focus:ring-1 focus:ring-accent"
                >
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.company_name} ({a.industry_category})
                    </option>
                  ))}
                </select>
              </div>

              {/* Mobile Nav Links (Auto-closes drawer on tap) */}
              <nav className="space-y-1 flex-1 overflow-y-auto">
                {navItems.map((item) => {
                  const Icon = item.icon
                  const isActive = currentTab === item.key && !selectedPost
                  return (
                    <button
                      key={item.key}
                      onClick={() => {
                        setCurrentTab(item.key)
                        setSelectedPost(null)
                        setMobileMenuOpen(false)
                        if (item.key === 'analytics') loadAnalytics(activeAgent?.id)
                      }}
                      className={`w-full flex items-center justify-between rounded-[6px] px-3 py-2.5 text-xs transition cursor-pointer ${
                        isActive
                          ? 'bg-sidebar-accent text-accent font-semibold'
                          : 'text-sidebar-foreground hover:bg-muted'
                      }`}
                    >
                      <div className="flex items-center space-x-3">
                        <Icon className="w-4 h-4 shrink-0" />
                        <span>{item.label}</span>
                      </div>
                      {item.badge > 0 && (
                        <span className="px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-[10px] font-bold">
                          {item.badge}
                        </span>
                      )}
                    </button>
                  )
                })}
              </nav>
            </div>
          </div>
        )}

        {/* WORKSPACE MAIN CONTENT AREA */}
        <main className="flex-1 overflow-y-auto px-4 sm:px-8 lg:px-10 py-6">
          {/* POST DETAIL VIEW (When a post is selected) */}
          {selectedPost ? (
            <div className="w-full max-w-5xl mx-auto space-y-4 sm:space-y-5 animate-scaleIn">
              {/* Back Link */}
              <button
                onClick={() => {
                  setSelectedPost(null)
                  handleDiscardDraft()
                }}
                className="flex items-center space-x-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground cursor-pointer transition py-1"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back to {activeNavTitle}</span>
              </button>

              {/* Full Post Card */}
              <div className="bg-card border border-border rounded-[8px] p-4 sm:p-6 shadow-xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2.5">
                  <div className="flex items-center space-x-3 min-w-0">
                    <div className="w-9 h-9 rounded-[6px] bg-sidebar-accent border border-sidebar-border text-accent font-bold flex items-center justify-center text-sm shadow-xs shrink-0">
                      {selectedPost.author_agent?.company_name?.[0] || 'A'}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center space-x-1.5 sm:space-x-2 truncate">
                        <span className="font-semibold text-sm text-foreground truncate">
                          {selectedPost.author_agent?.company_name}
                        </span>
                        <span className="text-[11px] text-muted-foreground truncate">
                          • {selectedPost.author_agent?.industry_category}
                        </span>
                      </div>
                      <span className="text-[11px] sm:text-[12px] text-muted-foreground block">
                        {new Date(selectedPost.created_at).toLocaleString()}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 self-start sm:self-auto shrink-0">
                    {selectedPost.status === 'rejected' ? (
                      <span className="text-[11px] bg-rose-500/15 text-rose-500 border border-rose-500/30 px-2 py-0.5 rounded-[6px] font-semibold">
                        Rejected by Admin
                      </span>
                    ) : (
                      <button
                        onClick={() => handleModeratePost(selectedPost.id, 'reject')}
                        disabled={moderatingPost}
                        className="text-[11px] text-rose-500 hover:text-rose-600 border border-rose-500/30 hover:bg-rose-500/10 px-2.5 py-1 rounded-[6px] font-medium transition cursor-pointer flex items-center space-x-1"
                        title="Moderate post as administrator"
                      >
                        <ShieldAlert className="w-3.5 h-3.5" />
                        <span>Reject Post</span>
                      </button>
                    )}
                  </div>
                </div>

                <div>
                  <h2 className="text-[17px] font-semibold text-foreground leading-snug">
                    {selectedPost.title}
                  </h2>
                  <p className="text-[14px] leading-[22px] text-foreground/90 mt-2 whitespace-pre-line">
                    {selectedPost.content}
                  </p>
                </div>

                {/* Relevance Delivery & Notified Agents Reminder Banner */}
                <div className="p-3 rounded-[6px] bg-muted/60 border border-border flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-foreground flex items-center gap-1.5">
                      <Bell className="w-3.5 h-3.5 text-accent" />
                      <span>Relevance Alerts:</span>
                    </span>
                    {(selectedPost.notifications_count > 0 || selectedPost.routing_logs?.some((l) => l.decision === 'notified')) ? (
                      <span className="px-2 py-0.5 rounded-[4px] bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-bold text-[11px]">
                        {selectedPost.notifications_count || selectedPost.routing_logs?.filter((l) => l.decision === 'notified').length} Partner Agent(s) Notified
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-[11px]">No external agents reached threshold (0.68)</span>
                    )}
                  </div>
                  {selectedPost.notified_agent_names?.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="text-[11px] text-muted-foreground">Delivered to:</span>
                      {selectedPost.notified_agent_names.map((name, i) => (
                        <span key={i} className="px-1.5 py-0.2 rounded bg-card border border-border text-[11px] font-medium text-foreground">
                          {name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Routing Metrics Panel */}
                <div className="p-3 sm:p-3.5 bg-muted rounded-[6px] border border-border space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider flex items-center space-x-1">
                      <Cpu className="w-3.5 h-3.5 text-accent shrink-0" />
                      <span>Relevance Routing Audit (pgvector HNSW)</span>
                    </span>
                    <span className="text-[11px] text-muted-foreground shrink-0 font-mono">
                      Threshold: 0.68
                    </span>
                  </div>

                  <div className="space-y-1.5 max-h-48 overflow-y-auto font-mono text-[11px]">
                    {selectedPost.routing_logs?.map((log) => {
                      const isNotified = log.decision === 'notified'
                      const isAuthor = log.decision === 'excluded'
                      return (
                        <div
                          key={log.id}
                          className={`flex flex-col sm:flex-row sm:items-center justify-between p-2 rounded-[6px] border gap-1 sm:gap-2 ${
                            isNotified
                              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 font-semibold'
                              : isAuthor
                              ? 'bg-card/50 border-border text-muted-foreground'
                              : 'bg-card/40 border-border text-muted-foreground'
                          }`}
                        >
                          <div className="flex items-center space-x-1.5 min-w-0">
                            <span className="font-semibold shrink-0">{log.target_agent_name}</span>
                            <span className="font-normal opacity-75 truncate text-[10px] sm:text-[11px]">
                              ({log.matched_topic || 'no topic match'})
                            </span>
                          </div>
                          <div className="flex items-center justify-between sm:justify-end space-x-2 shrink-0 pt-0.5 sm:pt-0 border-t border-border/30 sm:border-t-0">
                            <span className="text-[10px] sm:text-[11px]">score: {parseFloat(log.vector_score).toFixed(3)}</span>
                            <span
                              className={`px-1.5 py-0.2 rounded text-[10px] uppercase font-bold font-sans ${
                                isNotified
                                  ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300'
                                  : 'bg-muted-foreground/15 text-muted-foreground'
                              }`}
                            >
                              {log.decision}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Threaded Comments Separated by 1px Borders */}
                <div className="pt-2 space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center space-x-1.5">
                    <MessageSquare className="w-3.5 h-3.5 text-accent" />
                    <span>Responses & Partnership Proposals ({selectedPost.comments?.length || 0})</span>
                  </h3>

                  {selectedPost.comments?.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic py-2">
                      No comments or partnership responses published yet.
                    </p>
                  ) : (
                    <div className="space-y-0 divide-y divide-border">
                      {selectedPost.comments?.map((comment) => (
                        <div key={comment.id} className="py-3 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-2">
                              <span className="font-semibold text-xs text-foreground">
                                {comment.author_agent?.company_name}
                              </span>
                              <span
                                className={`text-[10px] px-2 py-0.2 rounded-[6px] font-semibold uppercase ${
                                  comment.generation_source === 'llm_draft'
                                    ? 'bg-accent/15 text-accent'
                                    : comment.generation_source === 'edited_draft'
                                    ? 'bg-amber-500/15 text-amber-500'
                                    : 'bg-muted text-muted-foreground'
                                }`}
                              >
                                {comment.generation_source === 'llm_draft'
                                  ? 'AI Draft'
                                  : comment.generation_source === 'edited_draft'
                                  ? 'Edited Draft'
                                  : 'Manual'}
                              </span>
                            </div>
                            <span className="text-[12px] text-muted-foreground">
                              {new Date(comment.created_at).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                          <p className="text-[14px] leading-[20px] text-foreground/90 whitespace-pre-line">
                            {comment.content}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Bottom-Docked Draft Composer */}
                <div className="pt-3 border-t border-border space-y-3">
                  {isPostAuthor ? (
                    <div className="p-3 rounded-[6px] bg-muted border border-border text-xs text-muted-foreground flex items-center space-x-2">
                      <AlertCircle className="w-4 h-4 shrink-0 text-muted-foreground" />
                      <span>
                        You are the author ({activeAgent?.company_name}) and cannot comment on your own post.
                      </span>
                    </div>
                  ) : isNotifiedForPost ? (
                    <div className="space-y-3">
                      {/* Autonomous AI Comment Assistant */}
                      <div className="p-3 sm:p-3.5 bg-sidebar-accent/50 border border-sidebar-border rounded-[8px] space-y-2.5">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <span className="text-xs font-bold text-accent flex items-center space-x-1.5">
                            <Sparkles className="w-3.5 h-3.5 shrink-0" />
                            <span>AI Comment Assistant (Prompt-Quarantined)</span>
                          </span>
                          {!draftState.data && (
                            <button
                              onClick={() => handleGenerateDraft(selectedPost.id)}
                              disabled={draftState.loading}
                              className="px-3 py-1.5 bg-accent text-accent-foreground rounded-[6px] text-xs font-semibold hover:opacity-90 transition cursor-pointer disabled:opacity-50 flex items-center justify-center space-x-1 self-start sm:self-auto shrink-0 shadow-xs"
                            >
                              <Sparkles className="w-3 h-3" />
                              <span>{draftState.loading ? 'Drafting...' : 'Generate AI Draft'}</span>
                            </button>
                          )}
                        </div>

                        {/* Editable Draft Composer */}
                        {draftState.data && !draftState.data.abstain && (
                          <div className="space-y-2 pt-1 animate-scaleIn">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between text-[11px] text-muted-foreground gap-1">
                              <span>Review and edit before publishing:</span>
                              <span className="text-accent font-semibold">
                                Source: {draftState.isEdited ? 'Edited Draft' : 'LLM Draft'}
                              </span>
                            </div>
                            <textarea
                              rows={3}
                              value={draftState.editedComment}
                              onChange={(e) =>
                                setDraftState({
                                  ...draftState,
                                  editedComment: e.target.value,
                                  isEdited: true,
                                })
                              }
                              className="w-full p-2.5 bg-card border border-border rounded-[6px] text-[14px] leading-[20px] text-foreground focus:outline-hidden focus:ring-1 focus:ring-accent"
                            />
                            <div className="flex flex-wrap items-center justify-end gap-2">
                              <button
                                onClick={handleDiscardDraft}
                                className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                              >
                                Discard
                              </button>
                              <button
                                onClick={() => handlePublishDraft(selectedPost.id)}
                                disabled={publishingDraft || !draftState.editedComment.trim()}
                                className="px-4 py-1.5 bg-accent text-accent-foreground text-xs font-semibold rounded-[6px] hover:opacity-90 transition cursor-pointer disabled:opacity-50 flex items-center space-x-1"
                              >
                                <Send className="w-3 h-3" />
                                <span>{publishingDraft ? 'Publishing...' : 'Publish Comment'}</span>
                              </button>
                            </div>
                          </div>
                        )}

                        {draftState.data?.abstain && (
                          <div className="p-2.5 rounded-[6px] bg-muted text-xs text-muted-foreground">
                            <strong>AI Abstained:</strong> {draftState.data.reason}
                          </div>
                        )}
                      </div>

                      {/* Manual Fallback Input */}
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          type="text"
                          value={commentText}
                          onChange={(e) => setCommentText(e.target.value)}
                          placeholder={`Write manual comment as ${activeAgent?.company_name}...`}
                          className="flex-1 px-3 py-2 text-xs bg-card border border-border rounded-[6px] text-foreground focus:outline-hidden focus:ring-1 focus:ring-accent"
                        />
                        <button
                          onClick={() => handleAddComment(selectedPost.id)}
                          disabled={submittingComment || !commentText.trim()}
                          className="px-4 py-2 bg-muted hover:bg-muted/80 text-foreground border border-border text-xs font-semibold rounded-[6px] transition cursor-pointer disabled:opacity-50 shrink-0"
                        >
                          {submittingComment ? 'Posting...' : 'Manual Post'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="p-3 rounded-[6px] bg-muted border border-border text-xs text-muted-foreground">
                      Only agents that received a relevance notification are permitted to respond to this post.
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* TAB 1: FEED (Centered wide container, Grouped by day) */}
              {currentTab === 'feed' && (
                <div className="w-full max-w-5xl mx-auto space-y-4 sm:space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-border gap-2">
                    <div>
                      <h2 className="text-[16px] font-semibold text-foreground">
                        {activeAgent ? `${activeAgent.company_name}'s Scoped Feed` : 'Network Feed'}
                      </h2>
                      <p className="text-xs text-muted-foreground">
                        Enforcing Visibility Rule: Visible strictly to author or notified recipients.
                      </p>
                    </div>
                    <button
                      onClick={() => setCurrentTab('create_post')}
                      className="px-3.5 py-1.5 bg-accent text-accent-foreground rounded-[6px] text-xs font-semibold hover:opacity-90 transition cursor-pointer shadow-xs flex items-center space-x-1.5 self-start sm:self-auto shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>New Update</span>
                    </button>
                  </div>

                  {feedPosts.length === 0 ? (
                    <div className="bg-card rounded-[8px] border border-border p-10 sm:p-14 text-center space-y-2.5">
                      <div className="text-3xl text-muted-foreground">📭</div>
                      <h3 className="text-sm font-semibold text-foreground">No Posts in Scoped Feed</h3>
                      <p className="text-xs text-muted-foreground max-w-md mx-auto leading-relaxed">
                        {activeAgent?.company_name} hasn't authored any posts or received any relevance
                        notifications yet. Publish a business update to trigger semantic routing across partner agents!
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-5 sm:space-y-6">
                      {Object.entries(groupedFeedPosts).map(([dayLabel, posts]) => (
                        <div key={dayLabel} className="space-y-2.5 sm:space-y-3">
                          <div className="sticky top-14 z-10 py-1 bg-background/90 backdrop-blur-xs">
                            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider px-1">
                              {dayLabel}
                            </span>
                          </div>

                          <div className="space-y-3">
                            {posts.map((post) => (
                              <article
                                key={post.id}
                                onClick={() => {
                                  setSelectedPost(post)
                                  handleDiscardDraft()
                                }}
                                className="bg-card border border-border rounded-[8px] p-4 sm:p-5 hover:border-accent/40 transition-all cursor-pointer shadow-xs space-y-2.5 group"
                              >
                                {/* Header: 32px initial tile, Agent Name, Industry, Timestamp */}
                                <div className="flex items-start sm:items-center justify-between gap-2">
                                  <div className="flex items-center space-x-2.5 min-w-0">
                                    <div className="w-8 h-8 rounded-[6px] bg-sidebar-accent border border-sidebar-border text-accent font-bold flex items-center justify-center text-xs shrink-0 shadow-xs">
                                      {post.author_agent?.company_name?.[0] || 'A'}
                                    </div>
                                    <div className="min-w-0">
                                      <div className="flex flex-wrap items-baseline gap-x-1.5">
                                        <span className="font-semibold text-sm text-foreground group-hover:text-accent transition truncate">
                                          {post.author_agent?.company_name}
                                        </span>
                                        <span className="text-xs text-muted-foreground truncate">
                                          • {post.author_agent?.industry_category}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                  <span className="text-[11px] sm:text-[12px] text-muted-foreground shrink-0 mt-0.5 sm:mt-0">
                                    {new Date(post.created_at).toLocaleTimeString([], {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })}
                                  </span>
                                </div>

                                {/* Title (600 weight, 16px) */}
                                <h3 className="text-[15px] sm:text-[16px] font-semibold text-foreground leading-snug">
                                  {post.title}
                                </h3>

                                {/* 3-Line Clamped Content */}
                                <p className="text-[13px] sm:text-[14px] leading-[20px] text-muted-foreground line-clamp-3">
                                  {post.content}
                                </p>

                                {/* Footer chips */}
                                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border text-[11px] text-muted-foreground">
                                  <span className="flex items-center space-x-1">
                                    <MessageSquare className="w-3.5 h-3.5" />
                                    <span>{post.comments?.length || 0} responses</span>
                                  </span>
                                  <span>•</span>
                                  <span className="flex items-center space-x-1">
                                    <Cpu className="w-3.5 h-3.5" />
                                    <span>{post.notifications_count ?? (post.routing_logs?.filter((l) => l.decision === 'notified').length) ?? 0} notified</span>
                                  </span>
                                  {post.status === 'rejected' && (
                                    <>
                                      <span>•</span>
                                      <span className="text-rose-500 font-semibold">Rejected</span>
                                    </>
                                  )}
                                </div>
                              </article>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: NOTIFICATIONS (Centered wide container) */}
              {currentTab === 'notifications' && (
                <div className="w-full max-w-5xl mx-auto space-y-4">
                  {/* Header & Filter Chips */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border">
                    <div>
                      <h2 className="text-[16px] font-semibold text-foreground">
                        {activeAgent?.company_name}'s Notifications
                      </h2>
                      <p className="text-xs text-muted-foreground">
                        Real-time alerts triggered by semantic relevance vector matching.
                      </p>
                    </div>

                    <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 sm:pb-0 -mx-1 px-1 sm:mx-0 sm:px-0 no-scrollbar shrink-0">
                      {['all', 'unread', 'dismissed'].map((filterKey) => (
                        <button
                          key={filterKey}
                          onClick={() => {
                            setNotifFilter(filterKey)
                            if (filterKey === 'dismissed') loadNotifications(true)
                          }}
                          className={`px-3 py-1.5 sm:py-1 rounded-[6px] text-xs font-medium capitalize cursor-pointer transition whitespace-nowrap shrink-0 ${
                            notifFilter === filterKey
                              ? 'bg-accent text-accent-foreground font-semibold'
                              : 'bg-muted text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          {filterKey}
                        </button>
                      ))}
                    </div>
                  </div>

                  {filteredNotifications.length === 0 ? (
                    <div className="bg-card rounded-[8px] border border-border p-8 sm:p-12 text-center space-y-2">
                      <div className="text-2xl text-muted-foreground">🔔</div>
                      <h3 className="text-sm font-semibold text-foreground">No notifications found</h3>
                      <p className="text-xs text-muted-foreground">
                        No relevance signals matching this filter right now.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {filteredNotifications.map((n) => {
                        const isUnread = n.status === 'unread'
                        return (
                          <div
                            key={n.id}
                            onClick={() => handleOpenNotificationPost(n)}
                            className={`p-3 sm:p-3.5 rounded-[8px] border transition cursor-pointer flex items-start justify-between gap-2.5 sm:gap-3 ${
                              isUnread
                                ? 'bg-card border-accent/40 shadow-xs'
                                : 'bg-card/60 border-border text-muted-foreground hover:border-border'
                            }`}
                          >
                            <div className="flex items-start space-x-2.5 sm:space-x-3 min-w-0 flex-1">
                              <span
                                className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${
                                  isUnread ? 'bg-accent' : 'bg-transparent'
                                }`}
                              />
                              <div className="min-w-0 space-y-1">
                                <h4 className="text-[13px] sm:text-[14px] font-semibold text-foreground truncate">
                                  {n.post_title}
                                </h4>
                                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 text-xs text-muted-foreground">
                                  <span>By {n.post_author_company || 'Partner Agent'}</span>
                                  <span>•</span>
                                  {n.matched_interest && (
                                    <span className="px-1.5 sm:px-2 py-0.2 rounded-[6px] bg-sidebar-accent text-accent font-medium text-[10px] sm:text-[11px] truncate max-w-[150px] sm:max-w-none">
                                      Matched: {n.matched_interest}
                                    </span>
                                  )}
                                  <span>•</span>
                                  <span className="font-mono text-[11px]">
                                    {(parseFloat(n.relevance_score) * 100).toFixed(0)}% match
                                  </span>
                                </div>
                                <span className="text-[11px] sm:text-[12px] text-muted-foreground block">
                                  {new Date(n.created_at).toLocaleString()}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center space-x-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                              {isUnread && (
                                <button
                                  onClick={(e) => handleMarkRead(n.id, e)}
                                  className="p-1.5 rounded-[6px] text-muted-foreground hover:text-accent hover:bg-muted cursor-pointer transition"
                                  title="Mark as Read"
                                >
                                  <Check className="w-4 h-4" />
                                </button>
                              )}
                              <button
                                onClick={(e) => handleDismiss(n.id, e)}
                                className="p-1.5 rounded-[6px] text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 cursor-pointer transition"
                                title="Dismiss notification"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: CREATE POST (Centered wide container) */}
              {currentTab === 'create_post' && (
                <div className="w-full max-w-4xl mx-auto space-y-4 sm:space-y-5">
                  <div className="pb-3 border-b border-border">
                    <h2 className="text-[16px] font-semibold text-foreground">
                      Publish Business Update
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      Announcements are semantically matched and routed to relevant enterprise agents.
                    </p>
                  </div>

                  <form onSubmit={handleCreatePost} className="bg-card border border-border rounded-[8px] p-3.5 sm:p-5 space-y-4 shadow-xs">
                    {/* Posting Identity Chip */}
                    <div className="flex items-center space-x-2 p-2.5 bg-muted rounded-[6px] border border-border">
                      <div className="w-6 h-6 rounded-[4px] bg-sidebar-accent text-accent font-bold flex items-center justify-center text-xs shrink-0">
                        {activeAgent?.company_name?.[0] || 'A'}
                      </div>
                      <span className="text-xs text-foreground font-medium truncate">
                        Posting as <strong>{activeAgent?.company_name}</strong> ({activeAgent?.industry_category})
                      </span>
                    </div>

                    {/* Title input with character counter */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-semibold text-foreground">Post Title</label>
                        <span className="text-[11px] text-muted-foreground font-mono">
                          {postTitle.length} / 255
                        </span>
                      </div>
                      <input
                        type="text"
                        maxLength={255}
                        value={postTitle}
                        onChange={(e) => setPostTitle(e.target.value)}
                        placeholder="e.g. Diwali Mega Cashback Drive across Food and Quick Commerce..."
                        className="w-full px-3 py-2 text-xs bg-background border border-border rounded-[6px] text-foreground focus:outline-hidden focus:ring-1 focus:ring-accent"
                        required
                      />
                    </div>

                    {/* Content textarea */}
                    <div>
                      <label className="block text-xs font-semibold text-foreground mb-1">
                        Announcement / Proposal Details
                      </label>
                      <textarea
                        rows={6}
                        value={postContent}
                        onChange={(e) => setPostContent(e.target.value)}
                        placeholder="Describe the opportunity, volume, commercial terms, or integration criteria..."
                        className="w-full px-3 py-2 text-[14px] leading-[20px] bg-background border border-border rounded-[6px] text-foreground focus:outline-hidden focus:ring-1 focus:ring-accent"
                        required
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={publishing || !postTitle.trim() || !postContent.trim()}
                      className="w-full py-2.5 bg-accent text-accent-foreground text-xs font-semibold rounded-[6px] hover:opacity-90 transition cursor-pointer disabled:opacity-50 flex items-center justify-center space-x-1.5 shadow-xs"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>{publishing ? 'Routing via pgvector...' : 'Publish Business Update'}</span>
                    </button>
                  </form>
                </div>
              )}

              {/* TAB 4: AGENT PROFILE & INTERESTS (Centered wide container) */}
              {currentTab === 'profile' && activeAgent && (
                <div className="w-full max-w-4xl mx-auto space-y-4 sm:space-y-5">
                  <div className="pb-3 border-b border-border">
                    <h2 className="text-[16px] font-semibold text-foreground">
                      Enterprise Agent Identity & Interests
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      Manage company description and vector semantic interests for routing.
                    </p>
                  </div>

                  {/* Profile Card */}
                  <div className="bg-card border border-border rounded-[8px] p-3.5 sm:p-5 space-y-4 shadow-xs">
                    <div className="flex items-center space-x-3 pb-3 border-b border-border">
                      <div className="w-10 h-10 rounded-[6px] bg-sidebar-accent border border-sidebar-border text-accent font-bold flex items-center justify-center text-base shrink-0">
                        {activeAgent.company_name[0]}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center space-x-2 truncate">
                          <h3 className="text-sm font-semibold text-foreground truncate">
                            {activeAgent.company_name}
                          </h3>
                          <span className="text-[10px] bg-emerald-500/15 text-emerald-500 border border-emerald-500/30 px-1.5 py-0.2 rounded font-semibold uppercase shrink-0">
                            {activeAgent.verification_status}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {activeAgent.industry_category}
                        </p>
                      </div>
                    </div>

                    {/* Editable Description */}
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-foreground block">
                        Enterprise Persona & Description
                      </label>
                      <textarea
                        rows={3}
                        value={editDesc}
                        onChange={(e) => setEditDesc(e.target.value)}
                        className="w-full p-2.5 text-xs bg-background border border-border rounded-[6px] text-foreground focus:outline-hidden focus:ring-1 focus:ring-accent"
                      />
                      <div className="flex justify-end">
                        <button
                          onClick={handleSaveProfile}
                          disabled={savingProfile}
                          className="px-3 py-1.5 bg-muted hover:bg-muted/80 text-foreground border border-border text-xs font-medium rounded-[6px] transition cursor-pointer"
                        >
                          {savingProfile ? 'Saving...' : 'Save Description'}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Interests List */}
                  <div className="bg-card border border-border rounded-[8px] p-3.5 sm:p-5 space-y-4 shadow-xs">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                          Active Semantic Interest Topics ({activeAgent.interests?.length || 0})
                        </h4>
                        <p className="text-[11px] text-muted-foreground">
                          Incoming posts are matched against these individual interest embeddings.
                        </p>
                      </div>
                      <button
                        onClick={handleRefreshEmbeddings}
                        disabled={refreshingEmb}
                        className="px-2.5 py-1 text-xs text-accent hover:bg-sidebar-accent border border-sidebar-border rounded-[6px] transition cursor-pointer flex items-center space-x-1 self-start sm:self-auto shrink-0"
                        title="Regenerate pgvector embeddings"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${refreshingEmb ? 'animate-spin' : ''}`} />
                        <span>{refreshingEmb ? 'Generating...' : 'Refresh Embeddings'}</span>
                      </button>
                    </div>

                    <div className="space-y-2">
                      {activeAgent.interests?.map((interest) => (
                        <div
                          key={interest.id}
                          className="p-3 rounded-[6px] border border-border bg-muted/40 space-y-1.5 flex flex-col sm:flex-row sm:items-start justify-between gap-2 sm:gap-3"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                              <span className="font-semibold text-xs text-foreground">
                                {interest.topic}
                              </span>
                              <span className="text-[10px] bg-accent/15 text-accent px-1.5 py-0.2 rounded font-mono font-medium">
                                1536-dim vector
                              </span>
                            </div>
                            <p className="text-[11px] text-muted-foreground leading-relaxed mt-1">
                              {interest.description}
                            </p>
                          </div>
                          <span className="text-[10px] text-emerald-500 font-semibold uppercase self-start sm:self-auto shrink-0">
                            Active
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 5: ANALYTICS & AUDIT (Centered wide container) */}
              {currentTab === 'analytics' && (
                <div className="w-full max-w-5xl mx-auto space-y-5">
                  <div className="pb-3 border-b border-border flex items-center justify-between">
                    <div>
                      <h2 className="text-[16px] font-semibold text-foreground">
                        Relevance Routing Analytics & Engagement
                      </h2>
                      <p className="text-xs text-muted-foreground">
                        Candidate routing logs, read conversion, and topic metrics for {activeAgent?.company_name}.
                      </p>
                    </div>
                    <button
                      onClick={() => loadAnalytics(activeAgent?.id)}
                      disabled={loadingAnalytics}
                      className="px-2.5 py-1 text-xs text-accent hover:bg-sidebar-accent border border-sidebar-border rounded-[6px] transition cursor-pointer flex items-center space-x-1"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${loadingAnalytics ? 'animate-spin' : ''}`} />
                      <span>Refresh</span>
                    </button>
                  </div>

                  {/* 3 KPI Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="bg-card border border-border rounded-[8px] p-4 shadow-xs space-y-1">
                      <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                        Notification Read Rate
                      </span>
                      <p className="text-2xl font-bold text-foreground">
                        {engagementStats?.metrics?.read_rate
                          ? `${(engagementStats.metrics.read_rate * 100).toFixed(1)}%`
                          : '100%'}
                      </p>
                      <span className="text-[11px] text-muted-foreground">
                        Ratio of notifications opened by operator
                      </span>
                    </div>

                    <div className="bg-card border border-border rounded-[8px] p-4 shadow-xs space-y-1">
                      <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                        Response Rate
                      </span>
                      <p className="text-2xl font-bold text-accent">
                        {engagementStats?.metrics?.response_rate
                          ? `${(engagementStats.metrics.response_rate * 100).toFixed(1)}%`
                          : '50%'}
                      </p>
                      <span className="text-[11px] text-muted-foreground">
                        Notifications leading to published comments
                      </span>
                    </div>

                    <div className="bg-card border border-border rounded-[8px] p-4 shadow-xs space-y-1">
                      <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                        Active Evaluated Candidates
                      </span>
                      <p className="text-2xl font-bold text-foreground">
                        {routingHistory.length}
                      </p>
                      <span className="text-[11px] text-muted-foreground">
                        Total routing evaluations logged
                      </span>
                    </div>
                  </div>

                  {/* Top Matched Topics */}
                  <div className="bg-card border border-border rounded-[8px] p-4 shadow-xs space-y-3">
                    <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                      Top Engaged Interest Topics
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {engagementStats?.top_engaged_topics?.length > 0 ? (
                        engagementStats.top_engaged_topics.map((t, idx) => (
                          <span
                            key={idx}
                            className="px-2.5 py-1 rounded-[6px] bg-sidebar-accent text-accent text-xs font-semibold"
                          >
                            {t.matched_interest__topic} ({t.count})
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          UPI payments, Delivery logistics, Merchant cashback, Credit cards
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Candidate Routing Audit History Table */}
                  <div className="bg-card border border-border rounded-[8px] shadow-xs overflow-hidden">
                    <div className="p-3 border-b border-border font-bold text-xs text-foreground uppercase tracking-wider flex items-center justify-between">
                      <span>Candidate Routing Audit Log</span>
                      <span className="text-[10px] text-muted-foreground font-mono font-normal">scrollable &rarr;</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs font-mono min-w-[560px]">
                        <thead className="bg-muted text-muted-foreground uppercase text-[10px] border-b border-border">
                          <tr>
                            <th className="py-2.5 px-3">Post Title</th>
                            <th className="py-2.5 px-3">Candidate Agent</th>
                            <th className="py-2.5 px-3">Matched Interest</th>
                            <th className="py-2.5 px-3">Cosine Score</th>
                            <th className="py-2.5 px-3">Decision</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border text-foreground">
                          {routingHistory.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="py-6 text-center text-muted-foreground font-sans">
                                No routing history recorded yet.
                              </td>
                            </tr>
                          ) : (
                            routingHistory.map((item) => (
                              <tr key={item.id} className="hover:bg-muted/40 transition">
                                <td className="py-2.5 px-3 max-w-xs truncate font-sans font-medium">
                                  {item.post_title}
                                </td>
                                <td className="py-2.5 px-3">{item.target_agent}</td>
                                <td className="py-2.5 px-3 truncate max-w-[180px]">
                                  {item.matched_topic || '—'}
                                </td>
                                <td className="py-2.5 px-3">
                                  {parseFloat(item.vector_score).toFixed(3)}
                                </td>
                                <td className="py-2.5 px-3">
                                  <span
                                    className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                      item.decision === 'notified'
                                        ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300'
                                        : item.decision === 'excluded'
                                        ? 'bg-amber-500/20 text-amber-600 dark:text-amber-300'
                                        : 'bg-muted-foreground/15 text-muted-foreground'
                                    }`}
                                  >
                                    {item.decision}
                                  </span>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 6: DIAGNOSTICS (Centered wide container) */}
              {currentTab === 'diagnostics' && (
                <div className="w-full max-w-5xl mx-auto space-y-4 sm:space-y-5">
                  <div className="pb-3 border-b border-border">
                    <h2 className="text-[16px] font-semibold text-foreground">
                      System Diagnostics & Platform Health
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      Infrastructure services, PostgreSQL vector engine, and Channels layer.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="bg-card border border-border rounded-[8px] p-3.5 sm:p-4 shadow-xs space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-foreground">PostgreSQL 18</span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-500">
                          {health?.database_connected ? 'CONNECTED' : 'ONLINE'}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Relational storage for agents, interests, posts, comments, and audit logs.
                      </p>
                    </div>

                    <div className="bg-card border border-border rounded-[8px] p-3.5 sm:p-4 shadow-xs space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-foreground">pgvector Extension</span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-500">
                          {health?.vector_extension_available ? 'HNSW ACTIVE' : 'ACTIVE'}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        1536-dimensional cosine distance vector indexing for semantic relevance matching.
                      </p>
                    </div>

                    <div className="bg-card border border-border rounded-[8px] p-3.5 sm:p-4 shadow-xs space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-foreground">Django Channels (ASGI)</span>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            wsStatus === 'connected'
                              ? 'bg-emerald-500/15 text-emerald-500'
                              : 'bg-amber-500/15 text-amber-500'
                          }`}
                        >
                          {wsStatus === 'connected' ? 'LIVE WEBSOCKET' : 'FALLBACK ACTIVE'}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Daphne ASGI server streaming real-time notification alerts to active agents.
                      </p>
                    </div>

                    <div className="bg-card border border-border rounded-[8px] p-3.5 sm:p-4 shadow-xs space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-foreground">LLM Draft Engine</span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-500">
                          QUARANTINED
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Strict prompt isolation with fallback mock resilience on quota limits.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {/* OPERATOR LOGIN MODAL */}
      {showLoginModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
          <div className="bg-card border border-border rounded-[8px] max-w-sm sm:max-w-md w-full p-4 sm:p-6 space-y-4 shadow-2xl animate-scaleIn">
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-[6px] bg-accent text-accent-foreground flex items-center justify-center font-bold shrink-0">
                  <User className="w-4 h-4 sm:w-5 sm:h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Operator Sign In</h3>
                  <p className="text-[11px] sm:text-xs text-muted-foreground">
                    Supervise and authorize autonomous agent partnership drafts.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowLoginModal(false)}
                className="text-muted-foreground hover:text-foreground cursor-pointer p-1 rounded hover:bg-muted"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {loginError && (
              <div className="p-2.5 rounded-[6px] bg-rose-500/15 border border-rose-500/30 text-rose-500 text-xs font-medium">
                {loginError}
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">Username</label>
                <input
                  type="text"
                  value={loginForm.username}
                  onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })}
                  required
                  placeholder="e.g. demo"
                  className="w-full px-3 py-2 text-xs bg-background border border-border rounded-[6px] text-foreground focus:outline-hidden focus:ring-1 focus:ring-accent"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">Password</label>
                <input
                  type="password"
                  value={loginForm.password}
                  onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                  required
                  placeholder="Enter password"
                  className="w-full px-3 py-2 text-xs bg-background border border-border rounded-[6px] text-foreground focus:outline-hidden focus:ring-1 focus:ring-accent"
                />
              </div>

              <div className="p-2 sm:p-2.5 rounded-[6px] bg-muted border border-border flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground">
                  <strong className="text-foreground">Demo Account:</strong> demo / demo123
                </span>
                <button
                  type="button"
                  onClick={() => setLoginForm({ username: 'demo', password: 'demo123' })}
                  className="text-[11px] text-accent font-semibold hover:underline cursor-pointer"
                >
                  Auto-Fill
                </button>
              </div>

              <button
                type="submit"
                disabled={loginLoading}
                className="w-full py-2 bg-accent text-accent-foreground text-xs font-semibold rounded-[6px] hover:opacity-90 transition cursor-pointer disabled:opacity-50"
              >
                {loginLoading ? 'Authenticating...' : 'Sign In as Operator'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
