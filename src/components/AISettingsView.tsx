import { AlertTriangle, CheckCircle2, KeyRound, Loader2, RefreshCw, Shield, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { ProviderConfigStatus, ProviderId } from '../types/studio';
import { api } from '../services/api';

interface AISettingsViewProps {
  providers: ProviderConfigStatus[];
  onRefresh: () => void;
  onNotify: (msg: string) => void;
}

export function AISettingsView({ providers, onRefresh, onNotify }: AISettingsViewProps) {
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [feedback, setFeedback] = useState<string>('');

  const handleSave = async (provider: ProviderConfigStatus, overrides?: Partial<ProviderConfigStatus>) => {
    setSaving((s) => ({ ...s, [provider.provider]: true }));
    setFeedback('');
    try {
      const apiKey = keyInputs[provider.provider]?.trim();
      const payload = overrides
        ? {
            ...(overrides.selected_model !== undefined ? { selected_model: overrides.selected_model } : {}),
            ...(overrides.tts_model !== undefined ? { tts_model: overrides.tts_model } : {}),
            ...(overrides.transcribe_model !== undefined ? { transcribe_model: overrides.transcribe_model } : {}),
            ...(overrides.llm_model !== undefined ? { llm_model: overrides.llm_model } : {}),
          }
        : {
            ...(apiKey ? { apiKey } : {}),
            selected_model: provider.selected_model,
            tts_model: provider.tts_model,
            transcribe_model: provider.transcribe_model,
            llm_model: provider.llm_model,
          };
      await api.updateProvider(provider.provider, payload);
      if (!overrides) {
        setKeyInputs((k) => ({ ...k, [provider.provider]: '' }));
      }
      onNotify(`Saved ${provider.provider.toUpperCase()} configuration securely.`);
      onRefresh();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving((s) => ({ ...s, [provider.provider]: false }));
    }
  };

  const handleClearVaultKey = async (id: ProviderId) => {
    setFeedback('');
    try {
      await api.updateProvider(id, { clearKey: true });
      onNotify(`Cleared stored ${id.toUpperCase()} vault key.`);
      onRefresh();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : String(err));
    }
  };

  const handleTest = async (id: ProviderId) => {
    setTesting((t) => ({ ...t, [id]: true }));
    setFeedback('');
    try {
      const res = await api.testProvider(id);
      if (res.provider.last_test_status === 'connected') {
        onNotify(`${id.toUpperCase()} real connection verified (${res.provider.latency_ms} ms).`);
      } else {
        onNotify(`${id.toUpperCase()} connection test failed: ${res.provider.last_error}`);
      }
      onRefresh();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting((t) => ({ ...t, [id]: false }));
    }
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="rounded-xl border border-white/[0.08] bg-[#171B26] p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <Shield className="mt-0.5 h-5 w-5 shrink-0 text-[#8B5CF6]" />
          <div className="min-w-0">
            <h1 className="font-display text-base sm:text-lg font-bold text-white">Admin AI Provider Settings</h1>
            <p className="mt-1 text-xs text-slate-400">
              API keys are encrypted at rest with AES-256-GCM on the backend and never returned in full to browser clients. Connection tests execute genuine API requests.
            </p>
          </div>
        </div>
      </div>

      {feedback && (
        <div className="rounded-lg border border-[#EF4444]/40 bg-[#EF4444]/10 p-3 text-xs text-[#FCA5A5] break-words">
          {feedback}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
        {providers.map((p) => {
          const isGemini = p.provider === 'gemini';
          return (
            <div
              key={p.provider}
              className="rounded-xl border border-white/[0.08] bg-[#171B26] p-4 sm:p-5 space-y-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-white/[0.06] pb-3">
                <div className="min-w-0">
                  <h2 className="font-display text-base font-bold text-white">
                    {isGemini ? 'A. Google Gemini' : 'B. Groq'}
                  </h2>
                  <p className="text-xs text-slate-400">
                    {isGemini
                      ? 'Video understanding, scene analysis, Myanmar translation, recap scripts & Myanmar TTS'
                      : 'Groq Whisper speech transcription & ultra-fast text processing'}
                  </p>
                </div>

                <div className="text-xs shrink-0">
                  {p.last_test_status === 'connected' ? (
                    <span className="inline-flex items-center gap-1.5 font-semibold text-[#10B981]">
                      <CheckCircle2 className="h-4 w-4" />
                      Connected {p.latency_ms ? `(${p.latency_ms}ms)` : ''}
                    </span>
                  ) : p.last_test_status === 'error' ? (
                    <span className="inline-flex items-center gap-1.5 font-semibold text-[#EF4444]">
                      <AlertTriangle className="h-4 w-4" />
                      Connection Error
                    </span>
                  ) : (
                    <span className="text-slate-400">Not Tested</span>
                  )}
                </div>
              </div>

              {/* Masked key & source */}
              <div className="rounded-lg border border-white/[0.06] bg-[#0B0D12] p-3 text-xs space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <span className="text-slate-400">Active Key Status</span>
                  <span className="font-mono text-slate-200 break-all">
                    {p.configured ? `${p.masked_key} (${p.source})` : 'Not configured'}
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <span className="text-slate-400">Last Tested</span>
                  <span className="font-mono text-slate-300">
                    {p.last_test_at ? new Date(p.last_test_at).toLocaleString() : 'Never tested'}
                  </span>
                </div>
              </div>

              {p.last_error && (
                <div className="rounded-lg border border-[#EF4444]/40 bg-[#EF4444]/10 p-3 text-xs text-[#FCA5A5]">
                  <div className="font-semibold">Latest Provider Error</div>
                  <div className="mt-0.5 break-words">{p.last_error}</div>
                </div>
              )}

              {/* API Key Vault Input */}
              <div>
                <label
                  htmlFor={`key-${p.provider}`}
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  {isGemini ? 'Gemini API Key (Encrypted Vault Override)' : 'Groq API Key (gsk_...)'}
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1 min-w-0">
                    <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                    <input
                      id={`key-${p.provider}`}
                      type="password"
                      autoComplete="off"
                      value={keyInputs[p.provider] || ''}
                      onChange={(e) =>
                        setKeyInputs((prev) => ({ ...prev, [p.provider]: e.target.value }))
                      }
                      placeholder={p.configured ? 'Enter new key to replace...' : 'Paste secret API key...'}
                      className="min-h-[38px] w-full rounded-lg border border-white/10 bg-[#0B0D12] py-2 pl-9 pr-3 text-xs text-white placeholder:text-slate-500 focus:border-[#8B5CF6] focus:outline-none"
                    />
                  </div>
                  {p.source === 'vault' && (
                    <button
                      type="button"
                      onClick={() => void handleClearVaultKey(p.provider)}
                      title="Remove encrypted vault key"
                      aria-label={`Remove ${p.provider} vault key`}
                      className="rounded-lg border border-white/10 bg-[#0B0D12] px-2.5 text-slate-400 hover:text-[#EF4444]"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Model Selectors */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    {isGemini ? 'Primary Multimodal / Translation Model' : 'Primary LLM Model'}
                  </label>
                  <select
                    value={p.selected_model}
                    onChange={(e) => void handleSave(p, { selected_model: e.target.value })}
                    className="min-h-[38px] w-full rounded-lg border border-white/10 bg-[#0B0D12] px-2.5 py-2 text-xs text-white"
                  >
                    {p.available_models
                      .filter((m) =>
                        isGemini
                          ? m.capabilities.includes('text')
                          : m.capabilities.includes('text')
                      )
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                  </select>
                </div>

                {isGemini ? (
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Myanmar TTS Model</label>
                    <select
                      value={p.tts_model}
                      onChange={(e) => void handleSave(p, { tts_model: e.target.value })}
                      className="min-h-[38px] w-full rounded-lg border border-white/10 bg-[#0B0D12] px-2.5 py-2 text-xs text-white"
                    >
                      {p.available_models
                        .filter((m) => m.capabilities.includes('tts'))
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}
                          </option>
                        ))}
                    </select>
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Whisper Transcription Model</label>
                    <select
                      value={p.transcribe_model}
                      onChange={(e) => void handleSave(p, { transcribe_model: e.target.value })}
                      className="min-h-[38px] w-full rounded-lg border border-white/10 bg-[#0B0D12] px-2.5 py-2 text-xs text-white"
                    >
                      {p.available_models
                        .filter((m) => m.capabilities.includes('audio_transcribe'))
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}
                          </option>
                        ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={saving[p.provider]}
                  onClick={() => void handleSave(p)}
                  className="min-h-[38px] rounded-lg border border-white/15 bg-[#0B0D12] px-4 py-2 text-xs font-medium text-white hover:border-[#8B5CF6]/50"
                >
                  {saving[p.provider]
                    ? 'Encrypting & Saving...'
                    : isGemini
                      ? 'Save Gemini Config'
                      : 'Save Groq Config'}
                </button>
                <button
                  type="button"
                  disabled={testing[p.provider]}
                  onClick={() => void handleTest(p.provider)}
                  className="flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#8B5CF6] px-4 py-2 text-xs font-semibold text-white hover:bg-[#7C3AED] disabled:opacity-50"
                >
                  {testing[p.provider] ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  <span>{isGemini ? 'Test Gemini Connection' : 'Test Groq Connection'}</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* AI Task Routing Table */}
      <div className="rounded-xl border border-white/[0.08] bg-[#171B26] p-5">
        <h2 className="font-display text-sm font-semibold text-white mb-3">
          Active AI & Media Engine Task Routing
        </h2>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-5 text-xs">
          {[
            ['Video Understanding', 'Google Gemini'],
            ['Scene Analysis', 'Google Gemini'],
            ['Story Understanding', 'Google Gemini'],
            ['Myanmar Translation', 'Google Gemini'],
            ['Recap Script', 'Google Gemini'],
            ['Speech Transcription', 'Groq Whisper (Gemini fallback)'],
            ['Fast Text Processing', 'Groq LLM'],
            ['Myanmar TTS', 'Google Gemini TTS'],
            ['Audio Separation', 'Demucs / FFmpeg Spectral'],
            ['Extraction & Render', 'FFmpeg / FFprobe'],
          ].map(([task, engine]) => (
            <div key={task} className="rounded-lg bg-[#0B0D12]/80 p-3">
              <div className="text-slate-400">{task}</div>
              <div className="mt-1 font-semibold text-slate-100">{engine}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
