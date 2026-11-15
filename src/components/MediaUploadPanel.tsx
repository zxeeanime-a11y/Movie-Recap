import { AlertCircle, CheckCircle2, Cloud, Film, HardDrive, Pause, Play, Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';
import type { MediaFileRecord } from '../types/studio';
import { api, uploadFileChunked, type ChunkedUploadController } from '../services/api';

interface MediaUploadPanelProps {
  projectId?: string;
  onUploaded: (media: MediaFileRecord) => void;
}

interface UploadItem {
  id: string;
  name: string;
  progress: number;
  statusText: string;
  paused: boolean;
  error?: string;
  done: boolean;
  controller?: ChunkedUploadController;
}

export function MediaUploadPanel({ projectId, onUploaded }: MediaUploadPanelProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [storageMode, setStorageMode] = useState<'local' | 'cloud'>('local');
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [generatingSample, setGeneratingSample] = useState(false);
  const [sampleError, setSampleError] = useState('');

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);

    for (const file of files) {
      const uid = `u_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      setUploads((prev) => [
        ...prev,
        { id: uid, name: file.name, progress: 0, statusText: 'Queued', paused: false, done: false },
      ]);

      try {
        const res = await uploadFileChunked({
          file,
          projectId,
          storageMode,
          onProgress: (pct, statusText) => {
            setUploads((prev) =>
              prev.map((u) => (u.id === uid ? { ...u, progress: pct, statusText } : u))
            );
          },
          onControllerReady: (ctrl) => {
            setUploads((prev) =>
              prev.map((u) => (u.id === uid ? { ...u, controller: ctrl } : u))
            );
          },
        });
        setUploads((prev) =>
          prev.map((u) =>
            u.id === uid
              ? {
                  ...u,
                  progress: 100,
                  statusText: res.duplicate ? 'Duplicate linked' : 'Uploaded & verified',
                  done: true,
                }
              : u
          )
        );
        onUploaded(res.media);
      } catch (err) {
        setUploads((prev) =>
          prev.map((u) =>
            u.id === uid
              ? { ...u, error: err instanceof Error ? err.message : String(err), statusText: 'Failed' }
              : u
          )
        );
      }
    }
  };

  const handleGenerateSample = async () => {
    setGeneratingSample(true);
    setSampleError('');
    try {
      const res = await api.generateSampleMedia(projectId);
      onUploaded(res.media);
    } catch (err) {
      setSampleError(err instanceof Error ? err.message : String(err));
    } finally {
      setGeneratingSample(false);
    }
  };

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-1 rounded-lg bg-[#0B0D12] p-1 border border-white/[0.08]">
          <button
            type="button"
            onClick={() => setStorageMode('local')}
            className={`flex min-h-[34px] items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
              storageMode === 'local' ? 'bg-[#171B26] text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <HardDrive className="h-3.5 w-3.5" />
            <span>Local</span>
          </button>
          <button
            type="button"
            onClick={() => setStorageMode('cloud')}
            className={`flex min-h-[34px] items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
              storageMode === 'cloud' ? 'bg-[#171B26] text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Cloud className="h-3.5 w-3.5" />
            <span>Cloud</span>
          </button>
        </div>

        <button
          type="button"
          onClick={handleGenerateSample}
          disabled={generatingSample}
          className="flex min-h-[38px] items-center gap-2 rounded-lg border border-white/10 bg-[#1E2331] px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-[#8B5CF6]/50 hover:text-white disabled:opacity-50"
        >
          <Film className="h-3.5 w-3.5 shrink-0 text-[#8B5CF6]" />
          <span>{generatingSample ? 'Rendering Sample...' : 'Generate Sample Clip'}</span>
        </button>
      </div>

      {sampleError && (
        <div className="flex items-center gap-2 rounded-lg border border-[#EF4444]/40 bg-[#EF4444]/10 p-3 text-xs text-[#FCA5A5]">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{sampleError}</span>
        </div>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void handleFiles(e.dataTransfer.files);
        }}
        className={`flex flex-col items-center justify-center rounded-xl border border-dashed p-6 text-center transition-colors ${
          dragging
            ? 'border-[#8B5CF6] bg-[#8B5CF6]/10'
            : 'border-white/15 bg-[#0B0D12] hover:border-white/25'
        }`}
      >
        <Upload className="h-7 w-7 text-[#8B5CF6]" />
        <p className="mt-2 text-sm font-medium text-slate-200">
          Drag and drop movie, audio, subtitle, or image files
        </p>
        <p className="mt-1 text-xs text-slate-400">
          MP4, MOV, MKV, WEBM · MP3, WAV, AAC, M4A, FLAC · SRT, ASS, VTT, TXT · JPG, PNG, WEBP
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          accept=".mp4,.mov,.mkv,.webm,.mp3,.wav,.aac,.m4a,.flac,.srt,.ass,.vtt,.txt,.jpg,.jpeg,.png,.webp"
          onChange={(e) => void handleFiles(e.target.files)}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-4 rounded-lg bg-[#8B5CF6] px-4 py-2 text-xs font-semibold text-white hover:bg-[#7C3AED]"
        >
          Select Files (Chunked Resumable)
        </button>
      </div>

      {uploads.length > 0 && (
        <div className="space-y-2">
          {uploads.map((item) => (
            <div key={item.id} className="rounded-lg border border-white/[0.08] bg-[#0B0D12] p-3">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate font-medium text-slate-200">{item.name}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-mono tabular-nums text-slate-400">{item.progress}%</span>
                  {!item.done && !item.error && item.controller && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          if (item.paused) {
                            item.controller?.resume();
                          } else {
                            item.controller?.pause();
                          }
                          setUploads((prev) =>
                            prev.map((u) => (u.id === item.id ? { ...u, paused: !u.paused } : u))
                          );
                        }}
                        aria-label={item.paused ? 'Resume upload' : 'Pause upload'}
                        className="rounded p-1 text-slate-300 hover:bg-white/10"
                      >
                        {item.paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => void item.controller?.cancel()}
                        aria-label="Cancel upload"
                        className="rounded p-1 text-slate-300 hover:bg-white/10 hover:text-[#EF4444]"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                  {item.done && <CheckCircle2 className="h-4 w-4 text-[#10B981]" />}
                </div>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className={`h-full transition-all ${item.error ? 'bg-[#EF4444]' : item.done ? 'bg-[#10B981]' : 'bg-[#8B5CF6]'}`}
                  style={{ width: `${item.progress}%` }}
                />
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[11px]">
                <span className={item.error ? 'text-[#FCA5A5]' : 'text-slate-400'}>
                  {item.error || item.statusText}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
