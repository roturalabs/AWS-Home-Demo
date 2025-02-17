import { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, Send, Bot, Code2, Wallet, RefreshCw } from 'lucide-react';
import { TuraWorkflow } from '../../agentic_workflow/TuraWorkflow';
import { VirtualWalletSystem } from '../../lib/virtual-wallet-system';
import { AgenticWorkflow } from '../../agentic_workflow/AgenticWorkflow';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { ScrollArea } from '../ui/scroll-area';
import { Badge } from '../ui/badge';
import { officialAgents, agents, createWorkflows } from '../../stores/agent-store';
import { Agent, OfficialAgent, Workflow } from '../../types/agentTypes';
import { MockWalletAgent } from '../../agentic_workflow/MockWalletAgent';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';

import { Message } from '../../agentic_workflow/AgenticWorkflow';

interface ChatMessage extends Message {
  id: string;
}

interface SignatureDetails {
  title: string;
  description: string;
  requirePassword?: boolean;
  onConfirm: (password?: string) => Promise<void>;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const updateMessages = useCallback((newMessages: Message[]): void => {
    setMessages(prevMessages => {
      if (JSON.stringify(prevMessages) === JSON.stringify(newMessages)) return prevMessages;
      return newMessages.map((msg, index) => ({
        id: `${Date.now()}-${index}`,
        text: msg.text,
        timestamp: msg.timestamp,
        sender: msg.sender
      }));
    });
  }, []);
  const [showSignatureDialog, setShowSignatureDialog] = useState(false);
  const [signatureDetails, setSignatureDetails] = useState<SignatureDetails | null>(null);
  const [password, setPassword] = useState('');

  // Expose dialog control to window for AgentManager
  useEffect(() => {
    interface ChatPageInterface {
      showSignatureDialog: (details: SignatureDetails) => void;
    }

    (window as unknown as { ChatPage: ChatPageInterface }).ChatPage = {
      showSignatureDialog: (details: SignatureDetails) => {
        setSignatureDetails(details);
        setShowSignatureDialog(true);
      }
    };
    return () => {
      delete (window as unknown as { ChatPage?: ChatPageInterface }).ChatPage;
    };
  }, [messages.length]);
  const [inputText, setInputText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [pressProgress, setPressProgress] = useState(0);
  const pressTimer = useRef<number | null>(null);
  const [walletSystem] = useState(() => new VirtualWalletSystem());
  const [workflows] = useState(() => createWorkflows(walletSystem));
  const turaWorkflow = useRef<TuraWorkflow | null>(null);
  
  useEffect(() => {
    if (workflows[0]?.instance instanceof TuraWorkflow) {
      turaWorkflow.current = workflows[0].instance;
    }
  }, [workflows]);
  const [activeAgent, setActiveAgent] = useState<OfficialAgent | Agent | Workflow | null>(officialAgents[0]);
  const [chatAddress, setChatAddress] = useState('');
  const [chatBalance, setChatBalance] = useState('0');
  const [isRefreshingBalance, setIsRefreshingBalance] = useState(false);
  const [lastMessageTime, setLastMessageTime] = useState<number>(Date.now());

  // Listen for wallet updates from TuraWorkflow
  useEffect(() => {
    const handleWalletUpdate = (event: CustomEvent<{ address: string; balance: string }>) => {
      setChatAddress(event.detail.address);
      setChatBalance(event.detail.balance);
    };
    
    window.addEventListener('wallet-updated', handleWalletUpdate as EventListener);
    return () => window.removeEventListener('wallet-updated', handleWalletUpdate as EventListener);
  }, []);
  const [walletAgent] = useState(() => {
    const instance = officialAgents[0].instance;
    if (!(instance instanceof MockWalletAgent)) {
      throw new Error('Expected WalletAgent instance to be MockWalletAgent');
    }
    return instance;
  });
  
  // Update messages state when balance changes
  const updateBalanceWithMessage = useCallback(async (address: string) => {
    try {
      const balance = await walletSystem.getBalance(address);
      setChatBalance(balance.toString());
      return balance;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error occurred';
      console.error('Error processing message:', errMsg);
      const errorMessage: Message = {
        text: `Failed to refresh balance: ${errMsg}`,
        sender: 'agent',
        timestamp: new Date().toISOString()
      };
      updateMessages([...messages, errorMessage]);
      throw error;
    }
  }, [walletSystem]);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const hasInitialized = useRef(false);

  // Initialize chat and set up balance refresh interval
  useEffect(() => {
    const initializeChat = async () => {
      if (hasInitialized.current) return;
      hasInitialized.current = true;

      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('chat_guest_')) {
          localStorage.removeItem(key);
        }
      });

      try {
        const storedAddress = walletSystem.getCurrentAddress();
        if (storedAddress) {
          setChatAddress(storedAddress);
          await updateBalanceWithMessage(storedAddress);
          
          const balanceResponse = await walletAgent.processMessage('balance');
          updateMessages([{
            text: balanceResponse,
            sender: 'agent',
            timestamp: new Date().toISOString()
          }]);
        } else if (messages.length === 0) {
          const welcomeResponse = await walletAgent.processMessage('help');
          updateMessages([{
            text: welcomeResponse,
            sender: 'agent',
            timestamp: new Date().toISOString()
          }]);
        }
      } catch (error) {
        console.error('Failed to initialize chat:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        updateMessages([{
          text: `Failed to initialize chat: ${errorMessage}. Please try refreshing the page.`,
          sender: 'agent',
          timestamp: new Date().toISOString()
        }]);
      }
    };

    initializeChat();

    const refreshInterval = setInterval(async () => {
      const timeSinceLastMessage = Date.now() - lastMessageTime;
      if (timeSinceLastMessage < 30000 && chatAddress) {
        try {
          await updateBalanceWithMessage(chatAddress);
        } catch (error) {
          console.error('Failed to refresh balance:', error);
        }
      }
    }, 5000);

    return () => clearInterval(refreshInterval);
  }, [walletSystem, walletAgent, lastMessageTime, chatAddress, messages.length, updateBalanceWithMessage, updateMessages]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async () => {
    if (!inputText.trim()) return;

    const text = inputText.trim();
    setInputText('');
    setLastMessageTime(Date.now());

    try {
        // Handle "Start Workflow" command
        if (text.toLowerCase() === 'start workflow') {
          if (!turaWorkflow.current) return;
          const result = await turaWorkflow.current.processMessage('start workflow');
          const message: ChatMessage = {
            id: Date.now().toString(),
            text: result,
            timestamp: new Date().toISOString(),
            sender: 'agent'
          };
          setMessages(prev => [...prev, message]);
          return;
        }

        if (!activeAgent || activeAgent.name === 'WalletAgent') {
          if (!(walletAgent instanceof AgenticWorkflow)) {
            return;
          }
          walletSystem.setCurrentAddress(chatAddress);
          await walletAgent.processMessage(text);
          
          const storedAddress = walletSystem.getCurrentAddress();
          if (storedAddress !== chatAddress) {
            setChatAddress(storedAddress || '');
          }
          
          if (chatAddress) {
            try {
              setIsRefreshingBalance(true);
              await updateBalanceWithMessage(chatAddress);
            } finally {
              setIsRefreshingBalance(false);
            }
          }

          const newMessages = walletAgent.getMessages();
          updateMessages(newMessages);
        } else {
          const agentInstance = activeAgent?.instance;
          if (!agentInstance || !(agentInstance instanceof AgenticWorkflow)) {
            return;
          }
          walletSystem.setCurrentAddress(chatAddress);
          await agentInstance.processMessage(text);
          const newMessages = agentInstance.getMessages();
          updateMessages(newMessages);
        }
    } catch (error: unknown) {
      console.error('Agent processing error:', error);
      const message = error instanceof Error ? error.message : 'Unknown error occurred';
      const errorMessage: Message = {
        text: `Error: ${message}`,
        sender: 'agent',
        timestamp: new Date().toISOString()
      };
      updateMessages([...messages, errorMessage]);
    }
  };

  const startRecording = async () => {
    try {
      // Check if mediaDevices API is supported
      if (!navigator?.mediaDevices?.getUserMedia) {
        throw new Error('MediaDevices API not supported in this browser');
      }

      // Check if MediaRecorder is supported
      if (!window.MediaRecorder) {
        throw new Error('MediaRecorder not supported in this browser');
      }

      // First check if we have permission
      const permissionStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      console.log('Microphone permission status:', permissionStatus.state);
      
      if (permissionStatus.state === 'denied') {
        throw new Error('Microphone permission denied. Please enable microphone access in your browser settings.');
      }

      // Try to get stream with specific constraints for Baidu API
      let stream;
      try {
        const constraints = {
          audio: {
            sampleRate: 16000,    // Required by Baidu API
            channelCount: 1,      // Mono audio required
            echoCancellation: true,
            noiseSuppression: true
          }
        };
        
        console.log('Requesting audio stream with constraints:', constraints);
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        
        // Verify the actual stream settings
        const audioTrack = stream.getAudioTracks()[0];
        const settings = audioTrack.getSettings();
        console.log('Actual audio track settings:', {
          sampleRate: settings.sampleRate,
          channelCount: settings.channelCount,
          deviceId: settings.deviceId,
          groupId: settings.groupId,
          autoGainControl: settings.autoGainControl,
          echoCancellation: settings.echoCancellation,
          noiseSuppression: settings.noiseSuppression,
          timestamp: new Date().toISOString()
        });
        
        // Warn if sample rate doesn't match requirements
        if (settings.sampleRate !== 16000) {
          console.warn('Warning: Audio sample rate does not match required 16kHz:', settings.sampleRate);
        }
      } catch (constraintError) {
        console.warn('Failed to get stream with specific constraints, falling back to default:', constraintError);
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        // Log fallback stream settings
        const audioTrack = stream.getAudioTracks()[0];
        const settings = audioTrack.getSettings();
        console.log('Fallback audio track settings:', settings);
      }

      // Try to use specific MIME type for better compatibility
      let mimeType = 'audio/webm;codecs=opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'audio/webm';  // Fallback to basic webm
      }

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(chunksRef.current, { type: 'audio/wav' });
        await handleSpeechToText(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };

      // Start recording with 15-second time limit
      mediaRecorder.start();
      setIsRecording(true);

      // Auto-stop after 15 seconds
      setTimeout(() => {
        if (mediaRecorder.state === 'recording') {
          stopRecording();
        }
      }, 15000);
    } catch (error) {
      // Log detailed error information for debugging
      console.error('Recording failed:', {
        name: error instanceof Error ? error.name : 'Unknown',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : 'No stack trace',
        browserInfo: {
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          vendor: navigator.vendor,
          mediaDevices: !!navigator.mediaDevices,
          mediaRecorder: !!window.MediaRecorder,
          secure: window.isSecureContext
        },
        constraints: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true
        }
      });

      // Generate user-friendly error message
      const errMsg = error instanceof Error ? (() => {
        switch (error.name) {
          case 'NotAllowedError':
            return 'Please grant microphone permissions.';
          case 'NotFoundError':
            return 'No microphone found.';
          case 'NotReadableError':
            return 'Microphone is already in use.';
          case 'OverconstrainedError':
            return 'Microphone does not support required audio settings.';
          default:
            return 'Please check your microphone settings.';
        }
      })() : 'Please check your microphone settings.';
      const errorMessage: Message = {
        text: `Failed to start recording: ${errMsg}`,
        sender: 'agent',
        timestamp: new Date().toISOString()
      };
      updateMessages([...messages, errorMessage]);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const handleSpeechToText = async (audioBlob: Blob) => {
    try {
      setIsLoading(true);
      const formData = new FormData();
      formData.append('audio', audioBlob);

      const response = await fetch('/api/v1/speech-to-text', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error(`Speech-to-text failed: ${response.statusText}`);
      }

      const data = await response.json();
      setInputText(data.text);
    } catch (error) {
      console.error('Speech-to-text error:', error);
      const errorMessage: Message = {
        text: 'Failed to convert speech to text. Please try again.',
        sender: 'agent',
        timestamp: new Date().toISOString()
      };
      updateMessages([...messages, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="h-[calc(100vh-8rem)]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="h-6 w-6" />
          {activeAgent ? activeAgent.name : 'Chat'}
          
          <div className="flex items-center gap-2">
            {chatAddress && (
              <>
                <div className="p-2 bg-secondary rounded-lg flex flex-col items-start">
                  <div className="text-xs text-muted-foreground">Account</div>
                  <div className="font-mono text-sm break-all">
                    {chatAddress.slice(0,6)}...{chatAddress.slice(-4)}
                  </div>
                </div>
                <div className="p-2 bg-secondary rounded-lg flex flex-col items-start">
                  <div className="text-xs text-muted-foreground">Balance</div>
                  <div className="text-sm font-bold flex items-center gap-2">
                    {chatBalance} TURA
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-4 w-4 p-0"
                      onClick={async () => {
                        if (isRefreshingBalance) return;
                        try {
                          setIsRefreshingBalance(true);
                          await updateBalanceWithMessage(chatAddress);
                        } finally {
                          setIsRefreshingBalance(false);
                        }
                      }}
                      disabled={isRefreshingBalance}
                    >
                      <RefreshCw className={`h-3 w-3 ${isRefreshingBalance ? 'animate-spin' : ''}`} />
                    </Button>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    walletSystem.logoutAccount();
                    setChatAddress('');
                    setChatBalance('0');
                    
                    // Clear all agent message histories and guest conversations
                    if (walletAgent) {
                      walletAgent.clearMessages();
                    }
                    officialAgents.forEach(agent => {
                      if (agent.instance?.clearMessages) {
                        agent.instance.clearMessages();
                      }
                    });
                    agents.forEach(agent => {
                      if (agent.instance?.clearMessages) {
                        agent.instance.clearMessages();
                      }
                    });
                    workflows.forEach((workflow: Workflow) => {
                      if (workflow.instance?.clearMessages) {
                        workflow.instance.clearMessages();
                      }
                    });
                    // Clear guest conversations
                    Object.keys(localStorage).forEach(key => {
                      if (key.startsWith('chat_guest_')) {
                        localStorage.removeItem(key);
                      }
                    });
                    updateMessages([]);
                  }}
                >
                  Logout
                </Button>
              </>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      {/* Signature Dialog */}
      <Dialog 
        open={showSignatureDialog} 
        onOpenChange={(open) => {
          if (!open) {
            setPassword('');
          }
          setShowSignatureDialog(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{signatureDetails?.title || 'Confirm Transaction'}</DialogTitle>
            <DialogDescription className="whitespace-pre-wrap">
              {signatureDetails?.description || 'Please confirm this transaction in your wallet.'}
            </DialogDescription>
          </DialogHeader>
          {signatureDetails?.requirePassword && (
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter your wallet password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="col-span-3"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <div className="flex justify-between w-full">
              <Button
                variant="outline"
                onClick={() => {
                  setPassword('');
                  setShowSignatureDialog(false);
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  if (signatureDetails?.onConfirm) {
                    try {
                      if (signatureDetails.requirePassword && !password) {
                        const errorMessage: Message = {
                          text: 'Error: Password is required',
                          sender: 'agent',
                          timestamp: new Date().toISOString()
                        };
                        updateMessages([...messages, errorMessage]);
                        return;
                      }
                      await signatureDetails.onConfirm(signatureDetails.requirePassword ? password : undefined);
                      setPassword('');
                      setShowSignatureDialog(false);
                      
                      if (chatAddress) {
                        try {
                          await updateBalanceWithMessage(chatAddress);
                        } catch (error) {
                          console.error('Failed to refresh balance after transaction:', error);
                        }
                      }
                    } catch (error) {
                      console.error('Transaction failed:', error);
                      const errorMessage: Message = {
                        text: `Error: ${error instanceof Error ? error.message : 'Transaction failed'}`,
                        sender: 'agent',
                        timestamp: new Date().toISOString()
                      };
                      updateMessages([...messages, errorMessage]);
                    }
                  }
                }}
                disabled={signatureDetails?.requirePassword && !password}
              >
                Sign & Deploy
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>



      <CardContent className="flex h-full gap-4">
        {/* AgenticWorkflow Sidebar */}
        <div className="w-[30%] border-r pr-4">
          <ScrollArea className="h-full">
            <div className="space-y-6">
              {/* Official Agents */}
              <div className="space-y-2">
                <h3 className="font-semibold flex items-center gap-2">
                  <Bot className="h-4 w-4" />
                  Official Agents
                </h3>
                <div className="space-y-2">
                  {officialAgents.map(agent => (
                    <div
                      key={agent.name}
                      className={`p-3 rounded-lg hover:bg-secondary/80 cursor-pointer transition-colors ${
                        activeAgent?.name === agent.name ? 'bg-secondary/90 ring-2 ring-primary' : 'bg-secondary'
                      }`}
                      onClick={async () => {
                        const agentInstance = agent?.instance;
                        if (!agentInstance || !(agentInstance instanceof AgenticWorkflow)) {
                          return;
                        }
                        agentInstance.setCurrentAddress(chatAddress);
                        setActiveAgent(agent);
                        if (agent.name === 'WalletAgent') {
                          if (chatAddress) {
                            try {
                              await updateBalanceWithMessage(chatAddress);
                            } catch (error) {
                              console.error('Failed to refresh balance on agent switch:', error);
                            }
                          }
                          // Only show messages if there are any, don't trigger help again
                          const existingMessages = agentInstance.getMessages();
                          if (existingMessages.length > 0) {
                            updateMessages(existingMessages);
                          }
                        } else {
                          const newMessages = agentInstance.getMessages();
                          updateMessages(newMessages);
                        }
                      }}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="font-medium flex items-center gap-2">
                          <Wallet className="h-4 w-4" />
                          {agent.name}
                        </div>
                        <Badge variant="secondary" className="text-xs">
                          {agent.status}
                        </Badge>
                      </div>
                      <div className="text-sm text-muted-foreground">{agent.description}</div>
                      <div className="text-xs text-muted-foreground mt-2">
                        Fee: {agent.feePerRequest}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Community Agents */}
              <div className="space-y-2">
                <h3 className="font-semibold flex items-center gap-2">
                  <Bot className="h-4 w-4" />
                  Community Agents
                </h3>
                <div className="space-y-2">
                  {agents.map(agent => (
                    <div
                      key={agent.contractAddress}
                      className={`p-3 rounded-lg hover:bg-secondary/80 cursor-pointer transition-colors ${
                        activeAgent?.name === agent.name ? 'bg-secondary/90 ring-2 ring-primary' : 'bg-secondary'
                      }`}
                      onClick={async () => {
                        const agentInstance = agent?.instance;
                        if (!agentInstance || !(agentInstance instanceof AgenticWorkflow)) {
                          return;
                        }
                        agentInstance.setCurrentAddress(chatAddress);
                        setActiveAgent(agent);
                        if (agent.name === 'WalletAgent' && chatAddress) {
                          try {
                            await updateBalanceWithMessage(chatAddress);
                          } catch (error) {
                            console.error('Failed to refresh balance on agent switch:', error);
                          }
                        }
                        const newMessages = agentInstance.getMessages();
                        updateMessages(newMessages);
                      }}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="font-medium">{agent.name}</div>
                        <Badge variant="secondary" className="text-xs">
                          {agent.status}
                        </Badge>
                      </div>
                      <div className="text-sm text-muted-foreground">{agent.description}</div>
                      <div className="text-xs font-mono mt-2">
                        Contract: {agent.contractAddress.slice(0, 6)}...{agent.contractAddress.slice(-4)}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Fee: {agent.feePerRequest}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Workflows */}
              <div className="space-y-2">
                <h3 className="font-semibold flex items-center gap-2">
                  <Code2 className="h-4 w-4" />
                  Workflows
                </h3>
                <div className="space-y-2">
                  {workflows.map((workflow: Workflow) => (
                    <div
                      key={workflow.contractAddress}
                      className={`p-3 rounded-lg hover:bg-secondary/80 cursor-pointer transition-colors ${
                        activeAgent?.name === workflow.name ? 'bg-secondary/90 ring-2 ring-primary' : 'bg-secondary'
                      }`}
                      onClick={async () => {
                        const workflowInstance = workflow?.instance;
                        if (!workflowInstance || !(workflowInstance instanceof AgenticWorkflow)) {
                          return;
                        }
                        workflowInstance.setCurrentAddress(chatAddress);
                        setActiveAgent(workflow);
                        if (workflow.name === 'WalletAgent' && chatAddress) {
                          try {
                            await updateBalanceWithMessage(chatAddress);
                          } catch (error) {
                            console.error('Failed to refresh balance on agent switch:', error);
                          }
                        }
                        const newMessages = workflowInstance.getMessages();
                        updateMessages(newMessages);
                      }}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="font-medium">{workflow.name}</div>
                        <Badge variant="secondary" className="text-xs">
                          {workflow.status}
                        </Badge>
                      </div>
                      <div className="text-sm text-muted-foreground">{workflow.description}</div>
                      <div className="text-xs font-mono mt-2">
                        Contract: {workflow.contractAddress.slice(0, 6)}...{workflow.contractAddress.slice(-4)}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Fee: {workflow.fee} • Confirmations: {workflow.requiredConfirmations}
                      </div>
                      
                    </div>
                  ))}
                </div>
              </div>
              {activeAgent?.name === 'TuraWorkflow' && (
                <div className="relative w-full mt-4">
                  <Button
                    className="w-full"
                    onMouseDown={() => {
                      setPressProgress(0);
                      const startTime = Date.now();
                      const duration = 1000;
                      const updateProgress = () => {
                        const elapsed = Date.now() - startTime;
                        const progress = Math.min(100, (elapsed / duration) * 100);
                        setPressProgress(progress);
                        if (progress < 100) {
                          pressTimer.current = requestAnimationFrame(updateProgress);
                        } else {
                          if (turaWorkflow.current) {
                            turaWorkflow.current.processMessage('start workflow').then((result) => {
                              const message: ChatMessage = {
                                id: Date.now().toString(),
                                text: result,
                                timestamp: new Date().toISOString(),
                                sender: 'agent'
                              };
                              setMessages(prev => [...prev, message]);
                            });
                          }
                        }
                      };
                      pressTimer.current = requestAnimationFrame(updateProgress);
                    }}
                    onMouseUp={() => {
                      if (pressTimer.current) {
                        cancelAnimationFrame(pressTimer.current);
                      }
                      setPressProgress(0);
                    }}
                    onMouseLeave={() => {
                      if (pressTimer.current) {
                        cancelAnimationFrame(pressTimer.current);
                      }
                      setPressProgress(0);
                    }}
                  >
                    Start Workflow
                  </Button>
                  {pressProgress > 0 && (
                    <div 
                      className="absolute bottom-0 left-0 h-1 bg-primary-foreground transition-all"
                      style={{ width: `${pressProgress}%` }}
                    />
                  )}
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Chat Area */}
        <div className="flex-1 flex flex-col">
          <div className="relative flex-1">
            <ScrollArea className="h-[calc(100vh-16rem)] pr-4">
              <div className="space-y-4 pb-16">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${
                      message.sender === 'user' ? 'justify-end' : 'justify-start'
                    }`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg p-3 ${
                        message.sender === 'user'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-secondary'
                      }`}
                    >
                      <div className="break-words whitespace-pre-wrap leading-relaxed">{message.text}</div>
                      <div className="text-xs opacity-70 mt-1">
                        {new Date(message.timestamp).toLocaleTimeString()}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

          </div>
          
          <div className="flex gap-2 mt-4">
            <Button
              variant="outline"
              size="icon"
              onClick={isRecording ? stopRecording : startRecording}
              disabled={isLoading}
              className={isRecording ? 'text-destructive' : ''}
            >
              <Mic className="h-4 w-4" />
            </Button>
            <Input
              placeholder="Type your message..."
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
              disabled={isLoading}
            />
            <Button onClick={handleSendMessage} disabled={isLoading}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
