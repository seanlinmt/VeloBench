import { Injectable, effect, signal } from '@angular/core';
import type { TestDef } from '../types';

const KEY = 'velobench.testdraft';

/**
 * Holds the UNSAVED test-constructor draft (review F4): navigating away
 * (Sessions, a report, anywhere — SPA clicks) no longer discards edits, and
 * even a full page reload restores the draft (mirrored in sessionStorage,
 * which is tab-scoped — a draft belongs to its tab). The draft survives
 * until saved, explicitly discarded, or replaced by a different test. Both
 * editor modes (UI + JSON) share this one state.
 */
@Injectable({ providedIn: 'root' })
export class TestDraftService {
  editing = signal<TestDef | null>(null);
  editMode = signal<'ui' | 'json'>('ui');
  /** JSON-mode editor text: part of the draft when in JSON mode. */
  jsonText = signal('');
  /** The test list is also held here so re-entry keeps the view. */
  tests = signal<TestDef[]>([]);
  filterKind = signal<'all' | 'built-in' | 'mine'>('all');

  constructor() {
    this.restore();
    // Mirror every draft change to sessionStorage (best-effort), so a reload
    // or tab close keeps the unsaved work.
    let first = true;
    effect(() => {
      // Read all three so the effect tracks them.
      const e = this.editing();
      const m = this.editMode();
      const j = this.jsonText();
      if (first) { first = false; return; } // the restore() set above fired it
      this.save();
    });
  }

  save(): void {
    try {
      const e = this.editing();
      if (!e) {
        sessionStorage.removeItem(KEY);
        return;
      }
      sessionStorage.setItem(KEY, JSON.stringify({
        editing: e,
        editMode: this.editMode(),
        jsonText: this.jsonText(),
      }));
    } catch { /* quota/private mode — the in-memory draft still works */ }
  }

  private restore(): void {
    try {
      const raw = sessionStorage.getItem(KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d && d.editing) {
        this.editing.set(d.editing);
        this.editMode.set(d.editMode === 'json' ? 'json' : 'ui');
        this.jsonText.set(String(d.jsonText ?? ''));
      }
    } catch { /* ignore malformed drafts */ }
  }

  /** Discard the draft (explicit Discard, Save, or replaced). */
  clear(): void {
    this.editing.set(null);
    this.save();
  }
}
