import { Injectable, signal } from '@angular/core';

/**
 * UI state of the Sessions index (review U3): filters, search, page position.
 * Held in a root service so returning from a report restores the exact view
 * (SPA navigation keeps the service alive) — the list itself is always
 * re-fetched fresh.
 */
@Injectable({ providedIn: 'root' })
export class SessionsUiState {
  viewTab = signal<'sessions' | 'categories'>('sessions');
  /** Free-text search across session id, name, model, provider and label. */
  search = signal('');
  filterKinds = signal<Set<string>>(new Set());
  filterRegimes = signal<Set<string>>(new Set());
  filterModels = signal<Set<string>>(new Set());
  filterProviders = signal<Set<string>>(new Set());
  filterCats = signal<Set<string>>(new Set());
  filterAi = signal<'all' | 'ai' | 'no'>('all');
  page = signal(1);
  pageSize = signal(20);
}
