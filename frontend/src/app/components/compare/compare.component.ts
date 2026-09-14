import { Component, ElementRef, OnInit, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { ChartsService } from '../../services/charts.service';
import { SideStats, sideStats } from '../../services/compare';
import { specDepthDomain } from '../../services/latency-clusters';
import { SessionAnalysisDetail } from '../../types';

interface Row {
  metric: string;
  unit: string;
  a: number;
  b: number;
  aS: string;
  bS: string;
  d: string;
  pct: string;
  fmt: (v: number) => string;
  /** null = neutral; true = B better; false = B worse */
  good: boolean | null;
}

@Component({
  selector: 'app-compare',
  standalone: true,
  templateUrl: './compare.component.html',
  styleUrl: './compare.component.css',
})
export class CompareComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly charts = inject(ChartsService);

  private readonly page = viewChild<ElementRef<HTMLElement>>('page');
  private histA = viewChild<ElementRef<HTMLCanvasElement>>('histA');
  private histB = viewChild<ElementRef<HTMLCanvasElement>>('histB');
  private accCanvasA = viewChild<ElementRef<HTMLCanvasElement>>('accA');
  private accCanvasB = viewChild<ElementRef<HTMLCanvasElement>>('accB');
  private sdA = viewChild<ElementRef<HTMLCanvasElement>>('sdA');
  private sdB = viewChild<ElementRef<HTMLCanvasElement>>('sdB');
  private barsCanvas = viewChild<ElementRef<HTMLCanvasElement>>('bars');

  readonly a = signal<SideStats | null>(null);
  readonly b = signal<SideStats | null>(null);
  readonly titleA = signal('');
  readonly titleB = signal('');
  /** Overall verdict per side from the decided metric count: win | lose | null (tie). */
  readonly verdictA = signal<'win' | 'lose' | null>(null);
  readonly verdictB = signal<'win' | 'lose' | null>(null);
  readonly winsA = signal(0);
  readonly winsB = signal(0);
  readonly decided = signal(0);
  readonly subA = signal('');
  readonly subB = signal('');
  readonly catA = signal('');
  readonly catB = signal('');
  readonly modelA = signal('');
  readonly modelB = signal('');
  readonly kind = signal('');
  readonly error = signal('');
  readonly capturing = signal(false);

  readonly rows = signal<Row[]>([]);
  readonly sectionRows = signal<Array<{ name: string; a: number; b: number; pct: string; turns: number }>>([]);

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id') || '';
    void this.load(id);
  }

  private async load(id: string): Promise<void> {
    try {
      const comps = await this.api.listComparisons();
      const c = (comps || []).find((x: any) => x.id === id);
      if (!c) {
        this.error.set('Comparison not found.');
        return;
      }
      this.kind.set(c.kind);
      const [da, db] = await Promise.all([
        this.api.getAnalysis(String(c.a)),
        this.api.getAnalysis(String(c.b)),
      ]);
      const A = da as SessionAnalysisDetail;
      const B = db as SessionAnalysisDetail;
      const meta = await this.api.sessionMeta();
      type MetaRow = { name?: string | null; category?: string | null };
      const metaOf = (sid: string): MetaRow =>
        (meta as Record<string, MetaRow>)[sid] || {};
      const titleOf = (sid: string, d: SessionAnalysisDetail): string => {
        const m = metaOf(sid);
        if (m && (m.name || m.category)) return String(m.name || m.category);
        // Fall back to the run label + model, like the Sessions list.
        const t0: any = d.turns && d.turns[0];
        return t0 ? `${t0.label || 'chat'} — ${t0.model || ''}`.trim() : sid.slice(0, 8);
      };
      const catOf = (sid: string, d: SessionAnalysisDetail): string => {
        const m = metaOf(sid);
        const c = m && m.category ? String(m.category).trim() : '';
        if (c) return c;
        const t0: any = d.turns && d.turns[0];
        return t0 && t0.label ? String(t0.label) : 'session';
      };
      const modelOf = (d: SessionAnalysisDetail): string => {
        const t0: any = d.turns && d.turns[0];
        if (!t0) return '';
        return `${t0.provider || ''} · ${t0.model || ''}`.replace(/^· | ·$/g, '').trim();
      };
      this.titleA.set(titleOf(String(c.a), A));
      this.titleB.set(titleOf(String(c.b), B));
      this.catA.set(catOf(String(c.a), A));
      this.catB.set(catOf(String(c.b), B));
      this.modelA.set(modelOf(A));
      this.modelB.set(modelOf(B));
      const subOf = (d: SessionAnalysisDetail): string => {
        const t0: any = d.turns && d.turns[0];
        return t0 ? `${d.turns.length} turn${d.turns.length === 1 ? '' : 's'}` : '';
      };
      this.subA.set(subOf(A));
      this.subB.set(subOf(B));
      this.a.set(sideStats(String(c.a), this.titleA(), A.turns || [], A.created_at));
      this.b.set(sideStats(String(c.b), this.titleB(), B.turns || [], B.created_at));
      this.buildCompat(A.turns || [], B.turns || []);
      this.buildRows();
      setTimeout(() => this.drawCharts());
    } catch (e: any) {
      this.error.set(String(e?.message || e));
    }
  }

  /** Compatibility notes (review M3): matching names alone do not make two
   *  sessions comparable. Facts first — differences that undermine the
   *  comparison warn; expected differences (the model under test) inform. */
  readonly compat = signal<Array<{ level: 'warn' | 'info'; text: string }>>([]);

  private buildCompat(at: any[], bt: any[]): void {
    const out: Array<{ level: 'warn' | 'info'; text: string }> = [];
    if (!at.length || !bt.length) return;
    const pick = (arr: any[], f: (t: any) => any) => [...new Set(arr.map(f).filter((v) => v != null && v !== ''))];
    const workersOf = (arr: any[]) => new Set(arr.map((t) => String(t.section || '')).filter((x) => /^worker \d+$/.test(x))).size;
    const awc = workersOf(at);
    const bwc = workersOf(bt);
    const aModels = pick(at, (t) => t.model);
    const bModels = pick(bt, (t) => t.model);
    const aTests = pick(at, (t) => String(t.label || '').split(' · ')[0]);
    const bTests = pick(bt, (t) => String(t.label || '').split(' · ')[0]);
    // workload identity
    if (aTests.join(',') !== bTests.join(',')) {
      out.push({ level: 'warn', text: `Different workload${aTests.length || bTests.length ? `: ${aTests.join(' + ') || '—'} vs ${bTests.join(' + ') || '—'}` : ''} — throughput/latency deltas may reflect the prompts, not the systems.` });
    }
    // worker count
    if ((awc > 0 || bwc > 0) && awc !== bwc) {
      out.push({ level: 'warn', text: `Different concurrency: ${awc || 'single'} vs ${bwc || 'single'} worker(s) — aggregate figures are not comparable across worker counts.` });
    }
    // model under test
    if (aModels.join(',') !== bModels.join(',')) {
      out.push({ level: 'info', text: `Different model${aModels.length > 1 || bModels.length > 1 ? 's' : ''}: ${aModels.join(', ') || '—'} vs ${bModels.join(', ') || '—'} (expected for model comparisons).` });
    }
    // per-step budgets on shared step labels
    const budgetOf = (arr: any[]) => {
      const m = new Map<string, number>();
      for (const t of arr) {
        const key = String(t.label || '');
        if (key && t.genBudget != null && !m.has(key)) m.set(key, t.genBudget);
      }
      return m;
    };
    const ab = budgetOf(at);
    const bb = budgetOf(bt);
    const budgetDiffs: string[] = [];
    for (const [k, v] of ab) {
      if (bb.has(k) && bb.get(k) !== v) budgetDiffs.push(`"${k.slice(-24)}" ${v} vs ${bb.get(k)} tok`);
    }
    if (budgetDiffs.length) {
      out.push({ level: 'warn', text: `Different generation budgets on shared steps — ${budgetDiffs.slice(0, 3).join('; ')}${budgetDiffs.length > 3 ? ' …' : ''}.` });
    }
    // tokenizer source
    const ats = pick(at, (t) => t.tokenSource);
    const bts = pick(bt, (t) => t.tokenSource);
    if (ats.join(',') !== bts.join(',')) {
      out.push({ level: 'info', text: `Token counting differs: ${ats.join(', ') || 'estimated'} vs ${bts.join(', ') || 'estimated'} — token-derived metrics carry that uncertainty.` });
    }
    this.compat.set(out);
  }

  fmtRate(v: number): string {
    return v >= 100 ? v.toFixed(0) : v.toFixed(1);
  }
  fmtMs(v: number): string {
    return v >= 10000 ? (v / 1000).toFixed(1) + ' s' : v.toFixed(0) + ' ms';
  }

  private buildRows(): void {
    const A = this.a(), B = this.b();
    if (!A || !B) return;
    const row = (metric: string, unit: string, av: number, bv: number, fmt: (v: number) => string, higherBetter: boolean | null): Row => {
      const d = bv - av;
      const pct = av != 0 ? (d / Math.abs(av)) * 100 : 0;
      return {
        metric,
        unit,
        a: av,
        b: bv,
        aS: fmt(av),
        bS: fmt(bv),
        // Delta = B − A with its sign retained (review A4): decreases must
        // render with a minus, increases with a plus. Rounding only for
        // display; direction-of-improvement is a separate field (good).
        d: (d >= 0 ? '+' : '-') + fmt(Math.abs(d)),
        pct: (pct >= 0 ? '+' : '-') + Math.abs(pct).toFixed(1) + '%',
        fmt,
        good: higherBetter === null ? null : Math.abs(d) < 1e-9 ? null : higherBetter ? d > 0 : d < 0,
      };
    };
    const rows: Row[] = [
      row('decode tok/s · median', 'tok/s', A.rateMedian, B.rateMedian, (v) => this.fmtRate(v), true),
      row('decode tok/s · mean', 'tok/s', A.rateAvg, B.rateAvg, (v) => this.fmtRate(v), true),
      row('decode tok/s · p95', 'tok/s', A.rateP95, B.rateP95, (v) => this.fmtRate(v), true),
      row('decode tok/s · min', 'tok/s', A.rateMin, B.rateMin, (v) => this.fmtRate(v), true),
      row('decode tok/s · max', 'tok/s', A.rateMax, B.rateMax, (v) => this.fmtRate(v), true),
      row('TTFT · median', 'ms', A.ttftMedian, B.ttftMedian, (v) => this.fmtMs(v), false),
      row('TTFT · p90', 'ms', A.ttftP90, B.ttftP90, (v) => this.fmtMs(v), false),
      row('completion tokens', 'tok', A.totalTokens, B.totalTokens, (v) => v.toFixed(0), true),
      row('duration (Σ turns)', 'ms', A.totalMs, B.totalMs, (v) => this.fmtMs(v), false),
      row('turns', 'n', A.turns, B.turns, (v) => v.toFixed(0), null),
    ];
    if (A.alphaServer != null && B.alphaServer != null) {
      rows.push(row('acceptance α (server)', '%', A.alphaServer * 100, B.alphaServer * 100, (v) => v.toFixed(1), true));
    }
    if (A.specDepth != null && B.specDepth != null) {
      rows.push(row('speculation depth', 'tok/turn', A.specDepth, B.specDepth, (v) => v.toFixed(2), true));
    }
    this.rows.set(rows);

    const srows: Array<{ name: string; a: number; b: number; pct: string; turns: number }> = [];
    for (const [name, sa] of A.sections) {
      const sb = B.sections.get(name);
      if (!sb) continue;
      const pct = sa.rateMedian != 0 ? ((sb.rateMedian - sa.rateMedian) / Math.abs(sa.rateMedian)) * 100 : 0;
      srows.push({
        name,
        a: sa.rateMedian,
        b: sb.rateMedian,
        pct: (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%',
        turns: Math.min(sa.turns, sb.turns),
      });
    }
    srows.sort((x, y) => x.name.localeCompare(y.name));
    this.sectionRows.set(srows);

    // Overall verdict: who wins more of the decided metrics.
    const winsA = rows.filter((r) => r.good === false).length;
    const winsB = rows.filter((r) => r.good === true).length;
    const decided = winsA + winsB;
    this.winsA.set(winsA);
    this.winsB.set(winsB);
    this.decided.set(decided);
    this.verdictA.set(winsA === winsB ? null : winsA > winsB ? 'win' : 'lose');
    this.verdictB.set(winsA === winsB ? null : winsB > winsA ? 'win' : 'lose');
  }

  private drawCharts(): void {
    const A = this.a(), B = this.b();
    if (!A || !B) return;

    // Paired horizontal bars for the metric table, one row per metric.
    if (this.barsCanvas()) {
      const rows = this.rows()
        .filter((r) => r.good !== null)
        .map((r) => ({ label: r.metric, a: r.a, b: r.b, fmt: r.fmt, good: r.good }));
      const el = this.barsCanvas()!.nativeElement;
      el.style.height = `${20 + rows.length * 34}px`;
      this.charts.drawMetricBars(el, rows, { labelA: this.titleA(), labelB: this.titleB() });
    }

    // Verdict colors per distribution pair: the side with the higher median
    // gets the winner green, the other the loser red. On an exact tie the
    // green/red pairing still applies by convention (A green, B red).
    const pairColor = (side: 'A' | 'B', win: 'A' | 'B' | null): string =>
      win === 'B' ? (side === 'A' ? '#ff8a96' : '#57d9a3') : side === 'A' ? '#57d9a3' : '#ff8a96';
    const rateWin: 'A' | 'B' | null =
      A.rateMedian === B.rateMedian ? null : A.rateMedian > B.rateMedian ? 'A' : 'B';

    // Two parallel decode-speed distributions — the SAME data points and the
    // SAME chart call as each session's analytics report (drawHistogram,
    // bin width 2, overall scale, p50/p90 markers), sharing one X scale
    // (union p99 cap) so the shapes compare directly.
    if (this.histA() && this.histB()) {
      const all = [...A.rates, ...B.rates].filter((v) => v > 0).sort((a, b) => a - b);
      const p = (arr: number[], q: number): number | undefined =>
        arr.length ? arr[Math.min(arr.length - 1, Math.floor(q * arr.length))] : undefined;
      const cap = p(all, 0.99);
      const draw = (cv: ElementRef<HTMLCanvasElement> | undefined, side: 'A' | 'B', vals: number[]) => {
        if (!cv) return;
        const s = [...vals].filter((v) => v > 0).sort((a, b) => a - b);
        this.charts.drawHistogram(cv.nativeElement, vals, {
          color: pairColor(side, rateWin),
          binWidth: 2,
          maxBins: 200,
          max: cap,
          overall: true,
          markers: [
            ...(p(s, 0.5) != null ? [{ v: p(s, 0.5)!, label: 'p50' }] : []),
            ...(p(s, 0.9) != null ? [{ v: p(s, 0.9)!, label: 'p90' }] : []),
          ],
          emptyLabel: 'not enough decode samples',
        });
      };
      draw(this.histA(), 'A', A.rates);
      draw(this.histB(), 'B', B.rates);
    }

    // Two parallel speculation-depth distributions — the SAME specDepthSeries
    // data and the SAME chart call as the analytics reports (category bars
    // over accepted-run lengths; the pair shares one data-derived domain so
    // both charts stay directly comparable).
    if (this.sdA() && this.sdB()) {
      const sdWin: 'A' | 'B' | null =
        !A.specDist.length || !B.specDist.length || A.specDepth === B.specDepth
          ? null
          : (A.specDepth ?? 0) > (B.specDepth ?? 0) ? 'A' : 'B';
      const sdDomain = specDepthDomain(A.specDist, B.specDist);
      this.charts.drawCategoryBars(this.sdA()!.nativeElement, A.specDist, {
        color: pairColor('A', sdWin),
        domain: sdDomain,
        emptyLabel: 'no speculation data (est. from gap runs)',
      });
      this.charts.drawCategoryBars(this.sdB()!.nativeElement, B.specDist, {
        color: pairColor('B', sdWin),
        domain: sdDomain,
        emptyLabel: 'no speculation data (est. from gap runs)',
      });
    }

    // Two parallel acceptance-rate estimates, both normalized to 0..100% of
    // their run and drawn on the identical axes; winner = higher mean α̂.
    if (this.accCanvasA() && this.accCanvasB()) {
      const has = A.accLine.length > 1 && B.accLine.length > 1;
      const meanAlpha = (L: Array<{ t: number; rate: number }>): number =>
        L.length ? L.reduce((a, p) => a + p.rate, 0) / L.length : -1;
      const accWin: 'A' | 'B' | null =
        !has || Math.abs(meanAlpha(A.accLine) - meanAlpha(B.accLine)) < 1e-9
          ? null
          : meanAlpha(A.accLine) > meanAlpha(B.accLine) ? 'A' : 'B';
      const drawAcc = (cv: ElementRef<HTMLCanvasElement> | undefined, side: 'A' | 'B', line: Array<{ t: number; rate: number }>) => {
        if (!cv) return;
        this.charts.drawRateLine(cv.nativeElement, line, {
          color: pairColor(side, accWin),
          xPct: true,
          yDomain: [0, 100],
          emptyLabel: has ? undefined : 'acceptance estimate unavailable',
        });
      };
      drawAcc(this.accCanvasA(), 'A', A.accLine);
      drawAcc(this.accCanvasB(), 'B', B.accLine);
    }
  }

  back(): void {
    void this.router.navigate(['/comparisons']);
  }

  async exportPNG(): Promise<void> {
    await this.capturePage((page, name) => this.charts.exportPNG(page, name));
  }

  async exportPDF(): Promise<void> {
    await this.capturePage((page, name) => this.charts.exportPDF(page, name));
  }

  /** Expand the scroll container to full content height, rasterise, restore. */
  private async capturePage(draw: (page: HTMLElement, name: string) => Promise<void>): Promise<void> {
    const page = this.page()?.nativeElement;
    if (!page || this.capturing()) return;
    this.capturing.set(true);
    const prevHeight = page.style.height;
    const prevOverflow = page.style.overflow;
    try {
      page.style.height = page.scrollHeight + 'px';
      page.style.overflow = 'visible';
      // Let Angular/CD flush the expanded layout before rasterising.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const id = this.route.snapshot.paramMap.get('id') || 'compare';
      await draw(page, `velobench-compare-${id.slice(0, 8)}`);
    } finally {
      page.style.height = prevHeight;
      page.style.overflow = prevOverflow;
      this.capturing.set(false);
    }
  }
}
