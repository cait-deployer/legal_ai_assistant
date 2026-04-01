'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
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
} from 'lucide-react';

// --- TYPES ---
type Citation = { num: number; source_title: string; passages: string[] };
type Message = { id: number; role: 'ai' | 'user'; text: string; references?: Citation[] };
type MindMapNode = { name?: string; label?: string; children?: MindMapNode[];[key: string]: unknown; };
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

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// --- RENDER HELPERS ---
function MessageText({ text, refs, onCitationOpen }: { text: string; refs: Citation[]; onCitationOpen: (c: Citation) => void }) {
  const lines = text.split('\n');
  const nodes: React.ReactNode[] = [];

  const parseInline = (lineText: string) => {
    const parts = lineText.split(/(\[\d+(?:,\s*\d+)*\])/g);
    return parts.map((part, i) => {
      if (/^\[\d+(?:,\s*\d+)*\]$/.test(part)) {
        const num = part.slice(1, -1);
        const citation = refs.find(r => r.num === Number(num));
        return (
          <button key={i} onClick={() => citation && onCitationOpen(citation)} className="inline-flex items-center justify-center align-top mt-1 mx-0.5 min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-white bg-indigo-600 rounded-md hover:bg-indigo-700 shadow-sm transition-transform active:scale-90 cursor-pointer">
            {num}
          </button>
        );
      }
      return part;
    });
  };

  lines.forEach((line, i) => {
    if (line.startsWith('### ')) nodes.push(<h3 key={i} className="font-bold text-slate-900 mt-4 mb-2 text-lg tracking-tight">{parseInline(line.slice(4))}</h3>);
    else if (/^[\*\-]\s/.test(line)) nodes.push(<div key={i} className="flex gap-2 my-1.5 pl-2"><div className="h-1.5 w-1.5 rounded-full bg-indigo-400 mt-2 shrink-0" /> <span className="text-slate-700 leading-relaxed">{parseInline(line.slice(2))}</span></div>);
    else if (line === '') nodes.push(<div key={i} className="h-3" />);
    else nodes.push(<p key={i} className="my-1.5 leading-relaxed text-slate-700">{parseInline(line)}</p>);
  });
  return <div className="animate-in fade-in slide-in-from-bottom-1 duration-500">{nodes}</div>;
}

// --- TOOL RESULT RENDERERS ---
function MindMapTree({ node, depth = 0 }: { node: MindMapNode; depth?: number }) {
  const label = node.name || node.label || 'Node';
  const children = (node.children as MindMapNode[]) || [];
  return (
    <div className={depth > 0 ? 'ml-5 border-l border-slate-200 pl-3 mt-1' : ''}>
      <div className={`py-1 text-sm font-medium ${depth === 0 ? 'text-indigo-700 font-bold text-base' : 'text-slate-700'}`}>{label}</div>
      {children.map((child, i) => <MindMapTree key={i} node={child} depth={depth + 1} />)}
    </div>
  );
}

function ToolResultBody({ result }: { result: ToolResult }) {
  if (result.type === 'markdown')
    return (
      <ScrollArea className="max-h-[60vh] p-4">
        <pre className="whitespace-pre-wrap font-sans text-sm text-slate-700 leading-relaxed">{result.content}</pre>
      </ScrollArea>
    );
  if (result.type === 'table')
    return (
      <ScrollArea className="max-h-[60vh]">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-slate-100 sticky top-0">
            <tr>{result.headers.map(h => <th key={h} className="text-left px-3 py-2 font-semibold text-slate-700 border-b border-slate-200">{h}</th>)}</tr>
          </thead>
          <tbody>
            {result.rows.map((row, i) => (
              <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                {result.headers.map(h => <td key={h} className="px-3 py-2 text-slate-600 border-b border-slate-100">{row[h] || '—'}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollArea>
    );
  if (result.type === 'audio')
    return (
      <div className="space-y-4 p-4">
        {result.url
          ? <audio controls className="w-full rounded-lg" src={result.url} />
          : <p className="text-sm text-slate-500">Audio generated. Open NotebookLM to listen.</p>
        }
      </div>
    );
  if (result.type === 'mindmap')
    return <ScrollArea className="max-h-[60vh] p-4"><MindMapTree node={result.data} /></ScrollArea>;
  return null;
}

// --- MAIN COMPONENT ---
export default function LawyerDashboard() {
  const [messages, setMessages] = useState<Message[]>([{ id: 1, role: 'ai', text: 'Your Personal AI Assistant is online. How can I help you today?', }]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [toolLoading, setToolLoading] = useState<string | null>(null);
  const [toolResult, setToolResult] = useState<ToolResult | null>(null);
  const [resultDialogOpen, setResultDialogOpen] = useState(false);
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);
  const [launchTool, setLaunchTool] = useState<StudioTool | null>(null);
  const [launchInstructions, setLaunchInstructions] = useState('');
  const [launchDialogOpen, setLaunchDialogOpen] = useState(false);

  const scrollViewportRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollViewportRef.current?.querySelector('[data-slot="scroll-area-viewport"]') as HTMLDivElement | null;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, isLoading]);

  const studioTools: StudioTool[] = [
    { name: 'Risk Report', endpoint: '/risk-report', icon: ShieldCheck, color: 'text-amber-500', bg: 'bg-amber-50', description: 'Deep analysis of legal risks and liabilities.', inputLabel: 'Focus area', inputPlaceholder: 'e.g. termination clauses...' },
    { name: 'Data Table', endpoint: '/data-table', icon: TableIcon, color: 'text-indigo-500', bg: 'bg-indigo-50', description: 'Extract dates, parties, and monetary amounts.', inputLabel: 'Entities', inputPlaceholder: 'e.g. payment terms...' },
    { name: 'Audio Brief', endpoint: '/audio-overview', icon: Headphones, color: 'text-purple-500', bg: 'bg-purple-50', description: 'AI professional summary of the sources.', inputLabel: null, inputPlaceholder: null },
    { name: 'Airtable Sync', endpoint: null, icon: Database, color: 'text-emerald-500', bg: 'bg-emerald-50', description: 'Sync findings to your external database.', inputLabel: null, inputPlaceholder: null },
  ];

  const handleSendMessage = async () => {
    if (!input.trim()) return;
    const userMsg: Message = { id: Date.now(), role: 'user', text: input };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);
    try {
      const res = await fetch(`${API_URL}/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: input }) });
      const data = await res.json();
      if (data.answer) setMessages(prev => [...prev, { id: Date.now() + 1, role: 'ai', text: data.answer, references: data.references ?? [] }]);
    } catch { toast.error('Backend connection failed'); } finally { setIsLoading(false); }
  };

  const handleLaunchConfirm = async () => {
    if (!launchTool) return;
    setLaunchDialogOpen(false);
    setToolLoading(launchTool.name);
    try {
      const res = await fetch(`${API_URL}${launchTool.endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instructions: launchInstructions }) });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setToolResult({ ...data, title: launchTool.name });
      setResultDialogOpen(true);
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Execution failed'); } finally { setToolLoading(null); setLaunchTool(null); }
  };

  return (
    <div className="flex h-screen w-full bg-slate-50/50 font-sans overflow-hidden selection:bg-indigo-100">
      <main className="flex-1 flex flex-col relative container mx-auto w-full bg-white border-x border-slate-200/60 shadow-2xl overflow-hidden">

        {/* HEADER - NO NESTED BUTTONS */}
        <header className="h-20 border-b border-slate-100 flex items-center px-10 justify-between bg-white/70 backdrop-blur-xl sticky top-0 z-30 shrink-0">
          <div className="flex items-center gap-6">
            <div className="bg-slate-900 p-2.5 rounded-xl text-white shadow-xl shadow-slate-900/20">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-[0.2em] mb-1">
                <span>Studio</span> <ChevronRight className="h-3 w-3" /> <span className="text-indigo-600">Active Context</span>
              </div>
              <h1 className="font-black text-xl tracking-tight text-slate-900 uppercase">Legal <span className="text-indigo-600">AI</span></h1>
            </div>
          </div>

          <div className="flex items-center gap-4">

            {/* <Sheet>
              <SheetTrigger className="flex items-center gap-2 bg-slate-900 text-white px-6 py-2.5 rounded-xl text-sm font-bold shadow-lg shadow-slate-900/20 hover:bg-black transition-all active:scale-95 cursor-pointer">
                <Settings2 className="h-4 w-4 text-indigo-400" />
                Studio Tools
              </SheetTrigger>
              <SheetContent side="right" className="w-[400px] bg-white border-l border-slate-100 p-0 shadow-2xl overflow-y-auto">
                <div className="p-8 border-b border-slate-100 bg-slate-50/50">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="bg-indigo-600 p-2 rounded-lg text-white"><Sparkles className="h-5 w-5" /></div>
                    <SheetTitle className="text-slate-900 font-black uppercase tracking-tight text-xl">Studio Panel</SheetTitle>
                  </div>
                  <SheetDescription className="text-slate-500 text-sm italic">Automated workflow tools for document intelligence.</SheetDescription>
                </div>
                <div className="p-8 space-y-4">
                  {studioTools.map((tool, i) => (
                    <button
                      key={i}
                      disabled={!!toolLoading}
                      onClick={() => tool.endpoint ? (setLaunchTool(tool), setLaunchInstructions(''), setLaunchDialogOpen(true)) : toast.info('Airtable Sync Standing By')}
                      className="w-full flex items-center gap-5 p-5 rounded-2xl border border-slate-100 hover:border-indigo-200 hover:bg-indigo-50/30 transition-all group text-left relative overflow-hidden cursor-pointer disabled:opacity-50"
                    >
                      <div className={`${tool.bg} ${tool.color} p-4 rounded-xl group-hover:scale-110 transition-transform duration-300 shadow-sm`}>
                        <tool.icon className="h-6 w-6" />
                      </div>
                      <div className="flex-1">
                        <p className="font-bold text-slate-900 text-[15px]">{tool.name}</p>
                        <p className="text-[10px] text-slate-500 uppercase font-bold tracking-tighter mt-1">{toolLoading === tool.name ? 'Generating...' : 'Launch Artifact'}</p>
                      </div>
                      {toolLoading === tool.name && <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />}
                    </button>
                  ))}
                </div>
                <div className="p-8 mt-auto">
                  <div className="p-6 bg-slate-900 rounded-2xl text-white shadow-xl">
                    <div className="flex items-center gap-3 mb-3">
                      <Database className="h-5 w-5 text-indigo-400" />
                      <p className="font-bold text-sm">Airtable Integration</p>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed italic">Connected to Base: Legal_Operations. Ready to push artifacts from current context.</p>
                  </div>
                </div>
              </SheetContent>
            </Sheet> */}
          </div>
        </header>

        {/* CHAT AREA */}
        <div ref={scrollViewportRef} className="flex-1 overflow-y-auto bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] [background-size:24px_24px]">
          <div className="max-w-4xl mx-auto px-8 py-12 space-y-10">
            {messages.map(msg => (
              <div key={msg.id} className={`flex gap-6 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                <div className={`h-12 w-12 rounded-2xl flex items-center justify-center shrink-0 shadow-xl ${msg.role === 'ai' ? 'bg-slate-900 text-white' : 'bg-indigo-50 text-indigo-600 border border-indigo-100'}`}>
                  {msg.role === 'ai' ? <Bot className="h-6 w-6" /> : <User className="h-6 w-6" />}
                </div>
                <Card className={`p-6 text-[15.5px] leading-relaxed shadow-[0_10px_30px_-15px_rgba(0,0,0,0.1)] border-none ring-1 ring-slate-100 max-w-[85%] ${msg.role === 'user' ? 'bg-slate-100/90 backdrop-blur-sm text-slate-800 rounded-tr-none' : 'bg-white text-slate-800 rounded-tl-none relative border-l-4 border-l-indigo-500'
                  }`}>
                  {msg.role === 'ai' ? <MessageText text={msg.text} refs={msg.references ?? []} onCitationOpen={setActiveCitation} /> : msg.text}
                </Card>
              </div>
            ))}
            {isLoading && (
              <div className="flex gap-4 items-center pl-4 animate-pulse">
                <div className="h-2 w-2 bg-indigo-500 rounded-full animate-bounce" />
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">Processing Legal Logic...</span>
              </div>
            )}
          </div>
        </div>

        {/* INPUT AREA */}
        <footer className="p-10 bg-white border-t border-slate-100 shrink-0 shadow-[0_-20px_40px_-20px_rgba(0,0,0,0.05)]">
          <div className="max-w-5xl mx-auto flex items-end gap-4 bg-slate-50 border border-slate-200/60 p-4 rounded-[28px] focus-within:ring-4 focus-within:ring-indigo-500/5 transition-all focus-within:bg-white focus-within:border-indigo-200 shadow-inner">
            <Textarea
              placeholder="Consult your legal AI studio..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), handleSendMessage())}
              className="bg-transparent border-none focus-visible:ring-0 text-[15.5px] min-h-[48px] max-h-[180px] resize-none w-full scrollbar-hide py-2 px-4 placeholder:text-slate-400 font-medium"
              rows={1}
            />
            <Button onClick={handleSendMessage} disabled={isLoading || !input.trim()} className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl h-14 w-14 shrink-0 shadow-xl shadow-indigo-200 transition-all active:scale-90">
              <SendHorizontal className="h-6 w-6" />
            </Button>
          </div>
        </footer>
      </main>

      {/* --- RE-ENABLED LAUNCH DIALOG --- */}
      <Dialog open={launchDialogOpen} onOpenChange={setLaunchDialogOpen}>
        <DialogContent className="sm:max-w-md bg-white rounded-[32px] p-8 border-none shadow-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3 text-slate-900 text-xl font-black uppercase tracking-tight">
              <div className={`${launchTool?.color} ${launchTool?.bg} p-2.5 rounded-xl`}>
                {launchTool && <launchTool.icon className="h-6 w-6" />}
              </div>
              {launchTool?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="my-6">
            <p className="text-sm text-slate-500 leading-relaxed font-medium">{launchTool?.description}</p>
            <div className="mt-6 space-y-3">
              {launchTool?.inputLabel && (
                <>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">{launchTool.inputLabel}</label>
                  <Textarea
                    placeholder={launchTool.inputPlaceholder || ''}
                    value={launchInstructions}
                    onChange={e => setLaunchInstructions(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && e.ctrlKey && handleLaunchConfirm()}
                    className="bg-slate-50 border-slate-200 rounded-2xl text-sm px-6 py-4 min-h-[100px] resize-none focus:ring-indigo-500"
                    rows={3}
                  />
                </>
              )}
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button onClick={handleLaunchConfirm} className="bg-slate-900 hover:bg-black h-14 w-full rounded-2xl font-bold tracking-wide shadow-xl text-white transition-all">
              GENERATE ARTIFACT
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* RESULT DIALOG */}
      <Dialog open={resultDialogOpen} onOpenChange={setResultDialogOpen}>
        <DialogContent className="sm:max-w-5xl bg-white rounded-[32px] p-8 border-none shadow-3xl overflow-hidden">
          <DialogHeader className="flex flex-row items-center justify-between mb-4">
            <DialogTitle className="text-slate-900 font-black uppercase tracking-tight text-2xl">
              <Zap className="inline h-6 w-6 text-indigo-600 mr-2" /> {toolResult?.title}
            </DialogTitle>
            <Button variant="ghost" size="icon" onClick={() => setResultDialogOpen(false)} className="rounded-full"><X className="h-5 w-5" /></Button>
          </DialogHeader>
          {toolResult && (
            <div className="bg-slate-50 rounded-2xl p-2">
              <ToolResultBody result={toolResult} />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* CITATION DIALOG */}
      <Dialog open={!!activeCitation} onOpenChange={o => !o && setActiveCitation(null)}>
        <DialogContent className="max-w-2xl bg-white rounded-[32px] p-0 border-none shadow-3xl overflow-hidden">
          <div className="bg-slate-800 p-10 flex justify-between items-start text-white relative">
            <div className="flex items-start gap-5 relative z-10">
              <div className="bg-indigo-600 p-3 rounded-2xl shadow-lg shadow-indigo-500/30">
                <BookOpenText className="h-6 w-6 text-white" />
              </div>
              <div>
                <span className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.3em] block mb-2">Reference Source [{activeCitation?.num}]</span>
                <DialogTitle className="font-black text-xl leading-tight tracking-tight">
                  {activeCitation?.source_title}
                </DialogTitle>
              </div>
            </div>
            {/* <button onClick={() => setActiveCitation(null)} className="p-2 hover:bg-white/10 rounded-full transition-colors cursor-pointer">
              <X className="h-5 w-5 text-slate-400" />
            </button> */}
          </div>
          <ScrollArea className="max-h-[450px] p-12 bg-white">
            <div className="space-y-10">
              {activeCitation?.passages.map((p, i) => (
                <div key={i} className="relative group">
                  <div className="absolute -left-6 top-0 text-6xl text-indigo-100 font-serif leading-none select-none opacity-50">&ldquo;</div>
                  <p className="text-slate-700 text-base leading-relaxed relative z-10 pl-2">
                    {p}
                  </p>
                </div>
              ))}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}