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
import type { UILang } from '../utils/i18n';
import { UI_COPY } from '../utils/i18n';

export type NavRoute =
  | 'dashboard'
  | 'subtitle'
  | 'recap'
  | 'dubbing'
  | 'projects'
  | 'media'
  | 'exports'
  | 'ai-settings'
  | 'system-settings';

interface SidebarProps {
  activeRoute: NavRoute;
  onNavigate: (route: NavRoute) => void;
  onNewProject: () => void;
  lang: UILang;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function Sidebar({
  activeRoute,
  onNavigate,
  onNewProject,
  lang,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const t = UI_COPY[lang];

  const primaryModules: Array<{
    id: NavRoute;
    label: string;
    sublabel: string;
    icon: typeof Captions;
    accentClass: string;
  }> = [
    {
      id: 'subtitle',
      label: t.subtitleStudio,
      sublabel: t.subtitleMyanmar,
      icon: Captions,
      accentClass: 'text-[#3B82F6]',
    },
    {
      id: 'recap',
      label: t.recapStudio,
      sublabel: t.recapMyanmar,
      icon: Film,
      accentClass: 'text-[#8B5CF6]',
    },
    {
      id: 'dubbing',
      label: t.dubbingStudio,
      sublabel: t.dubbingMyanmar,
      icon: Mic,
      accentClass: 'text-[#10B981]',
    },
  ];

  const workspaceNav: Array<{ id: NavRoute; label: string; icon: typeof LayoutDashboard }> = [
    { id: 'projects', label: t.myProjects, icon: FolderKanban },
    { id: 'media', label: t.mediaLibrary, icon: HardDrive },
    { id: 'exports', label: t.exportCenter, icon: Download },
    { id: 'ai-settings', label: t.aiSettings, icon: Sliders },
    { id: 'system-settings', label: t.systemSettings, icon: Settings },
  ];

  const content = (
    <aside className="flex h-full w-[256px] shrink-0 flex-col border-r border-white/[0.08] bg-[#11141C] select-none">
      <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-4">
        <button
          type="button"
          onClick={() => {
            onNavigate('dashboard');
            onCloseMobile();
          }}
          className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B5CF6] rounded"
        >
          <span className="font-display block text-sm font-bold tracking-wide text-white whitespace-nowrap">
            AI MOVIE RECAP STUDIO
          </span>
          <span className="mt-0.5 block text-[11px] text-slate-400">Myanmar Production Suite</span>
        </button>
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Close navigation menu"
          className="rounded-md p-1.5 text-slate-400 hover:bg-white/5 hover:text-white lg:hidden"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="p-3">
        <button
          type="button"
          onClick={() => {
            onNewProject();
            onCloseMobile();
          }}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#8B5CF6] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#7C3AED] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B5CF6]"
        >
          <Plus className="h-4 w-4" />
          <span className="whitespace-nowrap">{t.newProject}</span>
        </button>
      </div>

      <nav aria-label="Primary studio navigation" className="flex-1 overflow-y-auto px-3 pb-4 space-y-5">
        <div>
          <button
            type="button"
            onClick={() => {
              onNavigate('dashboard');
              onCloseMobile();
            }}
            className={`flex min-h-[42px] w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              activeRoute === 'dashboard'
                ? 'bg-white/[0.08] text-white'
                : 'text-slate-300 hover:bg-white/[0.04] hover:text-white'
            }`}
          >
            <LayoutDashboard className="h-4 w-4 shrink-0 text-slate-400" />
            <span className="truncate">{t.dashboard}</span>
          </button>
        </div>

        <div>
          <div className="px-3 pb-1.5 text-[11px] font-medium text-slate-500">Production Modules</div>
          <div className="space-y-1">
            {primaryModules.map((mod) => {
              const Icon = mod.icon;
              const active = activeRoute === mod.id;
              return (
                <button
                  key={mod.id}
                  type="button"
                  onClick={() => {
                    onNavigate(mod.id);
                    onCloseMobile();
                  }}
                  className={`flex min-h-[44px] w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    active
                      ? 'border-white/15 bg-[#171B26] text-white'
                      : 'border-transparent text-slate-300 hover:bg-white/[0.04] hover:text-white'
                  }`}
                >
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${mod.accentClass}`} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium leading-tight">{mod.label}</div>
                    <div className="mt-0.5 truncate text-[11px] text-slate-400 myanmar-text">{mod.sublabel}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="px-3 pb-1.5 text-[11px] font-medium text-slate-500">Workspace & System</div>
          <div className="space-y-1">
            {workspaceNav.map((item) => {
              const Icon = item.icon;
              const active = activeRoute === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onNavigate(item.id);
                    onCloseMobile();
                  }}
                  className={`flex min-h-[42px] w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    active
                      ? 'bg-white/[0.08] text-white'
                      : 'text-slate-300 hover:bg-white/[0.04] hover:text-white'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0 text-slate-400" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </nav>
    </aside>
  );

  return (
    <>
      <div className="hidden lg:block h-full">{content}</div>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="fixed inset-0 bg-black/70" onClick={onCloseMobile} />
          <div className="relative z-10 h-full">{content}</div>
        </div>
      )}
    </>
  );
}
