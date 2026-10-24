import React from 'react';
import {Composition, Img, Sequence, AbsoluteFill, useCurrentFrame, useVideoConfig, registerRoot, staticFile, delayRender, continueRender} from 'remotion';
import {Audio} from '@remotion/media';
// Núcleo compartido con la vista previa: guion, línea de tiempo, plantillas y estilos.
import '../shared/chatcore.js';
// Formatos «Top» e «Historia»: guion, tiempos y escenas compartidos con la vista previa.
import '../shared/formats.js';

const C: any = (globalThis as any).ChatCore;
const F: any = (globalThis as any).ChatFormats;

export type Project = Record<string, any> & {
  videoWidth?: number; videoHeight?: number; fps: number; script: string; chars: any[];
};

/** Rutas del proyecto (/projects/..., /library/...) → staticFile(); data:/http se dejan tal cual. */
const asset = (src?: string | null): string | undefined => {
  if (!src) return undefined;
  if (/^(data:|https?:|blob:)/i.test(src)) return src;
  return staticFile(src.replace(/\\/g, '/').replace(/^\/+/, ''));
};

/** Carga una letra de Google Fonts (Nunito de «Texto limpio» o la del kit de marca) antes de renderizar;
 *  si no hay internet, sigue con la de respaldo. */
const FontLoader: React.FC<{url?: string; family?: string}> = ({url = C.FX_FONT_URL, family = 'Nunito'}) => {
  const [handle] = React.useState(() => delayRender('Cargando tipografía'));
  React.useEffect(() => {
    let done = false;
    const finish = () => { if (!done) { done = true; continueRender(handle); } };
    const timer = setTimeout(finish, 5000);
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = url;
    link.onload = () => {
      const fonts = (document as any).fonts;
      Promise.all(['400', '700', '800', '900'].map((w) => fonts.load(`${w} 52px "${family}"`))).catch(() => null).finally(() => { clearTimeout(timer); finish(); });
    };
    link.onerror = () => { clearTimeout(timer); finish(); };
    document.head.appendChild(link);
  }, [handle]);
  return null;
};

/** Texto con *palabras* resaltadas. */
const Rich: React.FC<{text: string}> = ({text}) => (
  <>{C.richText(text).map((seg: any, i: number) => (seg.hi ? <span key={i} style={C.styles.highlight()}>{seg.t}</span> : <React.Fragment key={i}>{seg.t}</React.Fragment>))}</>
);

/** Nota de voz: botón ▶/⏸, onda que se rellena mientras suena, tiempo y (opcional) transcripción. */
const VoiceNote: React.FC<{p: Project; e: any; c: any; ms: number}> = ({p, e, c, ms}) => {
  const vn = C.voiceNote(p, e, ms);
  return (
    <>
      <div style={C.styles.vnWrap(c)}>
        <div style={C.styles.vnButton(c)}>
          {vn.playing ? (<><div style={C.styles.vnPauseBar(c)} /><div style={C.styles.vnPauseBar(c)} /></>) : <div style={C.styles.vnPlay(c)} />}
        </div>
        <div style={C.styles.vnBars(c)}>{vn.bars.map((b: any, i: number) => <div key={i} style={C.styles.vnBar(c, b)} />)}</div>
        <div style={C.styles.vnTime(p, c)}>{vn.time}</div>
      </div>
      {e.voiceNote === 'transcript' ? <div style={C.styles.vnTranscript(p, c)}><Rich text={e.text} /></div> : null}
    </>
  );
};

const Message: React.FC<{p: Project; f: any; e: any; isLast: boolean; ms: number}> = ({p, f, e, isLast, ms}) => {
  const c = e.char;
  const react = C.reactionState(e, ms);
  const st = C.rowState(p, f, e, ms);
  return (
    <div style={C.styles.row(p, C.messageMotion(e, isLast, ms, p.anim, C.fx(p).smooth), st)}>
      <div style={C.styles.visual(c, st)}>
        {st.compact ? null : (
          <>
            <Img src={asset(c.image) || C.BLANK_IMG} style={C.styles.img(c, st)} />
            <div style={C.styles.name(p, c)}>{c.name}</div>
          </>
        )}
      </div>
      <div style={C.styles.side(c)}>
        <div style={C.styles.bubble(p, c, st)}>
          {st.tail ? <div style={C.styles.tail(p, c)} /> : null}
          {e.reply ? (
            <div style={C.styles.quote(p, c, e.reply)}>
              <div style={C.styles.quoteName(p, c, e.reply)}>{e.reply.name}</div>
              <div style={C.styles.quoteText(p, c)}>{C.quoteText(e.reply)}</div>
            </div>
          ) : null}
          {e.voiceNote ? <VoiceNote p={p} e={e} c={c} ms={ms} /> : <Rich text={e.text} />}
          {st.meta ? <span style={C.styles.meta(p, c)}>{st.meta}<span style={C.styles.ticks(c)}>✓✓</span></span> : null}
        </div>
        {react && (
          <div style={C.styles.reactions(p, c, react)}>
            {e.reactions.map((r: any, i: number) => (
              <span key={i}>{r.emoji}{r.count > 1 ? <span style={C.styles.reactionCount(c)}>{r.count}</span> : null}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

/** Confesionario: un personaje solo, «hablando a cámara». */
const Confession: React.FC<{p: Project; e: any; ms: number}> = ({p, e, ms}) => {
  const c = e.char, v = C.confessionView(p, e, ms), img = asset(c.image) || C.BLANK_IMG;
  return (
    <div style={C.styles.confRoot()}>
      <div style={C.styles.confCamera(p, v)}>
        <Img src={img} style={C.styles.confBackdrop()} />
        <div style={C.styles.confGlow(p, c)} />
        <div style={C.styles.confPhotoBox(p, v)}><Img src={img} style={C.styles.confPhoto(p, c, v)} /></div>
        <div style={C.styles.confInfo(p)}>
          <div style={C.styles.confLabel()}>🎥 CONFESIONARIO</div>
          <div style={C.styles.confName(p, c)}>{c.name}</div>
        </div>
      </div>
      <div style={C.styles.confSubWrap(p)}>
        <div style={C.styles.confSub(p)}>
          {v.words.map((w: any, i: number) => (w.state === 'space' ? <React.Fragment key={i}>{w.t}</React.Fragment> : <span key={i} style={C.styles.confWord(w)}>{w.t}</span>))}
        </div>
      </div>
      <div style={C.styles.confRec(p)}><span style={C.styles.confRecDot(ms)} />REC</div>
      <div style={C.styles.confTimecode(p)}>{v.timecode}</div>
      {[0, 1, 2, 3].map((i) => <div key={i} style={C.styles.confCorner(p, i)} />)}
      {v.local < 220 ? <div style={C.styles.confFlash(v)} /> : null}
    </div>
  );
};

/** Dibuja el chat en el instante ms. */
const ChatFrame: React.FC<{project: Project; events: any[]; ms: number}> = ({project, events, ms}) => {
  const {width} = useVideoConfig();
  const f = C.frameAt(project, events, ms);
  const scale = width / C.canvasSize(project).w;
  const hx = f.intro ? null : C.headerExtras(project, f);
  return (
    <AbsoluteFill style={C.styles.background({...project, __bgUrl: asset(project.bgImage)})}>
      <div style={C.styles.canvas(project, scale)}>
        {f.confession ? <Confession p={project} e={f.confession} ms={ms} /> : f.intro ? (
          <div style={C.styles.introWrap(project)}>
            <div style={C.styles.introText(project)}>{f.intro.text}</div>
          </div>
        ) : (
          <>
            {C.fx(project).bg && !project.bgImage ? <div style={C.styles.fxBackground(f)} /> : null}
            <div style={C.styles.header(project)}>
              {hx ? (
                <>
                  <div style={C.styles.headerLeft()}>
                    {hx.avatars.map((src: string, i: number) => <Img key={i} src={asset(src)!} style={C.styles.headerAvatar(project, i)} />)}
                  </div>
                  <div style={C.styles.headerCenter()}>
                    <div style={C.styles.headerName(project)}>{f.header.name}</div>
                    <div style={C.styles.headerSubtitle(project, hx.typing)}>{hx.subtitle}</div>
                  </div>
                </>
              ) : (
                <>
                  <div />
                  <div style={C.styles.headerName(project)}>{f.header.name}</div>
                </>
              )}
              <div style={C.styles.headerMembers(project)}>{C.membersLabel(f.header.count)}</div>
            </div>
            <div style={C.styles.chatOuter(project)}>
              <div style={C.styles.chatInner(project)}>
                <div style={C.styles.chatStack()}>
                  {f.shown.map((e: any) =>
                    e.kind === 'system' ? (
                      <div key={e.key} style={C.styles.systemWrap()}>
                        {e.event && e.event.type === 'day'
                          ? <div style={C.styles.dayChip(project)}>{e.text}</div>
                          : <div style={C.styles.systemText(project)}>{C.systemText(e.text, project)}</div>}
                      </div>
                    ) : (
                      <Message key={e.key} p={project} f={f} e={e} isLast={e === f.lastMessage} ms={ms} />
                    )
                  )}
                  {f.typing && (
                    <div style={C.styles.typingRow(project)}>
                      <div style={C.styles.typing(project, f.typing.char, f.typing)}>{C.typingLabel(f.typing)}</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </AbsoluteFill>
  );
};

/** Árbol de nodos del núcleo de formatos ({t, s, c, src}) → elementos de React. */
const toReact = (n: any, key: number | string = 0): React.ReactNode => {
  if (n == null) return null;
  if (typeof n === 'string') return n;
  if (n.t === 'img') return <Img key={key} src={asset(n.src) || C.BLANK_IMG} style={n.s} />;
  return React.createElement(n.t, {key, style: n.s}, ...(n.c || []).map((k: any, i: number) => toReact(k, i)));
};

/** Formatos «Top / Ranking» e «Historia narrada»: escena, voces del narrador, efectos y música. */
const FormatVideo: React.FC<{project: Project}> = ({project}) => {
  const frame = useCurrentFrame();
  const {fps, width} = useVideoConfig();
  const ms = (frame / fps) * 1000;
  const plan = F.plan(project);
  const scale = width / C.canvasSize(project).w;
  const music = asset(project.music);
  const toFrame = (secs: number) => Math.max(0, Math.round(secs * fps));
  const framesOf = (secs: number) => Math.max(1, Math.ceil(secs * fps));
  return (
    <AbsoluteFill style={{background: '#000', overflow: 'hidden'}}>
      <FontLoader />
      <div style={C.styles.canvas(project, scale)}>{toReact(F.scene(project, plan, ms))}</div>
      {music ? <Audio src={music} loop loopVolumeCurveBehavior="extend" volume={(f: number) => C.musicVolume(project, plan.voiceSegs, (f / fps) * 1000, plan.total * 1000)} /> : null}
      {plan.lines.filter((l: any) => l.audio).map((l: any, i: number) => (
        <Sequence key={`v-${i}`} from={toFrame(l.abs)} durationInFrames={framesOf(l.dur)}><Audio src={asset(l.audio)!} /></Sequence>
      ))}
      {plan.sfx.map((x: any, i: number) => (
        <Sequence key={`s-${i}`} from={toFrame(x.at)} durationInFrames={framesOf(x.dur)}><Audio src={asset(x.src)!} volume={x.vol} /></Sequence>
      ))}
    </AbsoluteFill>
  );
};

/** Duración (s) del vídeo sin la presentación ni el cierre del canal. */
const innerSeconds = (project: Project) => (F.isFormat(project) ? F.plan(project).total : C.buildEvents(project).totalMs / 1000);

/** Presentación o cierre del canal (kit de marca). */
const BrandCard: React.FC<{project: Project; phase: 'intro' | 'outro'}> = ({project, phase}) => {
  const frame = useCurrentFrame();
  const {fps, width} = useVideoConfig();
  const scale = width / C.canvasSize(project).w;
  return <AbsoluteFill style={{background: '#08090c'}}><div style={C.styles.canvas(project, scale)}>{toReact(F.brandCard(project, phase, (frame / fps) * 1000))}</div></AbsoluteFill>;
};

const Watermark: React.FC<{project: Project}> = ({project}) => {
  const {width} = useVideoConfig();
  const wm = F.watermark(project);
  if (!wm) return null;
  return <AbsoluteFill style={{pointerEvents: 'none'}}><div style={C.styles.canvas(project, width / C.canvasSize(project).w)}>{toReact(wm)}</div></AbsoluteFill>;
};

/** Vídeo completo: presentación del canal (opcional) → chat / Top / Historia (con marca de agua) → cierre (opcional). */
const ChatVideo: React.FC<Project> = (project) => {
  const {fps} = useVideoConfig();
  const B = F.brandTiming(project);
  const fontUrl = F.brandFontUrl(project);
  const intro = Math.round(B.intro * fps), body = Math.max(1, Math.ceil(innerSeconds(project) * fps)), outro = Math.round(B.outro * fps);
  const content = F.isFormat(project) ? <FormatVideo project={project} /> : <ChatOnly {...project} />;
  if (!F.brand(project)) return content;
  return (
    <AbsoluteFill style={{background: '#000'}}>
      {fontUrl ? <FontLoader url={fontUrl} family={F.brand(project).font} /> : null}
      {intro ? (
        <Sequence durationInFrames={intro}>
          <BrandCard project={project} phase="intro" />
          <Audio src={staticFile('sfx/whoosh.wav')} volume={0.6} />
        </Sequence>
      ) : null}
      <Sequence from={intro} durationInFrames={body}>
        {content}
        <Watermark project={project} />
      </Sequence>
      {outro ? <Sequence from={intro + body} durationInFrames={outro}><BrandCard project={project} phase="outro" /></Sequence> : null}
    </AbsoluteFill>
  );
};

const ChatOnly: React.FC<Project> = (project) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const {events, totalMs} = C.buildEvents(project);
  const ms = (frame / fps) * 1000;
  const music = asset(project.music);
  const voiceSegs = C.voiceSegments(project, events);
  const toFrame = (msVal: number) => Math.max(0, Math.round((msVal / 1000) * fps));
  const framesOf = (secs: number) => Math.max(1, Math.ceil(secs * fps));
  const popupFrames = Math.max(0, Math.round((project.popupDelay ?? 0.35) * fps));
  const sound = asset(project.sound);

  return (
    <AbsoluteFill>
      {C.fx(project).text ? <FontLoader /> : null}
      <ChatFrame project={project} events={events} ms={ms} />
      {music ? (
        // Música de fondo: en bucle todo el vídeo; baja mientras suenan las voces (ducking).
        <Audio src={music} loop loopVolumeCurveBehavior="extend" volume={(f: number) => C.musicVolume(project, voiceSegs, (f / fps) * 1000, totalMs)} />
      ) : null}
      {events.map((e: any) => {
        if (e.kind === 'intro' && e.audio) {
          const dur = framesOf(e.audioDuration || 0.1);
          return <Sequence key={`a-${e.key}`} from={toFrame(e.start)} durationInFrames={dur}><Audio src={asset(e.audio)!} startFrom={0} durationInFrames={dur} /></Sequence>;
        }
        if (e.kind === 'system' && e.audio) {
          const dur = framesOf(e.audioDuration || (e.end - e.visibleStart) / 1000);
          return <Sequence key={`a-${e.key}`} from={toFrame(e.visibleStart + 120)} durationInFrames={dur}><Audio src={asset(e.audio)!} startFrom={0} durationInFrames={dur} /></Sequence>;
        }
        if (e.kind === 'message') {
          const from = toFrame(e.visibleStart);
          const dur = framesOf(e.audioDuration || 0.1);
          return (
            <React.Fragment key={`a-${e.key}`}>
              {sound ? (
                <Sequence from={from} durationInFrames={e.audio ? Math.max(1, popupFrames) : framesOf(Math.max(0.1, (e.end - e.visibleStart) / 1000))}>
                  <Audio src={sound} />
                </Sequence>
              ) : null}
              {e.audio ? (
                <Sequence from={from + popupFrames} durationInFrames={dur}>
                  <Audio src={asset(e.audio)!} startFrom={0} durationInFrames={dur} />
                </Sequence>
              ) : null}
            </React.Fragment>
          );
        }
        return null;
      })}
    </AbsoluteFill>
  );
};

const EMPTY: Project = {
  videoWidth: 1920, videoHeight: 1080, bgColor: '#11131a', bgImage: null, bgFit: 'cover', theme: 'clasico',
  groupName: 'Chat de grupo', groupMembers: 24, headerSize: 108, eventSize: 28,
  initialTitle: '', initialTitleAudio: null, initialTitleDuration: 0, titleAudios: [], groupEvents: [],
  chars: [], script: '', delay: 0, typing: 0, duration: 2.2, anim: 'Pop', fps: 30,
  sound: null, music: null, musicVolume: 25, musicDuck: 8, dialogueMessages: [], popupDelay: 0.35,
};

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="ChatVideo"
      component={ChatVideo}
      durationInFrames={1}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={EMPTY}
      calculateMetadata={({props}) => {
        const project = props as Project;
        const fps = Number(project.fps) || 30;
        const B = F.brandTiming(project);
        return {
          durationInFrames: Math.round(B.intro * fps) + Math.max(1, Math.ceil(innerSeconds(project) * fps)) + Math.round(B.outro * fps),
          fps,
          width: Number(project.videoWidth) || 1920,
          height: Number(project.videoHeight) || 1080,
        };
      }}
    />
  </>
);

registerRoot(RemotionRoot);
