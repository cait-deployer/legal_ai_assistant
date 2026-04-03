'use client';

import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
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
  Headphones,
  Settings2,
  Database,
  Zap,
  Loader2,
  BookOpenText,
  X,
  ShieldCheck,
  ChevronRight,
  Activity,
  ExternalLink, // ← НОВЕ: для deep link у модалці
} from 'lucide-react';

// --- TYPES ---
type Citation = {
  num: number;
  source_title: string;
  passages: string[];
  status?: string; // ← НОВЕ: 'Чинний' | 'Втратив чинність' | 'Невідомо'
  law_url?: string; // ← НОВЕ: посилання на zakon.rada.gov.ua
  law_id?: string;
};

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
  bg: string;
  description: string;
  inputLabel: string | null;
  inputPlaceholder: string | null;
};

type Template = {
  title: string;
  url: string;
  type: string;
};

type Message = {
  id: number;
  role: 'ai' | 'user';
  text: string;
  references?: Citation[];
  templates?: Template[];
};

const API_URL = process.env.NEXT_PUBLIC_API_URL;

// ─── НОВЕ: Плашка статусу закону ──────────────────────────────────────────────
function StatusBadge({ status }: { status?: string }) {
  if (!status || status === 'Невідомо') return null;

  const isActive =
    status.toLowerCase().includes('чинний') && !status.toLowerCase().includes('втратив');

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 pb-0.5 pt-1 leading-none rounded-full text-[10px] font-bold uppercase tracking-wider mt-1.5 ${isActive
          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
          : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
      <span
        className={`h-1.5 w-1.5 rounded-full shrink-0 ${isActive ? 'bg-emerald-500' : 'bg-red-500'
          }`}
      />
      {status}
    </span>
  );
}

// --- MARKDOWN PASSAGE RENDERER (для цитат із законів) ---
function renderInlineMd(text: string): React.ReactNode[] {
  return text
    .split(/\*\*(.*?)\*\*/g)
    .map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : part));
}

function MarkdownPassage({ text }: { text: string }) {
  return (
    <div className="space-y-1 text-slate-800 text-sm leading-relaxed font-sans">
      {text.split('\n').map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={i} className="h-1" />;
        if (/^#{1,2}\s/.test(trimmed)) {
          return (
            <p key={i} className="font-bold text-slate-900 mt-2">
              {renderInlineMd(trimmed.replace(/^#{1,2}\s/, ''))}
            </p>
          );
        }
        if (/^###\s/.test(trimmed)) {
          return (
            <p key={i} className="font-semibold text-slate-700 mt-1">
              {renderInlineMd(trimmed.replace(/^###\s/, ''))}
            </p>
          );
        }
        if (/^\d+\.\s/.test(trimmed) || /^[-*]\s/.test(trimmed)) {
          return (
            <p key={i} className="pl-3">
              {renderInlineMd(trimmed)}
            </p>
          );
        }
        return <p key={i}>{renderInlineMd(trimmed)}</p>;
      })}
    </div>
  );
}

function TemplateCard({ template }: { template: Template }) {
  return (
    <a
      href={template.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 p-3 bg-indigo-50 border border-indigo-100 rounded-xl hover:bg-indigo-100 transition-all group mt-2">
      <div className="bg-indigo-600 p-2 rounded-lg text-white group-hover:scale-110 transition-transform">
        <Database className="h-4 w-4" />
      </div>
      <div className="flex flex-col min-w-0">
        <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">
          Шаблон документа
        </span>
        <span className="text-xs font-bold text-slate-900 truncate">{template.title}</span>
      </div>
      <ExternalLink className="h-4 w-4 text-indigo-400 ml-auto" />
    </a>
  );
}

// --- RENDER HELPERS ---
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

  const parseInline = (lineText: string) => {
    const parts = lineText.split(/(\[\d+(?:,\s*\d+)*\])/g);

    return parts.map((part, i) => {
      if (/^\[\d+(?:,\s*\d+)*\]$/.test(part)) {
        const nums = part
          .slice(1, -1)
          .split(',')
          .map(n => n.trim());

        return nums.map((numStr, j) => {
          const num = Number(numStr);
          const citation = refs.find(r => r.num === num);

          return (
            <button
              key={`${i}-${j}`}
              onClick={() => citation && onCitationOpen(citation)}
              className="inline-flex items-center justify-center align-top mt-0.5 mx-0.5 min-w-[16px] h-[16px] px-1 text-[9px] font-bold text-white bg-indigo-500 rounded-sm hover:bg-indigo-600 shadow-sm transition-all active:scale-90 cursor-pointer">
              {num}
            </button>
          );
        });
      }
      return part;
    });
  };

  lines.forEach((line, i) => {
    if (line.startsWith('### '))
      nodes.push(
        <h3 key={i} className="font-bold text-slate-900 mt-3 mb-1 text-base tracking-tight">
          {parseInline(line.slice(4))}
        </h3>,
      );
    else if (/^[\*\-]\s/.test(line))
      nodes.push(
        <div key={i} className="flex gap-2 my-1 pl-1">
          <div className="h-1 w-1 rounded-full bg-indigo-400 mt-2 shrink-0" />{' '}
          <span className="text-slate-700 text-sm leading-relaxed">
            {parseInline(line.slice(2))}
          </span>
        </div>,
      );
    else if (line === '') nodes.push(<div key={i} className="h-2" />);
    else
      nodes.push(
        <p key={i} className="my-1 text-sm leading-relaxed text-slate-700">
          {parseInline(line)}
        </p>,
      );
  });
  return <div className="animate-in fade-in slide-in-from-bottom-1 duration-400">{nodes}</div>;
}

// --- TOOL RESULT RENDERERS ---
function MindMapTree({ node, depth = 0 }: { node: MindMapNode; depth?: number }) {
  const label = node.name || node.label || 'Node';
  const children = (node.children as MindMapNode[]) || [];
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
      <ScrollArea className="max-h-[60vh] p-4">
        <pre className="whitespace-pre-wrap font-sans text-sm text-slate-700 leading-relaxed">
          {result.content}
        </pre>
      </ScrollArea>
    );
  if (result.type === 'table')
    return (
      <ScrollArea className="max-h-[60vh]">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-slate-100 sticky top-0">
            <tr>
              {result.headers.map(h => (
                <th
                  key={h}
                  className="text-left px-3 py-2 font-semibold text-slate-700 border-b border-slate-200">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, i) => (
              <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                {result.headers.map(h => (
                  <td
                    key={h}
                    className="px-3 py-2 text-slate-600 border-b border-slate-100">
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
      <div className="space-y-4 p-4">
        {result.url ? (
          <audio controls className="w-full rounded-lg" src={result.url} />
        ) : (
          <p className="text-sm text-slate-500">
            Audio generated. Open NotebookLM to listen.
          </p>
        )}
      </div>
    );
  if (result.type === 'mindmap')
    return (
      <ScrollArea className="max-h-[60vh] p-4">
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
      text: 'Your Personal AI Assistant is online. How can I help you today?',
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

  // --- AUTO SCROLL LOGIC ---
  const scrollToBottom = () => {
    if (scrollRef.current) {
      const scrollContainer = scrollRef.current;
      scrollContainer.scrollTo({
        top: scrollContainer.scrollHeight,
        behavior: 'smooth',
      });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const studioTools: StudioTool[] = [
    {
      name: 'Risk Report',
      endpoint: '/risk-report',
      icon: ShieldCheck,
      color: 'text-amber-500',
      bg: 'bg-amber-50',
      description: 'Deep analysis of legal risks and liabilities.',
      inputLabel: 'Focus area',
      inputPlaceholder: 'e.g. termination clauses...',
    },
    {
      name: 'Data Table',
      endpoint: '/data-table',
      icon: TableIcon,
      color: 'text-indigo-500',
      bg: 'bg-indigo-50',
      description: 'Extract dates, parties, and monetary amounts.',
      inputLabel: 'Entities',
      inputPlaceholder: 'e.g. payment terms...',
    },
    {
      name: 'Audio Brief',
      endpoint: '/audio-overview',
      icon: Headphones,
      color: 'text-purple-500',
      bg: 'bg-purple-50',
      description: 'AI professional summary of the sources.',
      inputLabel: null,
      inputPlaceholder: null,
    },
    {
      name: 'Airtable Sync',
      endpoint: null,
      icon: Database,
      color: 'text-emerald-500',
      bg: 'bg-emerald-50',
      description: 'Sync findings to your external database.',
      inputLabel: null,
      inputPlaceholder: null,
    },
  ];

  const handleSendMessage = async () => {
    if (!input.trim()) return;
    const userMsg: Message = { id: Date.now(), role: 'user', text: input };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);
    try {
      const res = await fetch(`${API_URL}/ask`, {
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
            templates: data.templates ?? []
          },
        ]);
    } catch {
      toast.error('Backend connection failed');
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
      toast.error(e instanceof Error ? e.message : 'Execution failed');
    } finally {
      setToolLoading(null);
      setLaunchTool(null);
    }
  };

  return (
    <div className="flex h-screen w-full bg-[#F8FAFC] font-sans overflow-hidden selection:bg-indigo-100">
      <main className="flex-1 flex flex-col relative max-w-[1600px] mx-auto w-full bg-white border-x border-slate-200/50 shadow-sm overflow-hidden">
        {/* HEADER */}
        <header className="h-16 border-b border-slate-100 flex items-center px-6 justify-between bg-white/80 backdrop-blur-md sticky top-0 z-30 shrink-0">
          <div className="flex items-center gap-4">
            <div className="bg-slate-900 p-2 rounded-lg text-white shadow-lg">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="flex flex-col">
              {/* <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                <span>Studio</span> <ChevronRight className="h-2.5 w-2.5" /> <span className="text-indigo-600">Active Context</span>
              </div> */}
              <h1 className="font-extrabold text-lg tracking-tight text-slate-900 uppercase">
                Legal <span className="text-indigo-600">AI</span>
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3"></div>
        </header>

        {/* CHAT AREA */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] [background-size:20px_20px] scroll-smooth">
          <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
            {messages.map(msg => (
              <div
                key={msg.id}
                className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                <div
                  className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 shadow-sm ${msg.role === 'ai' ? 'bg-slate-900 text-white' : 'bg-indigo-600 text-white'}`}>
                  {msg.role === 'ai' ? (
                    <Bot className="h-5 w-5" />
                  ) : (
                    <User className="h-5 w-5" />
                  )}
                </div>
                <div
                  className={`group relative max-w-[85%] ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
                  <Card
                    className={`p-4 text-sm shadow-sm border-none ring-1 ring-slate-200/60 ${msg.role === 'user'
                        ? 'bg-indigo-50/50 backdrop-blur-sm text-slate-800 rounded-2xl rounded-tr-none'
                        : 'bg-white text-slate-800 rounded-2xl rounded-tl-none border-l-[3px] border-l-indigo-500'
                      }`}>
                    {msg.role === 'ai' ? (
                      <>
                        <MessageText
                          text={msg.text}
                          refs={msg.references ?? []}
                          onCitationOpen={setActiveCitation}
                        />
                        {msg.templates && msg.templates.length > 0 && (
                          <div className="mt-4 pt-4 border-t border-slate-100 space-y-2">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                              Рекомендовані бланки:
                            </p>
                            {msg.templates.map((t, idx) => (
                              <TemplateCard key={idx} template={t} />
                            ))}
                          </div>
                        )}</>
                    ) : (
                      msg.text
                    )}
                  </Card>
                  <span className="text-[9px] font-bold text-slate-400 uppercase mt-1.5 block px-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {msg.role === 'ai' ? 'Assistant' : 'You'}
                  </span>
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex gap-3 items-center pl-1">
                <div className="flex gap-1">
                  <div className="h-1.5 w-1.5 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
                  <div className="h-1.5 w-1.5 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
                  <div className="h-1.5 w-1.5 bg-indigo-500 rounded-full animate-bounce" />
                </div>
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                  Thinking...
                </span>
              </div>
            )}
          </div>
        </div>

        {/* INPUT AREA */}
        <footer className="pt-4 pb-2 bg-white border-t border-slate-100 shrink-0">
          <div className="max-w-4xl mx-auto">
            <div className="relative flex items-end gap-2 bg-slate-50 border border-slate-200/60 p-2 rounded-2xl focus-within:ring-2 focus-within:ring-indigo-500/10 transition-all focus-within:bg-white focus-within:border-indigo-200 shadow-sm">
              <Textarea
                placeholder="Ask your legal assistant..."
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e =>
                  e.key === 'Enter' &&
                  !e.shiftKey &&
                  (e.preventDefault(), handleSendMessage())
                }
                className="bg-transparent border-none focus-visible:ring-0 text-sm min-h-[40px] max-h-[150px] resize-none w-full py-2 px-3 placeholder:text-slate-400 font-medium"
                rows={1}
              />
              <Button
                onClick={handleSendMessage}
                disabled={isLoading || !input.trim()}
                className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl h-10 w-10 shrink-0 shadow-indigo-100 transition-all active:scale-95">
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <SendHorizontal className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="text-[9px] text-center text-slate-400 mt-3 font-medium uppercase tracking-tighter">
              AI can make mistakes. Please verify important legal information.
            </p>
          </div>
        </footer>
      </main>

      {/* LAUNCH DIALOG */}
      <Dialog open={launchDialogOpen} onOpenChange={setLaunchDialogOpen}>
        <DialogContent className="sm:max-w-md bg-white rounded-3xl p-6 border-none shadow-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3 text-slate-900 text-lg font-bold uppercase tracking-tight">
              <div
                className={`${launchTool?.color} ${launchTool?.bg} p-2 rounded-lg`}>
                {launchTool && <launchTool.icon className="h-5 w-5" />}
              </div>
              {launchTool?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="my-4">
            <p className="text-xs text-slate-500 leading-relaxed font-medium mb-4">
              {launchTool?.description}
            </p>
            {launchTool?.inputLabel && (
              <div className="space-y-2">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                  {launchTool.inputLabel}
                </label>
                <Textarea
                  placeholder={launchTool.inputPlaceholder || ''}
                  value={launchInstructions}
                  onChange={e => setLaunchInstructions(e.target.value)}
                  className="bg-slate-50 border-slate-200 rounded-xl text-sm px-4 py-3 min-h-[80px] resize-none focus:ring-indigo-500"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              onClick={handleLaunchConfirm}
              className="bg-slate-900 hover:bg-black h-11 w-full rounded-xl font-bold text-xs tracking-wide text-white transition-all">
              GENERATE ARTIFACT
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* RESULT DIALOG */}
      <Dialog open={resultDialogOpen} onOpenChange={setResultDialogOpen}>
        <DialogContent className="sm:max-w-4xl bg-white rounded-3xl p-6 border-none shadow-2xl">
          <DialogHeader className="flex flex-row items-center justify-between border-b border-slate-100 pb-4 mb-4">
            <DialogTitle className="text-slate-900 font-bold uppercase tracking-tight text-lg">
              <Zap className="inline h-5 w-5 text-indigo-600 mr-2" />{' '}
              {toolResult?.title}
            </DialogTitle>
          </DialogHeader>
          {toolResult && (
            <div className="bg-slate-50 rounded-xl overflow-hidden border border-slate-100">
              <ToolResultBody result={toolResult} />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ─── CITATION DIALOG — ОНОВЛЕНО ──────────────────────────────────────── */}
      <Dialog open={!!activeCitation} onOpenChange={o => !o && setActiveCitation(null)}>
        <DialogContent className="max-w-xl bg-white rounded-3xl p-0 border-none shadow-2xl overflow-hidden">
          {/* Шапка з заголовком і статусом */}
          <div className="bg-slate-900 p-6 text-white">
            <div className="flex items-start gap-4">
              <div className="bg-indigo-500 p-2 rounded-lg shadow-lg shrink-0">
                <BookOpenText className="h-5 w-5 text-white" />
              </div>
              <div className="min-w-0">
                <span className="text-[9px] font-bold text-indigo-300 uppercase tracking-widest block mb-1">
                  Source Reference [{activeCitation?.num}]
                </span>
                <DialogTitle className="font-bold text-base leading-snug break-words">
                  {activeCitation?.source_title}
                </DialogTitle>
                {/* ВИПРАВЛЕНО: використовуємо просто status, як приходить з беку */}
                <StatusBadge status={activeCitation?.status} />
              </div>
            </div>
          </div>

          {/* Текст фрагменту */}
          <ScrollArea className="max-h-[360px] p-8 bg-white text-sm">
            <div className="space-y-6">
              {/* Додаємо перевірку: якщо passages немає, виводимо текст повідомлення або пустий масив */}
              {(activeCitation?.passages && activeCitation.passages.length > 0) ? (
                activeCitation.passages.map((p, i) => (
                  <div key={i} className="relative pl-4 border-l-2 border-indigo-100">
                    <MarkdownPassage text={p} />
                  </div>
                ))
              ) : (
                <p className="text-slate-400 italic">Текст фрагменту недоступний для цього джерела.</p>
              )}
            </div>
          </ScrollArea>

          {activeCitation?.law_url && (
            <div className="px-8 py-5 border-t border-slate-100 bg-slate-50">
              <a
                href={activeCitation.law_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-600 hover:text-indigo-800 transition-colors group">
                <ExternalLink className="h-4 w-4" />
                Відкрити повний текст
              </a>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
