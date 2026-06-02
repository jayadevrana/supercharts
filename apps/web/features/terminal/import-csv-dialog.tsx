'use client';

import { useEffect, useRef, useState } from 'react';
import { Upload, FileSpreadsheet, Trash2, TriangleAlert, CandlestickChart } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { toast } from '@/components/use-toast';
import { useTerminalStore } from './terminal-store';
import type { Interval } from '@supercharts/types';

interface Dataset {
  id: string;
  name: string;
  symbolId: string;
  interval: string;
  rowCount: number;
  createdAt: number;
}

/**
 * Custom OHLC CSV import (Phase 3 #14). Reads a CSV client-side, posts the text to the server
 * (which parses + stores it and seeds the candle store), then opens the resulting CUSTOM: symbol
 * on the active pane. Also lists / deletes / re-opens previously imported datasets.
 */
export function ImportCsvDialog() {
  const [open, setOpen] = useState(false);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [name, setName] = useState('');
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const panes = useTerminalStore((s) => s.panes);
  const activePaneId = useTerminalStore((s) => s.activePaneId);
  const setPaneSymbol = useTerminalStore((s) => s.setPaneSymbol);
  const setPaneInterval = useTerminalStore((s) => s.setPaneInterval);

  const refresh = async (): Promise<void> => {
    try {
      setDatasets((await api<{ items: Dataset[] }>('/custom/datasets')).items);
    } catch {
      setDatasets([]);
    }
  };

  useEffect(() => {
    if (open) {
      setError(null);
      setWarnings([]);
      void refresh();
    }
  }, [open]);

  const onFile = (f: File | undefined): void => {
    if (!f) return;
    setFileName(f.name);
    if (!name.trim()) setName(f.name.replace(/\.[^.]+$/, ''));
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result ?? ''));
    reader.readAsText(f);
  };

  const openOnChart = (symbolId: string, interval: string): void => {
    const paneId = activePaneId ?? panes[0]?.id;
    if (!paneId) return;
    setPaneInterval(paneId, interval as Interval);
    setPaneSymbol(paneId, symbolId);
  };

  const doImport = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setWarnings([]);
    try {
      // Direct fetch so we can read the server's validation message + warnings on a non-2xx.
      const res = await fetch('/api/custom/datasets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: name.trim(), csv }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        symbolId?: string;
        interval?: string;
        rowCount?: number;
        name?: string;
        warnings?: string[];
        message?: string;
      };
      if (!res.ok) {
        setError(body.message ?? `Import failed (${res.status}).`);
        setWarnings(body.warnings ?? []);
        return;
      }
      toast({
        title: 'Dataset imported',
        description: `${body.name} · ${body.rowCount} bars · ${body.interval}`,
        tone: 'success',
      });
      await refresh();
      if (body.symbolId && body.interval) openOnChart(body.symbolId, body.interval);
      setCsv('');
      setFileName('');
      setName('');
      setOpen(false);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async (id: string): Promise<void> => {
    try {
      await api(`/custom/datasets/${id}`, { method: 'DELETE' });
      await refresh();
    } catch {
      /* ignore */
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1 text-muted-foreground hover:text-foreground"
          title="Import custom OHLC data from a CSV file"
        >
          <Upload className="h-3.5 w-3.5" /> Import
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <FileSpreadsheet className="h-4 w-4 text-accent" /> Import CSV data
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Upload your own OHLC candles. Columns are auto-detected (time, open, high, low, close, and
            optional volume); timestamps may be UNIX seconds/ms or dates. It charts as a{' '}
            <span className="text-foreground">CUSTOM:</span> symbol.
          </p>

          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt,text/csv"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          <Button variant="outline" size="sm" className="gap-1.5 truncate" onClick={() => fileRef.current?.click()}>
            <Upload className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{fileName || 'Choose a CSV file'}</span>
          </Button>

          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Name</span>
            <Input placeholder="My dataset" value={name} onChange={(e) => setName(e.target.value)} />
          </label>

          {error ? (
            <div className="flex items-start gap-1.5 rounded-md border border-bear/40 bg-bear/10 p-2 text-[11px] text-bear">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span>{error}</span>
            </div>
          ) : null}
          {warnings.length > 0 ? (
            <div className="rounded-md border border-warn/40 bg-warn/10 p-2 text-[11px] text-warn">
              {warnings.map((w, i) => (
                <div key={i}>{w}</div>
              ))}
            </div>
          ) : null}

          <Button size="sm" loading={busy} disabled={!csv || !name.trim()} onClick={() => void doImport()}>
            Import &amp; chart
          </Button>

          {datasets.length > 0 ? (
            <div className="mt-1 flex flex-col gap-1 border-t border-border/60 pt-2">
              <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Your datasets</span>
              {datasets.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 hover:bg-surface-raised"
                >
                  <button
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                    onClick={() => {
                      openOnChart(d.symbolId, d.interval);
                      setOpen(false);
                    }}
                  >
                    <CandlestickChart className="h-3.5 w-3.5 shrink-0 text-accent" />
                    <span className="truncate text-xs text-foreground">{d.name}</span>
                    <Badge tone="muted" className="text-[9px]">
                      {d.interval}
                    </Badge>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{d.rowCount} bars</span>
                  </button>
                  <button
                    className="shrink-0 text-muted-foreground hover:text-bear"
                    title="Delete dataset"
                    onClick={() => void doDelete(d.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
