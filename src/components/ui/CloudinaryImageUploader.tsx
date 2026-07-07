/**
 * CloudinaryImageUploader
 *
 * A self-contained image uploader with:
 *  - Drag-and-drop or click-to-browse
 *  - Canvas-based crop with live preview (no external dep)
 *  - Zoom slider + drag-to-pan inside crop window
 *  - Per-slot aspect ratio enforcement (logo, favicon, og, banner…)
 *  - Uploads to Cloudinary via unsigned upload preset
 *  - Fetches cloud_name + upload_preset from /api/v1/settings/cloudinary
 *
 * Usage:
 *   <CloudinaryImageUploader
 *     label="Logo"
 *     fieldKey="logo_url"
 *     aspectRatio={4}           // width/height — undefined = free
 *     recommendedSize="400×100px"
 *     hint="Shown in navbar and footer"
 *     currentUrl={form.logo_url}
 *     onChange={url => update('logo_url', url)}
 *   />
 */

import { useRef, useState, useCallback, useEffect } from 'react'
import { settingsAPI } from '../../services/api'

// ── types ──────────────────────────────────────────────────────
interface CloudinarySettings {
  cloud_name: string
  upload_preset: string
  folder?: string
}

interface Props {
  label: string
  fieldKey: string
  aspectRatio?: number          // w/h — undefined = free crop
  recommendedSize?: string
  hint?: string
  currentUrl?: string
  onChange: (url: string) => void
  brand?: string
}

// ── shared Cloudinary settings cache ──────────────────────────
let _settingsCache: CloudinarySettings | null = null
let _settingsFetch: Promise<CloudinarySettings | null> | null = null

async function getCloudinarySettings(): Promise<CloudinarySettings | null> {
  if (_settingsCache) return _settingsCache
  if (_settingsFetch) return _settingsFetch
  _settingsFetch = settingsAPI.cloudinary()
    .then(r => {
      const d = r.data?.data || {}
      if (d.cloud_name && d.upload_preset) {
        _settingsCache = { cloud_name: d.cloud_name, upload_preset: d.upload_preset, folder: d.folder }
        return _settingsCache
      }
      return null
    })
    .catch(() => null)
  return _settingsFetch
}

// ── canvas crop helper ─────────────────────────────────────────
interface CropState {
  zoom: number       // 1 = fit, >1 = zoomed in
  offsetX: number   // fraction of source image width
  offsetY: number   // fraction of source image height
}

function drawCropPreview(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  crop: CropState,
  aspectRatio: number | undefined,
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const canvasW = canvas.width
  const canvasH = canvas.height

  // Natural image size
  const nw = img.naturalWidth
  const nh = img.naturalHeight

  // At zoom=1, we fit the entire image into the crop box respecting aspect ratio
  const boxAR = canvasW / canvasH
  const imgAR  = nw / nh

  // Scale so image fills canvas at zoom=1
  let baseW: number, baseH: number
  if (imgAR > boxAR) {
    baseW = canvasW
    baseH = canvasW / imgAR
  } else {
    baseH = canvasH
    baseW = canvasH * imgAR
  }

  const drawW = baseW * crop.zoom
  const drawH = baseH * crop.zoom

  // Center offset + pan
  const cx = (canvasW - drawW) / 2 + crop.offsetX * canvasW
  const cy = (canvasH - drawH) / 2 + crop.offsetY * canvasH

  ctx.clearRect(0, 0, canvasW, canvasH)

  // Checkerboard for transparency
  const sz = 12
  for (let row = 0; row < canvasH / sz + 1; row++) {
    for (let col = 0; col < canvasW / sz + 1; col++) {
      ctx.fillStyle = (row + col) % 2 === 0 ? '#e5e7eb' : '#f9fafb'
      ctx.fillRect(col * sz, row * sz, sz, sz)
    }
  }

  ctx.drawImage(img, cx, cy, drawW, drawH)
}

// ── extract cropped blob ───────────────────────────────────────
function extractCrop(
  img: HTMLImageElement,
  crop: CropState,
  aspectRatio: number | undefined,
  outputW: number,
): Promise<Blob> {
  const nw = img.naturalWidth
  const nh = img.naturalHeight
  const outputH = aspectRatio ? Math.round(outputW / aspectRatio) : Math.round(outputW * nh / nw)

  const canvas = document.createElement('canvas')
  canvas.width  = outputW
  canvas.height = outputH

  const ctx = canvas.getContext('2d')!

  // Reproduce the same geometry as the preview
  const PREVIEW_W = 480
  const PREVIEW_H = aspectRatio ? Math.round(PREVIEW_W / aspectRatio) : 270

  const imgAR  = nw / nh
  const boxAR  = PREVIEW_W / PREVIEW_H

  let baseW: number, baseH: number
  if (imgAR > boxAR) {
    baseW = PREVIEW_W
    baseH = PREVIEW_W / imgAR
  } else {
    baseH = PREVIEW_H
    baseW = PREVIEW_H * imgAR
  }

  const drawW = baseW * crop.zoom
  const drawH = baseH * crop.zoom
  const cx = (PREVIEW_W - drawW) / 2 + crop.offsetX * PREVIEW_W
  const cy = (PREVIEW_H - drawH) / 2 + crop.offsetY * PREVIEW_H

  // Map canvas pixel → preview pixel → source pixel
  const scaleX = outputW / PREVIEW_W
  const scaleY = outputH / PREVIEW_H

  // Source rect in natural pixels
  const srcX = (-cx / drawW) * nw
  const srcY = (-cy / drawH) * nh
  const srcW = (PREVIEW_W / drawW) * nw
  const srcH = (PREVIEW_H / drawH) * nh

  ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, outputW, outputH)

  return new Promise(resolve => canvas.toBlob(b => resolve(b!), 'image/png', 0.95))
}

// ── main component ─────────────────────────────────────────────
export default function CloudinaryImageUploader({
  label, fieldKey, aspectRatio, recommendedSize, hint, currentUrl, onChange, brand = '#1B4FD8',
}: Props) {
  const [phase, setPhase] = useState<'idle'|'crop'|'uploading'|'done'>('idle')
  const [imgEl, setImgEl]   = useState<HTMLImageElement | null>(null)
  const [crop, setCrop]     = useState<CropState>({ zoom: 1, offsetX: 0, offsetY: 0 })
  const [err, setErr]       = useState('')
  const [progress, setProgress] = useState(0)
  const [dragging, setDragging] = useState(false)

  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const dragStart   = useRef<{x:number;y:number;ox:number;oy:number} | null>(null)
  const fileInputRef= useRef<HTMLInputElement>(null)

  // Preview canvas dimensions
  const PREVIEW_W = 480
  const PREVIEW_H = aspectRatio ? Math.round(PREVIEW_W / aspectRatio) : 270

  // Redraw whenever crop or image changes
  useEffect(() => {
    if (phase !== 'crop' || !imgEl || !canvasRef.current) return
    drawCropPreview(canvasRef.current, imgEl, crop, aspectRatio)
  }, [crop, imgEl, phase, aspectRatio])

  // Load file → image element
  const loadFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) { setErr('Please select an image file.'); return }
    const reader = new FileReader()
    reader.onload = e => {
      const img = new Image()
      img.onload = () => {
        setImgEl(img)
        setCrop({ zoom: 1, offsetX: 0, offsetY: 0 })
        setPhase('crop')
        setErr('')
      }
      img.src = e.target!.result as string
    }
    reader.readAsDataURL(file)
  }, [])

  // Drag-over zone
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) loadFile(f)
  }, [loadFile])

  // Canvas mouse pan
  const onCanvasMouseDown = (e: React.MouseEvent) => {
    dragStart.current = { x: e.clientX, y: e.clientY, ox: crop.offsetX, oy: crop.offsetY }
  }
  const onCanvasMouseMove = (e: React.MouseEvent) => {
    if (!dragStart.current) return
    const dx = (e.clientX - dragStart.current.x) / PREVIEW_W
    const dy = (e.clientY - dragStart.current.y) / PREVIEW_H
    setCrop(c => ({ ...c, offsetX: dragStart.current!.ox + dx, offsetY: dragStart.current!.oy + dy }))
  }
  const onCanvasMouseUp = () => { dragStart.current = null }

  // Touch pan
  const touchStart = useRef<{x:number;y:number;ox:number;oy:number} | null>(null)
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0]
    touchStart.current = { x: t.clientX, y: t.clientY, ox: crop.offsetX, oy: crop.offsetY }
  }
  const onTouchMove = (e: React.TouchEvent) => {
    if (!touchStart.current) return
    const t = e.touches[0]
    const dx = (t.clientX - touchStart.current.x) / PREVIEW_W
    const dy = (t.clientY - touchStart.current.y) / PREVIEW_H
    setCrop(c => ({ ...c, offsetX: touchStart.current!.ox + dx, offsetY: touchStart.current!.oy + dy }))
  }

  // Upload to Cloudinary
  const doUpload = async () => {
    if (!imgEl) return
    setPhase('uploading'); setProgress(10); setErr('')

    const settings = await getCloudinarySettings()
    if (!settings) {
      setErr('Cloudinary not configured. Go to Settings → Cloudinary tab first.')
      setPhase('crop'); return
    }

    try {
      // 1. Extract cropped blob
      const outputW = aspectRatio === 1 ? 256   // favicon
                    : aspectRatio && aspectRatio >= 1.5 && aspectRatio <= 2.1 ? 1200 // og
                    : aspectRatio && aspectRatio > 3 ? 800  // logo
                    : 1920  // banner / free
      const blob = await extractCrop(imgEl, crop, aspectRatio, outputW)
      setProgress(35)

      // 2. POST to Cloudinary
      const fd = new FormData()
      fd.append('file', blob, `${fieldKey}.png`)
      fd.append('upload_preset', settings.upload_preset)
      if (settings.folder) fd.append('folder', settings.folder)
      fd.append('public_id', `${fieldKey}_${Date.now()}`)

      const xhr = new XMLHttpRequest()
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) setProgress(35 + Math.round((ev.loaded / ev.total) * 55))
      }

      const url = await new Promise<string>((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status === 200) {
            const r = JSON.parse(xhr.responseText)
            resolve(r.secure_url)
          } else {
            reject(new Error(xhr.responseText))
          }
        }
        xhr.onerror = () => reject(new Error('Network error'))
        xhr.open('POST', `https://api.cloudinary.com/v1_1/${settings.cloud_name}/image/upload`)
        xhr.send(fd)
      })

      setProgress(100)
      onChange(url)
      setPhase('done')
    } catch (e: any) {
      let msg = e.message || 'Upload failed'
      try { const j = JSON.parse(msg); msg = j.error?.message || msg } catch {}
      setErr(msg)
      setPhase('crop')
    }
  }

  const reset = () => {
    setPhase('idle'); setImgEl(null); setCrop({ zoom: 1, offsetX: 0, offsetY: 0 })
    setErr(''); setProgress(0)
  }

  // ── render ─────────────────────────────────────────────────
  const previewAR = aspectRatio || (16/9)

  return (
    <div style={{ marginBottom: 22 }}>
      {/* Label row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <label style={{ fontSize: 12, fontWeight: 700, color: '#374151',
          textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</label>
        {recommendedSize && (
          <span style={{ fontSize: 11, color: '#94A3B8', background: '#F1F5F9',
            padding: '1px 7px', borderRadius: 20 }}>{recommendedSize}</span>
        )}
      </div>

      {/* Current URL display */}
      {currentUrl && currentUrl !== '' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
          background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: '6px 10px' }}>
          <img src={currentUrl} alt="" style={{ height: 32, maxWidth: 100, objectFit: 'contain', borderRadius: 4 }} />
          <span style={{ flex: 1, fontSize: 11, color: '#64748B', overflow: 'hidden',
            textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentUrl}</span>
          <button onClick={reset} title="Change image"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8',
              fontSize: 14, padding: '2px 4px', flexShrink: 0 }}>✕</button>
        </div>
      )}

      {/* ── IDLE: drop zone ── */}
      {phase === 'idle' && (
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${dragging ? brand : '#CBD5E1'}`,
            borderRadius: 12, padding: '24px 16px', textAlign: 'center',
            cursor: 'pointer', background: dragging ? `${brand}08` : '#FAFAFA',
            transition: 'all 0.15s',
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 8 }}>🖼️</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
            {currentUrl ? 'Replace Image' : 'Upload Image'}
          </div>
          <div style={{ fontSize: 12, color: '#94A3B8' }}>
            Drop here or click to browse · PNG, JPG, WebP, SVG
          </div>
          {recommendedSize && (
            <div style={{ fontSize: 11, color: '#64748B', marginTop: 4 }}>
              Recommended: {recommendedSize}
            </div>
          )}
          <input ref={fileInputRef} type="file" accept="image/*"
            style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = '' }} />
        </div>
      )}

      {/* ── CROP tool ── */}
      {phase === 'crop' && imgEl && (
        <div style={{ border: '1px solid #E2E8F0', borderRadius: 14, overflow: 'hidden',
          background: '#0F172A' }}>

          {/* Toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
            background: '#1E293B', borderBottom: '1px solid #334155' }}>
            <span style={{ fontSize: 13, color: '#94A3B8', fontWeight: 600 }}>✂️ Crop & Adjust</span>
            {aspectRatio && (
              <span style={{ fontSize: 11, color: '#64748B', background: '#0F172A',
                padding: '2px 8px', borderRadius: 20 }}>
                {aspectRatio === 1 ? '1:1' : aspectRatio >= 1.8 && aspectRatio <= 2 ? '16:9 OG'
                  : aspectRatio > 3 ? 'Logo (wide)' : `${aspectRatio.toFixed(1)}:1`} locked
              </span>
            )}
            <span style={{ fontSize: 11, color: '#64748B', marginLeft: 'auto' }}>Drag to pan</span>
          </div>

          {/* Canvas */}
          <div style={{ position: 'relative', display: 'flex', justifyContent: 'center',
            background: '#0F172A', padding: '16px 16px 8px' }}>
            <canvas
              ref={canvasRef}
              width={PREVIEW_W}
              height={PREVIEW_H}
              style={{
                borderRadius: 8, cursor: 'grab', maxWidth: '100%',
                display: 'block',
                border: `2px solid ${brand}40`,
              }}
              onMouseDown={onCanvasMouseDown}
              onMouseMove={onCanvasMouseMove}
              onMouseUp={onCanvasMouseUp}
              onMouseLeave={onCanvasMouseUp}
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
              onTouchEnd={() => { touchStart.current = null }}
            />
            {/* Aspect ratio guide overlay */}
            {!aspectRatio && (
              <div style={{ position: 'absolute', top: 24, right: 24,
                fontSize: 11, color: '#fff', background: 'rgba(0,0,0,0.5)',
                padding: '2px 8px', borderRadius: 20 }}>Free crop</div>
            )}
          </div>

          {/* Zoom slider */}
          <div style={{ padding: '10px 20px 14px', background: '#1E293B' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 16, color: '#64748B' }}>🔍</span>
              <span style={{ fontSize: 12, color: '#64748B', width: 32, flexShrink: 0 }}>
                {Math.round(crop.zoom * 100)}%
              </span>
              <input
                type="range" min="100" max="400" step="1"
                value={Math.round(crop.zoom * 100)}
                onChange={e => setCrop(c => ({ ...c, zoom: Number(e.target.value) / 100 }))}
                style={{ flex: 1, accentColor: brand, height: 4 }}
              />
              <button onClick={() => setCrop({ zoom: 1, offsetX: 0, offsetY: 0 })}
                style={{ fontSize: 11, color: '#94A3B8', background: '#0F172A',
                  border: '1px solid #334155', borderRadius: 6,
                  padding: '3px 8px', cursor: 'pointer' }}>Reset</button>
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={doUpload}
                style={{ flex: 1, background: brand, color: 'white', border: 'none',
                  borderRadius: 8, padding: '9px 0', fontSize: 13, fontWeight: 700,
                  cursor: 'pointer' }}>
                ☁️ Upload to Cloudinary
              </button>
              <button onClick={reset}
                style={{ padding: '9px 16px', background: '#334155', color: '#94A3B8',
                  border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
            {err && (
              <div style={{ marginTop: 8, fontSize: 12, color: '#FCA5A5',
                background: '#450A0A', borderRadius: 6, padding: '6px 10px' }}>⚠️ {err}</div>
            )}
          </div>
        </div>
      )}

      {/* ── UPLOADING ── */}
      {phase === 'uploading' && (
        <div style={{ border: '1px solid #BFDBFE', borderRadius: 12, padding: 20,
          background: '#EFF6FF', textAlign: 'center' }}>
          <div style={{ fontSize: 28, marginBottom: 10 }}>☁️</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#1E40AF', marginBottom: 12 }}>
            Uploading to Cloudinary…
          </div>
          <div style={{ background: '#BFDBFE', borderRadius: 100, height: 6, overflow: 'hidden' }}>
            <div style={{ height: '100%', background: brand, width: `${progress}%`,
              transition: 'width 0.3s', borderRadius: 100 }} />
          </div>
          <div style={{ fontSize: 12, color: '#3B82F6', marginTop: 6 }}>{progress}%</div>
        </div>
      )}

      {/* ── DONE ── */}
      {phase === 'done' && currentUrl && (
        <div style={{ border: '1px solid #86EFAC', borderRadius: 12, padding: 14,
          background: '#F0FDF4', display: 'flex', alignItems: 'center', gap: 12 }}>
          <img src={currentUrl} alt=""
            style={{ height: 48, maxWidth: 120, objectFit: 'contain', borderRadius: 6,
              background: '#fff', padding: 4 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#166534', marginBottom: 2 }}>
              ✅ Uploaded successfully
            </div>
            <div style={{ fontSize: 11, color: '#15803D', wordBreak: 'break-all' }}>{currentUrl}</div>
          </div>
          <button onClick={reset}
            style={{ fontSize: 12, color: '#15803D', background: 'none',
              border: '1px solid #86EFAC', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>
            Replace
          </button>
        </div>
      )}

      {hint && (
        <p style={{ fontSize: 11, color: '#94A3B8', marginTop: 5 }}>💡 {hint}</p>
      )}
    </div>
  )
}
