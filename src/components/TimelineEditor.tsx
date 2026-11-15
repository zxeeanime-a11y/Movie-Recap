import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Lock,
  Magnet,
  Maximize2,
  Pause,
  Play,
  Redo2,
  Scissors,
  Trash2,
  Undo2,
  Unlock,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SubtitleCue, TimelineClip, TimelineTrack, VideoResolution } from '../types/studio';
import { formatDisplayTimecode, moveClipWithSnap, splitClipAtTime } from '../utils/studioRules';

interface TimelineEditorProps {
  videoUrl?: string;
  durationSec: number;
  subtitles?: SubtitleCue[];
  initialClips?: TimelineClip[];
  resolutionPreview: VideoResolution;
  onResolutionPreviewChange: (res: VideoResolution) => void;
  onSeekExternal?: (sec: number) => void;
}

const DEFAULT_TRACKS: TimelineTrack[] = [
  { id: 't_video', kind: 'video', label: 'Video', muted: false, locked: false, hidden: false },
  { id: 't_orig', kind: 'original_audio', label: 'Original Audio', muted: false, locked: false, hidden: false },
  { id: 't_dlg', kind: 'dialogue', label: 'Dialogue Stem', muted: false, locked: false, hidden: false },
  { id: 't_ai', kind: 'ai_voice', label: 'AI Voice', muted: false, locked: false, hidden: false },
  { id: 't_bgm', kind: 'music', label: 'Background Music', muted: false, locked: false, hidden: false },
  { id: 't_sfx', kind: 'sfx', label: 'Sound Effects', muted: false, locked: false, hidden: false },
  { id: 't_sub', kind: 'subtitle', label: 'Subtitles', muted: false, locked: false, hidden: false },
];

export function TimelineEditor({
  videoUrl,
  durationSec,
  subtitles = [],
  initialClips = [],
  resolutionPreview,
  onResolutionPreviewChange,
}: TimelineEditorProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [actualDuration, setActualDuration] = useState(Math.max(10, durationSec || 10));
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [tracks, setTracks] = useState<TimelineTrack[]>(DEFAULT_TRACKS);
  const [clips, setClips] = useState<TimelineClip[]>(initialClips);
  const [history, setHistory] = useState<TimelineClip[][]>([]);
  const [redoStack, setRedoStack] = useState<TimelineClip[][]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [mobileTrackId, setMobileTrackId] = useState<string>('t_video');
  const [zoomPxPerSec, setZoomPxPerSec] = useState(48);
  const [snapEnabled, setSnapEnabled] = useState(true);

  useEffect(() => {
    setClips(initialClips);
  }, [initialClips]);

  useEffect(() => {
    if (durationSec > 0) setActualDuration(durationSec);
  }, [durationSec]);

  const activeCue = useMemo(() => {
    const subTrack = tracks.find((t) => t.kind === 'subtitle');
    if (subTrack?.hidden) return null;
    return subtitles.find((c) => currentTime >= c.start_sec && currentTime <= c.end_sec) || null;
  }, [subtitles, currentTime, tracks]);

  const commitClips = (next: TimelineClip[]) => {
    setHistory((h) => [...h.slice(-20), clips]);
    setRedoStack([]);
    setClips(next);
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      void v.play();
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  };

  const seekTo = (sec: number) => {
    const clamped = Math.max(0, Math.min(actualDuration, sec));
    setCurrentTime(clamped);
    if (videoRef.current) {
      videoRef.current.currentTime = clamped;
    }
  };

  const stepFrame = (deltaFrames: number) => {
    seekTo(currentTime + deltaFrames * (1 / 30));
  };

  const handleSpeedChange = (speed: number) => {
    setPlaybackSpeed(speed);
    if (videoRef.current) videoRef.current.playbackRate = speed;
  };

  const handleFullscreen = () => {
    videoRef.current?.requestFullscreen?.();
  };

  const selectedClip = clips.find((c) => c.id === selectedClipId) || null;
  const isTrackLocked = (trackId: string) => Boolean(tracks.find((t) => t.id === trackId)?.locked);
  const activeMobileTrack = tracks.find((t) => t.id === mobileTrackId) || tracks[0];

  const handleSplit = () => {
    if (!selectedClip || isTrackLocked(selectedClip.trackId)) return;
    commitClips(splitClipAtTime(clips, selectedClip.id, currentTime));
  };

  const handleDuplicate = () => {
    if (!selectedClip || isTrackLocked(selectedClip.trackId)) return;
    const dur = selectedClip.endSec - selectedClip.startSec;
    const dup: TimelineClip = {
      ...selectedClip,
      id: `${selectedClip.id}_dup_${Date.now()}`,
      label: `${selectedClip.label} Copy`,
      startSec: Number(selectedClip.endSec.toFixed(2)),
      endSec: Number((selectedClip.endSec + dur).toFixed(2)),
    };
    commitClips([...clips, dup]);
    setSelectedClipId(dup.id);
  };

  const handleDelete = () => {
    if (!selectedClip || isTrackLocked(selectedClip.trackId)) return;
    commitClips(clips.filter((c) => c.id !== selectedClip.id));
    setSelectedClipId(null);
  };

  const handleNudgeClip = (deltaSec: number) => {
    if (!selectedClip || isTrackLocked(selectedClip.trackId)) return;
    const moved = moveClipWithSnap(selectedClip, selectedClip.startSec + deltaSec, snapEnabled, 0.25);
    commitClips(clips.map((c) => (c.id === selectedClip.id ? moved : c)));
  };

  const handleTrimClip = (edge: 'start' | 'end', deltaSec: number) => {
    if (!selectedClip || isTrackLocked(selectedClip.trackId)) return;
    commitClips(
      clips.map((c) => {
        if (c.id !== selectedClip.id) return c;
        if (edge === 'start') {
          const ns = Math.max(0, Math.min(c.endSec - 0.3, Number((c.startSec + deltaSec).toFixed(2))));
          return { ...c, startSec: ns };
        }
        const ne = Math.max(c.startSec + 0.3, Number((c.endSec + deltaSec).toFixed(2)));
        return { ...c, endSec: ne };
      })
    );
  };

  const handleUndo = () => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setRedoStack((r) => [...r, clips]);
    setHistory((h) => h.slice(0, -1));
    setClips(prev);
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setHistory((h) => [...h, clips]);
    setRedoStack((r) => r.slice(0, -1));
    setClips(next);
  };

  const timelineWidthPx = Math.max(520, Math.ceil(actualDuration * zoomPxPerSec));

  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#171B26] overflow-hidden">
      {/* Responsive Video Monitor — full container width, original aspect ratio */}
      <div className="relative bg-black flex items-center justify-center aspect-video w-full md:max-h-[420px]">
        {videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            playsInline
            onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime || 0)}
            onLoadedMetadata={() => {
              if (videoRef.current?.duration) setActualDuration(videoRef.current.duration);
            }}
            onEnded={() => setPlaying(false)}
            muted={tracks.find((t) => t.kind === 'original_audio')?.muted}
            className={`h-full w-full object-contain ${
              tracks.find((t) => t.kind === 'video')?.hidden ? 'opacity-10' : ''
            }`}
          />
        ) : (
          <div className="flex flex-col items-center justify-center text-slate-400 text-xs p-6 text-center">
            <p>Import or generate a media clip to preview video and timeline waveforms.</p>
          </div>
        )}

        {activeCue && (
          <div className="pointer-events-none absolute bottom-3 sm:bottom-5 left-1/2 -translate-x-1/2 max-w-[90%] rounded-lg bg-black/80 px-3 py-1.5 sm:px-4 sm:py-2 text-center">
            <p className="text-sm sm:text-base font-semibold text-white myanmar-text leading-snug">
              {activeCue.myanmar_text || activeCue.source_text}
            </p>
          </div>
        )}
      </div>

      {/* Interactive Video Seek Bar + Primary Transport Controls */}
      <div className="border-y border-white/[0.08] bg-[#11141C] px-3 sm:px-4 py-2.5 space-y-2.5">
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-[11px] tabular-nums text-slate-300 shrink-0">
            {formatDisplayTimecode(currentTime)}
          </span>
          <input
            type="range"
            min={0}
            max={Math.max(1, actualDuration)}
            step={0.05}
            value={Math.min(currentTime, actualDuration)}
            onChange={(e) => seekTo(Number(e.target.value))}
            aria-label="Seek video timeline"
            className="h-2 w-full cursor-pointer accent-[#8B5CF6]"
          />
          <span className="font-mono text-[11px] tabular-nums text-slate-400 shrink-0">
            {formatDisplayTimecode(actualDuration)}
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => stepFrame(-1)}
              aria-label="Step back 1 frame"
              className="inline-flex min-h-[38px] min-w-[38px] items-center justify-center rounded-md border border-white/10 bg-[#171B26] text-slate-300 hover:text-white"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={togglePlay}
              aria-label={playing ? 'Pause playback' : 'Play video'}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-md bg-[#8B5CF6] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#7C3AED]"
            >
              {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              <span>{playing ? 'Pause' : 'Play'}</span>
            </button>
            <button
              type="button"
              onClick={() => stepFrame(1)}
              aria-label="Step forward 1 frame"
              className="inline-flex min-h-[38px] min-w-[38px] items-center justify-center rounded-md border border-white/10 bg-[#171B26] text-slate-300 hover:text-white"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <select
              aria-label="Playback speed"
              value={playbackSpeed}
              onChange={(e) => handleSpeedChange(Number(e.target.value))}
              className="min-h-[38px] rounded-md border border-white/10 bg-[#0B0D12] px-2 py-1 text-xs text-slate-200"
            >
              <option value={0.5}>0.5x</option>
              <option value={1}>1.0x</option>
              <option value={1.5}>1.5x</option>
              <option value={2}>2.0x</option>
            </select>

            <select
              aria-label="Preview resolution"
              value={resolutionPreview}
              onChange={(e) => onResolutionPreviewChange(e.target.value as VideoResolution)}
              className="min-h-[38px] rounded-md border border-white/10 bg-[#0B0D12] px-2 py-1 text-xs text-slate-200"
            >
              <option value="480p">480p</option>
              <option value="720p">720p</option>
              <option value="1080p">1080p</option>
              <option value="4k">4K</option>
            </select>

            <button
              type="button"
              onClick={() => setZoomPxPerSec((z) => Math.max(20, z - 12))}
              aria-label="Zoom out timeline"
              className="inline-flex min-h-[38px] min-w-[38px] items-center justify-center rounded-md border border-white/10 bg-[#171B26] text-slate-300 hover:text-white"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setZoomPxPerSec((z) => Math.min(120, z + 12))}
              aria-label="Zoom in timeline"
              className="inline-flex min-h-[38px] min-w-[38px] items-center justify-center rounded-md border border-white/10 bg-[#171B26] text-slate-300 hover:text-white"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={handleFullscreen}
              aria-label="Fullscreen preview"
              className="inline-flex min-h-[38px] min-w-[38px] items-center justify-center rounded-md border border-white/10 bg-[#171B26] text-slate-300 hover:text-white"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Clip Editing Toolbar (scrollable horizontally on narrow screens) */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-1">
          <button
            type="button"
            onClick={handleSplit}
            disabled={!selectedClip}
            title="Split clip at playhead"
            className="inline-flex min-h-[34px] shrink-0 items-center gap-1 rounded-md border border-white/10 bg-[#171B26] px-2.5 py-1 text-xs text-slate-300 hover:text-white disabled:opacity-40"
          >
            <Scissors className="h-3.5 w-3.5" />
            <span>Split</span>
          </button>
          <button
            type="button"
            onClick={() => handleTrimClip('start', 0.25)}
            disabled={!selectedClip}
            className="min-h-[34px] shrink-0 rounded-md border border-white/10 bg-[#171B26] px-2.5 py-1 text-xs text-slate-300 hover:text-white disabled:opacity-40"
          >
            Trim In
          </button>
          <button
            type="button"
            onClick={() => handleTrimClip('end', -0.25)}
            disabled={!selectedClip}
            className="min-h-[34px] shrink-0 rounded-md border border-white/10 bg-[#171B26] px-2.5 py-1 text-xs text-slate-300 hover:text-white disabled:opacity-40"
          >
            Trim Out
          </button>
          <button
            type="button"
            onClick={() => handleNudgeClip(-0.25)}
            disabled={!selectedClip}
            className="min-h-[34px] shrink-0 rounded-md border border-white/10 bg-[#171B26] px-2.5 py-1 text-xs text-slate-300 hover:text-white disabled:opacity-40"
          >
            -0.25s
          </button>
          <button
            type="button"
            onClick={() => handleNudgeClip(0.25)}
            disabled={!selectedClip}
            className="min-h-[34px] shrink-0 rounded-md border border-white/10 bg-[#171B26] px-2.5 py-1 text-xs text-slate-300 hover:text-white disabled:opacity-40"
          >
            +0.25s
          </button>
          <button
            type="button"
            onClick={handleDuplicate}
            disabled={!selectedClip}
            aria-label="Duplicate selected clip"
            className="inline-flex min-h-[34px] min-w-[34px] shrink-0 items-center justify-center rounded-md border border-white/10 bg-[#171B26] text-slate-300 hover:text-white disabled:opacity-40"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={!selectedClip}
            aria-label="Delete selected clip"
            className="inline-flex min-h-[34px] min-w-[34px] shrink-0 items-center justify-center rounded-md border border-white/10 bg-[#171B26] text-slate-300 hover:text-[#EF4444] disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setSnapEnabled((s) => !s)}
            aria-label="Toggle timeline snap"
            className={`inline-flex min-h-[34px] shrink-0 items-center gap-1 rounded-md border px-2.5 py-1 text-xs ${
              snapEnabled
                ? 'border-[#8B5CF6]/60 bg-[#8B5CF6]/20 text-white'
                : 'border-white/10 bg-[#171B26] text-slate-400'
            }`}
          >
            <Magnet className="h-3.5 w-3.5" />
            <span>Snap</span>
          </button>
          <button
            type="button"
            onClick={handleUndo}
            disabled={history.length === 0}
            aria-label="Undo timeline edit"
            className="inline-flex min-h-[34px] min-w-[34px] shrink-0 items-center justify-center rounded-md border border-white/10 bg-[#171B26] text-slate-300 hover:text-white disabled:opacity-40"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={handleRedo}
            disabled={redoStack.length === 0}
            aria-label="Redo timeline edit"
            className="inline-flex min-h-[34px] min-w-[34px] shrink-0 items-center justify-center rounded-md border border-white/10 bg-[#171B26] text-slate-300 hover:text-white disabled:opacity-40"
          >
            <Redo2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* DEDICATED MOBILE TIMELINE VIEW (<768px) */}
      <div className="md:hidden bg-[#0B0D12] p-3 space-y-2.5">
        {/* Track Selector Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar" role="tablist" aria-label="Mobile timeline track selector">
          {tracks.map((track) => {
            const count = clips.filter((c) => c.trackId === track.id).length;
            const selected = track.id === activeMobileTrack.id;
            return (
              <button
                key={track.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setMobileTrackId(track.id)}
                className={`inline-flex min-h-[34px] shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors ${
                  selected
                    ? 'border-[#8B5CF6] bg-[#8B5CF6]/20 text-white'
                    : 'border-white/[0.08] bg-[#11141C] text-slate-400 hover:text-white'
                }`}
              >
                <span>{track.label}</span>
                {count > 0 && <span className="font-mono text-[10px] opacity-75">({count})</span>}
              </button>
            );
          })}
        </div>

        {/* Compact Active Track Controls */}
        <div className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-[#11141C] px-2.5 py-1.5 text-xs">
          <span className="font-medium text-slate-200 truncate">{activeMobileTrack.label}</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() =>
                setTracks((ts) =>
                  ts.map((t) => (t.id === activeMobileTrack.id ? { ...t, muted: !t.muted } : t))
                )
              }
              aria-label={`Toggle mute on ${activeMobileTrack.label}`}
              className={`inline-flex min-h-[32px] min-w-[32px] items-center justify-center rounded ${
                activeMobileTrack.muted ? 'text-[#EF4444]' : 'text-slate-400 hover:text-white'
              }`}
            >
              {activeMobileTrack.muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={() =>
                setTracks((ts) =>
                  ts.map((t) => (t.id === activeMobileTrack.id ? { ...t, locked: !t.locked } : t))
                )
              }
              aria-label={`Toggle lock on ${activeMobileTrack.label}`}
              className={`inline-flex min-h-[32px] min-w-[32px] items-center justify-center rounded ${
                activeMobileTrack.locked ? 'text-[#8B5CF6]' : 'text-slate-400 hover:text-white'
              }`}
            >
              {activeMobileTrack.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={() =>
                setTracks((ts) =>
                  ts.map((t) => (t.id === activeMobileTrack.id ? { ...t, hidden: !t.hidden } : t))
                )
              }
              aria-label={`Toggle visibility on ${activeMobileTrack.label}`}
              className={`inline-flex min-h-[32px] min-w-[32px] items-center justify-center rounded ${
                activeMobileTrack.hidden ? 'text-slate-600' : 'text-slate-400 hover:text-white'
              }`}
            >
              {activeMobileTrack.hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
            <span className="ml-1 font-mono text-[10px] text-slate-500">{zoomPxPerSec}px/s</span>
          </div>
        </div>

        {/* Mobile Horizontal Scrollable Timeline Lane */}
        <div className="overflow-x-auto rounded-lg border border-white/[0.08] bg-[#11141C]">
          <div style={{ width: `${timelineWidthPx}px` }} className="relative">
            <div
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                seekTo((e.clientX - rect.left) / zoomPxPerSec);
              }}
              className="relative h-7 cursor-pointer border-b border-white/[0.08] bg-[#0B0D12]"
            >
              {Array.from({ length: Math.ceil(actualDuration) + 1 }).map((_, sec) => (
                <div
                  key={sec}
                  style={{ left: `${sec * zoomPxPerSec}px` }}
                  className="absolute top-0 bottom-0 border-l border-white/10 pl-1 font-mono text-[10px] text-slate-500"
                >
                  {sec}s
                </div>
              ))}
            </div>

            <div className={`relative h-14 ${activeMobileTrack.hidden ? 'opacity-30' : ''}`}>
              {clips
                .filter((c) => c.trackId === activeMobileTrack.id)
                .map((clip) => {
                  const left = clip.startSec * zoomPxPerSec;
                  const width = Math.max(40, (clip.endSec - clip.startSec) * zoomPxPerSec);
                  const isSelected = clip.id === selectedClipId;
                  return (
                    <button
                      key={clip.id}
                      type="button"
                      onClick={() => setSelectedClipId(clip.id)}
                      style={{ left: `${left}px`, width: `${width}px`, backgroundColor: `${clip.color}38` }}
                      className={`absolute top-2 bottom-2 rounded-md border px-2 text-left text-xs font-medium text-white truncate transition-colors ${
                        isSelected ? 'border-white ring-1 ring-white/50' : 'border-white/20'
                      }`}
                    >
                      {clip.label}
                    </button>
                  );
                })}
            </div>

            <div
              style={{ left: `${currentTime * zoomPxPerSec}px` }}
              className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-[#EF4444]"
            />
          </div>
        </div>
      </div>

      {/* DESKTOP & TABLET MULTI-TRACK TIMELINE GRID (>=768px) */}
      <div className="hidden md:flex overflow-x-auto bg-[#0B0D12]">
        <div className="w-44 shrink-0 border-r border-white/[0.08] bg-[#11141C]">
          <div className="h-7 border-b border-white/[0.08] px-3 flex items-center text-[11px] text-slate-400">
            Tracks
          </div>
          {tracks.map((track) => (
            <div
              key={track.id}
              className="flex h-10 items-center justify-between border-b border-white/[0.05] px-3 text-xs"
            >
              <span className={`truncate font-medium ${track.hidden ? 'text-slate-600' : 'text-slate-200'}`}>
                {track.label}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() =>
                    setTracks((ts) => ts.map((t) => (t.id === track.id ? { ...t, muted: !t.muted } : t)))
                  }
                  aria-label={`Toggle mute on ${track.label}`}
                  className={`p-1 rounded ${track.muted ? 'text-[#EF4444]' : 'text-slate-500 hover:text-white'}`}
                >
                  {track.muted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setTracks((ts) => ts.map((t) => (t.id === track.id ? { ...t, locked: !t.locked } : t)))
                  }
                  aria-label={`Toggle lock on ${track.label}`}
                  className={`p-1 rounded ${track.locked ? 'text-[#8B5CF6]' : 'text-slate-500 hover:text-white'}`}
                >
                  {track.locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setTracks((ts) => ts.map((t) => (t.id === track.id ? { ...t, hidden: !t.hidden } : t)))
                  }
                  aria-label={`Toggle visibility on ${track.label}`}
                  className={`p-1 rounded ${track.hidden ? 'text-slate-600' : 'text-slate-500 hover:text-white'}`}
                >
                  {track.hidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="relative flex-1 overflow-x-auto">
          <div style={{ width: `${timelineWidthPx}px` }} className="relative">
            {/* Scrubber Ruler */}
            <div
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const x = e.clientX - rect.left;
                seekTo(x / zoomPxPerSec);
              }}
              className="relative h-7 cursor-pointer border-b border-white/[0.08] bg-[#11141C]"
            >
              {Array.from({ length: Math.ceil(actualDuration) + 1 }).map((_, sec) => (
                <div
                  key={sec}
                  style={{ left: `${sec * zoomPxPerSec}px` }}
                  className="absolute top-0 bottom-0 border-l border-white/10 pl-1 font-mono text-[10px] text-slate-500"
                >
                  {sec}s
                </div>
              ))}
            </div>

            {/* Track Lanes */}
            {tracks.map((track) => {
              const trackClips = clips.filter((c) => c.trackId === track.id);
              return (
                <div
                  key={track.id}
                  className={`relative h-10 border-b border-white/[0.05] ${
                    track.hidden ? 'opacity-30' : ''
                  }`}
                >
                  {trackClips.map((clip) => {
                    const left = clip.startSec * zoomPxPerSec;
                    const width = Math.max(24, (clip.endSec - clip.startSec) * zoomPxPerSec);
                    const isSelected = clip.id === selectedClipId;
                    return (
                      <button
                        key={clip.id}
                        type="button"
                        onClick={() => setSelectedClipId(clip.id)}
                        style={{ left: `${left}px`, width: `${width}px`, backgroundColor: `${clip.color}33` }}
                        className={`absolute top-1.5 bottom-1.5 rounded border px-2 text-left text-[11px] font-medium text-white truncate transition-colors ${
                          isSelected ? 'border-white ring-1 ring-white/50' : 'border-white/20'
                        }`}
                      >
                        {clip.label}
                      </button>
                    );
                  })}
                </div>
              );
            })}

            {/* Playhead */}
            <div
              style={{ left: `${currentTime * zoomPxPerSec}px` }}
              className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-[#EF4444]"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
