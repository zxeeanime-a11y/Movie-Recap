import { Bell, Globe, Menu, Search, UserCheck, X } from 'lucide-react';
import { useState } from 'react';
import type { ProcessingJobRecord, ProjectRecord, UserProfile } from '../types/studio';
import type { UILang } from '../utils/i18n';
import { UI_COPY } from '../utils/i18n';

export interface OpenTab {
  projectId: string;
  name: string;
  module: ProjectRecord['module'];
}

interface TopBarProps {
  openTabs: OpenTab[];
  activeProjectId: string | null;
  onSelectTab: (projectId: string) => void;
  onCloseTab: (projectId: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  autosaveStatus: 'idle' | 'saving' | 'saved' | 'offline';
  activeJobs: ProcessingJobRecord[];
  notifications: string[];
  onClearNotifications: () => void;
  lang: UILang;
  onToggleLang: () => void;
  user: UserProfile | null;
  onOpenAuthModal: () => void;
  onOpenMobileMenu: () => void;
}

export function TopBar({
  openTabs,
  activeProjectId,
  onSelectTab,
  onCloseTab,
  searchQuery,
  onSearchChange,
  autosaveStatus,
  activeJobs,
  notifications,
  onClearNotifications,
  lang,
  onToggleLang,
  user,
  onOpenAuthModal,
  onOpenMobileMenu,
}: TopBarProps) {
  const [notifOpen, setNotifOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const t = UI_COPY[lang];
  const runningJobsCount = activeJobs.filter((j) =>
    ['Queued', 'Preparing', 'Processing', 'Rendering'].includes(j.status)
  ).length;

  return (
    <header className="flex flex-col border-b border-white/[0.08] bg-[#11141C]">
      <div className="flex h-12 md:h-14 items-center justify-between gap-1.5 sm:gap-4 px-2.5 sm:px-4">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-3">
          <button
            type="button"
            onClick={onOpenMobileMenu}
            aria-label="Open navigation menu"
            className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-slate-300 hover:bg-white/5 hover:text-white lg:hidden shrink-0"
          >
            <Menu className="h-5 w-5" />
          </button>

          <span className="font-display text-xs font-bold tracking-wide text-white whitespace-nowrap shrink-0 sm:hidden">
            RECAP STUDIO
          </span>

          <button
            type="button"
            onClick={() => setMobileSearchOpen((v) => !v)}
            aria-label="Toggle mobile search"
            aria-expanded={mobileSearchOpen}
            className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-slate-300 hover:bg-white/5 hover:text-white sm:hidden shrink-0"
          >
            <Search className="h-4 w-4" />
          </button>

          <div className="relative hidden sm:block w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={t.searchPlaceholder}
              aria-label="Global search"
              className="w-full rounded-lg border border-white/[0.08] bg-[#0B0D12] py-1.5 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-[#8B5CF6] focus:outline-none"
            />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:gap-3">
          <span className="hidden md:inline-block text-xs text-slate-400 whitespace-nowrap">
            {autosaveStatus === 'saving'
              ? t.autosaveSaving
              : autosaveStatus === 'offline'
                ? t.autosaveOffline
                : t.autosaveSaved}
          </span>

          {runningJobsCount > 0 && (
            <span className="hidden sm:inline-block text-xs font-medium text-[#3B82F6] whitespace-nowrap tabular-nums">
              {runningJobsCount} active
            </span>
          )}

          <button
            type="button"
            onClick={onToggleLang}
            aria-label="Switch language between English and Myanmar"
            className="inline-flex h-9 items-center gap-1 rounded-lg border border-white/[0.08] bg-[#171B26] px-2 sm:px-2.5 text-xs font-medium text-slate-200 hover:border-white/20 whitespace-nowrap shrink-0"
          >
            <Globe className="h-3.5 w-3.5 text-[#8B5CF6]" />
            <span className="hidden sm:inline">{lang === 'en' ? 'EN / MY' : 'MY / EN'}</span>
            <span className="sm:hidden">{lang === 'en' ? 'EN' : 'MY'}</span>
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setNotifOpen((v) => !v)}
              aria-label="Toggle job notifications"
              className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.08] bg-[#171B26] text-slate-300 hover:border-white/20 hover:text-white"
            >
              <Bell className="h-4 w-4" />
              {notifications.length > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#8B5CF6] px-1 text-[10px] font-semibold text-white tabular-nums">
                  {notifications.length}
                </span>
              )}
            </button>

            {notifOpen && (
              <div className="fixed right-3 top-14 z-50 w-[calc(100vw-1.5rem)] max-w-xs sm:absolute sm:right-0 sm:top-auto sm:mt-2 sm:w-80 rounded-xl border border-white/10 bg-[#171B26] p-3 shadow-2xl">
                <div className="flex items-center justify-between border-b border-white/[0.08] pb-2">
                  <span className="text-xs font-semibold text-white">Studio Notifications</span>
                  <button
                    type="button"
                    onClick={onClearNotifications}
                    className="text-xs text-slate-400 hover:text-white"
                  >
                    Clear
                  </button>
                </div>
                <div className="mt-2 max-h-60 space-y-2 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <p className="py-4 text-center text-xs text-slate-500">No recent notifications.</p>
                  ) : (
                    notifications.map((n, i) => (
                      <div key={i} className="rounded-lg bg-[#0B0D12] p-2 text-xs text-slate-300 break-words">
                        {n}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onOpenAuthModal}
            aria-label={user ? `Account: ${user.name}` : 'Sign In'}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-[#171B26] px-2 sm:px-2.5 text-xs font-medium text-slate-200 hover:border-white/20 whitespace-nowrap shrink-0"
          >
            <UserCheck className="h-3.5 w-3.5 text-[#10B981]" />
            <span className="hidden sm:inline max-w-[110px] truncate">{user ? user.name : 'Sign In'}</span>
          </button>
        </div>
      </div>

      {mobileSearchOpen && (
        <div className="border-t border-white/[0.06] bg-[#0B0D12] px-3 py-2 sm:hidden">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={t.searchPlaceholder}
              aria-label="Mobile global search"
              className="w-full min-h-[40px] rounded-lg border border-white/[0.08] bg-[#171B26] py-1.5 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-[#8B5CF6] focus:outline-none"
            />
          </div>
        </div>
      )}

      {openTabs.length > 0 && (
        <div
          role="tablist"
          aria-label="Open project tabs"
          className="flex items-center gap-1 overflow-x-auto no-scrollbar border-t border-white/[0.06] bg-[#0B0D12] px-2.5 sm:px-4 py-1.5"
        >
          {openTabs.map((tab) => {
            const active = tab.projectId === activeProjectId;
            return (
              <div
                key={tab.projectId}
                className={`flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors ${
                  active
                    ? 'border-[#8B5CF6]/50 bg-[#171B26] text-white'
                    : 'border-transparent text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
                }`}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => onSelectTab(tab.projectId)}
                  className="max-w-[135px] sm:max-w-[160px] truncate font-medium whitespace-nowrap"
                >
                  {tab.module.toUpperCase()} · {tab.name}
                </button>
                <button
                  type="button"
                  onClick={() => onCloseTab(tab.projectId)}
                  aria-label={`Close tab ${tab.name}`}
                  className="rounded p-0.5 text-slate-500 hover:bg-white/10 hover:text-white"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </header>
  );
}
