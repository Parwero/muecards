'use client';

import { useCallback, useRef, useState } from 'react';
import { ImagePlus, X, FileWarning, Camera, Loader2 } from 'lucide-react';

interface UploadZoneProps {
  file: File | null;
  previewUrl: string | null;
  previewLoading?: boolean;
  onFileChange: (file: File | null) => void;
}

const MAX_BYTES = 8 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

function isHeicFile(f: File): boolean {
  const name = f.name.toLowerCase();
  return (
    f.type === 'image/heic' ||
    f.type === 'image/heif' ||
    name.endsWith('.heic') ||
    name.endsWith('.heif')
  );
}

export function UploadZone({ file, previewUrl, previewLoading = false, onFileChange }: UploadZoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const validate = (f: File): string | null => {
    if (!ACCEPTED_TYPES.includes(f.type) && !isHeicFile(f))
      return 'Formato no soportado. Usa JPG, PNG, WEBP o HEIC.';
    if (f.size > MAX_BYTES) return 'La imagen supera 8 MB.';
    return null;
  };

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const next = files[0];
      const err = validate(next);
      if (err) {
        setError(err);
        return;
      }
      setError(null);
      onFileChange(next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onFileChange],
  );

  const clear = () => {
    onFileChange(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
      className="hidden"
      onChange={(e) => handleFiles(e.target.files)}
    />
  );

  // ── State 1: file selected with image preview (non-HEIC) ─────────────────
  if (file && previewUrl) {
    return (
      <div className="overflow-hidden rounded-sm border border-ink-600 bg-ink-900 shadow-card">
        {/* Instagram-style preview: 4:5 portrait, object-cover */}
        <div className="relative aspect-[4/5] w-full overflow-hidden bg-ink-950">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="Preview Instagram"
            className="h-full w-full object-cover"
          />
          {/* Instagram aspect ratio label */}
          <span className="absolute left-2 top-2 rounded-sm bg-ink-950/70 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-parchment-400 backdrop-blur">
            4 : 5 · Instagram
          </span>
          <button
            type="button"
            onClick={clear}
            className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full border border-ink-600 bg-ink-900/80 text-parchment-200 backdrop-blur transition hover:border-gold-400 hover:text-gold-300"
            aria-label="Quitar imagen"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex items-center justify-between border-t border-ink-700 bg-ink-900 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate font-mono text-xs text-parchment-200">{file.name}</p>
            <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-parchment-400">
              {(file.size / 1024).toFixed(0)} kb · {file.type.split('/')[1]}
            </p>
          </div>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400 hover:text-gold-300"
          >
            Cambiar
          </button>
        </div>
        {fileInput}
      </div>
    );
  }

  // ── State 2: HEIC converting or conversion failed ────────────────────────
  if (file && !previewUrl) {
    return (
      <div className="overflow-hidden rounded-sm border border-ink-600 bg-ink-900 shadow-card">
        <div className="flex aspect-[4/5] w-full flex-col items-center justify-center gap-4 bg-ink-950">
          {previewLoading ? (
            <>
              <Loader2 className="h-8 w-8 animate-spin text-gold-400" strokeWidth={1.5} />
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-parchment-400">
                Convirtiendo HEIC…
              </p>
            </>
          ) : (
            <>
              <div className="relative flex h-16 w-16 items-center justify-center">
                <div className="absolute inset-0 rotate-45 border border-gold-400/40" />
                <Camera className="relative h-6 w-6 text-gold-400" strokeWidth={1.5} />
              </div>
              <div className="space-y-1 px-8 text-center">
                <p className="font-serif text-lg text-parchment-50">Foto iOS lista</p>
                <p className="font-mono text-[10px] text-parchment-400">
                  Vista previa no disponible
                </p>
                <p className="font-mono text-[9px] uppercase tracking-wider text-parchment-400/60">
                  Se convertirá a JPG al publicar
                </p>
              </div>
            </>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-ink-700 bg-ink-900 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate font-mono text-xs text-parchment-200">{file.name}</p>
            <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-parchment-400">
              {(file.size / 1024).toFixed(0)} kb · HEIC
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400 hover:text-gold-300"
            >
              Cambiar
            </button>
            <button
              type="button"
              onClick={clear}
              className="font-mono text-[10px] uppercase tracking-[0.2em] text-parchment-400 hover:text-ember-400"
            >
              Quitar
            </button>
          </div>
        </div>
        {fileInput}
      </div>
    );
  }

  // ── State 3: empty drop zone ──────────────────────────────────────────────
  return (
    <div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={`group relative flex aspect-[4/5] w-full flex-col items-center justify-center gap-4 rounded-sm border border-dashed text-center transition ${
          dragOver
            ? 'border-gold-400 bg-ink-800'
            : 'border-ink-600 bg-ink-900/60 hover:border-gold-500/60 hover:bg-ink-900'
        }`}
      >
        <div className="relative flex h-14 w-14 items-center justify-center">
          <div className="absolute inset-0 rotate-45 border border-gold-400/40" />
          <ImagePlus className="relative h-5 w-5 text-gold-400" strokeWidth={1.5} />
        </div>
        <div className="space-y-1 px-8">
          <p className="font-serif text-xl text-parchment-50">Suelta tu carta aquí</p>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-parchment-400">
            o pulsa para seleccionar archivo
          </p>
        </div>
        <p className="absolute bottom-4 font-mono text-[10px] text-parchment-400">
          JPG · PNG · WEBP · HEIC — máx 8MB
        </p>
      </button>
      {error && (
        <div className="mt-3 flex items-center gap-2 border-l-2 border-ember-500 bg-ember-500/5 px-3 py-2 font-mono text-xs text-ember-500">
          <FileWarning className="h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}
      {fileInput}
    </div>
  );
}
