import {
  Captions,
  Download,
  Film,
  FolderKanban,
  HardDrive,
  LayoutDashboard,
  Mic,
  Plus,
  Settings,
  Sliders,
  X,
} from 'lucide-react';
import { useState } from 'react';
import type { ModuleType } from '../types/studio';
import type { UILang } from '../utils/i18n';
import { UI_COPY } from '../utils/i18n';
import type { NavRoute } from './Sidebar';

interface MobileBottomNavProps {
  activeRoute: NavRoute;
  onNavigate: (route: NavRoute) => void;
  onNewProject: (module: ModuleType) => void;
  lang: UILang;
}

export function MobileBottomNav({
  activeRoute,
  onNavigate,
  onNewProject,
  lang,
}: MobileBottomNavProps) {
  const [sheet, setSheet] = useState<'studio' | 'settings' | null>(null);
  const t = UI_COPY[lang];

  const isStudioRoute = activeRoute === 'subtitle' || activeRoute === 'recap' || activeRoute === 'dubbing';
  const isSettingsRoute =
    activeRoute === 'ai-settings' || activeRoute === 'system-settings' || activeRoute === 'exports';

  const navigateAndClose = (route: NavRoute) => {
    setSheet(null);
    onNavigate(route);
  };

  return (
    <>
      {/* Quick Studio / Settings Bottom Sheet (no floating clutter) */}
      {sheet && (
        <div className="fixed inset-0 z-50 flex items-end md:hidden">
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-xs"
            onClick={() => setSheet(null)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={sheet === 'studio' ? 'Select production studio' : 'Studio settings & exports'}
            className="relative z-10 w-full rounded-t-2xl border-t border-white/10 bg-[#171B26] px-4 pb-6 pt-3 shadow-2xl space-y-3"
          >
            <div className="mx-auto h-1 w-10 rounded-full bg-white/20" />
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-bold text-white">
                {sheet === 'studio' ? 'Production Studios' : 'Settings & Exports'}
              </h3>
              <button
                type="button"
                onClick={() => setSheet(null)}
                aria-label="Close sheet"
                className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {sheet === 'studio' ? (
              <div className="space-y-2">
                {[
                  {
                    id: 'subtitle' as ModuleType,
                    label: t.subtitleStudio,
                    mm: t.subtitleMyanmar,
                    icon: Captions,
                    color: 'text-[#3B82F6]',
                  },
                  {
                    id: 'recap' as ModuleType,
                    label: t.recapStudio,
                    mm: t.recapMyanmar,
                    icon: Film,
                    color: 'text-[#8B5CF6]',
                  },
                  {
                    id: 'dubbing' as ModuleType,
                    label: t.dubbingStudio,
                    mm: t.dubbingMyanmar,
                    icon: Mic,
                    color: 'text-[#10B981]',
                  },
                ].map((mod) => {
                  const Icon = mod.icon;
                  const active = activeRoute === mod.id;
                  return (
                    <div
                      key={mod.id}
                      className={`flex items-center justify-between gap-2 rounded-xl border p-2.5 ${
                        active
                          ? 'border-[#8B5CF6]/50 bg-[#8B5CF6]/10'
                          : 'border-white/[0.08] bg-[#0B0D12]'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => navigateAndClose(mod.id)}
                        className="flex min-h-[44px] flex-1 items-center gap-3 text-left"
                      >
                        <Icon className={`h-5 w-5 shrink-0 ${mod.color}`} />
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-white truncate">{mod.label}</div>
                          <div className="text-xs text-slate-400 myanmar-text truncate">{mod.mm}</div>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSheet(null);
                          onNewProject(mod.id);
                        }}
                        aria-label={`New ${mod.label} project`}
                        className="inline-flex min-h-[40px] items-center gap-1 rounded-lg border border-white/10 bg-[#171B26] px-3 text-xs font-medium text-white hover:border-[#8B5CF6]/50 shrink-0"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <span>New</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-2">
                {[
                  { id: 'ai-settings' as NavRoute, label: t.aiSettings, desc: 'Gemini & Groq API configuration', icon: Sliders },
                  { id: 'exports' as NavRoute, label: t.exportCenter, desc: 'Rendered SRT, ASS, VTT & MP4 files', icon: Download },
                  { id: 'system-settings' as NavRoute, label: t.systemSettings, desc: 'FFmpeg, audio separation & backups', icon: Settings },
                ].map((item) => {
                  const Icon = item.icon;
                  const active = activeRoute === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => navigateAndClose(item.id)}
                      className={`flex min-h-[48px] w-full items-center gap-3 rounded-xl border p-3 text-left ${
                        active
                          ? 'border-[#8B5CF6]/50 bg-[#8B5CF6]/10 text-white'
                          : 'border-white/[0.08] bg-[#0B0D12] text-slate-200'
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-[#8B5CF6]" />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">{item.label}</div>
                        <div className="text-[11px] text-slate-400 truncate">{item.desc}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Fixed Bottom Navigation Bar (Mobile <768px only) */}
      <nav
        aria-label="Mobile bottom navigation"
        className="fixed bottom-0 inset-x-0 z-40 grid h-14 grid-cols-5 border-t border-white/[0.08] bg-[#11141C]/95 backdrop-blur-md md:hidden"
      >
        <button
          type="button"
          onClick={() => navigateAndClose('dashboard')}
          className={`flex min-h-[44px] flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${
            activeRoute === 'dashboard' ? 'text-[#A78BFA]' : 'text-slate-400 hover:text-white'
          }`}
        >
          <LayoutDashboard className="h-4 w-4" />
          <span className="truncate max-w-[60px]">Dashboard</span>
        </button>

        <button
          type="button"
          onClick={() => navigateAndClose('projects')}
          className={`flex min-h-[44px] flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${
            activeRoute === 'projects' ? 'text-[#A78BFA]' : 'text-slate-400 hover:text-white'
          }`}
        >
          <FolderKanban className="h-4 w-4" />
          <span className="truncate max-w-[60px]">Projects</span>
        </button>

        <button
          type="button"
          onClick={() => setSheet((s) => (s === 'studio' ? null : 'studio'))}
          aria-expanded={sheet === 'studio'}
          className={`flex min-h-[44px] flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${
            isStudioRoute || sheet === 'studio' ? 'text-[#10B981]' : 'text-slate-400 hover:text-white'
          }`}
        >
          <Film className="h-4 w-4" />
          <span className="truncate max-w-[60px]">Studio</span>
        </button>

        <button
          type="button"
          onClick={() => navigateAndClose('media')}
          className={`flex min-h-[44px] flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${
            activeRoute === 'media' ? 'text-[#A78BFA]' : 'text-slate-400 hover:text-white'
          }`}
        >
          <HardDrive className="h-4 w-4" />
          <span className="truncate max-w-[60px]">Media</span>
        </button>

        <button
          type="button"
          onClick={() => setSheet((s) => (s === 'settings' ? null : 'settings'))}
          aria-expanded={sheet === 'settings'}
          className={`flex min-h-[44px] flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${
            isSettingsRoute || sheet === 'settings' ? 'text-[#A78BFA]' : 'text-slate-400 hover:text-white'
          }`}
        >
          <Settings className="h-4 w-4" />
          <span className="truncate max-w-[60px]">Settings</span>
        </button>
      </nav>
    </>
  );
}
