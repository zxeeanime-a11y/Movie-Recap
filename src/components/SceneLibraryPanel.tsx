import { ChevronLeft, ChevronRight, Eye, Search, Sparkles, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { VideoScene } from '../types/studio';
import {
  filterAndPaginateScenes,
  formatDisplayTimecode,
  type SceneFilterMode,
} from '../utils/studioRules';

interface SceneLibraryPanelProps {
  scenes: VideoScene[];
  onToggleScene: (sceneId: string, selected: boolean) => void;
}

export function SceneLibraryPanel({ scenes, onToggleScene }: SceneLibraryPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<SceneFilterMode>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(6);
  const [expandedSceneId, setExpandedSceneId] = useState<string | null>(null);

  const paged = useMemo(
    () => filterAndPaginateScenes(scenes, { searchQuery, filter, page, pageSize }),
    [scenes, searchQuery, filter, page, pageSize]
  );

  const expandedScene = useMemo(
    () => scenes.find((s) => s.id === expandedSceneId) || null,
    [scenes, expandedSceneId]
  );

  const selectedCount = scenes.filter((s) => s.selected).length;

  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#171B26] p-4 sm:p-5 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-display text-sm font-semibold text-white">
            Steps 4–7 · Scene Library & AI Selection
          </h3>
          <p className="text-xs text-slate-400">
            Tap any scene to inspect full AI story analysis. Toggle Include to curate recap clips.
          </p>
        </div>
        <span className="font-mono text-xs text-slate-300 tabular-nums">
          {selectedCount} / {scenes.length} selected
        </span>
      </div>

      {/* Search, Filter & Page Size Controls */}
      {scenes.length > 0 && (
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Search scene, character, twist..."
              aria-label="Search detected scenes"
              className="w-full min-h-[40px] rounded-lg border border-white/10 bg-[#0B0D12] py-1.5 pl-8 pr-3 text-xs text-white placeholder:text-slate-500 focus:border-[#8B5CF6] focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1 rounded-lg border border-white/[0.08] bg-[#0B0D12] p-1">
              {(
                [
                  { id: 'all', label: 'All' },
                  { id: 'selected', label: 'Selected' },
                  { id: 'pivotal', label: 'Pivotal' },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setFilter(item.id);
                    setPage(1);
                  }}
                  className={`min-h-[32px] rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                    filter === item.id
                      ? 'bg-[#8B5CF6] text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <select
              aria-label="Scenes per page"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="min-h-[36px] rounded-lg border border-white/10 bg-[#0B0D12] px-2.5 py-1 text-xs text-slate-200"
            >
              <option value={6}>6 / page</option>
              <option value={12}>12 / page</option>
              <option value={100}>Show All</option>
            </select>
          </div>
        </div>
      )}

      {/* Expandable Scene Detail Panel */}
      {expandedScene && (
        <div
          role="region"
          aria-label={`Scene ${expandedScene.scene_index} analysis details`}
          className="rounded-xl border border-[#8B5CF6]/40 bg-[#0B0D12] p-3.5 sm:p-4 space-y-3"
        >
          <div className="flex flex-wrap items-start justify-between gap-2 border-b border-white/[0.08] pb-2.5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-mono font-semibold text-[#C4B5FD]">
                  Scene #{expandedScene.scene_index}
                </span>
                <span className="font-mono text-slate-400 tabular-nums">
                  {formatDisplayTimecode(expandedScene.start_sec)} – {formatDisplayTimecode(expandedScene.end_sec)}
                </span>
                <span className="font-mono text-[#10B981]">
                  Score {expandedScene.importance_score}/10
                </span>
              </div>
              <h4 className="mt-1 text-sm font-semibold text-white">
                {expandedScene.story_position || 'Story Beat'} · {expandedScene.location || 'Scene'}
              </h4>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <label className="inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-lg border border-white/10 bg-[#171B26] px-2.5 py-1 text-xs text-slate-200">
                <input
                  type="checkbox"
                  checked={expandedScene.selected}
                  onChange={(e) => onToggleScene(expandedScene.id, e.target.checked)}
                  className="accent-[#8B5CF6]"
                />
                <span>Include</span>
              </label>
              <button
                type="button"
                onClick={() => setExpandedSceneId(null)}
                aria-label="Close scene analysis panel"
                className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg border border-white/10 bg-[#171B26] text-slate-300 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-[200px_1fr]">
            <div className="aspect-video overflow-hidden rounded-lg bg-black">
              <img
                src={`/api/scenes/${expandedScene.id}/keyframe`}
                alt={`Scene ${expandedScene.scene_index} keyframe`}
                referrerPolicy="no-referrer"
                loading="lazy"
                className="h-full w-full object-cover"
              />
            </div>

            <div className="space-y-2 text-xs leading-relaxed">
              <p className="text-slate-200 myanmar-text">
                {expandedScene.action_summary || 'Awaiting Gemini scene analysis...'}
              </p>
              {expandedScene.plot_twist && (
                <div className="flex items-start gap-1.5 rounded-lg bg-[#F59E0B]/10 border border-[#F59E0B]/30 px-2.5 py-1.5 text-[#FCD34D]">
                  <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>Plot Twist: {expandedScene.plot_twist}</span>
                </div>
              )}
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 text-[11px] text-slate-400">
                {expandedScene.characters.length > 0 && (
                  <div>
                    <span className="text-slate-300 font-medium">Characters:</span>{' '}
                    {expandedScene.characters.join(', ')}
                  </div>
                )}
                {expandedScene.emotional_shift && (
                  <div>
                    <span className="text-slate-300 font-medium">Emotion:</span>{' '}
                    {expandedScene.emotional_shift}
                  </div>
                )}
                {expandedScene.important_events && (
                  <div className="sm:col-span-2">
                    <span className="text-slate-300 font-medium">Key Event:</span>{' '}
                    {expandedScene.important_events}
                  </div>
                )}
                {expandedScene.dialogue_context && (
                  <div className="sm:col-span-2 myanmar-text">
                    <span className="text-slate-300 font-medium">Dialogue Context:</span>{' '}
                    {expandedScene.dialogue_context}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Scene Cards Grid */}
      {scenes.length === 0 ? (
        <div className="rounded-lg border border-white/[0.06] bg-[#0B0D12] p-8 text-center text-xs text-slate-500">
          No scenes detected yet. Start the pipeline to extract keyframes and run Gemini multimodal scene analysis.
        </div>
      ) : paged.items.length === 0 ? (
        <div className="rounded-lg border border-white/[0.06] bg-[#0B0D12] p-6 text-center text-xs text-slate-400">
          No scenes match your current search or filter.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-3 xl:grid-cols-4">
          {paged.items.map((scene) => {
            const isExpanded = expandedSceneId === scene.id;
            return (
              <div
                key={scene.id}
                className={`flex flex-col rounded-xl border overflow-hidden transition-colors ${
                  isExpanded
                    ? 'border-[#8B5CF6] bg-[#0B0D12] ring-1 ring-[#8B5CF6]/40'
                    : scene.selected
                      ? 'border-[#8B5CF6]/45 bg-[#0B0D12]'
                      : 'border-white/[0.06] bg-[#0B0D12]/60 opacity-80'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setExpandedSceneId(isExpanded ? null : scene.id)}
                  aria-expanded={isExpanded}
                  aria-label={`Inspect Scene ${scene.scene_index}`}
                  className="group relative aspect-video w-full overflow-hidden bg-black text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B5CF6]"
                >
                  <img
                    src={`/api/scenes/${scene.id}/keyframe`}
                    alt={`Scene ${scene.scene_index} keyframe`}
                    referrerPolicy="no-referrer"
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                  />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/45 to-transparent px-2 py-1.5 flex items-center justify-between gap-1">
                    <span className="font-mono text-[10px] sm:text-[11px] font-semibold text-white tabular-nums truncate">
                      #{scene.scene_index} · {formatDisplayTimecode(scene.start_sec)}
                    </span>
                    <span className="font-mono text-[10px] text-[#34D399] tabular-nums shrink-0">
                      {scene.importance_score}/10
                    </span>
                  </div>
                </button>

                <div className="flex items-center justify-between gap-1.5 px-2 py-1.5 text-[11px]">
                  <label className="inline-flex min-h-[34px] cursor-pointer items-center gap-1.5 text-slate-200 truncate">
                    <input
                      type="checkbox"
                      checked={scene.selected}
                      onChange={(e) => onToggleScene(scene.id, e.target.checked)}
                      className="h-3.5 w-3.5 shrink-0 accent-[#8B5CF6]"
                    />
                    <span className="truncate">Include</span>
                  </label>

                  <button
                    type="button"
                    onClick={() => setExpandedSceneId(isExpanded ? null : scene.id)}
                    aria-expanded={isExpanded}
                    className={`inline-flex min-h-[34px] shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                      isExpanded
                        ? 'bg-[#8B5CF6] text-white'
                        : 'text-slate-300 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    <Eye className="h-3 w-3" />
                    <span>{isExpanded ? 'Open' : 'Info'}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination Bar */}
      {paged.totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] pt-3 text-xs">
          <span className="font-mono text-[11px] text-slate-400 tabular-nums">
            Showing {paged.items.length} of {paged.filteredCount} scenes
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={paged.page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-white/10 bg-[#0B0D12] px-2.5 py-1 text-xs text-slate-200 hover:border-white/25 disabled:opacity-40"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              <span>Prev</span>
            </button>
            <span className="px-2 font-mono text-[11px] text-slate-300 tabular-nums">
              {paged.page} / {paged.totalPages}
            </span>
            <button
              type="button"
              disabled={paged.page >= paged.totalPages}
              onClick={() => setPage((p) => Math.min(paged.totalPages, p + 1))}
              className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-white/10 bg-[#0B0D12] px-2.5 py-1 text-xs text-slate-200 hover:border-white/25 disabled:opacity-40"
            >
              <span>Next</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
