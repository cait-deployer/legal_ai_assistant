'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Textarea } from "@/components/ui/textarea";
import { Card } from '@/components/ui/card';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetTitle,
    SheetTrigger,
} from '@/components/ui/sheet';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
    Bot,
    User,
    SendHorizontal,
    Sparkles,
    Table as TableIcon,
    FileCheck,
    Headphones,
    LayoutTemplate,
    Settings2,
    Database,
    Zap,
    Loader2,
    Info,
    BookOpenText,
    X,
    Menu,
    Network,
} from 'lucide-react';

// --- TYPES ---
type Citation = { num: number; source_title: string; passages: string[] };
type Message = { id: number; role: 'ai' | 'user'; text: string; references?: Citation[] };
type MindMapNode = {
    name?: string;
    label?: string;
    children?: MindMapNode[];
    [key: string]: unknown;
};
type ToolResult =
    | { type: 'markdown'; content: string; title: string }
    | { type: 'table'; headers: string[]; rows: Record<string, string>[]; title: string }
    | { type: 'audio'; url: string | null; task_id: string; title: string }
    | { type: 'mindmap'; data: MindMapNode; title: string };

type StudioTool = {
    name: string;
    endpoint: string | null;
    icon: React.ElementType;
    color: string;
    description: string;
    inputLabel: string | null;
    inputPlaceholder: string | null;
    autoNote: string | null;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// --- RENDER HELPERS ---
function CitationBadge({
    num,
    refs,
    onOpen,
}: {
    num: string;
    refs: Citation[];
    onOpen: (c: Citation) => void;
}) {
    const citation = refs.find(r => r.num === Number(num));
    if (!citation)
        return <sup className="text-[10px] font-bold text-indigo-400 mx-0.5">[{num}]</sup>;
    return (
        <sup>
            <button
                onClick={() => onOpen(citation)}
                className="text-[10px] font-bold text-white bg-indigo-600 px-1.5 py-0.5 rounded-sm mx-0.5 hover:bg-indigo-700 transition-all shadow-sm">
                {num}
            </button>
        </sup>
    );
}

function parseInline(
    text: string,
    refs: Citation[],
    onCitationOpen: (c: Citation) => void,
): React.ReactNode[] {
    const parts = text.split(/(\*\*[^*]+\*\*|\[\d+(?:,\s*\d+)*\])/g);
    return parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**'))
            return (
                <strong key={i} className="font-bold text-slate-900">
                    {part.slice(2, -2)}
                </strong>
            );
        if (/^\[\d+(?:,\s*\d+)*\]$/.test(part)) {
            const nums = part
                .slice(1, -1)
                .split(',')
                .map(n => n.trim());
            return (
                <span key={i} className="inline-flex gap-0.5 align-middle">
                    {nums.map(n => (
                        <CitationBadge key={n} num={n} refs={refs} onOpen={onCitationOpen} />
                    ))}
                </span>
            );
        }
        return part;
    });
}

function MessageText({
    text,
    refs,
    onCitationOpen,
}: {
    text: string;
    refs: Citation[];
    onCitationOpen: (c: Citation) => void;
}) {
    const lines = text.split('\n');
    const nodes: React.ReactNode[] = [];
    const pi = (s: string) => parseInline(s, refs, onCitationOpen);
    lines.forEach((line, i) => {
        if (line.startsWith('### '))
            nodes.push(
                <p key={i} className="font-bold text-slate-900 mt-3 text-[15px]">
                    {pi(line.slice(4))}
                </p>,
            );
        else if (line.startsWith('## '))
            nodes.push(
                <p key={i} className="font-bold text-slate-900 mt-4 text-base">
                    {pi(line.slice(3))}
                </p>,
            );
        else if (line.startsWith('# '))
            nodes.push(
                <p key={i} className="font-bold text-slate-900 mt-4 text-lg">
                    {pi(line.slice(2))}
                </p>,
            );
        else if (/^[\*\-]\s/.test(line))
            nodes.push(
                <div key={i} className="flex gap-2 my-1 pl-1">
                    <span className="text-indigo-500 shrink-0 mt-1">•</span>
                    <span>{pi(line.slice(2))}</span>
                </div>,
            );
        else if (line === '') nodes.push(<div key={i} className="h-2" />);
        else
            nodes.push(
                <p key={i} className="my-1 leading-relaxed">
                    {pi(line)}
                </p>,
            );
    });
    return <div className="space-y-0.5">{nodes}</div>;
}

function MindMapTree({ node, depth = 0 }: { node: MindMapNode; depth?: number }) {
    const label = node.name || node.label || 'Node';
    const children = node.children || [];
    return (
        <div className={depth > 0 ? 'ml-5 border-l border-slate-200 pl-3 mt-1' : ''}>
            <div
                className={`py-1 text-sm font-medium ${depth === 0 ? 'text-indigo-700 font-bold text-base' : 'text-slate-700'}`}>
                {label}
            </div>
            {children.map((child, i) => (
                <MindMapTree key={i} node={child} depth={depth + 1} />
            ))}
        </div>
    );
}

function ToolResultBody({ result }: { result: ToolResult }) {
    if (result.type === 'markdown')
        return (
            <ScrollArea className="max-h-[60vh] p-1">
                <pre className="whitespace-pre-wrap font-sans text-sm text-slate-700 leading-relaxed">
                    {result.content}
                </pre>
            </ScrollArea>
        );
    if (result.type === 'table')
        return (
            <ScrollArea className="max-h-[60vh] border rounded-lg">
                <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b sticky top-0">
                        <tr>
                            {result.headers.map(h => (
                                <th
                                    key={h}
                                    className="text-left px-3 py-2 font-bold text-slate-700">
                                    {h}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {result.rows.map((row, i) => (
                            <tr key={i} className="border-b last:border-0">
                                {result.headers.map(h => (
                                    <td key={h} className="px-3 py-2 text-slate-600">
                                        {row[h] || '—'}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </ScrollArea>
        );
    if (result.type === 'audio')
        return (
            <div className="space-y-4">
                {result.url ? (
                    <audio controls className="w-full" src={result.url} />
                ) : (
                    <p className="text-sm text-slate-500 italic">
                        Audio generated. Check NotebookLM.
                    </p>
                )}
            </div>
        );
    if (result.type === 'mindmap')
        return (
            <ScrollArea className="max-h-[60vh]">
                <MindMapTree node={result.data} />
            </ScrollArea>
        );
    return null;
}

// --- MAIN COMPONENT ---
export default function LawyerDashboard() {
    const [messages, setMessages] = useState<Message[]>([
        {
            id: 1,
            role: 'ai',
            text: 'Legal AI Studio ready. RentalAgreement_44.pdf is indexed. Open Studio Tools to generate artifacts or ask me anything.',
        },
    ]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [toolLoading, setToolLoading] = useState<string | null>(null);
    const [toolResult, setToolResult] = useState<ToolResult | null>(null);
    const [resultDialogOpen, setResultDialogOpen] = useState(false);
    const [activeCitation, setActiveCitation] = useState<Citation | null>(null);
    const [launchTool, setLaunchTool] = useState<StudioTool | null>(null);
    const [launchInstructions, setLaunchInstructions] = useState('');
    const [launchDialogOpen, setLaunchDialogOpen] = useState(false);

    const scrollRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const studioTools: StudioTool[] = [
        {
            name: 'Risk Report',
            endpoint: '/risk-report',
            icon: FileCheck,
            color: 'text-amber-500',
            description: 'Deep analysis of legal risks.',
            inputLabel: 'Focus area',
            inputPlaceholder: 'e.g. liability...',
            autoNote: null,
        },
        {
            name: 'Data Table',
            endpoint: '/data-table',
            icon: TableIcon,
            color: 'text-blue-500',
            description: 'Extract dates, parties, amounts.',
            inputLabel: 'Entities',
            inputPlaceholder: 'e.g. payments...',
            autoNote: null,
        },
        {
            name: 'Audio Overview',
            endpoint: '/audio-overview',
            icon: Headphones,
            color: 'text-purple-500',
            description: 'AI podcast summary.',
            inputLabel: null,
            inputPlaceholder: null,
            autoNote: 'Generates 5-min audio.',
        },
        {
            name: 'Mind Map',
            endpoint: '/mind-map',
            icon: LayoutTemplate,
            color: 'text-pink-500',
            description: 'Concept hierarchy.',
            inputLabel: null,
            inputPlaceholder: null,
            autoNote: 'Automatic generation.',
        },
        {
            name: 'Airtable Sync',
            endpoint: null,
            icon: Database,
            color: 'text-emerald-500',
            description: 'Sync to database.',
            inputLabel: null,
            inputPlaceholder: null,
            autoNote: null,
        },
    ];

    const handleSendMessage = async () => {
        if (!input.trim()) return;
        const userMsg: Message = { id: Date.now(), role: 'user', text: input };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setIsLoading(true);
        try {
          const res = await fetch('${API_URL}/ask', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question: input }),
            });
            const data = await res.json();
            if (data.answer)
                setMessages(prev => [
                    ...prev,
                    {
                        id: Date.now() + 1,
                        role: 'ai',
                        text: data.answer,
                        references: data.references ?? [],
                    },
                ]);
        } catch {
            toast.error('Backend error');
        } finally {
            setIsLoading(false);
        }
    };

    const handleLaunchConfirm = async () => {
        if (!launchTool) return;
        setLaunchDialogOpen(false);
        setToolLoading(launchTool.name);
        try {
          const res = await fetch(`${API_URL}${launchTool.endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ instructions: launchInstructions }),
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            setToolResult({ ...data, title: launchTool.name });
            setResultDialogOpen(true);
        } catch (e: unknown) {
            toast.error((e as Error).message || 'Execution failed');
        } finally {
            setToolLoading(null);
            setLaunchTool(null);
        }
    };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

    return (
        <div className="flex h-screen w-full bg-slate-50 font-sans overflow-hidden">
            {/* MAIN CANVAS */}
            <main className="flex-1 flex flex-col relative max-w-7xl mx-auto w-full bg-white border-x border-slate-100 shadow-2xl overflow-hidden">
                {/* HEADER */}
                <header className="h-20 border-b border-slate-100 flex items-center px-8 justify-between bg-white/80 backdrop-blur-md sticky top-0 z-30">
                    <div className="flex items-center gap-4">
                        <div className="bg-slate-900 p-2 rounded-lg text-white shadow-lg shadow-slate-900/20">
                            <Sparkles className="h-5 w-5" />
                        </div>
                        <div>
                            <h1 className="font-black text-lg tracking-tight">
                                Legal AI <span className="text-indigo-600">Studio</span>
                            </h1>
                            <div className="flex gap-2 mt-0.5 items-center">
                                <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                    NotebookLM Live
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* STUDIO TOOLS TRIGGER (SHEET) */}
                    <Sheet>
                        <SheetTrigger>
                            <button className="flex items-center gap-2 border border-slate-200 bg-white hover:bg-slate-50 px-5 py-2.5 rounded-xl text-sm font-bold shadow-sm transition-all active:scale-95 group">
                                <Settings2 className="h-4 w-4 text-slate-400 group-hover:rotate-90 transition-transform duration-300" />
                                Studio Tools
                            </button>
                        </SheetTrigger>
                        <SheetContent
                            side="right"
                            className="w-[350px] sm:w-[420px] bg-slate-900 border-none p-0">
                            <div className="p-8 border-b border-slate-800 flex items-center gap-3">
                                <div className="bg-indigo-600 p-2 rounded-xl text-white">
                                    <Sparkles className="h-5 w-5" />
                                </div>
                                <SheetTitle className="text-white font-black uppercase tracking-tight text-xl">
                                    Studio Panel
                                </SheetTitle>
                            </div>
                            <div className="p-8 space-y-4">
                                <SheetDescription className="text-slate-400 font-medium">
                                    Select a tool to generate document artifacts.
                                </SheetDescription>
                                <div className="grid gap-3 pt-4">
                                    {studioTools.map(tool => (
                                        <Button
                                            key={tool.name}
                                            variant="ghost"
                                            disabled={!!toolLoading}
                                            onClick={() =>
                                                tool.endpoint
                                                    ? (setLaunchTool(tool),
                                                      setLaunchInstructions(''),
                                                      setLaunchDialogOpen(true))
                                                    : toast.info('Sync Standby')
                                            }
                                            className="h-20 justify-start gap-5 px-5 rounded-2xl border border-transparent hover:border-slate-700 hover:bg-slate-800 transition-all group">
                                            <div
                                                className={`p-3 rounded-xl bg-slate-800 ${tool.color} group-hover:scale-110 transition-transform`}>
                                                <tool.icon className="h-6 w-6" />
                                            </div>
                                            <div className="text-left">
                                                <p className="font-bold text-slate-100">
                                                    {tool.name}
                                                </p>
                                                <p className="text-[10px] text-slate-500 uppercase font-bold tracking-tighter">
                                                    {toolLoading === tool.name
                                                        ? 'Generating...'
                                                        : 'Launch Tool'}
                                                </p>
                                            </div>
                                            {toolLoading === tool.name && (
                                                <Loader2 className="ml-auto h-4 w-4 animate-spin text-indigo-400" />
                                            )}
                                        </Button>
                                    ))}
                                </div>
                            </div>
                        </SheetContent>
                    </Sheet>
                </header>

                {/* CHAT AREA */}
                <ScrollArea className="flex-1 px-4 md:px-10 py-10 bg-slate-50/20 overflow-auto">
                    <div className="max-w-5xl mx-auto space-y-8">
                        {messages.map(msg => (
                            <div
                                key={msg.id}
                                className={`flex gap-5 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                                <div
                                    className={`h-11 w-11 rounded-2xl flex items-center justify-center shrink-0 shadow-lg ${msg.role === 'ai' ? 'bg-slate-900 text-white' : 'bg-indigo-600 text-white'}`}>
                                    {msg.role === 'ai' ? (
                                        <Bot className="h-6 w-6" />
                                    ) : (
                                        <User className="h-6 w-6" />
                                    )}
                                </div>
                                <Card
                                    className={`p-5 text-[15px] leading-relaxed shadow-xl max-w-[85%] ${msg.role === 'user' ? 
                                    'bg-slate-100 border-transparent text-slate-800 rounded-tr-none'
                                    : 'bg-white border-slate-100 text-slate-800 rounded-tl-none shadow-slate-200/50'}`}>
                                    {msg.role === 'ai' ? (
                                        <MessageText
                                            text={msg.text}
                                            refs={msg.references ?? []}
                                            onCitationOpen={setActiveCitation}
                                        />
                                    ) : (
                                        msg.text
                                    )}
                                </Card>
                            </div>
                        ))}
                        {isLoading && (
                            <div className="flex gap-5 items-center italic text-slate-400 text-sm animate-pulse">
                                <Bot className="h-5 w-5" />
                                <Zap className="h-4 w-4 animate-bounce text-indigo-500" /> Lawyer AI
                                is processing...
                            </div>
                        )}
                        <div ref={scrollRef} className="h-10" />
                    </div>
                </ScrollArea>

                {/* INPUT */}
          <footer className="p-8 bg-white border-t border-slate-100 shadow-[0_-10px_30px_rgba(0,0,0,0.02)]">
            <div className="max-w-3xl mx-auto flex items-end gap-3 bg-slate-50 border border-slate-200 p-3 rounded-[24px] shadow-inner focus-within:ring-2 focus-within:ring-indigo-500/20 transition-all">
              <Textarea
                placeholder="Type your legal question here... (Shift+Enter for new line)"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isLoading}
                className="bg-transparent border-none focus-visible:ring-0 text-[15px] px-4 py-2 min-h-[44px] max-h-[200px] resize-none w-full scrollbar-hide"
                rows={1}
              />
              <Button
                onClick={handleSendMessage}
                disabled={isLoading || !input.trim()}
                className="bg-slate-900 hover:bg-black rounded-2xl h-12 w-12 shrink-0 shadow-xl transition-all active:scale-95 disabled:bg-slate-200"
              >
                <SendHorizontal className="h-5 w-5" />
              </Button>
            </div>
            {/* <p className="text-center text-[10px] text-slate-400 mt-4 font-bold uppercase tracking-[0.2em]">
              Powered by NotebookLM × Lawyer AI Studio
            </p> */}
          </footer>
            </main>

            {/* DIALOGS */}
            <Dialog open={launchDialogOpen} onOpenChange={setLaunchDialogOpen}>
                <DialogContent className="sm:max-w-md bg-white rounded-3xl p-8 border-none shadow-2xl">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-3 text-slate-900">
                            <div className={`${launchTool?.color} bg-slate-50 p-2 rounded-xl`}>
                                {launchTool && <launchTool.icon className="h-6 w-6" />}
                            </div>
                            {launchTool?.name}
                        </DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-slate-500 leading-relaxed my-4">
                        {launchTool?.description}
                    </p>
                    {launchTool?.inputLabel && (
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                                {launchTool.inputLabel}
                            </label>
                            <Input
                                placeholder={launchTool.inputPlaceholder || ''}
                                value={launchInstructions}
                                onChange={e => setLaunchInstructions(e.target.value)}
                                className="bg-slate-50 border-slate-200 rounded-xl h-12 text-sm"
                            />
                        </div>
                    )}
                    <DialogFooter className="mt-8">
                        <Button
                            onClick={handleLaunchConfirm}
                            className="bg-indigo-600 hover:bg-indigo-700 h-12 w-full rounded-xl font-bold shadow-lg shadow-indigo-500/20">
                            GENERATE
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={resultDialogOpen} onOpenChange={setResultDialogOpen}>
                <DialogContent className="sm:max-w-3xl bg-white rounded-3xl p-8 border-none shadow-2xl overflow-hidden">
                    <DialogHeader>
                        <DialogTitle className="text-slate-900 font-black uppercase tracking-tight">
                            Artifact Result: {toolResult?.title}
                        </DialogTitle>
                    </DialogHeader>
                    {toolResult && <ToolResultBody result={toolResult} />}
                </DialogContent>
            </Dialog>

            <Dialog open={!!activeCitation} onOpenChange={o => !o && setActiveCitation(null)}>
                <DialogContent className="max-w-2xl bg-white rounded-3xl p-0 border-none shadow-3xl overflow-hidden">
                    <div className="bg-slate-950 p-8 flex justify-between items-center text-white">
                        <div className="flex items-center gap-4">
                            <BookOpenText className="h-7 w-7 text-indigo-400" />
                            <DialogTitle className="font-bold tracking-tight text-xl">
                                Source Reference [{activeCitation?.num}]
                            </DialogTitle>
                        </div>
                        <X
                            className="h-5 w-5 cursor-pointer opacity-50 hover:opacity-100"
                            onClick={() => setActiveCitation(null)}
                        />
                    </div>
                    <ScrollArea className="max-h-[450px] p-10 font-serif italic text-slate-700 leading-relaxed text-lg">
                        {activeCitation?.passages.map((p, i) => (
                            <div
                                key={i}
                                className="pl-6 border-l-4 border-indigo-100 mb-8 last:mb-0">
                                {p}
                            </div>
                        ))}
                    </ScrollArea>
                </DialogContent>
            </Dialog>
        </div>
    );
}
