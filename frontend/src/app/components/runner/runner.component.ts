import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { SettingsService } from '../../services/settings.service';
import { RunnerUiState } from '../../services/runner-ui.service';

/** Mirror of the Rust ConcRun/WorkerSnap snapshots. */
export interface WorkerSnap {
  idx: number;
  state: string;
  est_tokens: number;
  tok_s: number;
  ttft_ms: number | null;
  completion_tokens: number;
  final_tok_s: number | null;
  error: string | null;
  /** Result-assertion verdict (review M1); null = no assertion set. */
  assert_pass: boolean | null;
}

export interface ConcRun {
  id: string;
  label: string;
  provider_name: string;
  model: string;
  fill_tokens: number;
  tg: number;
  workers: number;
  repeats?: number;
  session: string;
  started_at: string;
  finished: boolean;
  test_id: string;
  test_title: string;
  error: string;
  step: number;
  steps: number;
  step_title: string;
  snaps: WorkerSnap[];
}

@Component({
  selector: 'app-runner',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './runner.component.html',
  styleUrl: './runner.component.css',
})
export class RunnerComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  readonly ss = inject(SettingsService);
  private readonly router = inject(Router);
  private readonly ui = inject(RunnerUiState);

  readonly runs = signal<ConcRun[]>([]);
  readonly tests = signal<any[]>([]);
  /** Draft config persists across navigation/reload (review F6). */
  readonly testId = this.ui.testId;
  readonly workersN = this.ui.workersN;
  readonly repeatsN = this.ui.repeatsN;
  readonly label = this.ui.label;
  readonly starting = signal(false);
  readonly error = signal('');

  readonly anyRunning = computed(() => this.runs().some((r) => !r.finished));
  readonly runTests = computed(() => this.tests().filter((t) => t.steps.some((s: any) => s.type !== 'section')));

  private timer: ReturnType<typeof setInterval> | null = null;

  async ngOnInit(): Promise<void> {
    await this.refresh();
    try {
      const tests = await this.api.getTests();
      this.tests.set(Array.isArray(tests) ? tests : []);
      // Default to the quick shape check — only when the draft is empty.
      if (!this.testId()) {
        const pref = this.tests().find((t) => t.id === 'prebuilt-shape-quick')
          || this.tests().find((t) => t.prebuilt && t.steps.some((s: any) => s.type === 'bench'))
          || this.tests()[0];
        if (pref) this.testId.set(pref.id);
      }
    } catch { /* ignore — selector just stays empty */ }
    // Poll continuously; cheap even when idle (one small JSON per second).
    this.timer = setInterval(() => void this.refresh(), 1000);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async refresh(): Promise<void> {
    try {
      const list = await this.api.listConcurrent();
      this.runs.set(Array.isArray(list) ? list : []);
    } catch {
      /* server restarting — keep the last snapshot */
    }
  }

  async start(): Promise<void> {
    const p = this.ss.activeProvider();
    const m = this.ss.activeModel();
    if (!p || !m) {
      this.error.set('Pick a provider + model first (top bar).');
      return;
    }
    this.error.set('');
    this.starting.set(true);
    try {
      await this.api.startConcurrent({
        provider_id: p.id,
        model: m.id,
        model_uid: m.uid || '',
        fill_tokens: 0,
        tg: 128,
        workers: Math.max(1, this.workersN() || 1),
        repeats: Math.max(1, Math.min(10, this.repeatsN() || 1)),
        label: this.label().trim() || undefined,
        test_id: this.testId() || undefined,
      });
      await this.refresh();
    } catch (e: any) {
      this.error.set(String(e?.message || e));
    } finally {
      this.starting.set(false);
    }
  }

  async stop(id: string): Promise<void> {
    try {
      await this.api.stopConcurrent(id);
      await this.refresh();
    } catch {
      /* ignore */
    }
  }

  openReport(session: string): void {
    void this.router.navigate(['/analytics', session]);
  }

  /** Re-run with an explicitly recorded configuration (review F6): the form
   *  fills from the run card, never from silent defaults. */
  runAgain(r: ConcRun): void {
    this.testId.set(r.test_id || '');
    this.workersN.set(r.workers);
    this.repeatsN.set(r.repeats || 1);
    this.label.set(r.label || '');
    this.error.set('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Aggregate strip values for one run.
  runningCount(r: ConcRun): number {
    return r.snaps.filter((w) => w.state === 'streaming').length;
  }
  doneCount(r: ConcRun): number {
    return r.snaps.filter((w) => w.state === 'done').length;
  }
  /** A settled rate is only meaningful with a real inter-token stream: a
   *  1-token answer has no interval to measure, so it shows as insufficient
   *  instead of an absurd tok/s figure. */
  rateOf(w: WorkerSnap): number | null {
    if (this.maxTok(w) < 2) return null;
    const settled = w.state === 'done' || w.state === 'stopped';
    const rate = settled ? (w.final_tok_s ?? 0) : (w.tok_s || 0);
    return rate > 0 ? rate : null;
  }
  sumTokS(r: ConcRun): number {
    let sum = 0;
    let n = 0;
    for (const w of r.snaps) {
      const rate = this.rateOf(w);
      if (rate != null) { sum += rate; n++; }
    }
    return n ? sum : 0;
  }
  hasRates(r: ConcRun): boolean {
    return r.snaps.some((w) => this.rateOf(w) != null);
  }
  sumTokens(r: ConcRun): number {
    return r.snaps.reduce((acc, w) => acc + Math.max(w.completion_tokens || 0, Math.round(w.est_tokens || 0)), 0);
  }
  maxTok(w: WorkerSnap): number {
    return Math.max(w.completion_tokens || 0, Math.round(w.est_tokens || 0));
  }
  testTitle(id: string): string {
    return this.tests().find((t) => t.id === id)?.title || id;
  }

  testDesc(id: string): string {
    return this.tests().find((t) => t.id === id)?.description || '';
  }

  fmtN(n: number): string {
    return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(n < 10 ? 1 : 0);
  }
  stateClass(s: string): string {
    return `st-${s}`;
  }
}
