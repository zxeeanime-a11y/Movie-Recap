import { useCallback, useEffect, useState } from 'react';
import { AISettingsView } from './components/AISettingsView';
import { DubbingStudioView } from './components/DubbingStudioView';
import { MobileBottomNav } from './components/MobileBottomNav';
import { MovieRecapView } from './components/MovieRecapView';
import { ProjectWizardModal } from './components/ProjectWizardModal';
import {
  AuthModal,
  DashboardView,
  ExportCenterView,
  MediaLibraryView,
  MyProjectsView,
  SystemSettingsView,
} from './components/SecondaryViews';
import { Sidebar, type NavRoute } from './components/Sidebar';
import { SubtitleStudioView } from './components/SubtitleStudioView';
import { TopBar, type OpenTab } from './components/TopBar';
import { api, type ProjectDetailResponse } from './services/api';
import type {
  ExportRecord,
  MediaFileRecord,
  ModuleType,
  ProcessingJobRecord,
  ProjectRecord,
  ProviderConfigStatus,
  UserProfile,
  VoiceProfile,
} from './types/studio';
import type { UILang } from './utils/i18n';

export default function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [activeRoute, setActiveRoute] = useState<NavRoute>('dashboard');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [lang, setLang] = useState<UILang>('en');
  const [searchQuery, setSearchQuery] = useState('');
  const [autosaveStatus, setAutosaveStatus] = useState<'idle' | 'saving' | 'saved' | 'offline'>('saved');

  const [projects, setProjects] = useState<(ProjectRecord & { mediaCount: number })[]>([]);
  const [mediaList, setMediaList] = useState<MediaFileRecord[]>([]);
  const [jobsList, setJobsList] = useState<ProcessingJobRecord[]>([]);
  const [exportsList, setExportsList] = useState<(ExportRecord & { project_name: string })[]>([]);
  const [providers, setProviders] = useState<ProviderConfigStatus[]>([]);
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [systemInfo, setSystemInfo] = useState<Awaited<ReturnType<typeof api.getSystemInfo>> | null>(null);

  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeProjectDetail, setActiveProjectDetail] = useState<ProjectDetailResponse | null>(null);

  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardModule, setWizardModule] = useState<ModuleType>('subtitle');
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [notifications, setNotifications] = useState<string[]>([]);

  const notify = useCallback((msg: string) => {
    setNotifications((prev) => [`${new Date().toLocaleTimeString()} · ${msg}`, ...prev].slice(0, 20));
  }, []);

  const loadWorkspaceData = useCallback(async () => {
    try {
      const meRes = await api.getMe();
      setUser(meRes.user);
      setLang(meRes.user.preferred_lang || 'en');

      const [projRes, medRes, jobRes, expRes, provRes, voiceRes, sysRes] = await Promise.all([
        api.listProjects(undefined, searchQuery),
        api.listMedia(),
        api.listJobs(),
        api.listExports(),
        api.getProviders(),
        api.getVoices(),
        api.getSystemInfo(),
      ]);

      setProjects(projRes.projects);
      setMediaList(medRes.media);
      setJobsList(jobRes.jobs);
      setExportsList(expRes.exports);
      setProviders(provRes.providers);
      setVoices(voiceRes.voices);
      setSystemInfo(sysRes);

      if (!searchQuery.trim()) {
        const validIds = new Set(projRes.projects.map((p) => p.id));
        setOpenTabs((prev) => prev.filter((t) => validIds.has(t.projectId)));
        setActiveProjectId((curr) => (curr && !validIds.has(curr) ? null : curr));
      }
    } catch {
      setAuthModalOpen(true);
    }
  }, [searchQuery]);

  const loadProjectDetail = useCallback(
    async (projectId: string) => {
      try {
        const detail = await api.getProject(projectId);
        setActiveProjectDetail(detail);
        setAutosaveStatus('saved');
        localStorage.setItem(`studio_draft_${projectId}`, JSON.stringify(detail.project));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/project not found/i.test(msg)) {
          localStorage.removeItem(`studio_draft_${projectId}`);
          setOpenTabs((prev) => prev.filter((t) => t.projectId !== projectId));
          setActiveProjectId((curr) => (curr === projectId ? null : curr));
          setActiveProjectDetail((curr) => (curr?.project.id === projectId ? null : curr));
          notify('Selected project is no longer available and was closed.');
          return;
        }
        setAutosaveStatus('offline');
      }
    },
    [notify]
  );

  useEffect(() => {
    void loadWorkspaceData();
  }, [loadWorkspaceData]);

  useEffect(() => {
    if (activeProjectId) {
      void loadProjectDetail(activeProjectId);
    } else {
      setActiveProjectDetail(null);
    }
  }, [activeProjectId, loadProjectDetail]);

  // Poll active background jobs every 2.5s while any job is running
  useEffect(() => {
    const hasActive =
      jobsList.some((j) => ['Queued', 'Preparing', 'Processing', 'Rendering'].includes(j.status)) ||
      (activeProjectDetail?.latestJob &&
        ['Queued', 'Preparing', 'Processing', 'Rendering'].includes(activeProjectDetail.latestJob.status));

    if (!hasActive) return;
    const timer = setInterval(() => {
      void loadWorkspaceData();
      if (activeProjectId) void loadProjectDetail(activeProjectId);
    }, 2500);
    return () => clearInterval(timer);
  }, [jobsList, activeProjectDetail, activeProjectId, loadWorkspaceData, loadProjectDetail]);

  const openProjectInStudio = (p: ProjectRecord) => {
    setOpenTabs((prev) => {
      if (prev.some((t) => t.projectId === p.id)) return prev;
      return [...prev, { projectId: p.id, name: p.name, module: p.module }];
    });
    setActiveProjectId(p.id);
    setActiveRoute(p.module);
  };

  const handleCloseTab = (projectId: string) => {
    const next = openTabs.filter((t) => t.projectId !== projectId);
    setOpenTabs(next);
    if (activeProjectId === projectId) {
      setActiveProjectId(next[0]?.projectId || null);
    }
  };

  const handleSelectTab = (projectId: string) => {
    const tab = openTabs.find((t) => t.projectId === projectId);
    setActiveProjectId(projectId);
    if (tab) setActiveRoute(tab.module);
  };

  const handleNavigate = (route: NavRoute) => {
    setActiveRoute(route);
    if (route === 'subtitle' || route === 'recap' || route === 'dubbing') {
      if (!activeProjectDetail || activeProjectDetail.project.module !== route) {
        const match = projects.find((p) => p.module === route);
        if (match) {
          openProjectInStudio(match);
        } else {
          setActiveProjectId(null);
        }
      }
    }
  };

  const handleToggleLang = () => {
    const next: UILang = lang === 'en' ? 'my' : 'en';
    setLang(next);
    void api.setLanguagePref(next).catch(() => {});
  };

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-[#0B0D12] text-[#F1F5F9]">
      <Sidebar
        activeRoute={activeRoute}
        onNavigate={handleNavigate}
        onNewProject={() => {
          setWizardModule(
            activeRoute === 'recap' || activeRoute === 'dubbing' ? activeRoute : 'subtitle'
          );
          setWizardOpen(true);
        }}
        lang={lang}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar
          openTabs={openTabs}
          activeProjectId={activeProjectId}
          onSelectTab={handleSelectTab}
          onCloseTab={handleCloseTab}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          autosaveStatus={autosaveStatus}
          activeJobs={jobsList}
          notifications={notifications}
          onClearNotifications={() => setNotifications([])}
          lang={lang}
          onToggleLang={handleToggleLang}
          user={user}
          onOpenAuthModal={() => setAuthModalOpen(true)}
          onOpenMobileMenu={() => setMobileOpen(true)}
        />

        <main className="flex-1 overflow-y-auto p-3 sm:p-6 pb-20 md:pb-6">
          <div className="mx-auto max-w-[1400px]">
            {activeRoute === 'dashboard' && (
              <DashboardView
                projects={projects}
                jobs={jobsList}
                providers={providers}
                exportsList={exportsList}
                onOpenProject={openProjectInStudio}
                onNewModuleProject={(m) => {
                  setWizardModule(m);
                  setWizardOpen(true);
                }}
                onOpenRoute={(r) => setActiveRoute(r)}
              />
            )}

            {activeRoute === 'subtitle' && (
              <SubtitleStudioView
                detail={
                  activeProjectDetail?.project.module === 'subtitle' ? activeProjectDetail : null
                }
                user={user}
                voices={voices}
                onRefresh={() => {
                  void loadWorkspaceData();
                  if (activeProjectId) void loadProjectDetail(activeProjectId);
                }}
                onCreateNew={() => {
                  setWizardModule('subtitle');
                  setWizardOpen(true);
                }}
                onNotify={notify}
                onAutosaveState={setAutosaveStatus}
              />
            )}

            {activeRoute === 'recap' && (
              <MovieRecapView
                detail={
                  activeProjectDetail?.project.module === 'recap' ? activeProjectDetail : null
                }
                voices={voices}
                onRefresh={() => {
                  void loadWorkspaceData();
                  if (activeProjectId) void loadProjectDetail(activeProjectId);
                }}
                onCreateNew={() => {
                  setWizardModule('recap');
                  setWizardOpen(true);
                }}
                onNotify={notify}
                onAutosaveState={setAutosaveStatus}
              />
            )}

            {activeRoute === 'dubbing' && (
              <DubbingStudioView
                detail={
                  activeProjectDetail?.project.module === 'dubbing' ? activeProjectDetail : null
                }
                voices={voices}
                onRefresh={() => {
                  void loadWorkspaceData();
                  if (activeProjectId) void loadProjectDetail(activeProjectId);
                }}
                onCreateNew={() => {
                  setWizardModule('dubbing');
                  setWizardOpen(true);
                }}
                onNotify={notify}
              />
            )}

            {activeRoute === 'projects' && (
              <MyProjectsView
                projects={projects}
                onOpenProject={openProjectInStudio}
                onNewProject={() => setWizardOpen(true)}
                onRefresh={() => void loadWorkspaceData()}
                onDeletedProject={(deletedId) => {
                  handleCloseTab(deletedId);
                  setActiveProjectDetail((curr) => (curr?.project.id === deletedId ? null : curr));
                  void loadWorkspaceData();
                }}
              />
            )}

            {activeRoute === 'media' && (
              <MediaLibraryView
                media={mediaList}
                onRefresh={() => void loadWorkspaceData()}
              />
            )}

            {activeRoute === 'exports' && <ExportCenterView exportsList={exportsList} />}

            {activeRoute === 'ai-settings' && (
              <AISettingsView
                providers={providers}
                onRefresh={() => void loadWorkspaceData()}
                onNotify={notify}
              />
            )}

            {activeRoute === 'system-settings' && (
              <SystemSettingsView
                info={systemInfo}
                onRefresh={() => void loadWorkspaceData()}
                onNotify={notify}
              />
            )}
          </div>
        </main>
      </div>

      <ProjectWizardModal
        open={wizardOpen}
        initialModule={wizardModule}
        voices={voices}
        onClose={() => setWizardOpen(false)}
        onCreated={(proj) => {
          notify(`Created ${proj.module.toUpperCase()} project "${proj.name}".`);
          void loadWorkspaceData();
          openProjectInStudio(proj);
        }}
      />

      <AuthModal
        open={authModalOpen}
        user={user}
        onClose={() => setAuthModalOpen(false)}
        onAuthChanged={(u) => {
          setUser(u);
          setOpenTabs([]);
          setActiveProjectId(null);
          setActiveProjectDetail(null);
          if (u) void loadWorkspaceData();
        }}
      />

      <MobileBottomNav
        activeRoute={activeRoute}
        onNavigate={handleNavigate}
        onNewProject={(mod) => {
          setWizardModule(mod);
          setWizardOpen(true);
        }}
        lang={lang}
      />
    </div>
  );
}
