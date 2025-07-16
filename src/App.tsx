import React, { useState, useCallback, useEffect, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card'
import { Button } from './components/ui/button'
import { Badge } from './components/ui/badge'
import { Progress } from './components/ui/progress'
import { Alert, AlertDescription } from './components/ui/alert'
import { Separator } from './components/ui/separator'
import { Recycle, Trash2, Trophy, Zap, Target, Camera, Sparkles, Video, VideoOff, RotateCcw } from 'lucide-react'
import { blink } from './blink/client'

interface GameStats {
  score: number
  streak: number
  totalAnswers: number
  correctAnswers: number
  level: number
}

interface AnalysisResult {
  classification: 'recycle' | 'trash'
  confidence: number
  explanation: string
  tips: string[]
}

interface Achievement {
  id: string
  name: string
  description: string
  icon: React.ReactNode
  unlocked: boolean
}

function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null)
  const [showResult, setShowResult] = useState(false)
  const [userAnswer, setUserAnswer] = useState<'recycle' | 'trash' | null>(null)
  const [gameStats, setGameStats] = useState<GameStats>({
    score: 0,
    streak: 0,
    totalAnswers: 0,
    correctAnswers: 0,
    level: 1
  })
  
  // Camera streaming states
  const [isCameraMode, setIsCameraMode] = useState(false)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [isStreamingAnalysis, setIsStreamingAnalysis] = useState(false)
  const [lastAnalysisTime, setLastAnalysisTime] = useState(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const analysisIntervalRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    const unsubscribe = blink.auth.onAuthStateChanged((state) => {
      setUser(state.user)
      setLoading(state.isLoading)
    })
    return unsubscribe
  }, [])

  const [achievements] = useState<Achievement[]>([
    {
      id: 'first-sort',
      name: 'First Sort',
      description: 'Complete your first waste sorting',
      icon: <Target className="w-4 h-4" />,
      unlocked: false
    },
    {
      id: 'streak-master',
      name: 'Streak Master',
      description: 'Get 5 correct answers in a row',
      icon: <Zap className="w-4 h-4" />,
      unlocked: false
    },
    {
      id: 'eco-champion',
      name: 'Eco Champion',
      description: 'Reach 1000 points',
      icon: <Trophy className="w-4 h-4" />,
      unlocked: false
    }
  ])

  // Camera functions
  const startCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'environment' // Use back camera on mobile
        } 
      })
      setStream(mediaStream)
      setIsCameraMode(true)
      
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream
      }
    } catch (error) {
      console.error('Error accessing camera:', error)
      alert('Unable to access camera. Please check permissions.')
    }
  }

  const stopCamera = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop())
      setStream(null)
    }
    setIsCameraMode(false)
    setIsStreamingAnalysis(false)
    if (analysisIntervalRef.current) {
      clearInterval(analysisIntervalRef.current)
      analysisIntervalRef.current = null
    }
  }, [stream])

  const captureFrame = (): string | null => {
    if (!videoRef.current || !canvasRef.current) return null
    
    const video = videoRef.current
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    
    if (!ctx) return null
    
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    ctx.drawImage(video, 0, 0)
    
    return canvas.toDataURL('image/jpeg', 0.8)
  }

  const uploadImageToStorage = async (dataUrl: string): Promise<string> => {
    try {
      // Convert data URL to blob
      const response = await fetch(dataUrl)
      const blob = await response.blob()
      
      // Create a file from the blob
      const file = new File([blob], `waste-item-${Date.now()}.jpg`, { type: 'image/jpeg' })
      
      // Upload to Blink storage
      const { publicUrl } = await blink.storage.upload(file, `waste-analysis/${Date.now()}.jpg`, { upsert: true })
      
      // Validate that we got an HTTPS URL
      if (!publicUrl || !publicUrl.startsWith('https://')) {
        throw new Error(`Invalid storage URL: ${publicUrl}`)
      }
      
      return publicUrl
    } catch (error) {
      console.error('Failed to upload image to storage:', error)
      throw new Error('Failed to upload image for analysis')
    }
  }

  const analyzeImageFromUrl = async (imageUrl: string): Promise<AnalysisResult> => {
    try {
      // Validate that the image URL is HTTPS
      if (!imageUrl || !imageUrl.startsWith('https://')) {
        throw new Error(`Invalid image URL for AI analysis: ${imageUrl}. Must be HTTPS.`)
      }
      
      // Use Blink AI to analyze the image
      const { text } = await blink.ai.generateText({
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Analyze this image and determine if the object should be recycled or thrown in trash. 

Please respond in this exact JSON format:
{
  "classification": "recycle" or "trash",
  "confidence": number between 70-99,
  "explanation": "Brief explanation of why this item belongs in recycle or trash",
  "tips": ["tip1", "tip2", "tip3"]
}

Consider:
- Plastic bottles, aluminum cans, paper, cardboard = recycle
- Food waste, dirty items, broken glass, electronics = trash
- When in doubt, lean toward trash to avoid contamination`
              },
              {
                type: "image",
                image: imageUrl
              }
            ]
          }
        ]
      })

      // Parse the AI response
      const cleanedText = text.replace(/```json\n?|\n?```/g, '').trim()
      const result = JSON.parse(cleanedText) as AnalysisResult
      
      // Validate the result
      if (!result.classification || !['recycle', 'trash'].includes(result.classification)) {
        throw new Error('Invalid classification')
      }
      
      return result
    } catch (error) {
      console.error('AI analysis failed:', error)
      
      // Fallback to a default response
      return {
        classification: 'trash',
        confidence: 75,
        explanation: 'Unable to analyze this image clearly. When in doubt, it\'s safer to put items in trash to avoid contaminating recycling.',
        tips: ['Take a clearer photo if possible', 'Check your local recycling guidelines', 'When unsure, choose trash to be safe']
      }
    }
  }

  const startStreamingAnalysis = () => {
    setIsStreamingAnalysis(true)
    setAnalysisResult(null)
    setShowResult(false)
    setUserAnswer(null)
    
    analysisIntervalRef.current = setInterval(async () => {
      const now = Date.now()
      if (now - lastAnalysisTime < 2000) return // Throttle to every 2 seconds
      
      const frame = captureFrame()
      if (!frame) return
      
      setLastAnalysisTime(now)
      
      try {
        const imageUrl = await uploadImageToStorage(frame)
        const result = await analyzeImageFromUrl(imageUrl)
        setAnalysisResult(result)
      } catch (error) {
        console.error('Streaming analysis failed:', error)
        // Set a fallback result to prevent UI from being stuck
        setAnalysisResult({
          classification: 'trash',
          confidence: 75,
          explanation: 'Unable to analyze this frame. Please try adjusting the camera angle or lighting.',
          tips: ['Ensure good lighting', 'Hold the camera steady', 'Make sure the object is clearly visible']
        })
      }
    }, 500) // Check every 500ms, but throttled to 2s
  }

  const stopStreamingAnalysis = () => {
    setIsStreamingAnalysis(false)
    if (analysisIntervalRef.current) {
      clearInterval(analysisIntervalRef.current)
      analysisIntervalRef.current = null
    }
  }

  const handleUserAnswer = (answer: 'recycle' | 'trash') => {
    setUserAnswer(answer)
    setShowResult(true)
    
    const isCorrect = answer === analysisResult?.classification
    const points = isCorrect ? (analysisResult?.confidence || 0) : 0
    
    setGameStats(prev => ({
      ...prev,
      score: prev.score + points,
      streak: isCorrect ? prev.streak + 1 : 0,
      totalAnswers: prev.totalAnswers + 1,
      correctAnswers: prev.correctAnswers + (isCorrect ? 1 : 0),
      level: Math.floor((prev.score + points) / 500) + 1
    }))
  }

  const resetGame = () => {
    setAnalysisResult(null)
    setShowResult(false)
    setUserAnswer(null)
    stopStreamingAnalysis()
  }

  // Cleanup camera on unmount
  useEffect(() => {
    return () => {
      stopCamera()
    }
  }, [stopCamera])

  const accuracy = gameStats.totalAnswers > 0 ? Math.round((gameStats.correctAnswers / gameStats.totalAnswers) * 100) : 0

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 via-blue-50 to-emerald-50 flex items-center justify-center">
        <div className="text-center">
          <div className="p-4 bg-green-500 rounded-full mb-4 mx-auto w-fit">
            <Sparkles className="w-8 h-8 text-white animate-spin" />
          </div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Loading EcoSort AI...</h2>
          <p className="text-gray-600">Getting ready to sort some waste!</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 via-blue-50 to-emerald-50 flex items-center justify-center">
        <div className="text-center max-w-md mx-auto p-8">
          <div className="p-4 bg-green-500 rounded-full mb-6 mx-auto w-fit">
            <Recycle className="w-12 h-12 text-white" />
          </div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-green-600 to-blue-600 bg-clip-text text-transparent mb-4">
            EcoSort AI
          </h1>
          <p className="text-gray-600 mb-6">
            Please sign in to start playing the waste sorting game and track your progress!
          </p>
          <Button 
            onClick={() => blink.auth.login()}
            className="bg-green-600 hover:bg-green-700"
            size="lg"
          >
            Sign In to Play
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-blue-50 to-emerald-50">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Header */}
        <div className="flex justify-between items-start mb-8">
          <div className="text-center flex-1">
            <div className="flex items-center justify-center gap-3 mb-4">
              <div className="p-3 bg-green-500 rounded-full">
                <Recycle className="w-8 h-8 text-white" />
              </div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-green-600 to-blue-600 bg-clip-text text-transparent">
                EcoSort AI
              </h1>
            </div>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              Test your waste sorting skills! Use your camera for real-time analysis to learn proper waste sorting.
            </p>
          </div>
          
          {/* User Profile */}
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium text-gray-800">Welcome back!</p>
              <p className="text-xs text-gray-600">{user?.email}</p>
            </div>
            <Button
              onClick={() => blink.auth.logout()}
              variant="outline"
              size="sm"
            >
              Sign Out
            </Button>
          </div>
        </div>

        {/* Game Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <Card className="text-center">
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-green-600">{gameStats.score}</div>
              <div className="text-sm text-gray-600">Score</div>
            </CardContent>
          </Card>
          <Card className="text-center">
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-blue-600">{gameStats.streak}</div>
              <div className="text-sm text-gray-600">Streak</div>
            </CardContent>
          </Card>
          <Card className="text-center">
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-purple-600">{accuracy}%</div>
              <div className="text-sm text-gray-600">Accuracy</div>
            </CardContent>
          </Card>
          <Card className="text-center">
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-orange-600">Level {gameStats.level}</div>
              <div className="text-sm text-gray-600">
                <Progress value={(gameStats.score % 500) / 5} className="mt-2" />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Main Game Area */}
          <div className="lg:col-span-2 space-y-6">
            {/* Camera Analysis */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Camera className="w-5 h-5" />
                    Live Camera Analysis
                  </CardTitle>
                  <Button
                    onClick={() => {
                      if (isCameraMode) {
                        stopCamera()
                      } else {
                        startCamera()
                      }
                    }}
                    variant={isCameraMode ? "destructive" : "default"}
                    size="sm"
                  >
                    {isCameraMode ? (
                      <>
                        <VideoOff className="w-4 h-4 mr-2" />
                        Stop Camera
                      </>
                    ) : (
                      <>
                        <Video className="w-4 h-4 mr-2" />
                        Start Camera
                      </>
                    )}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {!isCameraMode ? (
                  <div className="text-center py-12">
                    <Camera className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                    <h3 className="text-xl font-semibold text-gray-700 mb-2">
                      Ready to Start Sorting?
                    </h3>
                    <p className="text-gray-600 mb-6">
                      Click "Start Camera" to begin real-time waste sorting analysis
                    </p>
                    <Button
                      onClick={startCamera}
                      className="bg-green-600 hover:bg-green-700"
                      size="lg"
                    >
                      <Video className="w-5 h-5 mr-2" />
                      Start Camera
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="relative">
                      <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        className="w-full max-w-md mx-auto rounded-lg shadow-lg"
                        style={{ transform: 'scaleX(-1)' }} // Mirror the video
                      />
                      <canvas ref={canvasRef} className="hidden" />
                      
                      {/* Live analysis overlay */}
                      {analysisResult && (
                        <div className="absolute top-4 left-4 right-4">
                          <div className={`p-3 rounded-lg backdrop-blur-sm ${
                            analysisResult.classification === 'recycle' 
                              ? 'bg-green-500/80 text-white' 
                              : 'bg-gray-600/80 text-white'
                          }`}>
                            <div className="flex items-center gap-2 mb-1">
                              {analysisResult.classification === 'recycle' ? (
                                <Recycle className="w-4 h-4" />
                              ) : (
                                <Trash2 className="w-4 h-4" />
                              )}
                              <span className="font-medium">
                                {analysisResult.classification === 'recycle' ? 'RECYCLE' : 'TRASH'}
                              </span>
                              <Badge variant="secondary" className="ml-auto">
                                {analysisResult.confidence}%
                              </Badge>
                            </div>
                            <p className="text-sm opacity-90">{analysisResult.explanation}</p>
                          </div>
                        </div>
                      )}
                    </div>
                    
                    <div className="text-center space-y-4">
                      {!isStreamingAnalysis ? (
                        <Button
                          onClick={startStreamingAnalysis}
                          className="bg-blue-600 hover:bg-blue-700"
                          size="lg"
                        >
                          <Sparkles className="w-5 h-5 mr-2" />
                          Start Live Analysis
                        </Button>
                      ) : (
                        <div className="space-y-4">
                          <Button
                            onClick={stopStreamingAnalysis}
                            variant="outline"
                            size="lg"
                          >
                            <RotateCcw className="w-5 h-5 mr-2" />
                            Stop Analysis
                          </Button>
                          
                          {analysisResult && (
                            <div className="space-y-3">
                              <p className="text-lg font-medium">
                                What do you think? Where should this go?
                              </p>
                              <div className="flex gap-4 justify-center">
                                <Button
                                  onClick={() => handleUserAnswer('recycle')}
                                  className="bg-green-600 hover:bg-green-700 flex items-center gap-2"
                                  size="lg"
                                >
                                  <Recycle className="w-5 h-5" />
                                  Recycle
                                </Button>
                                <Button
                                  onClick={() => handleUserAnswer('trash')}
                                  className="bg-gray-600 hover:bg-gray-700 flex items-center gap-2"
                                  size="lg"
                                >
                                  <Trash2 className="w-5 h-5" />
                                  Trash
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      
                      <p className="text-sm text-gray-600">
                        Point your camera at any object to get instant waste sorting guidance
                      </p>
                    </div>
                  </div>
                )}
                
                {/* Results section */}
                {showResult && analysisResult && (
                  <div className="space-y-4 mt-6">
                    <Alert className={userAnswer === analysisResult.classification ? 'border-green-500 bg-green-50' : 'border-red-500 bg-red-50'}>
                      <AlertDescription>
                        <div className="flex items-center gap-2 mb-2">
                          {userAnswer === analysisResult.classification ? (
                            <Badge className="bg-green-600">Correct! +{analysisResult.confidence} points</Badge>
                          ) : (
                            <Badge variant="destructive">Incorrect! Try again next time</Badge>
                          )}
                          <Badge variant="outline">
                            AI Confidence: {analysisResult.confidence}%
                          </Badge>
                        </div>
                        <p className="font-medium mb-2">
                          Correct Answer: {analysisResult.classification === 'recycle' ? 'Recycle' : 'Trash'}
                        </p>
                        <p className="text-sm">{analysisResult.explanation}</p>
                      </AlertDescription>
                    </Alert>

                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg">💡 Eco Tips</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ul className="space-y-2">
                          {analysisResult.tips.map((tip, index) => (
                            <li key={index} className="text-sm flex items-start gap-2">
                              <span className="text-green-600 mt-1">•</span>
                              {tip}
                            </li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>

                    <div className="text-center">
                      <Button onClick={resetGame} variant="outline">
                        Try Another Item
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Achievements */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Trophy className="w-5 h-5" />
                  Achievements
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {achievements.map((achievement) => (
                    <div
                      key={achievement.id}
                      className={`flex items-center gap-3 p-3 rounded-lg ${
                        achievement.unlocked ? 'bg-yellow-50 border border-yellow-200' : 'bg-gray-50'
                      }`}
                    >
                      <div className={`p-2 rounded-full ${
                        achievement.unlocked ? 'bg-yellow-500 text-white' : 'bg-gray-300 text-gray-500'
                      }`}>
                        {achievement.icon}
                      </div>
                      <div>
                        <div className="font-medium text-sm">{achievement.name}</div>
                        <div className="text-xs text-gray-600">{achievement.description}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Game History */}
            <Card>
              <CardHeader>
                <CardTitle>Quick Stats</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Total Attempts</span>
                    <span className="font-medium">{gameStats.totalAnswers}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Correct Answers</span>
                    <span className="font-medium text-green-600">{gameStats.correctAnswers}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Best Streak</span>
                    <span className="font-medium text-blue-600">{gameStats.streak}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Current Level</span>
                    <span className="font-medium text-purple-600">Level {gameStats.level}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Educational Info */}
            <Card>
              <CardHeader>
                <CardTitle>🌱 Did You Know?</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-sm text-gray-600 space-y-2">
                  <p>• Recycling one aluminum can saves enough energy to power a TV for 3 hours</p>
                  <p>• It takes 450 years for a plastic bottle to decompose</p>
                  <p>• Recycling paper uses 60% less energy than making new paper</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App