import React, { useEffect, useRef, useState } from 'react'

const SILENCE_MS = 3000
const SILENCE_THRESHOLD = 0.015
const MIN_AUDIO_SAMPLES = 16000
const API_BASE = 'http://localhost:4000'

async function apiFetchJson(url, options = {}) {
  const authToken = window.localStorage.getItem('authToken')
  const headers = {
    ...(options.headers || {}),
    ...(authToken ? { 'x-auth-token': authToken } : {})
  }
  const response = await fetch(url, { ...options, headers })
  const raw = await response.text()
  let data = null

  try {
    data = raw ? JSON.parse(raw) : {}
  } catch (_) {
    const looksHtml = raw.trim().startsWith('<')
    throw new Error(
      looksHtml
        ? 'Server returned HTML instead of JSON. Please ensure backend is running with latest code on port 4000.'
        : 'Server returned an invalid response.'
    )
  }

  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || `Request failed (${response.status})`)
  }

  return data
}

function downsampleBuffer(buffer, inputSampleRate, outputSampleRate) {
  if (outputSampleRate === inputSampleRate) return buffer

  const sampleRateRatio = inputSampleRate / outputSampleRate
  const newLength = Math.round(buffer.length / sampleRateRatio)
  const result = new Float32Array(newLength)

  let offsetResult = 0
  let offsetBuffer = 0

  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio)
    let accum = 0
    let count = 0

    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i += 1) {
      accum += buffer[i]
      count += 1
    }

    result[offsetResult] = count > 0 ? accum / count : 0
    offsetResult += 1
    offsetBuffer = nextOffsetBuffer
  }

  return result
}

function floatTo16BitPCM(floatBuffer) {
  const pcm = new Int16Array(floatBuffer.length)

  for (let i = 0; i < floatBuffer.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, floatBuffer[i]))
    pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
  }

  return pcm
}

function buildWavBlob(pcm16, sampleRate) {
  const buffer = new ArrayBuffer(44 + pcm16.byteLength)
  const view = new DataView(buffer)

  const writeString = (offset, value) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i))
    }
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + pcm16.byteLength, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(36, 'data')
  view.setUint32(40, pcm16.byteLength, true)
  new Int16Array(buffer, 44).set(pcm16)

  return new Blob([buffer], { type: 'audio/wav' })
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [currentUser, setCurrentUser] = useState(null)
  const [loginName, setLoginName] = useState('')
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [authMode, setAuthMode] = useState('login')
  const [loginError, setLoginError] = useState('')
  const [activePage, setActivePage] = useState('setup')
  const [file, setFile] = useState(null)
  const [resumeText, setResumeText] = useState('')
  const [jobDesc, setJobDesc] = useState('')
  const [loading, setLoading] = useState(false)
  const [userInput, setUserInput] = useState('')
  const [conversation, setConversation] = useState([])
  const [scoreHistory, setScoreHistory] = useState([])
  const [adaptiveDifficulty, setAdaptiveDifficulty] = useState({ level: 3, label: 'medium', guide: '' })
  const [gapAnalysis, setGapAnalysis] = useState(null)
  const [gapLoading, setGapLoading] = useState(false)
  const [codingRound, setCodingRound] = useState(null)
  const [codingDuration, setCodingDuration] = useState(25)
  const [codingLanguage, setCodingLanguage] = useState('javascript')
  const [codingSolution, setCodingSolution] = useState('')
  const [codingLoading, setCodingLoading] = useState(false)
  const [timeLeftMs, setTimeLeftMs] = useState(0)
  const [companyRound, setCompanyRound] = useState(null)
  const [selectedCompany, setSelectedCompany] = useState('Google')
  const [companyLoading, setCompanyLoading] = useState(false)
  const [companySection, setCompanySection] = useState('behavior')
  const [companyAnswer, setCompanyAnswer] = useState('')
  const [companyEvaluation, setCompanyEvaluation] = useState(null)
  const [listening, setListening] = useState(false)
  const [speechError, setSpeechError] = useState('')
  const [liveMode, setLiveMode] = useState(false)
  const [voiceStatus, setVoiceStatus] = useState('Ready for text or voice interview.')
  const [processingVoice, setProcessingVoice] = useState(false)
  const [savedResumes, setSavedResumes] = useState([])
  const [pastSession, setPastSession] = useState(null)
  const [recommendations, setRecommendations] = useState(null)
  const [recommendationLoading, setRecommendationLoading] = useState(false)
  const [globalHistory, setGlobalHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [showSetupUploadResult, setShowSetupUploadResult] = useState(false)
  const [resumeReadyThisSession, setResumeReadyThisSession] = useState(false)
  const [jobReadyThisSession, setJobReadyThisSession] = useState(false)

  const audioContextRef = useRef(null)
  const processorRef = useRef(null)
  const mediaStreamRef = useRef(null)
  const sourceRef = useRef(null)
  const chunksRef = useRef([])
  const audioPlayerRef = useRef(null)
  const silenceTimeoutRef = useRef(null)
  const hasSpokenRef = useRef(false)
  const liveModeRef = useRef(false)
  const processingVoiceRef = useRef(false)
  const loadingRef = useRef(false)
  const listeningRef = useRef(false)

  useEffect(() => {
    liveModeRef.current = liveMode
  }, [liveMode])

  useEffect(() => {
    processingVoiceRef.current = processingVoice
  }, [processingVoice])

  useEffect(() => {
    loadingRef.current = loading
  }, [loading])

  useEffect(() => {
    listeningRef.current = listening
  }, [listening])

  useEffect(() => {
    // Always start from login page on a fresh app launch.
    window.localStorage.removeItem('authToken')
    setIsAuthenticated(false)
    setCurrentUser(null)
  }, [])

  useEffect(() => {
    if (!isAuthenticated) return

    const loadData = async () => {
      try {
        const [resumes, sessions, history] = await Promise.all([
          apiFetchJson(`${API_BASE}/saved-resumes`),
          apiFetchJson(`${API_BASE}/sessions`),
          apiFetchJson(`${API_BASE}/history`)
        ])
        setSavedResumes(Array.isArray(resumes.savedResumes) ? resumes.savedResumes : [])
        setPastSession(sessions.session || null)
        setGlobalHistory(Array.isArray(history.history) ? history.history : [])
      } catch (_) {
      }
    }

    loadData()
  }, [isAuthenticated])

  useEffect(() => {
    if (!codingRound) {
      setTimeLeftMs(0)
      return
    }

    const updateTimer = () => {
      const left = Math.max(0, Number(codingRound.deadlineAt) - Date.now())
      setTimeLeftMs(left)
    }

    updateTimer()
    const id = window.setInterval(updateTimer, 1000)
    return () => window.clearInterval(id)
  }, [codingRound])

  useEffect(() => {
    return () => {
      stopAllAudio()
    }
  }, [])

  useEffect(() => {
    const onKeyDown = async (event) => {
      const key = event.key.toLowerCase()
      if (!liveModeRef.current) return

      if (key === 'q') {
        if (!listeningRef.current || processingVoiceRef.current) return
        event.preventDefault()
        await finalizeVoiceTurn()
        return
      }

      if (key === 'k') {
        if (listeningRef.current || processingVoiceRef.current || loadingRef.current) return
        event.preventDefault()
        await startMicCapture()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [listening])

  const clearSilenceTimer = () => {
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current)
      silenceTimeoutRef.current = null
    }
  }

  const cleanupAudio = async () => {
    clearSilenceTimer()

    if (processorRef.current) {
      processorRef.current.disconnect()
      processorRef.current.onaudioprocess = null
      processorRef.current = null
    }

    if (sourceRef.current) {
      sourceRef.current.disconnect()
      sourceRef.current = null
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
    }

    if (audioContextRef.current) {
      await audioContextRef.current.close()
      audioContextRef.current = null
    }
  }

  const stopAllAudio = async () => {
    await cleanupAudio()
    listeningRef.current = false
    setListening(false)
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause()
      audioPlayerRef.current = null
    }
  }

  const scheduleNextTurn = () => {
    if (!liveModeRef.current) return

    window.setTimeout(() => {
      if (liveModeRef.current && !processingVoiceRef.current && !loadingRef.current && !listeningRef.current) {
        startMicCapture()
        return
      }

      if (liveModeRef.current && !listeningRef.current) {
        scheduleNextTurn()
      }
    }, 400)
  }

  const playReply = (audioBase64) => {
    if (!audioBase64) {
      if (liveModeRef.current) {
        setVoiceStatus('Listening...')
        scheduleNextTurn()
      }
      return
    }

    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause()
      audioPlayerRef.current = null
    }

    const audio = new Audio(`data:audio/wav;base64,${audioBase64}`)
    audioPlayerRef.current = audio
    audio.onended = () => {
      audioPlayerRef.current = null
      if (liveModeRef.current) {
        setVoiceStatus('Listening...')
        scheduleNextTurn()
      }
    }

    audio.play().then(() => {
      setVoiceStatus('Interviewer speaking...')
    }).catch(() => {
      setSpeechError('The browser blocked autoplay. Click once anywhere on the page and try live mode again.')
      if (liveModeRef.current) {
        setVoiceStatus('Listening...')
        scheduleNextTurn()
      }
    })
  }

  const refreshPastSession = async () => {
    try {
      const data = await apiFetchJson(`${API_BASE}/sessions`)
      setPastSession(data.session || null)
    } catch (_) {
    }
  }

  const sendMessage = async (text) => {
    if (!resumeReadyThisSession || !jobReadyThisSession) {
      alert('Please upload your resume and set job description in Setup first.')
      setActivePage('setup')
      return
    }

    const cleanText = text.trim()
    if (!cleanText) return

    setConversation((c) => [...c, { who: 'You', text: cleanText }])
    setUserInput('')
    setLoading(true)

    try {
      const data = await apiFetchJson(`${API_BASE}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userText: cleanText })
      })
      setConversation((c) => [...c, { who: 'Interviewer', text: data.reply }])
      if (Array.isArray(data.scoreHistory)) {
        setScoreHistory(data.scoreHistory)
      } else if (data.scoreEntry) {
        setScoreHistory((prev) => [...prev, data.scoreEntry])
      }
      if (data.adaptiveDifficulty) {
        setAdaptiveDifficulty(data.adaptiveDifficulty)
      }
      playReply(data.audioBase64)
      refreshPastSession()
    } catch (err) {
      alert('Ask error: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  const upload = async () => {
    if (!file) return alert('Select a file first')
    setLoading(true)
    const fd = new FormData()
    fd.append('resume', file)
    try {
      const data = await apiFetchJson(`${API_BASE}/upload`, { method: 'POST', body: fd })
      setResumeText(data.text)
      setSavedResumes(Array.isArray(data.savedResumes) ? data.savedResumes : [])
      setShowSetupUploadResult(true)
      setResumeReadyThisSession(true)
      setConversation([])
      setScoreHistory([])
      setAdaptiveDifficulty({ level: 3, label: 'medium', guide: '' })
      setGapAnalysis(null)
      setCodingRound(null)
      setCodingSolution('')
      setCompanyRound(null)
      setCompanyEvaluation(null)
      setCompanyAnswer('')
      refreshPastSession()
    } catch (err) {
      alert('Upload error: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  const setJob = async () => {
    if (!jobDesc || jobDesc.trim().length < 3) return alert('Provide a job description')
    try {
      await apiFetchJson(`${API_BASE}/job`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobDesc })
      })
      setJobReadyThisSession(true)
      setGapAnalysis(null)
      setCodingRound(null)
      setCodingSolution('')
      setCompanyRound(null)
      setCompanyEvaluation(null)
      setCompanyAnswer('')
      alert('Job description set')
    } catch (err) {
      alert('Error: ' + err.message)
    }
  }

  const analyzeResumeGap = async () => {
    if (!resumeText) {
      alert('Upload and parse the resume first')
      return
    }
    if (!jobDesc || jobDesc.trim().length < 3) {
      alert('Set job description first')
      return
    }

    setGapLoading(true)
    try {
      const data = await apiFetchJson(`${API_BASE}/resume-gap`)
      setGapAnalysis(data.gapAnalysis)
    } catch (err) {
      alert('Resume gap analysis error: ' + err.message)
    } finally {
      setGapLoading(false)
    }
  }

  const ask = async () => {
    await sendMessage(userInput)
  }

  const startCodingRound = async () => {
    if (!resumeText) {
      alert('Upload and parse the resume first')
      return
    }
    if (!jobDesc || jobDesc.trim().length < 3) {
      alert('Set job description first')
      return
    }

    setCodingLoading(true)
    try {
      const data = await apiFetchJson(`${API_BASE}/coding/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ durationMinutes: codingDuration })
      })
      setCodingRound(data.codingRound)
      setCodingSolution('')
    } catch (err) {
      alert('Coding round error: ' + err.message)
    } finally {
      setCodingLoading(false)
    }
  }

  const submitCodingSolution = async () => {
    if (!codingRound) return
    if (!codingSolution.trim()) {
      alert('Please write your solution first')
      return
    }

    setCodingLoading(true)
    try {
      const data = await apiFetchJson(`${API_BASE}/coding/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ solution: codingSolution, language: codingLanguage })
      })
      setCodingRound(data.codingRound)
    } catch (err) {
      alert('Submit error: ' + err.message)
    } finally {
      setCodingLoading(false)
    }
  }

  const stopCodingRound = async () => {
    setCodingLoading(true)
    try {
      await apiFetchJson(`${API_BASE}/coding/stop`, { method: 'POST' })
      setCodingRound(null)
      setCodingSolution('')
      setTimeLeftMs(0)
    } catch (err) {
      alert('Stop error: ' + err.message)
    } finally {
      setCodingLoading(false)
    }
  }

  const startCompanyRound = async () => {
    if (!hasResume) {
      alert('Upload and parse the resume first')
      return
    }
    if (!jobDesc || jobDesc.trim().length < 3) {
      alert('Set job description first')
      return
    }

    setCompanyLoading(true)
    try {
      const data = await apiFetchJson(`${API_BASE}/company-round/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company: selectedCompany })
      })
      setCompanyRound(data.companyRound)
      setCompanySection('behavior')
      setCompanyAnswer('')
      setCompanyEvaluation(null)
    } catch (err) {
      alert('Company round error: ' + err.message)
    } finally {
      setCompanyLoading(false)
    }
  }

  const submitCompanyAnswer = async () => {
    if (!companyRound) return
    const answer = companyAnswer.trim()
    if (!answer) {
      alert('Please write your answer first')
      return
    }

    const sectionQuestion =
      companySection === 'behavior'
        ? companyRound.round?.behavior?.question
        : companySection === 'coding'
          ? companyRound.round?.coding?.question
          : companyRound.round?.systemDesign?.question

    setCompanyLoading(true)
    try {
      const data = await apiFetchJson(`${API_BASE}/company-round/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section: companySection,
          question: sectionQuestion,
          answer
        })
      })
      setCompanyEvaluation(data.evaluation)
      setCompanyRound(data.companyRound)
    } catch (err) {
      alert('Company round submit error: ' + err.message)
    } finally {
      setCompanyLoading(false)
    }
  }

  const finalizeVoiceTurn = async () => {
    if (processingVoiceRef.current || !listeningRef.current) return

    listeningRef.current = false
    setListening(false)
    processingVoiceRef.current = true
    setProcessingVoice(true)
    loadingRef.current = true
    setLoading(true)
    setVoiceStatus('Processing your answer...')

    await cleanupAudio()

    const allSamples = chunksRef.current.reduce((total, chunk) => total + chunk.length, 0)
    if (allSamples < MIN_AUDIO_SAMPLES) {
      chunksRef.current = []
      processingVoiceRef.current = false
      setProcessingVoice(false)
      loadingRef.current = false
      setLoading(false)
      setSpeechError('No clear speech detected. Please try again and speak a little louder.')
      if (liveModeRef.current) {
        setVoiceStatus('Listening...')
        scheduleNextTurn()
      } else {
        setVoiceStatus('Ready for text or voice interview.')
      }
      return
    }

    const merged = new Int16Array(allSamples)
    let offset = 0
    for (const chunk of chunksRef.current) {
      merged.set(chunk, offset)
      offset += chunk.length
    }
    chunksRef.current = []

    const audioBlob = buildWavBlob(merged, 16000)
    const formData = new FormData()
    formData.append('audio', audioBlob, 'recording.wav')

    try {
      const data = await apiFetchJson(`${API_BASE}/voice-turn`, {
        method: 'POST',
        body: formData
      })
      setConversation((c) => [...c, { who: 'You', text: data.transcript }])
      setConversation((c) => [...c, { who: 'Interviewer', text: data.reply }])
      if (Array.isArray(data.scoreHistory)) {
        setScoreHistory(data.scoreHistory)
      } else if (data.scoreEntry) {
        setScoreHistory((prev) => [...prev, data.scoreEntry])
      }
      if (data.adaptiveDifficulty) {
        setAdaptiveDifficulty(data.adaptiveDifficulty)
      }
      playReply(data.audioBase64)
      refreshPastSession()
    } catch (err) {
      setSpeechError(err.message || 'Voice interview failed')
      if (liveModeRef.current) {
        setVoiceStatus('Listening...')
        scheduleNextTurn()
      }
    } finally {
      processingVoiceRef.current = false
      setProcessingVoice(false)
      loadingRef.current = false
      setLoading(false)
    }
  }

  const startMicCapture = async () => {
    if (!liveModeRef.current || loadingRef.current || processingVoiceRef.current || listeningRef.current) return

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const audioContext = new (window.AudioContext || window.webkitAudioContext)()
      const source = audioContext.createMediaStreamSource(stream)
      const processor = audioContext.createScriptProcessor(4096, 1, 1)

      mediaStreamRef.current = stream
      audioContextRef.current = audioContext
      sourceRef.current = source
      processorRef.current = processor
      chunksRef.current = []
      hasSpokenRef.current = false

      source.connect(processor)
      processor.connect(audioContext.destination)

      processor.onaudioprocess = (event) => {
        const inputData = event.inputBuffer.getChannelData(0)
        const downsampled = downsampleBuffer(inputData, audioContext.sampleRate, 16000)
        const pcmChunk = floatTo16BitPCM(downsampled)
        chunksRef.current.push(pcmChunk)

        let energy = 0
        for (let i = 0; i < inputData.length; i += 1) {
          energy += inputData[i] * inputData[i]
        }
        const rms = Math.sqrt(energy / inputData.length)

        if (rms > SILENCE_THRESHOLD) {
          hasSpokenRef.current = true
          clearSilenceTimer()
          setVoiceStatus('Listening...')
          return
        }

        if (hasSpokenRef.current && !silenceTimeoutRef.current) {
          setVoiceStatus('Silence detected, finishing your turn...')
          silenceTimeoutRef.current = window.setTimeout(() => {
            silenceTimeoutRef.current = null
            finalizeVoiceTurn()
          }, SILENCE_MS)
        }
      }

      setSpeechError('')
      listeningRef.current = true
      setListening(true)
      setVoiceStatus('Listening...')
    } catch (err) {
      setSpeechError(err.message || 'Unable to access the microphone.')
      setLiveMode(false)
      liveModeRef.current = false
      setVoiceStatus('Ready for text or voice interview.')
      await stopAllAudio()
    }
  }

  const toggleLiveMode = async () => {
    if (!resumeReadyThisSession || !jobReadyThisSession) {
      alert('Please upload your resume and set job description in Setup first.')
      setActivePage('setup')
      return
    }

    if (liveModeRef.current) {
      liveModeRef.current = false
      setLiveMode(false)
      setVoiceStatus('Ready for text or voice interview.')
      await stopAllAudio()
      return
    }

    if (!resumeText) {
      alert('Upload and parse the resume first')
      return
    }

    setSpeechError('')
    setLiveMode(true)
    liveModeRef.current = true
    setVoiceStatus('Listening...')
    await startMicCapture()
  }

  const avg = (key) => {
    if (!scoreHistory.length) return 0
    const total = scoreHistory.reduce((sum, row) => sum + (Number(row[key]) || 0), 0)
    return Number((total / scoreHistory.length).toFixed(2))
  }

  const latestScore = scoreHistory.length ? scoreHistory[scoreHistory.length - 1] : null
  const codingFeedback = codingRound?.submission?.evaluation || null
  const timeLeftMin = Math.floor(timeLeftMs / 60000)
  const timeLeftSec = Math.floor((timeLeftMs % 60000) / 1000)
  const hasResume = Boolean(resumeText && resumeText.trim())
  const hasJobDescription = Boolean(jobDesc && jobDesc.trim().length >= 3)
  const canShowGapAnalysis = hasResume && hasJobDescription
  const setupStep = hasResume ? (hasJobDescription ? 3 : 2) : 1
  const setupCompleteThisSession = resumeReadyThisSession && jobReadyThisSession
  const hasMockInterviewResult = scoreHistory.length > 0
  const hasDsaResult = Boolean(codingFeedback)
  const canShowPreparationScore = hasMockInterviewResult && hasDsaResult

  const openPage = (page) => {
    setActivePage(page)
  }

  const loadRecommendations = async () => {
    setRecommendationLoading(true)
    try {
      const data = await apiFetchJson(`${API_BASE}/recommendations`)
      setRecommendations(data.recommendations || null)
    } catch (err) {
      alert('Recommendation error: ' + err.message)
    } finally {
      setRecommendationLoading(false)
    }
  }

  const loadGlobalHistory = async () => {
    setHistoryLoading(true)
    try {
      const data = await apiFetchJson(`${API_BASE}/history`)
      setGlobalHistory(Array.isArray(data.history) ? data.history : [])
    } catch (err) {
      alert('History error: ' + err.message)
    } finally {
      setHistoryLoading(false)
    }
  }

  const handleLogout = () => {
    window.localStorage.removeItem('authToken')
    setIsAuthenticated(false)
    setCurrentUser(null)
    setSavedResumes([])
    setPastSession(null)
    setRecommendations(null)
    setShowSetupUploadResult(false)
    setResumeReadyThisSession(false)
    setJobReadyThisSession(false)
  }

  const handleLogin = async (event) => {
    event.preventDefault()
    if (!loginEmail.trim() || !loginPassword.trim() || (authMode === 'register' && !loginName.trim())) {
      setLoginError('Please fill in all required fields.')
      return
    }

    try {
      setLoginError('')
      const path = authMode === 'register' ? '/auth/register' : '/auth/login'
      const payload = authMode === 'register'
        ? { name: loginName, email: loginEmail, password: loginPassword }
        : { email: loginEmail, password: loginPassword }
      const data = await apiFetchJson(`${API_BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      window.localStorage.setItem('authToken', data.token)
      setCurrentUser(data.user || null)
      setActivePage('setup')
      setResumeText('')
      setJobDesc('')
      setConversation([])
      setScoreHistory([])
      setGapAnalysis(null)
      setCodingRound(null)
      setCodingSolution('')
      setCompanyRound(null)
      setCompanyEvaluation(null)
      setCompanyAnswer('')
      setRecommendations(null)
      setShowSetupUploadResult(false)
      setResumeReadyThisSession(false)
      setJobReadyThisSession(false)
      setIsAuthenticated(true)
    } catch (err) {
      setLoginError(err.message || 'Authentication failed')
    }
  }

  if (!isAuthenticated) {
    return (
      <div className="authPage">
        <section className="authCard">
          <div className="authBrand">
            <p className="authEyebrow">AI Interview Studio</p>
            <h1>Master your next career move.</h1>
            <p>Experience personalized mock interviews, real-time analytics, and targeted feedback designed by industry leaders.</p>
          </div>
          <form className="authForm" onSubmit={handleLogin}>
            <h2>{authMode === 'register' ? 'Create account' : 'Welcome back'}</h2>
            {authMode === 'register' && (
              <>
                <label htmlFor="name">Full Name</label>
                <input
                  id="name"
                  type="text"
                  value={loginName}
                  onChange={(event) => setLoginName(event.target.value)}
                  placeholder="Enter your name"
                />
              </>
            )}
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={loginEmail}
              onChange={(event) => setLoginEmail(event.target.value)}
              placeholder="Enter your email"
            />
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={loginPassword}
              onChange={(event) => setLoginPassword(event.target.value)}
              placeholder="Enter your password"
            />
            {authMode !== 'register' && (
              <div className="authRow">
                <label className="rememberLabel">
                  <input type="checkbox" />
                  <span>Remember me</span>
                </label>
                <button type="button" className="authTextBtn">Forgot password?</button>
              </div>
            )}
            {loginError ? <p className="authError">{loginError}</p> : null}
            <button type="submit" className="btn authBtn">
              {authMode === 'register' ? 'Create account' : 'Sign in'}
            </button>
            <p className="authSwitchText">
              {authMode === 'register' ? 'Already have an account?' : "Don't have an account?"}{' '}
              <button
                type="button"
                className="authTextBtn"
                onClick={() => {
                  setAuthMode(authMode === 'register' ? 'login' : 'register')
                  setLoginError('')
                }}
              >
                {authMode === 'register' ? 'Sign in' : 'Sign up'}
              </button>
            </p>
          </form>
        </section>
      </div>
    )
  }

  return (
    <div className="page">
      <header className="header">
        <div className="headerTitle">AI Interview Studio</div>
        <div className="headerRight">
          <button className="navBtn" onClick={handleLogout}>Logout</button>
        </div>
      </header>

      <aside className="sideNav">
        <div className="sideBrand">
          <h2>Interview AI</h2>
          <p>Pro Plan Active</p>
        </div>
        <nav className="topNav">
          <button className={`navBtn ${activePage === 'setup' ? 'navBtnActive' : ''}`} onClick={() => openPage('setup')}>Setup</button>
          <button className={`navBtn ${activePage === 'features' ? 'navBtnActive' : ''}`} onClick={() => openPage('features')}>Features Hub</button>
          <button className={`navBtn ${activePage === 'interview' ? 'navBtnActive' : ''}`} onClick={() => openPage('interview')}>Mock Interview</button>
          <button className={`navBtn ${activePage === 'coding' ? 'navBtnActive' : ''}`} onClick={() => openPage('coding')}>DSA Coding</button>
          <button className={`navBtn ${activePage === 'company' ? 'navBtnActive' : ''}`} onClick={() => openPage('company')}>Company Rounds</button>
          <button className={`navBtn ${activePage === 'gap' ? 'navBtnActive' : ''}`} onClick={() => openPage('gap')}>Resume Gap</button>
          <button className={`navBtn ${activePage === 'scoring' ? 'navBtnActive' : ''}`} onClick={() => openPage('scoring')}>Scoring</button>
          <button className={`navBtn ${activePage === 'sessions' ? 'navBtnActive' : ''}`} onClick={() => openPage('sessions')}>Past Sessions</button>
          <button className={`navBtn ${activePage === 'history' ? 'navBtnActive' : ''}`} onClick={() => openPage('history')}>History</button>
          <button className={`navBtn ${activePage === 'recommendations' ? 'navBtnActive' : ''}`} onClick={() => openPage('recommendations')}>Recommendations</button>
        </nav>
      </aside>

      <main className="grid">
        {activePage === 'setup' && (
        <section className="card upload pageWide">
          <div className="setupHead">
            <h2>Prepare for Your Mock Interview</h2>
            <p className="muted">Provide your materials to tailor the AI assessment to your specific goals.</p>
          </div>
          <div className="setupStatus">
            {!file && !hasResume && <p className="muted"><strong>Before upload:</strong> Choose a resume file from the Resume card, then click <strong>Upload & Parse</strong>.</p>}
            {file && !hasResume && <p className="muted"><strong>Selected:</strong> {file.name}. Now click <strong>Upload & Parse</strong>.</p>}
            {hasResume && <p className="muted successText"><strong>Uploaded:</strong> Resume parsed successfully. You can now continue with interview features.</p>}
          </div>

          <div className="setupStepper">
            <div className="stepLine"></div>
            <div className={`step ${setupStep >= 1 ? 'active' : ''} ${setupStep > 1 ? 'complete' : ''}`}><span>1</span><small>Upload</small></div>
            <div className={`step ${setupStep >= 2 ? 'active' : ''} ${setupStep > 2 ? 'complete' : ''}`}><span>2</span><small>Configure</small></div>
            <div className={`step ${setupStep >= 3 ? 'active' : ''}`}><span>3</span><small>Start</small></div>
          </div>

          <div className="setupGrid">
            <div className="setupCard">
              <h3>Resume</h3>
              <p className="muted">Upload your latest CV. PDF or image.</p>
              <label className="dropZone">
                <input
                  type="file"
                  accept=".pdf,image/*"
                  onChange={(e) => {
                    setFile(e.target.files[0])
                    setShowSetupUploadResult(false)
                  }}
                />
                <div>
                  <strong>{file ? `Selected: ${file.name}` : 'Drag & drop your file here'}</strong>
                  <span>{file ? 'Click Upload & Parse below to process it' : 'or click to browse'}</span>
                </div>
              </label>
              <button onClick={upload} disabled={loading} className="btn setupBtn">
                {loading ? 'Uploading...' : 'Upload & Parse'}
              </button>
            </div>

            <div className="setupCard">
              <h3>Job Description</h3>
              <p className="muted">Paste the JD to tailor questions.</p>
              <textarea
                value={jobDesc}
                onChange={(e) => setJobDesc(e.target.value)}
                placeholder="Paste the full job description here..."
                className="jobText"
              />
              <button onClick={setJob} className="btn setupBtn">Set Job Description</button>
            </div>
          </div>

          <div className="setupAction">
              <button
                className="btn"
              onClick={() => openPage('features')}
              disabled={!setupCompleteThisSession}
            >
              Continue to Configuration
            </button>
          </div>

          <div className="preview">
            <h3>Parsed Resume</h3>
            <pre>
              {showSetupUploadResult
                ? (resumeText || 'No resume parsed yet.')
                : 'Before upload, this section is empty. After Upload & Parse, extracted resume text will appear here.'}
            </pre>
          </div>
          <div className="preview">
            <h3>Saved Resumes</h3>
            {!showSetupUploadResult ? <p className="muted">Saved resumes will appear after Upload & Parse.</p> : savedResumes.length === 0 ? <p className="muted">No saved resumes yet.</p> : (
              <ul>{savedResumes.map((item) => (<li key={item.id}><strong>{item.fileName}</strong> - {new Date(item.uploadedAt).toLocaleString()}</li>))}</ul>
            )}
          </div>
        </section>
        )}

        {activePage === 'features' && (
        <section className="card upload pageWide">
          <div className="hubTop">
            <div>
              <h2>Features Hub</h2>
              <p className="muted">Your central command center for interview preparation.</p>
            </div>
            <div className="hubTopStats">
              <span>Score: <strong>{latestScore?.overall ?? 'N/A'}</strong></span>
            </div>
          </div>

          <div className="hubGrid">
            <article className="hubCard scoreCardLite">
              <h3>Preparation Score</h3>
              {canShowPreparationScore ? (
                <>
                  <div className="hubScore">{latestScore?.overall ?? 0}</div>
                  <p className="muted">Good Standing</p>
                  <button className="btn btnGhost" onClick={() => openPage('scoring')}>View Detailed Insights</button>
                </>
              ) : (
                <>
                  <div className="hubScore">-</div>
                  <p className="muted">Complete Mock Interview and DSA Round to unlock score.</p>
                  <button className="btn btnGhost" onClick={() => openPage('scoring')} disabled>Locked</button>
                </>
              )}
            </article>

            <article className="hubCard">
              <h3>Mock Interview</h3>
              <p className="muted">Simulate rounds with adaptive AI hiring manager.</p>
              <button className="btn" onClick={() => openPage('interview')}>Start Session</button>
            </article>

            <article className="hubCard">
              <h3>DSA Labs</h3>
              <p className="muted">Practice coding and complexity analysis.</p>
              <button className="btn" onClick={() => openPage('coding')}>Practice Now</button>
            </article>

            <article className="hubCard hubCardWide">
              <h3>Resume Gap Analysis</h3>
              <p className="muted">Identify missing skills compared to target JD.</p>
              <button className="btn" onClick={() => openPage('gap')}>Open Resume Gap</button>
            </article>

            <article className="hubCard">
              <h3>Company Rounds</h3>
              <p className="muted">Google, Amazon, and TCS style interview tracks.</p>
              <button className="btn" onClick={() => openPage('company')}>Open Rounds</button>
            </article>

            <article className="hubCard">
              <h3>Recommendations</h3>
              <p className="muted">Personalized next-step plan from your performance.</p>
              <button className="btn" onClick={() => openPage('recommendations')}>View Plan</button>
            </article>

            <article className="hubCard">
              <h3>Past Sessions</h3>
              <p className="muted">Review latest session summary and recent turns.</p>
              <button className="btn" onClick={() => openPage('sessions')}>View Sessions</button>
            </article>

            <article className="hubCard">
              <h3>History</h3>
              <p className="muted">Browse all users history and activity snapshots.</p>
              <button className="btn" onClick={() => openPage('history')}>Open History</button>
            </article>
          </div>
        </section>
        )}

        {activePage === 'coding' && (
        <section className="card chat pageWide">
          <div className="codingLab">
            <div className="codingLabTop">
              <h2>DSA Coding Lab</h2>
              <div className="codingControls">
                <select value={codingDuration} onChange={(e) => setCodingDuration(Number(e.target.value))} disabled={codingLoading || !hasResume}>
                  <option value={15}>15 min</option>
                  <option value={25}>25 min</option>
                  <option value={35}>35 min</option>
                  <option value={45}>45 min</option>
                </select>
                <button className="btn" onClick={startCodingRound} disabled={codingLoading || !hasResume}>
                  {codingLoading ? 'Please wait...' : 'Start Coding Round'}
                </button>
                <button className="btn stopBtn" onClick={stopCodingRound} disabled={codingLoading || !codingRound || !hasResume}>
                  Stop Coding Round
                </button>
              </div>
            </div>

            {!hasResume && (
              <p className="speechError">Upload and parse resume in Setup page before using DSA Coding Round.</p>
            )}

            {!codingRound && <p className="muted">Start a timed round to get a coding prompt with test cases.</p>}

            {codingRound && (
              <div className="codingLabGrid">
                <div className="codingProblemPane">
                  <p className="codingTimer">
                    Time Left: <strong>{String(timeLeftMin).padStart(2, '0')}:{String(timeLeftSec).padStart(2, '0')}</strong>
                    {timeLeftMs <= 0 && <span className="expiredTag"> Time up</span>}
                  </p>
                  <h3>{codingRound.problem?.title}</h3>
                  <p>{codingRound.problem?.problem}</p>
                  <p><strong>Difficulty:</strong> {codingRound.problem?.difficulty}</p>
                  <p><strong>Function Signature:</strong> <code>{codingRound.problem?.functionSignature}</code></p>
                  <p className="gapTitle">Constraints</p>
                  <ul>
                    {(codingRound.problem?.constraints || []).map((c, i) => <li key={`cc-${i}`}>{c}</li>)}
                  </ul>
                  <p className="gapTitle">Examples / Test Cases</p>
                  <ul>
                    {(codingRound.problem?.testCases || []).map((tc, i) => (
                      <li key={`tc-${i}`}>Input: {tc.input} | Expected: {tc.expected}</li>
                    ))}
                  </ul>
                </div>

                <div className="codingEditorPane">
                  <div className="codingSubmitRow">
                    <select value={codingLanguage} onChange={(e) => setCodingLanguage(e.target.value)} disabled={codingLoading || !hasResume}>
                      <option value="javascript">JavaScript</option>
                      <option value="java">Java</option>
                      <option value="python">Python</option>
                      <option value="cpp">C++</option>
                    </select>
                  </div>

                  <textarea
                    className="codingEditor"
                    value={codingSolution}
                    onChange={(e) => setCodingSolution(e.target.value)}
                    placeholder="Write your code solution here..."
                  />

                  <div className="codingSubmitRow">
                    <button className="btn" disabled>Run Code</button>
                    <button className="btn" onClick={submitCodingSolution} disabled={codingLoading || !hasResume}>
                      Submit
                    </button>
                  </div>
                </div>
              </div>
            )}

            {codingFeedback && (
              <div className="codingFeedback">
                <p>
                  <strong>Score:</strong> {codingFeedback.score}/10 | <strong>Verdict:</strong> {codingFeedback.verdict} |{' '}
                  <strong>Passed:</strong> {codingFeedback.passedCount}/{codingFeedback.totalCount}
                </p>
                <p><strong>Time Complexity:</strong> {codingFeedback.timeComplexity}</p>
                <p><strong>Space Complexity:</strong> {codingFeedback.spaceComplexity}</p>
                <p className="gapTitle">Feedback</p>
                <ul>
                  {(codingFeedback.feedback || []).map((f, i) => <li key={`f-${i}`}>{f}</li>)}
                </ul>
                <p><strong>Improved Approach:</strong> {codingFeedback.improvedApproach}</p>
              </div>
            )}
          </div>
        </section>
        )}

        {activePage === 'company' && (
        <section className="card pageWide">
          <div className="codingCard companyWrap">
            <div className="companyHead">
              <h2>Company Rounds</h2>
              <p className="muted">Master interview formats of top companies with targeted mock rounds.</p>
            </div>

            <div className="companyCards">
              <button className={`companyCard ${selectedCompany === 'Google' ? 'companyCardActive' : ''}`} onClick={() => setSelectedCompany('Google')} disabled={companyLoading}>
                <span className="companyPill">Google</span>
                <h3>Googlyness & Leadership</h3>
                <p className="muted">Behavioral and leadership-focused format.</p>
              </button>
              <button className={`companyCard ${selectedCompany === 'Amazon' ? 'companyCardActive' : ''}`} onClick={() => setSelectedCompany('Amazon')} disabled={companyLoading}>
                <span className="companyPill">Amazon</span>
                <h3>Leadership Principles</h3>
                <p className="muted">STAR method and LP-driven evaluation.</p>
              </button>
              <button className={`companyCard ${selectedCompany === 'TCS' ? 'companyCardActive' : ''}`} onClick={() => setSelectedCompany('TCS')} disabled={companyLoading}>
                <span className="companyPill">TCS / Infosys</span>
                <h3>Technical Assessment</h3>
                <p className="muted">Core DSA and rapid-fire technical checks.</p>
              </button>
            </div>

            <div className="codingTop">
              <div className="codingControls">
                <button className="btn" onClick={startCompanyRound} disabled={companyLoading || !hasResume}>
                  {companyLoading ? 'Please wait...' : `Start ${selectedCompany} Round`}
                </button>
              </div>
            </div>

            {!hasResume && <p className="speechError">Upload and parse resume in Setup page before using Company Round.</p>}
            {!companyRound && <p className="muted">Generate a company-style mock round with behavior, coding, and system design sections.</p>}

            {companyRound && (
              <div className="codingBody">
                <p><strong>{companyRound.round?.roundTitle}</strong> ({companyRound.company})</p>

                <div className="codingSubmitRow">
                  <select value={companySection} onChange={(e) => setCompanySection(e.target.value)} disabled={companyLoading}>
                    <option value="behavior">Behavior</option>
                    <option value="coding">Coding</option>
                    <option value="system_design">System Design</option>
                  </select>
                </div>

                {companySection === 'behavior' && (
                  <>
                    <p><strong>Question:</strong> {companyRound.round?.behavior?.question}</p>
                    <p className="gapTitle">What to assess</p>
                    <ul>
                      {(companyRound.round?.behavior?.whatToAssess || []).map((x, i) => <li key={`b-${i}`}>{x}</li>)}
                    </ul>
                  </>
                )}

                {companySection === 'coding' && (
                  <>
                    <p><strong>Question:</strong> {companyRound.round?.coding?.question}</p>
                    <p className="gapTitle">Test Cases</p>
                    <ul>
                      {(companyRound.round?.coding?.testCases || []).map((tc, i) => (
                        <li key={`ct-${i}`}>Input: {tc.input} | Expected: {tc.expected}</li>
                      ))}
                    </ul>
                  </>
                )}

                {companySection === 'system_design' && (
                  <>
                    <p><strong>Question:</strong> {companyRound.round?.systemDesign?.question}</p>
                    <p className="gapTitle">Focus Areas</p>
                    <ul>
                      {(companyRound.round?.systemDesign?.focusAreas || []).map((x, i) => <li key={`s-${i}`}>{x}</li>)}
                    </ul>
                  </>
                )}

                <textarea
                  className="codingEditor"
                  value={companyAnswer}
                  onChange={(e) => setCompanyAnswer(e.target.value)}
                  placeholder="Write your answer here..."
                />

                <div className="codingSubmitRow">
                  <button className="btn" onClick={submitCompanyAnswer} disabled={companyLoading}>
                    Submit Answer
                  </button>
                </div>

                {companyEvaluation && (
                  <div className="codingFeedback">
                    <p><strong>Score:</strong> {companyEvaluation.score}/10</p>
                    <p><strong>Feedback:</strong> {companyEvaluation.feedback}</p>
                    <p className="gapTitle">Improvements</p>
                    <ul>
                      {(companyEvaluation.improvements || []).map((x, i) => <li key={`ci-${i}`}>{x}</li>)}
                    </ul>
                    <p><strong>Next Question:</strong> {companyEvaluation.nextQuestion}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
        )}

        {activePage === 'scoring' && (
        <section className="card chat pageWide">
          <div className="scoreDash">
            <div className="scoreDashHead">
              <div>
                <h2>Scoring Dashboard</h2>
                <p className="muted">
                  {pastSession?.lastSessionAt ? new Date(pastSession.lastSessionAt).toLocaleDateString() : 'No date'} • {scoreHistory.length} answered turns
                </p>
              </div>
              <div className="scoreDashActions">
                <button className="btn btnGhost" onClick={() => openPage('history')}>Export Report</button>
                <button className="btn" onClick={() => openPage('interview')}>Retry Interview</button>
              </div>
            </div>

            <div className="scoreDashGrid">
              <div className="scoreDonutCard">
                <p className="muted">Overall Performance</p>
                <div className="donutWrap">
                  <div className="donutCore">
                    <strong>{latestScore ? Math.round(Number(latestScore.overall) * 10) : 0}</strong>
                    <span>/100</span>
                  </div>
                </div>
                <div className="scoreBadges">
                  <span className="typePill">DSA: {codingFeedback?.score ?? 'N/A'}/10</span>
                  <span className="typePill">Level {adaptiveDifficulty.level}/5</span>
                </div>
              </div>

              <div className="scoreSkillsCard">
                <h3>Skill Dimensions</h3>
                {latestScore ? (
                  <>
                    <div className="skillRow"><span>Communication</span><b>{Math.round(avg('communication') * 10)}/100</b></div>
                    <div className="skillBar"><div style={{ width: `${Math.round(avg('communication') * 10)}%` }}></div></div>
                    <div className="skillRow"><span>Technical Knowledge</span><b>{Math.round(avg('correctness') * 10)}/100</b></div>
                    <div className="skillBar"><div style={{ width: `${Math.round(avg('correctness') * 10)}%` }}></div></div>
                    <div className="skillRow"><span>Confidence & Delivery</span><b>{Math.round(avg('clarity') * 10)}/100</b></div>
                    <div className="skillBar"><div style={{ width: `${Math.round(avg('clarity') * 10)}%` }}></div></div>
                    <div className="skillRow"><span>Strategic Thinking</span><b>{Math.round(avg('depth') * 10)}/100</b></div>
                    <div className="skillBar"><div style={{ width: `${Math.round(avg('depth') * 10)}%` }}></div></div>
                  </>
                ) : (
                  <p className="muted">No scored answers yet. Start interview and DSA round to populate metrics.</p>
                )}
                {latestScore?.feedback && <p className="scoreFeedback">Latest feedback: {latestScore.feedback}</p>}
              </div>
            </div>
          </div>
        </section>
        )}

        {activePage === 'interview' && (
        <section className="card chat pageWide">
          <div className="interviewTop">
            <h2>Active Interview Session</h2>
            <span className="sessionTag">{listening ? 'Recording in progress' : 'Ready'}</span>
          </div>

          <div className="interviewLayout">
            <div className="interviewMain">
              <div className="voiceStatus">
                <span className={`statusDot ${listening ? 'statusLive' : processingVoice ? 'statusBusy' : ''}`} />
                <span>{voiceStatus}</span>
                {(loading || processingVoice) && (
                  <span className="loadingDots" aria-hidden="true">
                    <span></span>
                    <span></span>
                    <span></span>
                  </span>
                )}
              </div>

              {speechError && <div className="speechError">{speechError}</div>}

              <div className="interviewerHero">
                <div className="avatarOrb"></div>
                <h3>Sarah (AI Interviewer)</h3>
                <p className="muted">{listening ? 'Listening...' : 'Awaiting your response'}</p>
                <div className="interviewControls">
                  <button
                    onClick={toggleLiveMode}
                    disabled={loading && !processingVoice}
                    className={`btn micBtn ${liveMode ? 'micActive' : ''}`}
                  >
                    {liveMode ? 'Stop Live Mode' : 'Start Live Mode'}
                  </button>
                </div>
              </div>

              <div className="askRow">
                <input
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  placeholder="Type your answer or question..."
                />
                <button onClick={ask} disabled={loading || !resumeText} className="btn">Send</button>
              </div>
            </div>

            <aside className="interviewSide">
              <div className="sideCard">
                <h3>Role Context</h3>
                <p><strong>Target:</strong> {jobDesc?.trim() ? 'Custom JD loaded' : 'Default Software Engineer Role'}</p>
                <p className="muted">Press Q to submit current voice turn. Press K to start listening again.</p>
              </div>
              <div className="sideCard">
                <h3>Live Transcript</h3>
                <div className="conv sideConv">
                  {conversation.length === 0 && <div className="muted">No conversation yet. Ask a question after uploading.</div>}
                  {conversation.map((m, i) => (
                    <div key={i} className={m.who === 'You' ? 'bubble user' : 'bubble ai'}>
                      <strong>{m.who}:</strong>
                      <div>{m.text}</div>
                    </div>
                  ))}
                </div>
              </div>
            </aside>
          </div>
        </section>
        )}

        {activePage === 'gap' && (
        <section className="card upload pageWide">
          <div className="gapDashboard">
            <div className="gapMain">
              <div className="gapHeaderTop">
                <div>
                  <h2>Resume Gap Analysis</h2>
                  <p className="muted">Compare your current resume against the target role and improve your ATS score.</p>
                </div>
                <div className="matchScoreBox">
                  <span className="muted">Match Score</span>
                  <strong>{gapAnalysis ? `${gapAnalysis.matchScore}/10` : '--'}</strong>
                </div>
              </div>

              <div className="gapCard">
                <div className="gapHeader">
                  <h3>Matching Skills</h3>
                  <button onClick={analyzeResumeGap} disabled={gapLoading || loading || !canShowGapAnalysis} className="btn">
                    {gapLoading ? 'Analyzing...' : 'Analyze Resume Gaps'}
                  </button>
                </div>
                {!canShowGapAnalysis && (
                  <p className="muted">Please upload/parse resume and set job description in Setup before viewing analysis.</p>
                )}
                {canShowGapAnalysis && !gapAnalysis && <p className="muted">Run analysis to generate matching and missing skill signals.</p>}
                {canShowGapAnalysis && gapAnalysis && (
                  <div className="skillTags">
                    {(gapAnalysis.missingSkills || []).length
                      ? (gapAnalysis.missingSkills || []).slice(0, 8).map((item, idx) => <span className="skillTag" key={`m-${idx}`}>{item}</span>)
                      : <span className="skillTag">Good matching skill coverage</span>}
                  </div>
                )}
              </div>

              <div className="gapCard">
                <div className="gapHeader">
                  <h3>Critical Gaps</h3>
                  <span className="criticalPill">High Priority</span>
                </div>
                {canShowGapAnalysis && gapAnalysis ? (
                  <div className="criticalList">
                    {(gapAnalysis.weakAreas || []).map((item, idx) => (
                      <div className="criticalItem" key={`w-${idx}`}>
                        <div>
                          <p className="criticalTitle">{item}</p>
                          <p className="muted">Needs stronger evidence in resume or interview responses.</p>
                        </div>
                      </div>
                    ))}
                    {(gapAnalysis.resumeBulletSuggestions || []).slice(0, 3).map((item, idx) => (
                      <div className="criticalItem" key={`b-${idx}`}>
                        <div>
                          <p className="criticalTitle">Resume Bullet Upgrade</p>
                          <p className="muted">{item}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="muted">Run analysis to view critical gaps and suggestions.</p>
                )}
              </div>
            </div>

            <aside className="gapSide">
              <div className="gapCard">
                <h3>Improvement Plan</h3>
                {canShowGapAnalysis && gapAnalysis ? (
                  <>
                    <p className="muted">{gapAnalysis.summary}</p>
                    <ul>
                      {(gapAnalysis.improvementSuggestions || []).map((item, idx) => <li key={`i-${idx}`}>{item}</li>)}
                    </ul>
                    <button className="btn" onClick={() => openPage('recommendations')}>Update Resume Now</button>
                  </>
                ) : (
                  <p className="muted">Run analysis first to generate your plan.</p>
                )}
              </div>
            </aside>
          </div>
        </section>
        )}

        {activePage === 'sessions' && (
        <section className="card upload pageWide">
          <div className="pastWrap">
            <div className="pastHead">
              <h2>Past Sessions</h2>
              <p className="muted">Review your historical performance and track improvement over time.</p>
            </div>

            <div className="pastStats">
              <div className="pastStatCard">
                <p className="muted">Total Interviews</p>
                <strong>{pastSession?.totalTurns ?? 0}</strong>
              </div>
              <div className="pastStatCard">
                <p className="muted">Avg Score</p>
                <strong>{latestScore?.overall ?? (pastSession?.latestOverall ?? 'N/A')}</strong>
              </div>
              <div className="pastStatCard">
                <p className="muted">Difficulty</p>
                <strong>{pastSession?.adaptiveDifficulty?.level ?? 'N/A'}/5</strong>
              </div>
            </div>

            <div className="pastTableWrap">
              <div className="pastTableHead">
                <div>Date</div>
                <div>Role / Topic</div>
                <div>Type</div>
                <div>Final Score</div>
                <div>Action</div>
              </div>

              {!pastSession ? (
                <div className="pastRow"><div className="muted">No session data available yet.</div></div>
              ) : (
                <>
                  <div className="pastRow">
                    <div>{pastSession.lastSessionAt ? new Date(pastSession.lastSessionAt).toLocaleDateString() : 'N/A'}</div>
                    <div>
                      <strong>Interview Session</strong>
                      <p className="muted">Adaptive difficulty: {pastSession.adaptiveDifficulty?.label || 'N/A'}</p>
                    </div>
                    <div><span className="typePill">Mock Interview</span></div>
                    <div className="scoreValue">{pastSession.latestOverall ?? 'N/A'}</div>
                    <div><button className="btn btnGhost" onClick={() => openPage('scoring')}>View Analysis</button></div>
                  </div>
                </>
              )}
            </div>

            <div className="scoreCard">
              <p className="gapTitle">Recent Conversation</p>
              <div className="conv">
                {(pastSession?.recentConversation || []).length === 0 && <div className="muted">No conversation yet.</div>}
                {(pastSession?.recentConversation || []).map((m, i) => (
                  <div key={i} className={m.who === 'You' ? 'bubble user' : 'bubble ai'}>
                    <strong>{m.who}:</strong>
                    <div>{m.text}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
        )}

        {activePage === 'history' && (
        <section className="card upload pageWide">
          <div className="gapCard">
            <div className="gapHeader">
              <h3>History (All Users)</h3>
              <button onClick={loadGlobalHistory} disabled={historyLoading} className="btn">
                {historyLoading ? 'Refreshing...' : 'Refresh History'}
              </button>
            </div>
            {globalHistory.length === 0 ? (
              <p className="muted">No history found yet.</p>
            ) : (
              <div className="gapBody">
                {globalHistory.map((item) => (
                  <div key={item.userId} className="preview">
                    <p><strong>{item.name}</strong> ({item.email})</p>
                    <p className="muted">Joined: {item.createdAt ? new Date(item.createdAt).toLocaleString() : 'N/A'}</p>
                    <p className="muted">Last Session: {item.lastSessionAt ? new Date(item.lastSessionAt).toLocaleString() : 'N/A'}</p>
                    <p>Interview Turns: <strong>{item.totalInterviewTurns}</strong> | Latest Score: <strong>{item.latestOverallScore ?? 'N/A'}</strong> | Saved Resumes: <strong>{item.savedResumesCount}</strong></p>
                    <p className="gapTitle">Recent Conversation</p>
                    <div className="conv">
                      {(item.recentConversation || []).map((m, i) => (
                        <div key={`${item.userId}-${i}`} className={m.who === 'You' ? 'bubble user' : 'bubble ai'}>
                          <strong>{m.who}:</strong>
                          <div>{m.text}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
        )}

        {activePage === 'recommendations' && (
        <section className="card upload pageWide">
          <div className="gapCard">
            <div className="gapHeader">
              <h3>Personalized Recommendations</h3>
              <button onClick={loadRecommendations} disabled={recommendationLoading || !canShowGapAnalysis} className="btn">
                {recommendationLoading ? 'Generating...' : 'Generate Recommendations'}
              </button>
            </div>
            {!canShowGapAnalysis ? (
              <p className="muted">Please upload/parse resume and set job description in Setup before viewing recommendations.</p>
            ) : !recommendations ? (
              <p className="muted">Generate recommendations based on your resume, scores, and gap analysis.</p>
            ) : (
              <div className="gapBody">
                <p className="muted">{recommendations.summary}</p>
                <p className="gapTitle">Priority Actions</p>
                <ul>{(recommendations.priorityActions || []).map((x, i) => <li key={`pa-${i}`}>{x}</li>)}</ul>
                <p className="gapTitle">Practice Plan</p>
                <ul>{(recommendations.practicePlan || []).map((x, i) => <li key={`pp-${i}`}>{x}</li>)}</ul>
                <p className="gapTitle">Resume Improvements</p>
                <ul>{(recommendations.resumeImprovements || []).map((x, i) => <li key={`ri-${i}`}>{x}</li>)}</ul>
                <p className="gapTitle">Next 7 Days Plan</p>
                <ul>{(recommendations.next7DaysPlan || []).map((x, i) => <li key={`n7-${i}`}>{x}</li>)}</ul>
              </div>
            )}
          </div>
        </section>
        )}
      </main>

      <footer className="footer">Live mode uses Sarvam speech-to-text and Sarvam text-to-speech for each interview turn.</footer>
    </div>
  )
}
