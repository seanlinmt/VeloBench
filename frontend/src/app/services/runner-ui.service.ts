import { Injectable, effect, signal } from '@angular/core';

const KEY = 'velobench.runnerdraft';

/**
 * Runner form draft (review F6): the configured test, worker count and label
 * survive navigation (root service) AND full page reloads (sessionStorage
 * mirror) — navigating away and back no longer silently resets to the
 * default shape and 10 workers. Re-running uses an explicitly recorded
 * configuration via the Run-again button, never silent defaults.
 */
@Injectable({ providedIn: 'root' })
export class RunnerUiState {
  testId = signal('');
  workersN = signal(10);
  repeatsN = signal(1);
  label = signal('');

  constructor() {
    this.restore();
    let first = true;
    effect(() => {
      this.testId();
      this.workersN();
      this.repeatsN();
      this.label();
      if (first) { first = false; return; } // the restore() set above fired it
      this.save();
    });
  }

  save(): void {
    try {
      sessionStorage.setItem(KEY, JSON.stringify({
        testId: this.testId(),
        workersN: this.workersN(),
        repeatsN: this.repeatsN(),
        label: this.label(),
      }));
    } catch { /* ignore */ }
  }

  private restore(): void {
    try {
      const raw = sessionStorage.getItem(KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d && d.testId) this.testId.set(String(d.testId));
      if (d && Number.isFinite(Number(d.workersN))) {
        this.workersN.set(Math.max(1, Math.min(64, Number(d.workersN))));
      }
      if (d && Number.isFinite(Number(d.repeatsN))) {
        this.repeatsN.set(Math.max(1, Math.min(10, Number(d.repeatsN))));
      }
      if (d && typeof d.label === 'string') this.label.set(d.label);
    } catch { /* ignore malformed drafts */ }
  }
}
