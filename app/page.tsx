'use client';

import { useEffect, useRef, useState } from 'react';
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
} from 'lucide-react';
import { ChatSidebar } from '@/components/chat-sidebar';
import { motion, AnimatePresence } from 'framer-motion';

const API_URL = process.env.NEXT_PUBLIC_API_URL;

const SAMPLE_QUESTIONS = [
    { icon: <Scale className="h-4 w-4" />, text: 'Які права має ФОП 3 групи?' },
    { icon: <Briefcase className="h-4 w-4" />, text: 'Як законно звільнити працівника?' },
    { icon: <Home className="h-4 w-4" />, text: 'Які документи потрібні для продажу квартири?' },
    { icon: <BarChart3 className="h-4 w-4" />, text: 'Коли ФОП зобов\'язаний платити ПДВ?' },
];

type Citation = {
    num: number;
    source_title: string;
    passages: string[];
    status?: string;
    law_url?: string;
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
};

// --- СТИЛІЗОВАНІ КОМПОНЕНТИ ---

function AuthBg() {
    return (
        <div className="absolute inset-0 pointer-events-none select-none z-0" aria-hidden>
            <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-[#BFA071]/5 blur-[120px]" />
            <div className="absolute bottom-[-20%] right-[-10%] w-[600px] h-[600px] rounded-full bg-[#BFA071]/3 blur-[140px]" />
        </div>
    );
}

function StatusBadge({ status }: { status?: string }) {
    if (!status || status === 'Невідомо') return null;
    const isActive = status.toLowerCase().includes('чинний') && !status.toLowerCase().includes('втратив');
    return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider mt-2 ${isActive ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'
            }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-red-500'}`} />
            {status}
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
                            onClick={() => citation && onCitationOpen(citation)}
                            className="inline-flex items-center justify-center align-top mt-0.5 mx-0.5 min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-[#0A0E1A] bg-[#BFA071] rounded-sm hover:bg-[#d4b78a] shadow-[0_0_10px_rgba(191,160,113,0.3)] transition-all active:scale-90"
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
                if (/^[\*\-]\s/.test(t)) return <div key={i} className="flex gap-2 my-1.5 pl-1"><div className="h-1.5 w-1.5 rounded-full bg-[#BFA071] mt-2 shrink-0" /><span className="text-[#E0E6ED]/80 text-sm leading-relaxed">{parseInline(t.slice(2))}</span></div>;
                return <p key={i} className="my-1.5 text-sm leading-relaxed text-[#E0E6ED]/90">{parseInline(t)}</p>;
            })}
        </div>
    );
}

export default function ChatPage() {
    const router = useRouter();
    const searchParams = useSearchParams();

    const [currentChatId, setCurrentChatId] = useState<string | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [activeCitation, setActiveCitation] = useState<Citation | null>(null);
    const [isFirstMessage, setIsFirstMessage] = useState(true);
    const [limitExceeded, setLimitExceeded] = useState(false);

    const scrollRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const sessionStartRef = useRef<number>(Date.now());
    // Prevents history-load from wiping optimistic messages during new-chat creation
    const newChatInProgressRef = useRef(false);

    // --- LOGIC ---

    // Track session duration — send on unmount via sendBeacon (non-blocking)
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

    // Check quota on mount
    useEffect(() => {
        fetch('/api/settings/profile')
            .then(r => r.ok ? r.json() : null)
            .then(profile => {
                if (!profile) return;
                const { monthly_limit, requests_this_month } = profile;
                if (monthly_limit != null && requests_this_month >= monthly_limit) {
                    setLimitExceeded(true);
                }
            })
            .catch(() => {});
    }, []);

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }, [messages, isLoading]);

    useEffect(() => {
        const id = searchParams.get('chat');
        if (id !== currentChatId) setCurrentChatId(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams]);

    useEffect(() => {
        if (!currentChatId) {
            setMessages([]);
            setIsFirstMessage(true);
            return;
        }
        setHistoryLoading(true);
        fetch(`/api/chats/${currentChatId}`)
            .then(r => r.json())
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .then((rows: any[]) => {
                if (!Array.isArray(rows)) { setMessages([]); return; }
                // New empty chat just created during a send — don't wipe optimistic user message
                if (rows.length === 0 && newChatInProgressRef.current) {
                    setIsFirstMessage(true);
                    return;
                }
                setMessages(rows.map(r => ({ id: r.id, role: r.role === 'assistant' ? 'ai' : 'user', text: r.content })));
                setIsFirstMessage(rows.length === 0);
            })
            .catch(() => toast.error('Не вдалося завантажити чат'))
            .finally(() => setHistoryLoading(false));
    }, [currentChatId]);

    const handleSend = async (text: string) => {
        if (!text.trim() || isLoading || limitExceeded) return;
        const questionText = text.trim();
        setInput('');

        setMessages(prev => [...prev, { id: Date.now(), role: 'user', text: questionText }]);
        setIsLoading(true);

        let chatId = currentChatId;
        if (!chatId) {
            try {
                newChatInProgressRef.current = true;
                const res = await fetch('/api/chats', { method: 'POST' });
                const data = await res.json();
                chatId = data.id;
                setCurrentChatId(chatId);
                router.push(`/?chat=${chatId}`);
                mutate('/api/chats');
            } catch { toast.error('Не вдалося створити чат'); setMessages(prev => prev.slice(0, -1)); setIsLoading(false); newChatInProgressRef.current = false; return; }
        }

        fetch(`/api/chats/${chatId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: 'user', content: questionText }),
        }).catch(() => { });

        try {
            const res = await fetch(`${API_URL}/ask`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question: questionText }),
                signal: AbortSignal.timeout(120_000),
            });
            if (res.status === 429) {
                setLimitExceeded(true);
                return;
            }

            const data = await res.json();

            if (data.answer) {
                setMessages(prev => [...prev, {
                    id: Date.now() + 1, role: 'ai', text: data.answer,
                    references: data.references ?? [], templates: data.templates ?? [],
                }]);

                fetch(`/api/chats/${chatId}/messages`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        role: 'assistant',
                        content: data.answer,
                        analytics: { query_text: questionText, ai_response: data.answer },
                    }),
                }).catch(() => { });

                if (isFirstMessage) {
                    setIsFirstMessage(false);
                    fetch(`/api/chats/${chatId}/name`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ question: questionText, answer: data.answer }),
                    }).then(() => mutate('/api/chats'));
                } else { mutate('/api/chats'); }
            }
        } catch { toast.error('Сервер не відповідає. Спробуйте ще раз.'); } finally {
            setIsLoading(false);
            newChatInProgressRef.current = false;
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend(input);
        }
    };

    // --- RETURN (Редизайн) ---

    return (
        <div className="flex h-screen bg-[#0A0E1A] text-[#E0E6ED] overflow-hidden relative">
            <AuthBg />

            <ChatSidebar
                currentChatId={currentChatId}
                onNewChat={() => router.push('/')}
                onSelectChat={(id) => router.push(`/?chat=${id}`)}
            />

            <main className="flex-1 flex flex-col relative z-10 bg-[#0d1120]/40 backdrop-blur-sm border-l border-[#BFA071]/10">
                {/* Header */}
                <header className="h-16 border-b border-[#BFA071]/10 flex items-center px-6 justify-between bg-[#0A0E1A]/60 backdrop-blur-md shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="bg-[#BFA071]/10 p-2 rounded-lg border border-[#BFA071]/20">
                            <Scale className="h-5 w-5 text-[#BFA071]" />
                        </div>
                        <h1 className="font-serif text-lg font-bold tracking-tight">
                            <span className="text-[#BFA071]">URAI</span> — Юридичний асистент
                        </h1>
                    </div>
                </header>

                {/* Chat Area */}
                <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-8 scroll-smooth">
                    <div className="max-w-3xl mx-auto">
                        {historyLoading ? (
                            <div className="flex flex-col items-center justify-center h-full gap-4 pt-20">
                                <Loader2 className="w-8 h-8 animate-spin text-[#BFA071]" />
                                <p className="text-[10px] font-bold text-[#BFA071] uppercase tracking-[0.3em]">Відновлення історії...</p>
                            </div>
                        ) : messages.length === 0 ? (
                            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center pt-10">
                                <div className="w-20 h-20 rounded-full bg-[#BFA071]/10 border border-[#BFA071]/20 flex items-center justify-center mx-auto mb-6 shadow-[0_0_30px_rgba(191,160,113,0.1)]">
                                    <Scale className="h-10 w-10 text-[#BFA071]" />
                                </div>
                                <h2 className="font-serif text-3xl font-bold mb-4 text-white">Привіт! Я <span className="text-[#BFA071]">URAI</span></h2>
                                <p className="text-[#E0E6ED]/60 text-sm max-w-md mx-auto mb-10 leading-relaxed">
                                    Задайте будь-яке юридичне запитання. Я проаналізую законодавство України та надам відповідь з посиланнями.
                                </p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
                                    {SAMPLE_QUESTIONS.map((q, i) => (
                                        <button key={i} onClick={() => handleSend(q.text)} className="flex items-center gap-3 p-4 rounded-2xl border border-[#BFA071]/10 bg-[#0d1120]/50 hover:border-[#BFA071]/40 hover:bg-[#BFA071]/5 transition-all group">
                                            <div className="text-[#BFA071] group-hover:scale-110 transition-transform">{q.icon}</div>
                                            <span className="text-xs font-medium text-[#E0E6ED]/80">{q.text}</span>
                                        </button>
                                    ))}
                                </div>
                            </motion.div>
                        ) : (
                            <div className="space-y-8 pb-10">
                                {messages.map(msg => (
                                    <motion.div key={msg.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                                        <div className={`h-10 w-10 rounded-2xl flex items-center justify-center shrink-0 shadow-xl ${msg.role === 'ai' ? 'bg-[#0d1120] border border-[#BFA071]/30 text-[#BFA071]' : 'bg-[#BFA071] text-[#0A0E1A]'
                                            }`}>
                                            {msg.role === 'ai' ? <Scale className="h-6 w-6" /> : <User className="h-6 w-6" />}
                                        </div>
                                        <div className={`max-w-[85%] space-y-2 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
                                            <Card className={`p-5 text-sm leading-relaxed border-none shadow-2xl ${msg.role === 'user'
                                                ? 'bg-[#BFA071]/10 text-[#E0E6ED] rounded-3xl rounded-tr-none'
                                                : 'bg-[#0d1120]/90 text-[#E0E6ED] rounded-3xl rounded-tl-none border-l-2 border-l-[#BFA071] font-serif tracking-wide'
                                                }`}>
                                                {msg.role === 'ai' ? (
                                                    <div className="space-y-4">
                                                        <MarkdownText text={msg.text} refs={msg.references ?? []} onCitationOpen={setActiveCitation} />
                                                        {msg.references && msg.references.length > 0 && (
                                                            <div className="mt-6 pt-4 border-t border-[#BFA071]/10 space-y-2">
                                                                <p className="text-[10px] font-bold text-[#BFA071]/70 uppercase tracking-[0.2em]">Юридичні джерела:</p>
                                                                <div className="flex flex-wrap gap-2">
                                                                    {msg.references.map((ref, ri) => (
                                                                        <button key={ri} onClick={() => setActiveCitation(ref)} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#BFA071]/5 border border-[#BFA071]/10 hover:border-[#BFA071]/30 text-[11px] text-[#BFA071] transition-all">
                                                                            <BookOpenText className="w-3 h-3" />
                                                                            [{ref.num}] {ref.source_title}
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}
                                                        {msg.templates && msg.templates.length > 0 && (
                                                            <div className="mt-4 pt-4 border-t border-[#BFA071]/10 space-y-2">
                                                                <p className="text-[10px] font-bold text-[#BFA071]/70 uppercase tracking-[0.2em]">Доступні бланки:</p>
                                                                {msg.templates.map((t, ti) => (
                                                                    <a key={ti} href={t.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 rounded-xl bg-[#BFA071]/5 border border-[#BFA071]/20 hover:bg-[#BFA071]/10 transition-all group">
                                                                        <div className="bg-[#BFA071] p-1.5 rounded-lg text-[#0A0E1A] group-hover:scale-110 transition-transform"><Plus className="w-4 h-4" /></div>
                                                                        <div className="flex-1 min-w-0"><p className="text-xs font-bold truncate text-[#E0E6ED]">{t.title}</p></div>
                                                                        <ExternalLink className="w-3.5 h-3.5 text-[#BFA071]/70" />
                                                                    </a>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                ) : msg.text}
                                            </Card>
                                            <span className="text-[10px] font-bold text-[#BFA071]/50 uppercase tracking-widest px-2">{msg.role === 'ai' ? 'URAI Legal Intelligence' : 'Клієнт'}</span>
                                        </div>
                                    </motion.div>
                                ))}
                            </div>
                        )}

                        {isLoading && (
                            <div className="flex gap-4 items-center">
                                <div className="h-10 w-10 rounded-2xl bg-[#0d1120] border border-[#BFA071]/20 flex items-center justify-center">
                                    <Loader2 className="h-5 w-5 animate-spin text-[#BFA071]" />
                                </div>
                                <p className="text-[10px] font-bold text-[#BFA071] uppercase tracking-[0.3em] animate-pulse">Аналіз законодавства...</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Input Area */}
                <footer className="p-4 sm:p-8 bg-[#0A0E1A]/80 backdrop-blur-md border-t border-[#BFA071]/10 shrink-0">
                    <div className="max-w-3xl mx-auto space-y-3">
                        {/* Limit exceeded banner */}
                        {limitExceeded && (
                            <div className="flex items-center gap-4 px-5 py-4 rounded-2xl bg-[#0d1120] border border-[#BFA071]/30 shadow-lg shadow-[#BFA071]/5">
                                <div className="w-9 h-9 rounded-xl bg-[#BFA071]/10 border border-[#BFA071]/20 flex items-center justify-center shrink-0">
                                    <Lock className="w-4 h-4 text-[#BFA071]" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-bold text-[#E0E6ED]">Ліміт запитів вичерпано</p>
                                    <p className="text-xs text-[#E0E6ED]/50 mt-0.5">Ви використали всі запити безкоштовного плану. Оформіть підписку для продовження.</p>
                                </div>
                                <a
                                    href="/settings?tab=billing"
                                    className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#BFA071] hover:bg-[#d4b78a] text-[#0A0E1A] text-[11px] font-black uppercase tracking-[0.15em] transition-all active:scale-95 whitespace-nowrap"
                                >
                                    <Sparkles className="w-3.5 h-3.5" />
                                    Підписка
                                </a>
                            </div>
                        )}

                        <div className={`relative flex items-end gap-3 bg-[#0d1120] border p-3 rounded-3xl transition-all shadow-2xl ${limitExceeded ? 'border-[#BFA071]/10 opacity-50 pointer-events-none' : 'border-[#BFA071]/20 focus-within:border-[#BFA071]/50 focus-within:ring-1 focus-within:ring-[#BFA071]/20'}`}>
                            <Textarea
                                ref={inputRef}
                                placeholder={limitExceeded ? "Ліміт запитів вичерпано..." : "Запитайте про закони, ФОП або договори..."}
                                value={input}
                                onChange={e => setInput(e.target.value)}
                                onKeyDown={handleKeyDown}
                                disabled={limitExceeded}
                                className="bg-transparent border-none focus-visible:ring-0 text-[#E0E6ED] placeholder:text-[#BFA071]/20 text-sm min-h-[50px] max-h-32 resize-none py-3 px-4 font-medium disabled:cursor-not-allowed"
                                rows={1}
                            />
                            <button
                                onClick={() => handleSend(input)}
                                disabled={!input.trim() || isLoading || limitExceeded}
                                className="bg-[#BFA071] hover:bg-[#d4b78a] text-[#0A0E1A] rounded-2xl h-12 w-12 flex items-center justify-center shrink-0 shadow-lg shadow-[#BFA071]/10 transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                                <Send className="h-5 w-5" />
                            </button>
                        </div>
                        <div className="flex items-center gap-2 justify-center text-[#BFA071]/70 uppercase text-[9px] font-black tracking-widest">
                            <AlertTriangle size={12} className="shrink-0" />
                            URAI базується на законах України. Перевіряйте важливі деталі.
                        </div>
                    </div>
                </footer>
            </main>

            {/* Citation Dialog */}
            <Dialog open={!!activeCitation} onOpenChange={o => !o && setActiveCitation(null)}>
                <DialogContent className="max-w-2xl bg-[#0d1120] rounded-[2rem] border border-[#BFA071]/40 shadow-2xl p-0 overflow-hidden text-[#E0E6ED]">
                    <div className="bg-[#BFA071] p-8 text-[#0A0E1A]">
                        <div className="flex items-start gap-5">
                            <div className="bg-[#0A0E1A] p-3 rounded-2xl shadow-xl shrink-0">
                                <BookOpenText className="h-6 w-6 text-[#BFA071]" />
                            </div>
                            <div className="min-w-0">
                                <span className="text-[10px] font-black text-[#0A0E1A]/60 uppercase tracking-[0.2em] block mb-1">Джерело №{activeCitation?.num}</span>
                                <DialogTitle className="font-serif font-bold text-xl leading-tight">{activeCitation?.source_title}</DialogTitle>
                                <StatusBadge status={activeCitation?.status} />
                            </div>
                        </div>
                    </div>
                    <ScrollArea className="max-h-[450px] p-10 bg-[#0A0E1A]/40 text-sm leading-relaxed font-serif">
                        {activeCitation?.passages?.map((p, i) => (
                            <div key={i} className="mb-6 pl-6 border-l-2 border-[#BFA071]/30 italic opacity-90">{p}</div>
                        ))}
                    </ScrollArea>
                    {activeCitation?.law_url && (
                        <div className="px-10 py-6 border-t border-[#BFA071]/10 bg-[#0d1120]">
                            <a href={activeCitation.law_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2.5 text-xs font-black text-[#BFA071] hover:text-[#d4b78a] transition-all uppercase tracking-widest group">
                                <ExternalLink className="h-4 w-4 group-hover:scale-110 transition-transform" /> Читати повний текст на zakon.rada.gov.ua
                            </a>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}