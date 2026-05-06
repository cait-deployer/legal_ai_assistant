'use client';

import { useEffect, useRef, useState, Suspense, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { mutate } from 'swr';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Card } from '@/components/ui/card';
import { toast } from 'sonner';
import {
    Send,
    BookOpenText,
    ExternalLink,
    AlertTriangle,
    Scale,
    Briefcase,
    Home,
    BarChart3,
    User,
    Loader2,
    Plus,
    Lock,
    Sparkles,
    Menu,
} from 'lucide-react';
import { ChatSidebar } from '@/components/chat-sidebar';
import { ChatTour } from '@/components/chat-tour';
import { motion } from 'framer-motion';
import { MessageFeedback } from '@/app/components/feedback/MessageFeedback';
import { ReviewModal } from '@/app/components/feedback/ReviewModal';
import { useReviewTrigger } from '@/app/hooks/useReviewTrigger';

const SAMPLE_QUESTIONS = [
    { icon: <Scale className="h-4 w-4" />, text: 'Які права має ФОП 3 групи?' },
    { icon: <Briefcase className="h-4 w-4" />, text: 'Як законно звільнити працівника?' },
    { icon: <Home className="h-4 w-4" />, text: 'Які документи потрібні для продажу квартири?' },
    { icon: <BarChart3 className="h-4 w-4" />, text: 'Коли ФОП зобов\'язаний платити ПДВ?' },
];

type Citation = {
    num: number;
    source_title: string;
    passage: string;
    status?: string;
    law_url?: string;
    chunk_index?: number;
    // enriched OpenData fields
    rada_status_name?: string;
    rada_is_dead?: boolean;
    rada_no_text?: boolean;
    rada_adopted_date?: string;
    rada_last_edition?: string;
    rada_dead_since?: string;
    rada_replaced_by?: string[];
    rada_cancelled_by?: string[];
    rada_theme?: string;
    rada_org?: string;
    rada_doc_type?: string;
};

type Template = {
    title: string;
    url: string;
    type: string;
};

type Message = {
    id: number | string;
    role: 'ai' | 'user';
    text: string;
    references?: Citation[];
    templates?: Template[];
    feedback?: { is_positive: boolean } | null;
};

function AuthBg() {
    return (
        <div className="absolute inset-0 pointer-events-none select-none z-0" aria-hidden>
            <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-[#C9A84C]/5 blur-[120px]" />
            <div className="absolute bottom-[-20%] right-[-10%] w-[600px] h-[600px] rounded-full bg-[#C9A84C]/3 blur-[140px]" />
        </div>
    );
}

function StatusBadge({ status }: { status?: string }) {
    if (!status || status === 'Невідомо') return null;
    const isActive = status.toLowerCase().includes('чинний') && !status.toLowerCase().includes('втратив');
    return (
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[12px] font-black uppercase tracking-widest mt-2 ${isActive ? 'bg-[#0A0E1A] text-emerald-400' : 'bg-[#0A0E1A] text-red-400'
            }`}>
            <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${isActive ? 'bg-emerald-400' : 'bg-red-400'}`} />
            <span className="whitespace-nowrap mt-0.5">{status}</span>
        </span>
    );
}

function MarkdownText({ text, refs, onCitationOpen }: {
    text: string;
    refs: Citation[];
    onCitationOpen: (c: Citation) => void;
}) {
    const parseInline = (lineText: string) =>
        lineText.split(/(\[\d+(?:,\s*\d+)*\])/g).map((part, i) => {
            if (/^\[\d+(?:,\s*\d+)*\]$/.test(part)) {
                return part.slice(1, -1).split(',').map((numStr, j) => {
                    const num = Number(numStr.trim());
                    const citation = refs.find(r => r.num === num);
                    return (
                        <button
                            key={`${i}-${j}`}
                            type="button"
                            disabled={!citation}
                            onClick={() => citation && onCitationOpen(citation)}
                            title={citation ? `Джерело ${num}` : `Джерело ${num} недоступне в збереженій відповіді`}
                            className={`inline-flex items-center justify-center align-middle mx-0.5 min-w-[22px] h-[22px] px-1.5 text-[12px] font-bold rounded transition-all touch-manipulation ${citation
                                ? 'text-[#0A0E1A] bg-[#C9A84C] hover:bg-[#E2C47A] shadow-[0_0_10px_rgba(201,168,76,0.3)] active:scale-90'
                                : 'text-[#0A0E1A]/50 bg-[#C9A84C]/45 cursor-not-allowed'
                                }`}
                        >
                            {num}
                        </button>
                    );
                });
            }
            return part;
        });

    const lines = text.split('\n');
    return (
        <div className="space-y-2">
            {lines.map((line, i) => {
                const t = line.trim();
                if (!t) return <div key={i} className="h-1" />;
                if (line.startsWith('### ')) return <h3 key={i} className="font-serif font-bold text-[#E0E6ED] mt-4 mb-2 text-base">{parseInline(line.slice(4))}</h3>;
                if (/^[\*\-]\s/.test(t)) return <div key={i} className="flex gap-2 my-1.5 pl-1"><div className="h-1.5 w-1.5 rounded-full bg-[#C9A84C] mt-2 shrink-0" /><span className="text-[#E0E6ED]/80 text-sm leading-relaxed">{parseInline(t.slice(2))}</span></div>;
                return <p key={i} className="my-1.5 text-sm leading-relaxed text-[#E0E6ED]/90">{parseInline(t)}</p>;
            })}
        </div>
    );
}

function ChatPage() {
    const router = useRouter();
    const searchParams = useSearchParams();

    const [currentChatId, setCurrentChatId] = useState<string | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [contextSummary, setContextSummary] = useState<string | null>(null);
    const [isSummarizing, setIsSummarizing] = useState(false);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [loadingStatus, setLoadingStatus] = useState('');
    const [loadingPhase, setLoadingPhase] = useState(0);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [activeCitation, setActiveCitation] = useState<Citation | null>(null);
    const [isFirstMessage, setIsFirstMessage] = useState(true);
    const [limitExceeded, setLimitExceeded] = useState(false);
    const [isBetaTester, setIsBetaTester] = useState(false);
    const [pendingBetaFeedbackId, setPendingBetaFeedbackId] = useState<string | null>(null);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [showTour, setShowTour] = useState(false);
    const reviewTrigger = useReviewTrigger();

    const scrollRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const sessionStartRef = useRef<number>(Date.now());
    const newChatInProgressRef = useRef(false);
    const contextSummaryRef = useRef<string | null>(null);
    const summaryPromiseRef = useRef<Promise<string | null> | null>(null);

    // Typewriter effect refs
    const twQueueRef = useRef('');   // chars waiting to be shown
    const twDisplayRef = useRef('');   // chars already shown
    const twTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const twMsgIdRef = useRef<number | string | null>(null);

    // drainQueue: виводить символи з черги по 1 (або по кілька при відставанні)
    // useCallback з [] — стабільна функція, всі залежності через refs
    const drainQueue = useCallback(() => {
        if (!twQueueRef.current) { twTimerRef.current = null; return; }
        const lag = twQueueRef.current.length;
        const n = lag > 120 ? 6 : lag > 40 ? 3 : 1;   // catch-up if queue is large
        twDisplayRef.current += twQueueRef.current.slice(0, n);
        twQueueRef.current = twQueueRef.current.slice(n);
        setMessages(prev => prev.map(m =>
            m.id === twMsgIdRef.current ? { ...m, text: twDisplayRef.current } : m
        ));
        const delay = twQueueRef.current.length > 120 ? 6 : 18;
        twTimerRef.current = setTimeout(drainQueue, delay);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // flushTypewriter: миттєво виводить залишок черги (викликається коли citations прийшли)
    const flushTypewriter = useCallback(() => {
        if (twTimerRef.current) { clearTimeout(twTimerRef.current); twTimerRef.current = null; }
        if (twQueueRef.current) {
            twDisplayRef.current += twQueueRef.current;
            twQueueRef.current = '';
            setMessages(prev => prev.map(m =>
                m.id === twMsgIdRef.current ? { ...m, text: twDisplayRef.current } : m
            ));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const LOADING_MESSAGES = [
        'Шукаю відповідний закон...',
        'Перевіряю судову практику...',
        'Аналізую постанови КМУ...',
        'Формую юридичний висновок...',
    ];

    useEffect(() => {
        sessionStartRef.current = Date.now();
        return () => {
            const duration = Math.round((Date.now() - sessionStartRef.current) / 1000);
            if (duration >= 5) {
                const blob = new Blob(
                    [JSON.stringify({ duration_seconds: duration })],
                    { type: 'application/json' }
                );
                navigator.sendBeacon('/api/settings/session', blob);
            }
        };
    }, []);

    useEffect(() => {
        fetch('/api/settings/profile')
            .then(r => r.ok ? r.json() : null)
            .then(profile => {
                if (!profile) return;
                const beta = profile.is_beta_tester === true;
                setIsBetaTester(beta);
                const { monthly_limit, bonus_requests, requests_this_month, tour_completed } = profile;
                if (!beta && monthly_limit != null && requests_this_month >= monthly_limit + (bonus_requests ?? 0)) {
                    setLimitExceeded(true);
                }
                // Show tour only for new users where tour_completed is explicitly false
                if (tour_completed === false) {
                    setShowTour(true);
                }
            })
            .catch(() => { });
    }, []);

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }, [messages, isLoading, loadingStatus]);

    useEffect(() => {
        if (!isLoading) { setLoadingPhase(0); return; }
        const t = setInterval(() => setLoadingPhase(p => (p + 1) % LOADING_MESSAGES.length), 2500);
        return () => clearInterval(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isLoading]);

    useEffect(() => {
        const id = searchParams.get('chat');
        if (id !== currentChatId) setCurrentChatId(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams]);

    useEffect(() => {
        if (!currentChatId) {
            setMessages([]);
            setContextSummary(null);
            contextSummaryRef.current = null;
            setIsFirstMessage(true);
            return;
        }
        setHistoryLoading(true);
        fetch(`/api/chats/${currentChatId}`)
            .then(r => {
                if (r.status === 404) {
                    setCurrentChatId(null);
                    setMessages([]);
                    setContextSummary(null);
                    setIsFirstMessage(true);
                    router.replace('/chat');
                    return null;
                }
                return r.json();
            })
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .then((data: { messages: any[]; context_summary: string | null } | null) => {
                if (data === null) return;
                const rows = data.messages ?? [];
                contextSummaryRef.current = data.context_summary ?? null;
                setContextSummary(data.context_summary ?? null);
                if (rows.length === 0 && newChatInProgressRef.current) {
                    setIsFirstMessage(true);
                    return;
                }
                setMessages(rows.map((r: { id: string; role: string; content: string; citations?: Citation[]; feedback?: { is_positive: boolean } | null }) => ({ id: r.id, role: r.role === 'assistant' ? 'ai' : 'user', text: r.content, references: r.citations ?? [], feedback: r.feedback ?? null })));
                setIsFirstMessage(rows.length === 0);
            })
            .catch(() => toast.error('Не вдалося завантажити чат'))
            .finally(() => setHistoryLoading(false));
    }, [currentChatId, router]);

    const handleNewChat = () => {
        setMessages([]);
        setIsFirstMessage(true);
        setInput('');
        setCurrentChatId(null);
        router.push('/chat');
    };

    const refreshLimit = () => {
        fetch('/api/settings/profile')
            .then(r => r.ok ? r.json() : null)
            .then(profile => {
                if (!profile) return;
                const beta = profile.is_beta_tester === true;
                setIsBetaTester(beta);
                if (!beta && profile.monthly_limit != null && profile.requests_this_month >= profile.monthly_limit + (profile.bonus_requests ?? 0)) {
                    setLimitExceeded(true);
                }
            })
            .catch(() => { });
    };

    const runSummary = useCallback(async (chatId: string): Promise<string | null> => {
        if (summaryPromiseRef.current) {
            try {
                return await summaryPromiseRef.current;
            } catch {
                return contextSummaryRef.current;
            }
        }

        setIsSummarizing(true);
        const promise = (async () => {
            for (let attempt = 0; attempt < 4; attempt += 1) {
                const res = await fetch(`/api/chats/${chatId}/summarize`, { method: 'POST' });
                const data = res.ok ? await res.json() : null;
                if (data?.summary && data?.persisted !== false) {
                    contextSummaryRef.current = data.summary;
                    setContextSummary(data.summary);
                    return data.summary as string;
                }
                if (!data?.skipped || data?.reason !== 'waiting_for_complete_turn') break;
                await new Promise(resolve => setTimeout(resolve, 900));
            }
            return contextSummaryRef.current;
        })();

        summaryPromiseRef.current = promise;
        try {
            return await promise;
        } catch {
            return contextSummaryRef.current;
        } finally {
            summaryPromiseRef.current = null;
            setIsSummarizing(false);
        }
    }, []);

    const handleSend = async (text: string) => {
        if (!text.trim() || isLoading || limitExceeded) return;
        const questionText = text.trim();
        setInput('');
        setLoadingStatus('Готую запит...');

        setMessages(prev => [...prev, { id: Date.now(), role: 'user', text: questionText }]);
        setIsLoading(true);

        let chatId = currentChatId;
        if (!chatId) {
            try {
                newChatInProgressRef.current = true;
                const res = await fetch('/api/chats', { method: 'POST' });
                const data = await res.json();
                if (!data.id) {
                    console.error('[chat] create failed:', data);
                    toast.error('Не вдалося створити чат: ' + (data.error ?? 'невідома помилка'));
                    setMessages(prev => prev.slice(0, -1)); setIsLoading(false); newChatInProgressRef.current = false; return;
                }
                chatId = data.id;
                setCurrentChatId(chatId);
                router.push(`/chat?chat=${chatId}`);
                mutate('/api/chats');
            } catch (e) { console.error('[chat] create exception:', e); toast.error('Не вдалося створити чат'); setMessages(prev => prev.slice(0, -1)); setIsLoading(false); newChatInProgressRef.current = false; return; }
        }

        if (!chatId) {
            setMessages(prev => prev.slice(0, -1));
            setIsLoading(false);
            newChatInProgressRef.current = false;
            return;
        }
        const activeChatId = chatId;

        const currentUserTurnCount = messages.filter(m => m.role === 'user').length + 1;

        fetch(`/api/chats/${activeChatId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: 'user', content: questionText }),
        }).catch(() => { });

        // Build conversation history for context — last 3 turns (6 messages) only.
        // Summary is persisted for future memory, but not injected into answer generation yet:
        // short summaries can distort follow-up retrieval more than they help.
        const allHistory = messages
            .filter(m => m.role === 'user' || m.role === 'ai')
            .map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.text }));
        const historyForBackend = allHistory.slice(-6);

        // Negative number → typeof !== 'string' → MessageFeedback won't render for temp message
        const STREAMING_ID = -(Date.now());
        let firstToken = true;
        let accText = '';
        type FinalPayload = { answer: string; references: Citation[]; templates: Template[]; _meta: Record<string, unknown> };
        let finalPayload: FinalPayload | null = null;

        try {
            const res = await fetch('/api/ask/stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question: questionText, history: historyForBackend, context_summary: null }),
                signal: AbortSignal.timeout(185_000),
            });

            if (res.status === 429) {
                setLimitExceeded(true);
                setIsLoading(false);
                newChatInProgressRef.current = false;
                return;
            }

            if (!res.ok || !res.body) {
                toast.error('Сервер не відповідає. Спробуйте ще раз.');
                setIsLoading(false);
                newChatInProgressRef.current = false;
                return;
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let currentEvent = 'message';

            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() ?? '';

                    for (const line of lines) {
                        if (line.startsWith('event: ')) {
                            currentEvent = line.slice(7).trim();
                        } else if (line.startsWith('data: ')) {
                            let parsed: Record<string, unknown>;
                            try { parsed = JSON.parse(line.slice(6)); } catch { continue; }

                            if (currentEvent === 'message' && parsed.token) {
                                const token = parsed.token as string;
                                if (firstToken) {
                                    firstToken = false;
                                    setIsLoading(false);
                                    setLoadingStatus('');
                                    twDisplayRef.current = '';
                                    twQueueRef.current = '';
                                    twMsgIdRef.current = STREAMING_ID;
                                    setMessages(prev => [...prev, { id: STREAMING_ID, role: 'ai', text: '', references: [] }]);
                                }
                                accText += token;
                                twQueueRef.current += token;
                                if (!twTimerRef.current) twTimerRef.current = setTimeout(drainQueue, 18);
                            } else if (currentEvent === 'citations') {
                                finalPayload = parsed as unknown as FinalPayload;
                                const answer = finalPayload.answer || accText;
                                if (firstToken) {
                                    // early_answer path: no tokens were streamed
                                    firstToken = false;
                                    setIsLoading(false);
                                    setLoadingStatus('');
                                    setMessages(prev => [...prev, {
                                        id: STREAMING_ID, role: 'ai', text: answer,
                                        references: finalPayload!.references ?? [],
                                        templates: finalPayload!.templates ?? [],
                                    }]);
                                } else {
                                    flushTypewriter();
                                    setMessages(prev => prev.map(m => m.id === STREAMING_ID ? {
                                        ...m, text: answer,
                                        references: finalPayload!.references ?? [],
                                        templates: finalPayload!.templates ?? [],
                                    } : m));
                                }
                            } else if (currentEvent === 'status') {
                                const message = typeof parsed.message === 'string' ? parsed.message : '';
                                if (message) setLoadingStatus(message);
                            } else if (currentEvent === 'error') {
                                toast.error('Помилка генерації відповіді.');
                            }
                        } else if (line === '') {
                            currentEvent = 'message';
                        }
                    }
                }
            } finally {
                reader.releaseLock();
            }

            // Save AI message to DB after stream ends
            if (finalPayload || accText) {
                const answer = finalPayload?.answer || accText;
                const refs = finalPayload?.references ?? [];
                const meta = finalPayload?._meta ?? {};

                fetch(`/api/chats/${activeChatId}/messages`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        role: 'assistant',
                        content: answer,
                        citations: refs,
                        analytics: {
                            query_text: questionText,
                            ai_response: answer,
                            category: meta.category,
                            sentiment: meta.sentiment,
                            complexity_score: meta.complexity_score,
                            user_intent: meta.user_intent,
                            processing_time_ms: meta.processing_time_ms,
                            tokens_used: meta.tokens_used ?? 0,
                        },
                    }),
                }).then(r => r.ok ? r.json() : null).then(saved => {
                    if (saved?.id) {
                        setMessages(prev => prev.map(m => m.id === STREAMING_ID ? { ...m, id: saved.id } : m));
                        if (isBetaTester) setPendingBetaFeedbackId(saved.id);
                    }
                    reviewTrigger.check();

                    // Compress context after every 2nd user turn, then reuse it for the next question.
                    if (currentUserTurnCount % 2 === 0) {
                        runSummary(activeChatId).catch(() => { });
                    }
                }).catch(() => { });

                refreshLimit();

                if (isFirstMessage) {
                    setIsFirstMessage(false);
                    fetch(`/api/chats/${activeChatId}/name`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ question: questionText, answer }),
                    }).then(() => mutate('/api/chats'));
                } else { mutate('/api/chats'); }
            }
        } catch { toast.error('Сервер не відповідає. Спробуйте ще раз.'); } finally {
            setIsLoading(false);
            newChatInProgressRef.current = false;
        }
    };

    const handleTourComplete = () => {
        setShowTour(false);
        setSidebarOpen(false);
        fetch('/api/settings/profile', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tour_completed: true }),
        }).catch(() => { });
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend(input);
        }
    };

    return (
        <div className="flex h-screen bg-[#0A0E1A] text-[#E0E6ED] overflow-hidden relative">
            <AuthBg />

            <ChatSidebar
                currentChatId={currentChatId}
                onNewChat={handleNewChat}
                onSelectChat={(id) => router.push(`/chat?chat=${id}`)}
                isOpen={sidebarOpen}
                onClose={() => setSidebarOpen(false)}
            />

            <main className="flex-1 flex flex-col relative z-10 bg-[#0d1120]/40 backdrop-blur-sm border-l border-[#C9A84C]/10 min-w-0">
                {/* Header */}
                <header className="h-14 md:h-16 border-b border-[#C9A84C]/10 flex items-center px-3 md:px-6 gap-3 justify-between bg-[#0A0E1A]/60 backdrop-blur-md shrink-0">
                    <div className="flex items-center gap-2 md:gap-3 min-w-0">
                        {/* Hamburger — mobile only */}
                        <button
                            onClick={() => setSidebarOpen(true)}
                            className="md:hidden w-9 h-9 flex items-center justify-center rounded-xl text-[#C9A84C]/60 hover:text-[#C9A84C] hover:bg-[#C9A84C]/10 transition-all shrink-0"
                        >
                            <Menu className="w-5 h-5" />
                        </button>
                        <div className="bg-[#C9A84C]/10 p-1.5 md:p-2 rounded-lg border border-[#C9A84C]/20 shrink-0">
                            <Scale className="h-4 w-4 md:h-5 md:w-5 text-[#C9A84C]" />
                        </div>
                        <h1 className="font-serif text-base md:text-lg font-bold tracking-tight truncate">
                            <span className="text-[#C9A84C]">URAI</span><span className="hidden sm:inline"> — Юридичний асистент</span>
                        </h1>
                    </div>
                </header>

                {/* Chat Area */}
                <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4 md:px-6 md:py-8 scroll-smooth">
                    <div className="max-w-5xl mx-auto">
                        {historyLoading ? (
                            <div className="flex flex-col items-center justify-center h-full gap-4 pt-20">
                                <Loader2 className="w-8 h-8 animate-spin text-[#C9A84C]" />
                                <p className="text-[12px] font-bold text-[#C9A84C] uppercase tracking-[0.3em]">Відновлення історії...</p>
                            </div>
                        ) : messages.length === 0 ? (
                            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center pt-6 md:pt-10">
                                <div className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-[#C9A84C]/10 border border-[#C9A84C]/20 flex items-center justify-center mx-auto mb-4 md:mb-6 shadow-[0_0_30px_rgba(201,168,76,0.1)]">
                                    <Scale className="h-8 w-8 md:h-10 md:w-10 text-[#C9A84C]" />
                                </div>
                                <h2 className="font-serif text-2xl md:text-3xl font-bold mb-3 md:mb-4 text-white">Привіт! Я <span className="text-[#C9A84C]">URAI</span></h2>
                                <p className="text-[#E0E6ED]/60 text-sm max-w-md mx-auto mb-6 md:mb-10 leading-relaxed px-2">
                                    Задайте будь-яке юридичне запитання. Я проаналізую законодавство України та надам відповідь з посиланнями.
                                </p>
                                <div data-tour="sample-questions" className="grid grid-cols-1 sm:grid-cols-2 gap-2 md:gap-3 text-left">
                                    {SAMPLE_QUESTIONS.map((q, i) => (
                                        <button key={i} onClick={() => handleSend(q.text)} className="flex items-center gap-3 p-3.5 md:p-4 rounded-2xl border border-[#C9A84C]/10 bg-[#0d1120]/50 hover:border-[#C9A84C]/40 hover:bg-[#C9A84C]/5 active:scale-[0.98] transition-all group text-left">
                                            <div className="text-[#C9A84C] group-hover:scale-110 transition-transform shrink-0">{q.icon}</div>
                                            <span className="text-xs font-medium text-[#E0E6ED]/80">{q.text}</span>
                                        </button>
                                    ))}
                                </div>
                            </motion.div>
                        ) : (
                            <div className="space-y-5 md:space-y-8 pb-6 md:pb-10">
                                {messages.map((msg, _mi, _arr) => {
                                    const lastAiId = [..._arr].reverse().find(m => m.role === 'ai')?.id
                                    const isLastAi = msg.role === 'ai' && msg.id === lastAiId
                                    return (
                                        <motion.div key={msg.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={`flex gap-2 md:gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                                            <div className={`h-8 w-8 md:h-10 md:w-10 rounded-xl md:rounded-2xl flex items-center justify-center shrink-0 shadow-xl ${msg.role === 'ai' ? 'bg-[#0d1120] border border-[#C9A84C]/30 text-[#C9A84C]' : 'bg-[#C9A84C] text-[#0A0E1A]'
                                                }`}>
                                                {msg.role === 'ai' ? <Scale className="h-4 w-4 md:h-6 md:w-6" /> : <User className="h-4 w-4 md:h-6 md:w-6" />}
                                            </div>
                                            <div className={`max-w-[88%] md:max-w-[85%] space-y-1.5 md:space-y-2 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
                                                <Card className={`p-3.5 md:p-5 text-sm leading-relaxed border-none shadow-2xl ${msg.role === 'user'
                                                    ? 'bg-[#C9A84C]/10 text-[#E0E6ED] rounded-3xl rounded-tr-none'
                                                    : 'bg-[#0d1120]/90 text-[#E0E6ED] rounded-3xl rounded-tl-none border-l-2 border-l-[#C9A84C] font-serif tracking-wide'
                                                    }`}>
                                                    {msg.role === 'ai' ? (
                                                        <div className="space-y-4">
                                                            <MarkdownText text={msg.text} refs={msg.references ?? []} onCitationOpen={setActiveCitation} />
                                                            {msg.templates && msg.templates.length > 0 && (
                                                                <div className="mt-4 pt-4 border-t border-[#C9A84C]/10 space-y-2">
                                                                    <p className="text-[12px] font-bold text-[#C9A84C]/70 uppercase tracking-[0.2em]">Доступні бланки:</p>
                                                                    {msg.templates.map((t, ti) => (
                                                                        <a key={ti} href={t.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 rounded-xl bg-[#C9A84C]/5 border border-[#C9A84C]/20 hover:bg-[#C9A84C]/10 transition-all group">
                                                                            <div className="bg-[#C9A84C] p-1.5 rounded-lg text-[#0A0E1A] group-hover:scale-110 transition-transform"><Plus className="w-4 h-4" /></div>
                                                                            <div className="flex-1 min-w-0"><p className="text-xs font-bold truncate text-[#E0E6ED]">{t.title}</p></div>
                                                                            <ExternalLink className="w-3.5 h-3.5 text-[#C9A84C]/70" />
                                                                        </a>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    ) : msg.text}
                                                </Card>
                                                <span className="text-[12px] font-bold text-[#C9A84C]/50 uppercase tracking-widest px-2">{msg.role === 'ai' ? 'URAI Legal Intelligence' : 'Ви'}</span>
                                                {msg.role === 'ai' && typeof msg.id === 'string' && currentChatId && (
                                                    <MessageFeedback
                                                        messageId={msg.id}
                                                        chatId={currentChatId}
                                                        initialIsPositive={msg.feedback?.is_positive ?? null}
                                                        betaMode={isBetaTester}
                                                        autoOpen={pendingBetaFeedbackId === msg.id}
                                                        onSubmitted={() => setPendingBetaFeedbackId(current => current === msg.id ? null : current)}
                                                        showReviewButton={isLastAi && reviewTrigger.buttonVisible}
                                                        onReviewOpen={reviewTrigger.reopen}
                                                    />
                                                )}
                                            </div>
                                        </motion.div>
                                    )
                                })}
                            </div>
                        )}

                        {!historyLoading && isLoading && (
                            <div className="flex gap-4 items-center">
                                <div className="h-10 w-10 rounded-2xl bg-[#0d1120] border border-[#C9A84C]/20 flex items-center justify-center">
                                    <Loader2 className="h-5 w-5 animate-spin text-[#C9A84C]" />
                                </div>
                                <p key={loadingPhase} className="text-[12px] font-bold text-[#C9A84C] uppercase tracking-[0.3em] animate-pulse">
                                    {loadingStatus || LOADING_MESSAGES[loadingPhase]}
                                </p>
                            </div>
                        )}
                        {!historyLoading && isSummarizing && !isLoading && (
                            <div className="flex gap-4 items-center">
                                <div className="h-10 w-10 rounded-2xl bg-[#0d1120] border border-[#C9A84C]/20 flex items-center justify-center">
                                    <Loader2 className="h-5 w-5 animate-spin text-[#C9A84C]" />
                                </div>
                                <p className="text-[12px] font-bold text-[#C9A84C] uppercase tracking-[0.3em] animate-pulse">
                                    Оновлюю контекст діалогу...
                                </p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Input Area */}
                <footer className="p-3 md:p-4 bg-[#0A0E1A]/80 backdrop-blur-md border-t border-[#C9A84C]/10 shrink-0 safe-area-pb">
                    <div className="max-w-5xl mx-auto space-y-3">
                        {limitExceeded && (
                            <div className="flex items-center gap-4 px-5 py-4 rounded-2xl bg-[#0d1120] border border-[#C9A84C]/30 shadow-lg shadow-[#C9A84C]/5">
                                <div className="w-9 h-9 rounded-xl bg-[#C9A84C]/10 border border-[#C9A84C]/20 flex items-center justify-center shrink-0">
                                    <Lock className="w-4 h-4 text-[#C9A84C]" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-bold text-[#E0E6ED]">Ліміт запитів вичерпано</p>
                                    <p className="text-xs text-[#E0E6ED]/50 mt-0.5">Ви використали всі запити безкоштовного плану. Оформіть підписку для продовження.</p>
                                </div>
                                <a
                                    href="/settings?tab=billing"
                                    className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#C9A84C] hover:bg-[#E2C47A] text-[#0A0E1A] text-[11px] font-black uppercase tracking-[0.15em] transition-all active:scale-95 whitespace-nowrap"
                                >
                                    <Sparkles className="w-3.5 h-3.5" />
                                    Підписка
                                </a>
                            </div>
                        )}

                        <div data-tour="chat-input" className={`relative flex items-end gap-3 bg-[#0d1120] border p-3 rounded-3xl transition-all shadow-2xl ${limitExceeded ? 'border-[#C9A84C]/10 opacity-50 pointer-events-none' : 'border-[#C9A84C]/20 focus-within:border-[#C9A84C]/50 focus-within:ring-1 focus-within:ring-[#C9A84C]/20'}`}>
                            <Textarea
                                ref={inputRef}
                                placeholder={limitExceeded ? "Ліміт запитів вичерпано..." : "Запитайте про закони, ФОП або договори..."}
                                value={input}
                                onChange={e => setInput(e.target.value)}
                                onKeyDown={handleKeyDown}
                                disabled={limitExceeded}
                                className="bg-transparent border-none focus-visible:ring-0 text-[#E0E6ED] placeholder:text-[#C9A84C]/20 text-sm min-h-[50px] max-h-32 resize-none py-3 px-4 font-medium disabled:cursor-not-allowed"
                                rows={1}
                            />
                            <button
                                onClick={() => handleSend(input)}
                                disabled={!input.trim() || isLoading || limitExceeded}
                                className="bg-[#C9A84C] hover:bg-[#E2C47A] text-[#0A0E1A] rounded-2xl h-12 w-12 flex items-center justify-center shrink-0 shadow-lg shadow-[#C9A84C]/10 transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                                <Send className="h-5 w-5" />
                            </button>
                        </div>
                        {isSummarizing && (
                            <div className="flex items-center justify-center gap-1.5 text-[#C9A84C]/40 text-[9px] font-medium tracking-wide">
                                <Loader2 className="w-2.5 h-2.5 animate-spin shrink-0" />
                                Архівуємо контекст діалогу…
                            </div>
                        )}
                        <div className="flex items-center gap-2 justify-center text-[#C9A84C]/70 uppercase text-[9px] font-black tracking-widest">
                            <AlertTriangle size={12} className="shrink-0" />
                            URAI базується на законах України. Перевіряйте важливі деталі.
                        </div>
                    </div>
                </footer>
            </main>

            {/* App review modal */}
            {reviewTrigger.status?.show && (
                <ReviewModal
                    rewardEligible={reviewTrigger.status.reward_eligible}
                    rewardAmount={reviewTrigger.status.reward_amount}
                    onClose={reviewTrigger.dismiss}
                    onLater={reviewTrigger.postpone}
                    onSubmitted={reviewTrigger.submitted}
                />
            )}

            {/* First-time user tour */}
            {showTour && (
                <ChatTour
                    onComplete={handleTourComplete}
                    onSidebarOpen={() => setSidebarOpen(true)}
                    onSidebarClose={() => setSidebarOpen(false)}
                />
            )}

            {/* Citation Dialog */}
            <Dialog open={!!activeCitation} onOpenChange={o => !o && setActiveCitation(null)}>
                <DialogContent className="w-[calc(100vw-2rem)] max-w-xl sm:max-w-2xl bg-[#0d1120] rounded-xl border border-[#C9A84C]/40 shadow-2xl p-0 overflow-hidden text-[#E0E6ED]">
                    <div className="bg-[#C9A84C] p-5 sm:p-7 text-[#0A0E1A]">
                        <div className="flex items-start gap-4">
                            <div className="bg-[#0A0E1A] p-2.5 rounded-lg shadow-lg shrink-0 mt-0.5">
                                <BookOpenText className="h-5 w-5 text-[#C9A84C]" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <span className="text-[9px] font-black text-[#0A0E1A]/50 uppercase tracking-[0.2em] block mb-1">Джерело №{activeCitation?.num}</span>
                                <DialogTitle className="font-serif font-bold text-base sm:text-lg leading-snug">{activeCitation?.source_title}</DialogTitle>
                                <div className="flex flex-wrap items-center gap-2 mt-1.5">
                                    <StatusBadge status={activeCitation?.status} />
                                    {activeCitation?.rada_is_dead && (
                                        <span className="px-2 py-0.5 rounded text-[12px] font-bold bg-red-900/80 text-red-200 border border-red-700/50">
                                            Втратив чинність
                                        </span>
                                    )}
                                    {activeCitation?.rada_doc_type && (
                                        <span className="text-[12px] text-[#0A0E1A]/60">{activeCitation.rada_doc_type}</span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                    <ScrollArea className="max-h-[40vh] sm:max-h-[360px] bg-[#0A0E1A]/40">
                        <div className="p-5 sm:p-7 space-y-4">
                            {/* Enriched metadata block */}
                            {(activeCitation?.rada_adopted_date || activeCitation?.rada_last_edition || activeCitation?.rada_dead_since || activeCitation?.rada_theme || activeCitation?.rada_org || (activeCitation?.rada_replaced_by?.length ?? 0) > 0 || (activeCitation?.rada_cancelled_by?.length ?? 0) > 0) && (
                                <div className="bg-[#0A0E1A]/60 rounded-lg p-3 space-y-1.5 text-xs border border-[#C9A84C]/10">
                                    {activeCitation?.rada_org && (
                                        <div className="flex gap-2">
                                            <span className="text-zinc-500 w-28 shrink-0">Орган:</span>
                                            <span className="text-zinc-300">{activeCitation.rada_org}</span>
                                        </div>
                                    )}
                                    {activeCitation?.rada_adopted_date && (
                                        <div className="flex gap-2">
                                            <span className="text-zinc-500 w-28 shrink-0">Прийнято:</span>
                                            <span className="text-zinc-300">{activeCitation.rada_adopted_date}</span>
                                        </div>
                                    )}
                                    {activeCitation?.rada_last_edition && (
                                        <div className="flex gap-2">
                                            <span className="text-zinc-500 w-28 shrink-0">Остання редакція:</span>
                                            <span className="text-zinc-300">{activeCitation.rada_last_edition}</span>
                                        </div>
                                    )}
                                    {activeCitation?.rada_dead_since && (
                                        <div className="flex gap-2">
                                            <span className="text-zinc-500 w-28 shrink-0">Втратив чинність:</span>
                                            <span className="text-red-400 font-medium">{activeCitation.rada_dead_since}</span>
                                        </div>
                                    )}
                                    {activeCitation?.rada_theme && (
                                        <div className="flex gap-2">
                                            <span className="text-zinc-500 w-28 shrink-0">Тема:</span>
                                            <span className="text-zinc-300">{activeCitation.rada_theme}</span>
                                        </div>
                                    )}
                                    {(activeCitation?.rada_replaced_by?.length ?? 0) > 0 && (
                                        <div className="flex gap-2">
                                            <span className="text-zinc-500 w-28 shrink-0">Замінено:</span>
                                            <div className="flex flex-col gap-0.5">
                                                {activeCitation!.rada_replaced_by!.map((nreg) => (
                                                    <a
                                                        key={nreg}
                                                        href={`https://zakon.rada.gov.ua/laws/show/${nreg}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="text-[#C9A84C] hover:underline"
                                                    >
                                                        {nreg}
                                                    </a>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    {(activeCitation?.rada_cancelled_by?.length ?? 0) > 0 && (
                                        <div className="flex gap-2">
                                            <span className="text-zinc-500 w-28 shrink-0">Скасовано:</span>
                                            <div className="flex flex-col gap-0.5">
                                                {activeCitation!.rada_cancelled_by!.map((nreg) => (
                                                    <a
                                                        key={nreg}
                                                        href={`https://zakon.rada.gov.ua/laws/show/${nreg}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="text-[#C9A84C] hover:underline"
                                                    >
                                                        {nreg}
                                                    </a>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                            {/* Passage */}
                            <div className="relative pl-4 border-l-2 border-[#C9A84C]/50">
                                <p className="text-[9px] font-black text-[#C9A84C]/50 uppercase tracking-widest mb-2.5">
                                    Уривок #{activeCitation?.num}
                                    {activeCitation?.chunk_index !== undefined ? ` · фрагмент ${activeCitation.chunk_index + 1}` : ""}
                                </p>
                                <p className="text-sm font-serif leading-loose text-[#E0E6ED]/85 italic">
                                    &ldquo;{activeCitation?.passage}&rdquo;
                                </p>
                            </div>
                        </div>
                    </ScrollArea>
                    {activeCitation?.law_url && (
                        <div className="px-5 sm:px-7 py-4 border-t border-[#C9A84C]/10 bg-[#0d1120]">
                            <a href={activeCitation.law_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-xs font-black text-[#C9A84C] hover:text-[#E2C47A] transition-all uppercase tracking-widest group">
                                <ExternalLink className="h-3.5 w-3.5 group-hover:scale-110 transition-transform" /> Читати повний текст
                            </a>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}

export default function Page() {
    return (
        <Suspense fallback={null}>
            <ChatPage />
        </Suspense>
    );
}
