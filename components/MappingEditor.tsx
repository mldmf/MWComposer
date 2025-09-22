"use client";
import React, { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Download, Upload, Plus, Trash2, Copy, ListPlus, Shuffle } from "lucide-react";

/* ---------- Types ---------- */
type Rect = { x: number; y: number; w: number; h: number };
type Zone = { src: Rect; dst: Rect };
type OverlayCfg = { media_root?: string; playlist?: string[]; loop?: boolean; zones?: "same" | Zone[] };
type Source = { media_root?: string; playlists?: Record<string, string[]>; bundles?: Record<string, string[][]>; active?: string; source: { w: number; h: number }; zones: Zone[]; overlay?: OverlayCfg };
type Mapping = { canvas: { w: number; h: number }; fps?: number; loop?: boolean; active_profile?: string; profiles?: string[]; sources: Source[] };

/* ---------- Helpers ---------- */
function deepClone<T>(o: T): T { return JSON.parse(JSON.stringify(o)); }
function clamp(v:number,min:number,max:number){ return Math.max(min, Math.min(max, v)); }
function downloadFile(filename:string, content:string, mime="application/json"){
  const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([content],{type:mime})); a.download=filename; a.click();
}
function hexToRgba(hex: string, alpha: number) {
  const m = hex.replace("#","");
  const r = parseInt(m.substring(0,2), 16);
  const g = parseInt(m.substring(2,4), 16);
  const b = parseInt(m.substring(4,6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function hexToRgb(hex: string){
  const m = hex.replace("#","");
  const r = parseInt(m.substring(0,2), 16);
  const g = parseInt(m.substring(2,4), 16);
  const b = parseInt(m.substring(4,6), 16);
  return { r, g, b };
}


function shadeColor(hex: string, offset: number){
  const { r, g, b } = hexToRgb(hex);
  const clamp = (v:number)=>Math.max(0, Math.min(255, Math.round(v)));
  const adjust = (c:number)=>{
    if(offset >= 0){
      return clamp(c + (255 - c) * offset);
    }
    return clamp(c * (1 + offset));
  };
  return `rgb(${adjust(r)}, ${adjust(g)}, ${adjust(b)})`;
}

/* ---------- UI: iOS-like Toggle Switch (no layout shift) ---------- */
function IOSwitch({ checked, onChange }:{ checked:boolean; onChange:(v:boolean)=>void }){
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      onKeyDown={(e)=>{ if(e.key === " " || e.key === "Enter"){ e.preventDefault(); onChange(!checked); } }}
      className={[
        "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer items-center rounded-full border transition-colors",
        checked ? "bg-green-500 border-green-500" : "bg-gray-300 border-gray-300"
      ].join(" ")}
    >
      <span
        aria-hidden="true"
        className={[
          "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-5" : "translate-x-1"
        ].join(" ")}
      />
    </button>
  );
}

/* ---------- Auto-Placement (ohne Skalierung, zeilenweise über ALLE Sources) ---------- */
function autoPlacementNoScale(mapping: Mapping): Mapping {
  const next = deepClone(mapping);
  const cw = next.canvas.w;
  const ch = next.canvas.h;

  let cursorX = 0;
  let cursorY = 0;

  next.sources.forEach(s => { s.zones = []; });

  const newLine = (lineH: number) => { cursorX = 0; cursorY += lineH; };

  for (let si = 0; si < next.sources.length; si++) {
    const s = next.sources[si];
    const sw = Math.max(1, s.source.w);
    const sh = Math.max(1, s.source.h);

    let remaining = sw;
    let srcX = 0;

    while (remaining > 0) {
      if (cursorX >= cw) newLine(sh);
      if (cursorY + sh > ch) return next;

      const spaceInRow = cw - cursorX;
      const sliceW = Math.min(spaceInRow, remaining);

      const zone: Zone = {
        src: { x: srcX, y: 0, w: sliceW, h: sh },
        dst: { x: cursorX, y: cursorY, w: sliceW, h: sh },
      };
      s.zones.push(zone);

      cursorX += sliceW;
      srcX += sliceW;
      remaining -= sliceW;

      if (cursorX >= cw && remaining > 0) newLine(sh);
    }
  }
  return next;
}

/* checkerboard background for canvases */
function drawChecker(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const step = 16;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const on = (((x / step) + (y / step)) | 0) % 2 === 0;
      ctx.fillStyle = on ? "#f3f4f6" : "#e5e7eb";
      ctx.fillRect(x, y, step, step);
    }
  }
}

/* ---------- ZoneCanvas (responsive + HiDPI, kein Abschneiden) ---------- */
function ZoneCanvas({
  title, size, zones, select, onSelect, kind, onMoveZone,
  srcIdx,
  srcIdxs,
  localIdxs,
  activeSrcIdx,
  className,
  preferredAspect,
} : {
  title:string;
  size:{w:number;h:number};
  zones:Zone[];
  select:number|null;
  onSelect:(i:number|null)=>void;
  kind:"src"|"dst";
  onMoveZone:(idx:number, r:Rect)=>void;
  srcIdx?: number;
  srcIdxs?: number[];
  localIdxs?: number[];
  activeSrcIdx?: number;
  className?: string;
  preferredAspect?: number;
}){
  const wrapRef = useRef<HTMLDivElement|null>(null);
  const canvasRef = useRef<HTMLCanvasElement|null>(null);
  const [displayW, setDisplayW] = useState<number>(640); // sichtbare CSS-Breite
  const dpr = typeof window !== "undefined" ? Math.max(1, Math.min(3, window.devicePixelRatio||1)) : 1;
  const MIN_DISPLAY_HEIGHT = 25;

  // responsive: Containerbreite beobachten
  useEffect(()=>{
    if(!wrapRef.current) return;
    const ro = new ResizeObserver(entries=>{
      const w = Math.floor(entries[0].contentRect.width);
      if (w>0) setDisplayW(w);
    });
    ro.observe(wrapRef.current);
    return ()=>ro.disconnect();
  },[]);

  // Canvas-Setup (HiDPI)
  const safeWidth = Math.max(1, size.w);
  const safeHeight = Math.max(1, size.h);
  const aspect = safeHeight / safeWidth;
  const naturalHeight = aspect * displayW;
  const preferredHeight = preferredAspect ? preferredAspect * displayW : 0;
  const displayH = Math.max(1, Math.round(Math.max(MIN_DISPLAY_HEIGHT, naturalHeight, preferredHeight)));
  useEffect(()=>{
    const c = canvasRef.current; if(!c) return;
    // physische Pixel
    c.width  = Math.max(1, Math.round(displayW * dpr));
    c.height = Math.max(1, Math.round(displayH * dpr));
    // CSS-Größe
    c.style.width  = `${displayW}px`;
    c.style.height = `${displayH}px`;
    const ctx = c.getContext("2d"); if(!ctx) return;
    ctx.setTransform(dpr,0,0,dpr,0,0); // 1 CSS px == 1 logischer px
  },[displayW, displayH, dpr]);

  const scaleX = displayW / safeWidth;
  const scaleY = displayH / safeHeight;
  const palette = ["#96f74b","#f910cd","#674ed1","#f59e0b","#0ea5e9","#10b981","#ef4444","#8b5cf6"];
  const shadeSteps = [-0.25, -0.1, 0, 0.12, 0.28];

  // Render
  useEffect(()=>{
    const c=canvasRef.current!; const ctx=c.getContext("2d"); if(!ctx) return;
    ctx.clearRect(0,0,displayW,displayH);
    drawChecker(ctx, displayW, displayH);

    zones.forEach((z,i)=>{
      const r=z[kind];
      const x = r.x*scaleX, y = r.y*scaleY, w = r.w*scaleX, h = r.h*scaleY;

      const zoneSrcIdx = (srcIdxs && srcIdxs[i] != null) ? srcIdxs[i] : (srcIdx ?? 0);
      const zoneLocalIdx = (localIdxs && localIdxs[i] != null) ? localIdxs[i] : i;
      const baseColor = palette[zoneSrcIdx % palette.length];
      const isActive = (activeSrcIdx == null) ? true : (zoneSrcIdx === activeSrcIdx);
      const shade = shadeSteps[zoneLocalIdx % shadeSteps.length];
      const fillColor = isActive ? shadeColor(baseColor, shade) : shadeColor(baseColor, 0.55);
      const strokeColor = isActive ? shadeColor(baseColor, Math.max(-0.35, shade - 0.2)) : "#9ca3af";
      const borderAccent = isActive ? shadeColor(baseColor, shade + 0.25) : shadeColor(baseColor, 0.7);

      // Füllung
      ctx.fillStyle = fillColor;
      ctx.fillRect(x, y, w, h);

      // Rahmen
      ctx.lineWidth=2;
      ctx.setLineDash(isActive ? [] : [5,4]);
      ctx.strokeStyle = strokeColor;
      ctx.strokeRect(Math.round(x)+0.5, Math.round(y)+0.5, Math.round(w), Math.round(h));
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = borderAccent;
      ctx.strokeRect(Math.round(x)+0.5, Math.round(y)+0.5, Math.round(w), Math.round(h));
      ctx.setLineDash([]);
      ctx.lineWidth = 2;

      // Label
      ctx.font="12px ui-sans-serif";
      ctx.fillStyle = isActive ? "#111827" : "#4b5563";
      ctx.fillText(String(i), x+4, y+14);
    });
  }, [zones, select, kind, scaleX, scaleY, displayW, displayH, srcIdx, srcIdxs, activeSrcIdx, localIdxs]);

  // Interaktion (wie gehabt)
  const st=useRef<{drag:boolean;idx:number|null;offX:number;offY:number;rect:Rect|null}>({drag:false,idx:null,offX:0,offY:0,rect:null});
  const toRect=(cx:number,cy:number)=>{
    const r=canvasRef.current!.getBoundingClientRect();
    return {x:(cx-r.left)/scaleX, y:(cy-r.top)/scaleY};
  };

  const down=(e:React.MouseEvent)=>{
    const {x,y}=toRect(e.clientX,e.clientY);
    let hit:number|null=null;
    for(let i=zones.length-1;i>=0;i--){
      const r=zones[i][kind];
      if(x>=r.x && x<=r.x+r.w && y>=r.y && y<=r.y+r.h){ hit=i; break; }
    }
    if(hit==null){ st.current.drag=false; st.current.idx=null; onSelect(null); return; }
    const zoneSrcIdx = (srcIdxs && srcIdxs[hit] != null) ? srcIdxs[hit] : (srcIdx ?? 0);
    const isActive = (activeSrcIdx == null) ? true : (zoneSrcIdx === activeSrcIdx);
    if(!isActive){ st.current.drag=false; st.current.idx=null; return; }
    const localIdx = (localIdxs && localIdxs[hit] != null) ? localIdxs[hit] : hit;
    onSelect(localIdx);
    const r=zones[hit][kind];
    st.current={drag:true,idx:localIdx,offX:x-r.x,offY:y-r.y,rect:{...r}};
  };
  const move=(e:React.MouseEvent)=>{
    if(!st.current.drag || st.current.idx==null || !st.current.rect) return;
    const {x,y}=toRect(e.clientX,e.clientY);
    const nextRect: Rect = {
      ...st.current.rect,
      x: Math.round(x - st.current.offX),
      y: Math.round(y - st.current.offY),
    };
    st.current.rect = nextRect;
    onMoveZone(st.current.idx, nextRect);
  };
  const up=()=>{ st.current.drag=false; st.current.rect=null; };

  return (
    <Card className={`shadow-sm h-full rounded-none ${className||""}`}>
      <CardHeader className="py-3">
        <CardTitle className="text-base">{title} <span className="text-xs text-gray-500">{size.w}×{size.h}</span></CardTitle>
      </CardHeader>
      <CardContent>
        <div ref={wrapRef} className="border overflow-hidden">
          <canvas
            ref={canvasRef}
            className="cursor-pointer block w-full"
            onMouseDown={down}
            onMouseMove={move}
            onMouseUp={up}
            onMouseLeave={up}
          />
        </div>
        <p className="text-xs text-gray-500 mt-2">Responsive Vorschau – skaliert auf Containerbreite, HiDPI-scharf.</p>
      </CardContent>
    </Card>
  );
}

/* ---------- ZoneInspector ---------- */
function ZoneInspector({ mapping, setMapping, srcIdx, zoneIdx }:{mapping:Mapping,setMapping:(m:Mapping)=>void,srcIdx:number,zoneIdx:number|null}){
  const src = mapping.sources[srcIdx]; const z = (zoneIdx!=null)? src.zones[zoneIdx] : null;
  const update=(path:(z:Zone)=>void)=>{
    const n=deepClone(mapping); const t=n.sources[srcIdx].zones[zoneIdx!]; path(t);
    t.dst.w=t.src.w; t.dst.h=t.src.h;
    t.src.x=clamp(t.src.x,0,src.source.w-t.src.w); t.src.y=clamp(t.src.y,0,src.source.h-t.src.h);
    t.dst.x=clamp(t.dst.x,0,n.canvas.w-t.dst.w); t.dst.y=clamp(t.dst.y,0,n.canvas.h-t.dst.h);
    setMapping(n);
  };
  if(!z) return (<Card className="shadow-sm h-full"><CardHeader className="py-3"><CardTitle className="text-base">Zone</CardTitle></CardHeader><CardContent className="text-sm text-gray-500">Keine Zone ausgewählt.</CardContent></Card>);
  return (<Card className="shadow-sm h-full">
    <CardHeader className="py-3"><CardTitle className="text-base">Zone #{zoneIdx}</CardTitle></CardHeader>
    <CardContent className="space-y-3">
      <div>
        <div className="text-xs font-medium text-gray-600 mb-1">Quelle (src)</div>
        <div className="grid grid-cols-4 gap-2 items-center">
          <Label className="text-xs">x</Label><Input type="number" value={z.src.x} onChange={e=>update(t=>t.src.x=Number(e.target.value))}/>
          <Label className="text-xs">y</Label><Input type="number" value={z.src.y} onChange={e=>update(t=>t.src.y=Number(e.target.value))}/>
          <Label className="text-xs">w</Label><Input type="number" value={z.src.w} onChange={e=>update(t=>t.src.w=Math.max(1,Number(e.target.value)))}/>
          <Label className="text-xs">h</Label><Input type="number" value={z.src.h} onChange={e=>update(t=>t.src.h=Math.max(1,Number(e.target.value)))}/>
        </div>
      </div>
      <div>
        <div className="text-xs font-medium text-gray-600 mb-1">Ziel (dst)</div>
        <div className="grid grid-cols-4 gap-2 items-center">
          <Label className="text-xs">x</Label><Input type="number" value={z.dst.x} onChange={e=>update(t=>t.dst.x=Number(e.target.value))}/>
          <Label className="text-xs">y</Label><Input type="number" value={z.dst.y} onChange={e=>update(t=>t.dst.y=Number(e.target.value))}/>
          <Label className="text-xs">w</Label><Input type="number" value={z.dst.w} disabled/>
          <Label className="text-xs">h</Label><Input type="number" value={z.dst.h} disabled/>
        </div>
      </div>
    </CardContent>
  </Card>);
}

/* ---------- OverlayEditor (basic, unverändert) ---------- */
function OverlayEditor({ mapping, setMapping, srcIdx }:{mapping:Mapping,setMapping:(m:Mapping)=>void,srcIdx:number}){
  const src = mapping.sources[srcIdx]; const overlay = src.overlay || {};
  const setOverlay=(fn:(o:OverlayCfg)=>void)=>{ const n=deepClone(mapping); if(!n.sources[srcIdx].overlay) n.sources[srcIdx].overlay={}; fn(n.sources[srcIdx].overlay!); setMapping(n); };
  return (<Card className="shadow-sm">
    <CardHeader className="py-3"><CardTitle className="text-base">Overlay</CardTitle></CardHeader>
    <CardContent className="space-y-2">
      <Label className="text-xs">media_root</Label>
      <Input value={overlay.media_root||""} onChange={e=>setOverlay(o=>{o.media_root=e.target.value;})} />
      <Label className="text-xs">playlist (CSV)</Label>
      <Input value={(overlay.playlist||[]).join(",")} onChange={e=>setOverlay(o=>{o.playlist=e.target.value.split(",").map(s=>s.trim()).filter(Boolean);})} />
      <div className="flex items-center gap-2">
        <Checkbox checked={!!overlay.loop} onChange={e=>setOverlay(o=>{o.loop=(e.target as HTMLInputElement).checked;})} />
        <span className="text-sm">loop</span>
      </div>
      <Label className="text-xs">zones ("same" oder JSON)</Label>
      <Input value={typeof overlay.zones==="string"?(overlay.zones||"same"):JSON.stringify(overlay.zones)} onChange={e=>setOverlay(o=>{try{const v=e.target.value.trim(); o.zones = (v==="same"?"same":JSON.parse(v));}catch{}})} />
    </CardContent>
  </Card>);
}

/* ---------- SourceEditor (Playlists-Tab ENTFERNT) ---------- */
type SourceEditorProps = { mapping: Mapping; setMapping: (m: Mapping) => void; srcIdx: number };

function SourceEditor({ mapping, setMapping, srcIdx }: SourceEditorProps) {
  const src = mapping.sources[srcIdx];
  const [selected, setSelected] = useState<number | null>(null);
  const maxSourceAspect = mapping.sources.reduce((acc, current) => {
    const w = current.source?.w || 0;
    const h = current.source?.h || 0;
    if (w <= 0 || h <= 0) return acc;
    return Math.max(acc, h / w);
  }, 0);

  const setZones = (fn: (zones: Zone[]) => Zone[]) => {
    const next = deepClone(mapping); next.sources[srcIdx].zones = fn(next.sources[srcIdx].zones || []); setMapping(next);
  };

  const addZone = () => {
    const def: Zone = {
      src: { x: 0, y: 0, w: Math.min(1920, src.source.w), h: Math.min(108, src.source.h) },
      dst: { x: 0, y: 0, w: Math.min(1920, src.source.w), h: Math.min(108, src.source.h) }
    };
    setZones(zs => [...zs, def]); setSelected((mapping.sources[srcIdx].zones?.length || 0));
  };
  const removeZone = () => { if (selected == null) return; setZones(zs => zs.filter((_, i) => i !== selected)); setSelected(null); };
  const copyZone = () => {
    if (selected == null) return;
    setZones(zs => {
      const c = deepClone(zs[selected]);
      c.src.x = clamp(c.src.x + 10, 0, src.source.w - c.src.w);
      c.src.y = clamp(c.src.y + 10, 0, src.source.h - c.src.h);
      c.dst.x = clamp(c.dst.x + 10, 0, mapping.canvas.w - c.dst.w);
      c.dst.y = clamp(c.dst.y + 10, 0, mapping.canvas.h - c.dst.h);
      return [...zs, c];
    });
    setSelected((mapping.sources[srcIdx].zones?.length || 0));
  };

  const moveZoneRect = (kind: "src" | "dst", idx: number, rect: Rect) => {
    const next = deepClone(mapping); const z = next.sources[srcIdx].zones[idx];
    if (kind === "src") { z.src = rect; z.dst.w = rect.w; z.dst.h = rect.h; }
    else { z.dst = rect; z.dst.w = z.src.w; z.dst.h = z.src.h; }
    z.src.x = clamp(z.src.x, 0, src.source.w - z.src.w); z.src.y = clamp(z.src.y, 0, src.source.h - z.src.h);
    z.dst.x = clamp(z.dst.x, 0, mapping.canvas.w - z.dst.w); z.dst.y = clamp(z.dst.y, 0, mapping.canvas.h - z.dst.h);
    setMapping(next);
  };

  const autoPlacement = () => {
    const next = autoPlacementNoScale(mapping);
    setMapping(next);
    setSelected(null);
  };

  // Für DEST-Canvas: alle Zonen zusammenführen + Mapping für aktive Source-Indices
  const mergedZones: Zone[] = [];
  const srcIdxs: number[] = [];
  const localIdxs: number[] = [];
  mapping.sources.forEach((s, i) => {
    let j = 0;
    (s.zones || []).forEach(z => {
      mergedZones.push(z);
      srcIdxs.push(i);
      localIdxs.push(j);
      j++;
    });
  });

  return (
    <div className="space-y-4">
      <Card className="shadow-sm">
        <CardHeader className="py-3"><CardTitle className="text-base">Quelle #{srcIdx}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-4 md:grid-cols-8 gap-3 items-center">
            <Label className="text-xs">source.w</Label>
            <Input type="number" value={src.source.w} onChange={e=>{ const next = deepClone(mapping); next.sources[srcIdx].source.w = Math.max(1, Number(e.target.value)); setMapping(next); }} />
            <Label className="text-xs">source.h</Label>
            <Input type="number" value={src.source.h} onChange={e=>{ const next = deepClone(mapping); next.sources[srcIdx].source.h = Math.max(1, Number(e.target.value)); setMapping(next); }} />
            {/* Insert media_root field here */}
            <Label className="text-xs">media_root</Label>
            <Input
              className="col-span-3 md:col-span-7"
              placeholder="/path/to/media"
              value={src.media_root || ""}
              onChange={e => {
                const next = deepClone(mapping);
                next.sources[srcIdx].media_root = (e.target as HTMLInputElement).value;
                setMapping(next);
              }}
            />
            <div className="col-span-4 flex gap-2 justify-end">
              <Button size="sm" variant="secondary" onClick={addZone}><Plus className="w-4 h-4 mr-1"/>Zone</Button>
              <Button size="sm" variant="secondary" onClick={copyZone} disabled={selected==null}><Copy className="w-4 h-4 mr-1"/>Duplizieren</Button>
              <Button size="sm" onClick={autoPlacement}><ListPlus className="w-4 h-4 mr-1"/>Auto-Placement</Button>
              <Button size="sm" variant="destructive" onClick={removeZone} disabled={selected==null}><Trash2 className="w-4 h-4 mr-1"/>Löschen</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="geometry">
        <TabsList>
          <TabsTrigger value="geometry">Geometrie</TabsTrigger>
          {/* Playlists-Tab entfernt */}
          <TabsTrigger value="overlay">Overlay</TabsTrigger>
        </TabsList>
        <TabsContent value="geometry">
          <div className="space-y-4">
            <ZoneCanvas
              title="SOURCE (src)"
              size={src.source}
              zones={src.zones || []}
              select={selected}
              onSelect={setSelected}
              kind="src"
              onMoveZone={(idx, r) => moveZoneRect("src", idx, r)}
              srcIdx={srcIdx}
              preferredAspect={maxSourceAspect}
            />
            <div className="grid md:grid-cols-2 gap-4 items-stretch">
              <ZoneInspector mapping={mapping} setMapping={setMapping} srcIdx={srcIdx} zoneIdx={selected} />
              <ZoneCanvas
                title="DEST (dst) – alle Zonen"
                size={mapping.canvas}
                zones={mergedZones}
                select={selected}
                onSelect={setSelected}
                kind="dst"
                onMoveZone={(idx, r) => moveZoneRect("dst", idx, { ...mapping.sources[srcIdx].zones[idx], ...mapping.sources[srcIdx].zones[idx]?.dst, x: Math.round(r.x), y: Math.round(r.y) } as any)}
                srcIdxs={srcIdxs}
                localIdxs={localIdxs}
                activeSrcIdx={srcIdx}
              />
            </div>
          </div>
        </TabsContent>
        <TabsContent value="overlay">
          <OverlayEditor mapping={mapping} setMapping={setMapping} srcIdx={srcIdx} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ---------- PlaylistMatrix (NEU: globale Section unter den Sources) ---------- */
function getActiveProfile(mapping: Mapping, s: Source): string {
  return s.active || mapping.active_profile || (mapping.profiles?.[0] ?? "default");
}

function PlaylistMatrix({ mapping, setMapping }:{mapping:Mapping; setMapping:(m:Mapping)=>void;}){
  const palette = ["#96f74b","#f910cd","#674ed1","#f59e0b","#0ea5e9","#10b981","#ef4444","#8b5cf6"];

  const getFiles = (s: Source, profile: string) => s.playlists?.[profile] || [];
  const profiles = mapping.profiles || ["default"];
  const [profile, setProfile] = useState<string>(mapping.active_profile || profiles[0] || "default");
  const [altView, setAltView] = useState<boolean>(false);
  // keep selected profile in sync with mapping changes
  useEffect(() => {
    const available = mapping.profiles || ["default"];
    if (!available.includes(profile)) {
      setProfile(mapping.active_profile || available[0] || "default");
    }
  }, [mapping.active_profile, mapping.profiles, profile]);
  useEffect(() => {
    if (!altView) return;
    const roots = (mapping.sources || []).map(s => s.media_root).filter(Boolean) as string[];
    roots.forEach(r => { void ensureFilesForRoot(r); });
  }, [altView, mapping.sources]);
  const [fileCache, setFileCache] = useState<Record<string, string[]>>({});
  const [loadingRoots, setLoadingRoots] = useState<Record<string, boolean>>({});
  const [errorRoots, setErrorRoots] = useState<Record<string, string>>({});
  const dragState = useRef<{ srcIdx: number; slotIdx: number } | null>(null);

  // Use the selected profile for all sources
  const perSourceFiles = mapping.sources.map(s => s.playlists?.[profile] || []);
  const maxSlots = Math.max(1, ...perSourceFiles.map(a => a.length));

  const PlaylistCell = ({
    colIdx,
    value,
    root,
    listId,
    loading,
    error,
    options,
    onChange,
    onDrop,
    onDragStart,
    onDragEnd,
  }:{
    colIdx: number;
    value: string;
    root: string;
    listId?: string;
    loading: boolean;
    error: string;
    options: string[];
    onChange: (next: string) => void;
    onDrop: () => void;
    onDragStart: () => void;
    onDragEnd: () => void;
  }) => {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState<string>(value || "");
    const [menuOpen, setMenuOpen] = useState<boolean>(false);

    // --- Begin: datalist open helpers ---
    const inputRef = useRef<HTMLInputElement | null>(null);

    // opens the datalist dropdown immediately
    const openDatalist = () => {
      const el = inputRef.current;
      if (!el) return;
      // focus and try to open the native datalist
      el.focus();
      try {
        // move caret to end to avoid overwriting existing text
        const len = el.value.length;
        el.setSelectionRange(len, len);
      } catch {}
      // dispatch ArrowDown to force datalist popup in most browsers
      try {
        const ev = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true });
        el.dispatchEvent(ev);
      } catch {}
    };
    // --- End: datalist open helpers ---

    useEffect(()=>{ if(!editing) setDraft(value || ""); }, [value, editing]);
    useEffect(()=>{ if(editing && root) void ensureFilesForRoot(root); }, [editing, root]);

    // Immediately open our suggestion menu when entering edit mode on empty field
    useEffect(() => {
      if (editing) {
        const id = setTimeout(() => {
          if (!draft || draft.trim() === "") {
            setMenuOpen(true);
            openDatalist(); // keep native datalist as a fallback
          }
        }, 0);
        return () => clearTimeout(id);
      } else {
        setMenuOpen(false);
      }
    }, [editing, draft]);

    // Reopen datalist after loading completes and options appear, if input is focused and empty
    useEffect(() => {
      const el = inputRef.current;
      const focusedHere = typeof document !== 'undefined' && document.activeElement === el;
      const isEmpty = !draft || draft.trim() === '';
      if (!loading && Array.isArray(options) && options.length > 0 && focusedHere && isEmpty) {
        setMenuOpen(true);
        openDatalist();
      }
    }, [loading, Array.isArray(options) ? options.length : 0, draft]);

    const commit = () => { onChange(draft.trim()); setEditing(false); };
    const cancel = () => { setDraft(value || ""); setEditing(false); };

    return (
      <div
        className="py-1 px-2 relative"
        onDragOver={event=>{
          if(editing) return;
          const canDrop = dragState.current && dragState.current.srcIdx === colIdx;
          if(!canDrop) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }}
        onDrop={event=>{
          if(editing) return;
          const canDrop = dragState.current && dragState.current.srcIdx === colIdx;
          if(!canDrop) return;
          event.preventDefault();
          onDrop();
        }}
      >
        {editing ? (
          <>
            <input
              ref={inputRef}
              autoFocus
              value={draft}
              onChange={e=>setDraft((e.target as HTMLInputElement).value)}
              list={listId}
              placeholder={loading ? "Lade Dateien..." : "clip.mp4"}
              className="h-8 w-full rounded-md border px-3 text-sm"
              onInput={(e)=>{ const v=(e.target as HTMLInputElement).value; setDraft(v); setMenuOpen(true); }}
              onBlur={(e)=>{
                // Delay to allow click on menu items (since we preventDefault on mousedown above, this is just a safety)
                setTimeout(()=>{ setMenuOpen(false); }, 100);
                commit();
              }}
              onKeyDown={e=>{
                if(e.key === "Enter") { e.preventDefault(); commit(); }
                if(e.key === "Escape") { e.preventDefault(); cancel(); }
              }}
              onFocus={()=>{ if(!draft || draft.trim()===""){ setMenuOpen(true); openDatalist(); } }}
              onClick={()=>{ if(!draft || draft.trim()===""){ setMenuOpen(true); openDatalist(); } }}
            />
            {/* Lightweight suggestion menu (works immediately on first click) */}
            {menuOpen && (
              <div
                className="absolute left-2 right-2 mt-1 z-20 rounded-md border bg-white shadow"
                onMouseDown={(e)=>e.preventDefault()} // prevent input blur before click
              >
                {loading && (
                  <div className="px-3 py-2 text-xs text-gray-500">Lade Dateien...</div>
                )}
                {!loading && options.length === 0 && (
                  <div className="px-3 py-2 text-xs text-gray-500">Keine Dateien</div>
                )}
                {!loading && options.length > 0 && (
                  <ul className="max-h-48 overflow-auto py-1">
                    {options.map(name => (
                      <li
                        key={name}
                        className="px-3 py-1 text-sm hover:bg-gray-100 cursor-pointer"
                        title={name}
                        onClick={()=>{
                          setDraft(name);
                          setMenuOpen(false);
                          // Commit immediately on pick
                          onChange(name);
                          setEditing(false);
                        }}
                      >
                        {name}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {root && (
              <datalist id={listId}>
                {options.map(name => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            )}
          </>
        ) : value ? (
          <div
            className="flex h-8 items-center justify-between gap-2 rounded-md border border-gray-200 bg-gray-50 px-2 text-sm text-gray-700"
            draggable={!!value}
            onDragStart={event=>{ if(!value) return; event.dataTransfer.effectAllowed="move"; event.dataTransfer.setData("text/plain", value); onDragStart(); }}
            onDragEnd={onDragEnd}
            title={error || undefined}
          >
            <button
              type="button"
              className="flex-1 truncate text-left"
              onClick={()=>{ setEditing(true); setTimeout(()=>openDatalist(), 0); }}
            >
              {value}
            </button>
            <button
              type="button"
              className="text-gray-400 hover:text-red-500"
              onClick={()=>onChange("")}
              title="Clip entfernen"
            >
              ×
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={()=>{ setEditing(true); setTimeout(()=>openDatalist(), 0); }}
            className="flex h-8 w-full items-center justify-center rounded-md border border-dashed border-gray-300 text-gray-400 hover:text-gray-600"
            title={error || undefined}
            disabled={loading}
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  };

  const ensureFilesForRoot = async (root: string) => {
    if (!root || fileCache[root]) return;
    setLoadingRoots(prev => ({ ...prev, [root]: true }));
    try {
      const res = await fetch(`/api/list-media?root=${encodeURIComponent(root)}`);
      if (!res.ok) {
        throw new Error(`Fehler ${res.status}`);
      }
      const data: { files?: string[]; error?: string } = await res.json();
      setFileCache(prev => ({ ...prev, [root]: data.files || [] }));
      setErrorRoots(prev => ({ ...prev, [root]: data.error ? String(data.error) : "" }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unbekannter Fehler";
      setErrorRoots(prev => ({ ...prev, [root]: message }));
      setFileCache(prev => ({ ...prev, [root]: [] }));
    } finally {
      setLoadingRoots(prev => ({ ...prev, [root]: false }));
    }
  };

  const setCell = (srcIdx:number, slotIdx:number, val:string) => {
    const n = deepClone(mapping);
    const s = n.sources[srcIdx];
    const p = profile;
    if(!s.playlists) s.playlists = {};
    if(!s.playlists[p]) s.playlists[p] = [];
    // Array bis slotIdx auffüllen
    while(s.playlists[p].length <= slotIdx) s.playlists[p].push("");
    s.playlists[p][slotIdx] = val;
    setMapping(n);
  };

  const addSlotRow = () => {
    const n = deepClone(mapping);
    n.sources.forEach(s => {
      const p = profile;
      if(!s.playlists) s.playlists = {};
      if(!s.playlists[p]) s.playlists[p] = [];
      s.playlists[p].push("");
    });
    setMapping(n);
  };

  const trimEmptyTail = () => {
    const n = deepClone(mapping);
    n.sources.forEach(s => {
      const p = profile;
      const arr = s.playlists?.[p];
      if (arr && arr.length) {
        // entferne leere Slots am Ende
        let end = arr.length - 1;
        while (end >= 0 && (!arr[end] || arr[end].trim()==="")) end--;
        s.playlists![p] = arr.slice(0, end+1);
      }
    });
    setMapping(n);
  };

  const removeSlot = (slotIdx: number) => {
    const n = deepClone(mapping);
    n.sources.forEach(s => {
      const p = profile;
      const arr = s.playlists?.[p];
      if(!arr) return;
      if(slotIdx < arr.length){ arr.splice(slotIdx,1); }
    });
    setMapping(n);
  };

  // --- Helper functions for altView count adjustment and shuffling ---
  const adjustCount = (srcIdx: number, name: string, delta: number) => {
    if (!name) return;
    const n = deepClone(mapping);
    const s = n.sources[srcIdx];
    const p = profile;
    if (!s.playlists) s.playlists = {};
    if (!s.playlists[p]) s.playlists[p] = [];
    const arr = s.playlists[p];
    if (delta > 0) {
      for (let i = 0; i < delta; i++) arr.push(name);
    } else if (delta < 0) {
      let toRemove = Math.min(Math.abs(delta), arr.reduce((acc, v) => acc + (v === name ? 1 : 0), 0));
      for (let i = arr.length - 1; i >= 0 && toRemove > 0; i--) {
        if (arr[i] === name) {
          arr.splice(i, 1);
          toRemove--;
        }
      }
    }
    setMapping(n);
  };

  const spreadPlaylist = (items: string[]) => {
    // Greedy round-robin to maximize spacing between identical names
    const counts = new Map<string, number>();
    items.forEach(n => counts.set(n, (counts.get(n) || 0) + 1));
    const names = Array.from(counts.entries()).sort((a,b)=>b[1]-a[1]).map(e=>e[0]);
    const remaining = new Map(counts);
    const result: string[] = [];
    while (result.length < items.length) {
      let placed = false;
      for (let i = 0; i < names.length; i++) {
        const name = names[i];
        const left = remaining.get(name) || 0;
        if (left <= 0) continue;
        if (result.length && result[result.length - 1] === name) continue;
        result.push(name);
        remaining.set(name, left - 1);
        placed = true;
      }
      if (!placed) {
        // Only one name remains and equals last; place it anyway
        for (let i = 0; i < names.length; i++) {
          const name = names[i];
          const left = remaining.get(name) || 0;
          if (left > 0) {
            result.push(name);
            remaining.set(name, left - 1);
            break;
          }
        }
      }
      // Re-sort names by remaining to keep balance
      names.sort((a,b)=>(remaining.get(b)||0)-(remaining.get(a)||0));
      // Stop if all remaining are zero
      if (names.every(nm => (remaining.get(nm) || 0) === 0)) break;
    }
    return result;
  };

  const hasAdjacentDuplicate = (list: string[]) => {
    for (let i = 1; i < list.length; i++) {
      if (list[i] === list[i - 1]) return true;
    }
    return false;
  };

  const randomizePlaylist = (items: string[]) => {
    if (items.length <= 1) return items;
    const originalKey = items.join("\u0000");

    const attemptWithGreedy = spreadPlaylist(items);
    if (attemptWithGreedy.join("\u0000") !== originalKey && !hasAdjacentDuplicate(attemptWithGreedy)) {
      return attemptWithGreedy;
    }

    const attemptLimit = 24;
    for (let attempt = 0; attempt < attemptLimit; attempt++) {
      const candidate = [...items];
      for (let i = candidate.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [candidate[i], candidate[j]] = [candidate[j], candidate[i]];
      }
      if (candidate.join("\u0000") === originalKey) continue;
      if (hasAdjacentDuplicate(candidate)) continue;
      return candidate;
    }

    return attemptWithGreedy;
  };

  const shuffleSource = (srcIdx: number) => {
    const n = deepClone(mapping);
    const s = n.sources[srcIdx];
    const p = profile;
    if (!s.playlists) s.playlists = {};
    if (!s.playlists[p]) s.playlists[p] = [];
    const arr = s.playlists[p];
    const empties = arr.filter(v => !v).length;
    const items = arr.filter(v => !!v) as string[];
    if (items.length <= 1) { setMapping(n); return; }
    const shuffled = randomizePlaylist(items);
    if (shuffled.join("\u0000") === items.join("\u0000")) { setMapping(n); return; }
    s.playlists[p] = [...shuffled, ...Array(empties).fill("")];
    setMapping(n);
  };

  return (
    <Card className="shadow-sm">
      <CardHeader className="py-3">
        <CardTitle className="text-base">Playlists (Matrix)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap" style={{ minHeight: "2.25rem" }}>
          <div className="flex items-center gap-4 text-sm text-gray-600">
            <div className="flex items-center gap-2">
              <span>Profil:</span>
              <select
                className="h-8 rounded-md border px-2 text-sm"
                value={profile}
                onChange={e => setProfile(e.target.value)}
              >
                {(mapping.profiles || ["default"]).map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span>Alternative Ansicht</span>
              <IOSwitch checked={altView} onChange={setAltView} />
            </div>
          </div>
          <div className={"flex gap-2 " + (altView ? "invisible pointer-events-none" : "")}>
            <Button size="sm" variant="secondary" onClick={addSlotRow}>+ Slot hinzufügen</Button>
            <Button size="sm" variant="secondary" onClick={trimEmptyTail}>Leere End-Slots kürzen</Button>
          </div>
        </div>
        <div className="text-sm text-gray-600">
          Bearbeite Profil: <span className="font-medium">{profile}</span>
        </div>
        {altView && (
          <div className="overflow-x-auto">
            <div className="min-w-[640px]">
              {(() => {
                // Build per-source selections and count maps based on the active playlist only
                const perSourceSelections: string[][] = mapping.sources.map(s => {
                  const arr = (s.playlists?.[profile] || []).filter(Boolean);
                  const seen = new Set<string>();
                  const unique: string[] = [];
                  arr.forEach(name => {
                    if (!seen.has(name)) {
                      seen.add(name);
                      unique.push(name);
                    }
                  });
                  return unique;
                });
                const perSourceCounts: Map<string, number>[] = mapping.sources.map(s => {
                  const arr = (s.playlists?.[profile] || []).filter(Boolean);
                  const m = new Map<string, number>();
                  arr.forEach(name => m.set(name, (m.get(name) || 0) + 1));
                  return m;
                });
                const perSourceLoading: boolean[] = mapping.sources.map(s => {
                  const root = s.media_root || "";
                  return root ? !!loadingRoots[root] : false;
                });
                const perSourceError: string[] = mapping.sources.map(s => {
                  const root = s.media_root || "";
                  return root ? (errorRoots[root] || "") : "";
                });
                const perSourceFiles: Record<number, string[]> = mapping.sources.reduce((acc, s, idx) => {
                  const root = s.media_root || "";
                  acc[idx] = root ? (fileCache[root] || []) : [];
                  return acc;
                }, {} as Record<number, string[]>);
                const maxRows = Math.max(1, ...perSourceSelections.map(a => a.length));
                const gridTemplate = [`80px`].concat(
                  ...mapping.sources.map(_s => [`minmax(200px,1fr)`, `56px`])
                ).join(" ");
                return (
                  <>
                    {/* Kopfzeile */}
                    <div className="grid items-center" style={{ gridTemplateColumns: gridTemplate, minHeight: "34px" }}>
                      <div className="text-xs font-medium text-gray-600 py-1 px-2">Datei</div>
                      {mapping.sources.map((s, i) => (
                        <React.Fragment key={i}>
                          <div className="text-xs font-medium py-1 px-2 flex items-center gap-2">
                            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: palette[i % palette.length] }} />
                            Quelle #{i} <span className="text-gray-500">({s.source.w}×{s.source.h})</span>
                          </div>
                          <div className="text-xs font-medium text-gray-600 py-1 px-2 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <span>Anz.</span>
                              <Button
                                size="sm"
                                variant="secondary"
                                className="h-6 px-2"
                                title="Shuffle (Abstände maximieren)"
                                onClick={()=>shuffleSource(i)}
                              >
                                <Shuffle className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                        </React.Fragment>
                      ))}
                    </div>
                    {/* Zeilen */}
                    {Array.from({ length: maxRows }).map((_, rowIdx) => (
                      <div key={rowIdx} className="grid border-t" style={{ gridTemplateColumns: gridTemplate }}>
                        <div className="py-2 px-2 text-xs text-gray-600 flex items-center justify-between gap-2">
                          <span>{rowIdx + 1}</span>
                          {/* kein Löschen in Alternativ-Ansicht */}
                        </div>
                        {mapping.sources.map((s, colIdx) => {
                          const root = s.media_root || "";
                          const loading = perSourceLoading[colIdx];
                          const error = perSourceError[colIdx];
                          const selections = perSourceSelections[colIdx] || [];
                          const name = selections[rowIdx] || "";
                          const count = name ? (perSourceCounts[colIdx].get(name) || 0) : 0;
                          const availableFiles = perSourceFiles[colIdx] || [];
                          const hasFetchedRoot = root ? Object.prototype.hasOwnProperty.call(fileCache, root) : false;
                          const missingFile = !!name && hasFetchedRoot && !availableFiles.includes(name);
                          return (
                            <React.Fragment key={colIdx}>
                              <div className="py-1 px-2">
                                {error && rowIdx === 0 && (
                                  <div className="text-xs text-red-600">Fehler: {error}</div>
                                )}
                                {!root && rowIdx === 0 && (
                                  <div className="text-sm text-gray-500">Kein <code>media_root</code> gesetzt.</div>
                                )}
                                {root && loading && !name && (
                                  <div className="text-sm text-gray-500">Lade Dateien…</div>
                                )}
                                {name ? (
                                  <div
                                    className="flex h-8 items-center justify-between gap-2 rounded-md border border-gray-200 bg-gray-50 px-2 text-sm text-gray-700"
                                    title={name}
                                  >
                                    <span className="truncate">{name}</span>
                                    {missingFile && (
                                      <span className="text-xs text-red-500">nicht im Verzeichnis</span>
                                    )}
                                    {/* rechter Bereich bleibt leer, Count kommt in Nachbarspalte */}
                                  </div>
                                ) : (
                                  <div className="flex h-8 items-center justify-center rounded-md border border-dashed border-gray-300 text-gray-300">
                                    —
                                  </div>
                                )}
                              </div>
                              <div className="py-1 px-2 flex items-center justify-end">
                                <div className="inline-flex h-8 items-center rounded-md border bg-white text-sm">
                                  <button
                                    type="button"
                                    className="px-2 h-full border-r hover:bg-gray-50"
                                    onClick={()=>adjustCount(colIdx, name, -1)}
                                    title="Anzahl verringern"
                                    disabled={!name || count<=0}
                                  >−</button>
                                  <div className="px-2 min-w-[28px] text-center tabular-nums">{count}</div>
                                  <button
                                    type="button"
                                    className="px-2 h-full border-l hover:bg-gray-50"
                                    onClick={()=>adjustCount(colIdx, name, +1)}
                                    title="Anzahl erhöhen"
                                    disabled={!name}
                                  >+</button>
                                </div>
                              </div>
                            </React.Fragment>
                          );
                        })}
                      </div>
                    ))}
                  </>
                );
              })()}
            </div>
          </div>
        )}
        {!altView && (
          <div className="overflow-x-auto">
            <div className="min-w-[640px]">
              {/* Kopfzeile */}
              <div className="grid items-center" style={{ gridTemplateColumns: `80px repeat(${mapping.sources.length}, minmax(200px,1fr))`, minHeight: "34px" }}>
                <div className="text-xs font-medium text-gray-600 py-1 px-2">Slot</div>
                {mapping.sources.map((s, i) => (
                  <div key={i} className="text-xs font-medium py-1 px-2 flex items-center gap-2">
                    <span className="inline-block w-3 h-3 rounded-sm" style={{ background: palette[i % palette.length] }} />
                    Quelle #{i} <span className="text-gray-500">({s.source.w}×{s.source.h})</span>
                  </div>
                ))}
              </div>
              {/* Zeilen */}
              {Array.from({length: maxSlots || 1}).map((_, rowIdx)=>(
                <div key={rowIdx} className="grid border-t" style={{ gridTemplateColumns: `80px repeat(${mapping.sources.length}, minmax(200px,1fr))` }}>
                  <div className="py-2 px-2 text-xs text-gray-600 flex items-center justify-between gap-2">
                    <span>{rowIdx+1}</span>
                    <button
                      type="button"
                      className="text-gray-400 hover:text-red-500"
                      onClick={()=>removeSlot(rowIdx)}
                      title="Slot löschen"
                    >
                      ×
                    </button>
                  </div>
                  {mapping.sources.map((s, colIdx)=>{
                    const files = perSourceFiles[colIdx] || [];
                    const val = files[rowIdx] ?? "";
                    const root = s.media_root || "";
                    const listId = root ? `media-options-${colIdx}` : undefined;
                    const loading = root ? !!loadingRoots[root] : false;
                    const error = root ? (errorRoots[root] || "") : "";
                    const options = root ? (fileCache[root] || []) : [];
  
                    const handleDrop = () => {
                      if(!dragState.current || dragState.current.srcIdx !== colIdx) return;
                      const from = dragState.current.slotIdx;
                      const to = rowIdx;
                      const n = deepClone(mapping);
                      const targetSource = n.sources[colIdx];
                      const profileName = profile;
                      if(!targetSource.playlists) targetSource.playlists = {};
                      if(!targetSource.playlists[profileName]) targetSource.playlists[profileName] = [];
                      const arr = targetSource.playlists[profileName];
                      while(arr.length <= Math.max(from, to)) arr.push("");
                      if(from !== to){
                        const [item] = arr.splice(from,1);
                        arr.splice(to,0,item);
                      }
                      setMapping(n);
                      dragState.current = null;
                    };
  
                    return (
                      <PlaylistCell
                        key={colIdx}
                        colIdx={colIdx}
                        value={val || ""}
                        root={root}
                        listId={listId}
                        loading={loading}
                        error={error}
                        options={options}
                        onChange={next=>setCell(colIdx, rowIdx, next)}
                        onDrop={handleDrop}
                        onDragStart={()=>{ if(val) dragState.current = { srcIdx: colIdx, slotIdx: rowIdx }; }}
                        onDragEnd={()=>{ dragState.current = null; }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------- MappingEditor Root ---------- */
const DEFAULT_MAPPING: Mapping = {
  canvas: { w: 3840, h: 2160 },
  fps: 60,
  loop: true,
  active_profile: "default",
  profiles: ["default"],
  sources: [
    { source: { w: 1920, h: 108 }, zones: [], playlists: {}, active: "default" },
  ]
};

export default function MappingEditor(){
  const [mapping, setMapping] = useState<Mapping>(DEFAULT_MAPPING);
  const [activeTab, setActiveTab] = useState<string>("0");
  const setCanvas = (k:"w"|"h", v:number)=>{ const n=deepClone(mapping); (n.canvas as any)[k]=Math.max(1, v); setMapping(n); };

  // Profile management
  const [newProfile, setNewProfile] = useState<string>("");
  const addProfile = () => {
    const name = (newProfile || "").trim();
    if (!name) return;
    const n = deepClone(mapping);
    n.profiles = Array.isArray(n.profiles) ? n.profiles : [];
    if (!n.profiles.includes(name)) {
      n.profiles.push(name);
      n.sources.forEach(s => {
        if (!s.playlists) s.playlists = {};
        if (!s.playlists[name]) s.playlists[name] = [];
      });
    }
    setMapping(n);
    setNewProfile("");
  };
  const removeProfile = (name: string) => {
    const n = deepClone(mapping);
    n.profiles = (n.profiles || []).filter(p => p !== name);
    n.sources.forEach(s => {
      if (s.playlists) { delete s.playlists[name]; }
    });
    if (n.active_profile === name) {
      n.active_profile = n.profiles?.[0];
    }
    setMapping(n);
  };
  const setActiveProfile = (name: string) => {
    const n = deepClone(mapping);
    n.active_profile = name;
    setMapping(n);
  };

  const addSource = ()=>{ const n=deepClone(mapping); n.sources.push({ source:{ w:1920, h:108 }, zones:[], playlists:{}, active:"default" }); setMapping(n); setActiveTab(String(n.sources.length-1)); };
  const delSource = (i:number)=>{ const n=deepClone(mapping); n.sources.splice(i,1); setMapping(n); const nextIndex = n.sources.length ? Math.min(i, n.sources.length-1) : 0; setActiveTab(String(nextIndex)); };

  const importJSON = async (file: File) => {
    const text = await file.text(); try{ const parsed = JSON.parse(text); setMapping(parsed); } catch{ alert("Ungültiges JSON"); }
  };
  const exportJSON = () => downloadFile("mapping_multi.json", JSON.stringify(mapping, null, 2));

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
        <img src="/logo.png" alt="Logo" className="h-10 w-auto" />
        <h1 className="text-2xl font-semibold text-center">Mapping Editor</h1>
        <div className="flex gap-2 justify-end">
          <label className="inline-flex items-center gap-2 text-sm border rounded-md px-3 py-2 bg-white cursor-pointer">
            <Upload className="w-4 h-4" /><span>Import JSON</span>
            <input type="file" accept="application/json" className="hidden" onChange={e=>{ const f=e.target.files?.[0]; if(f) importJSON(f); }} />
          </label>
          <Button onClick={exportJSON}><Download className="w-4 h-4 mr-1" />Export JSON</Button>
        </div>
      </div>

      {/* Canvas & Global */}
      <Card className="shadow-sm">
        <CardHeader className="py-3"><CardTitle className="text-base">Canvas & Global</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-4 md:grid-cols-8 gap-3 items-center">
          <Label className="text-xs">canvas.w</Label>
          <Input type="number" value={mapping.canvas.w} onChange={e=>setCanvas("w", Number(e.target.value))} />
          <Label className="text-xs">canvas.h</Label>
          <Input type="number" value={mapping.canvas.h} onChange={e=>setCanvas("h", Number(e.target.value))} />
          <div className="col-span-4 text-xs text-gray-500">fps: {mapping.fps ?? "—"} · loop: {mapping.loop ? "true":"false"}</div>

          {/* Profile Management */}
          <div className="col-span-4 md:col-span-8 border-t pt-3 mt-1 grid grid-cols-4 md:grid-cols-8 gap-3 items-center">
            <Label className="text-xs">active_profile</Label>
            <select
              className="col-span-1 h-8 rounded-md border px-2 text-sm"
              value={mapping.active_profile || (mapping.profiles?.[0] || "default")}
              onChange={e => setActiveProfile(e.target.value)}
            >
              {(mapping.profiles || ["default"]).map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>

            <Label className="text-xs">neues Profil</Label>
            <Input
              className="col-span-1"
              placeholder="Profilname"
              value={newProfile}
              onChange={e => setNewProfile(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") addProfile(); }}
            />
            <div className="col-span-2 flex gap-2">
              <Button size="sm" variant="secondary" onClick={addProfile}><Plus className="w-4 h-4 mr-1" /> Profil</Button>
            </div>

            <div className="col-span-4 md:col-span-8">
              <div className="flex flex-wrap gap-2">
                {(mapping.profiles || []).map(p => (
                  <span key={p} className="inline-flex items-center gap-2 rounded border px-2 py-1 text-xs">
                    {p}
                    <button
                      type="button"
                      className="text-gray-400 hover:text-red-500"
                      onClick={() => removeProfile(p)}
                      title="Profil löschen"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Sources als Tabs (Playlists-Tab entfernt) */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <TabsList className="flex-wrap">
            {mapping.sources.map((_, i) => (
              <TabsTrigger key={i} value={String(i)}>
                Quelle #{i}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={addSource}>
              <Plus className="w-4 h-4 mr-1" /> Quelle
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={()=>delSource(Number(activeTab))}
              disabled={mapping.sources.length===0}
            >
              <Trash2 className="w-4 h-4 mr-1" /> Entfernen
            </Button>
          </div>
        </div>

        {mapping.sources.map((_, i) => (
          <TabsContent key={i} value={String(i)}>
            <div className="text-sm text-gray-600 mb-2">Source #{i}</div>
            <SourceEditor mapping={mapping} setMapping={setMapping} srcIdx={i} />
          </TabsContent>
        ))}
      </Tabs>

      {/* NEU: Globale Playlist-Matrix */}
      <PlaylistMatrix mapping={mapping} setMapping={setMapping} />
    </div>
  );
}
