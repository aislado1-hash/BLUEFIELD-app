import React from 'react';
import {Composition, Img, Sequence, AbsoluteFill, useCurrentFrame, useVideoConfig, registerRoot, staticFile, delayRender, continueRender} from 'remotion';
import {Audio} from '@remotion/media';
// Núcleo compartido con la vista previa: guion, línea de tiempo, plantillas y estilos.
import '../shared/chatcore.js';

const C: any = (globalThis as any).ChatCore;

export type Project = Record<string, any> & {
  videoWidth?: number; videoHeight?: number; fps: number; script: string; chars: any[];
};

/** Rutas del proyecto (/projects/..., /library/...) → staticFile(); data:/http se dejan tal cual. */
const asset = (src?: string | null): string | undefined => {
  if (!src) return undefined;
  if (/^(data:|https?:|blob:)/i.test(src)) return src;
  return staticFile(src.replace(/\\/g, '/').replace(/^\/+/, ''));
};

/** Carga la letra Nunito («Texto limpio») antes de renderizar; si no hay internet, sigue con la de respaldo. */
const FontLoader: React.FC = () => {
  const [handle] = React.useState(() => delayRender('Cargando tipografía'));
  React.useEffect(() => {
    let done = false;
    const finish = () => { if (!done) { done = true; continueRender(handle); } };
    const timer = setTimeout(finish, 5000);
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = C.FX_FONT_URL;
    link.onload = () => {
      const fonts = (document as any).fonts;
      Promise.all(['700', '800', '900'].map((w) => fonts.load(`${w} 52px Nunito`))).catch(() => null).finally(() => { clearTimeout(timer); finish(); });
    };
    link.onerror = () => { clearTimeout(timer); finish(); };
    document.head.appendChild(link);
  }, [handle]);
  return null;
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
          {C.richText(e.text).map((seg: any, i: number) => (seg.hi ? <span key={i} style={C.styles.highlight()}>{seg.t}</span> : <React.Fragment key={i}>{seg.t}</React.Fragment>))}
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

/** Dibuja el chat en el instante ms. */
const ChatFrame: React.FC<{project: Project; events: any[]; ms: number}> = ({project, events, ms}) => {
  const {width} = useVideoConfig();
  const f = C.frameAt(project, events, ms);
  const scale = width / C.canvasSize(project).w;
  const hx = f.intro ? null : C.headerExtras(project, f);
  return (
    <AbsoluteFill style={C.styles.background({...project, __bgUrl: asset(project.bgImage)})}>
      <div style={C.styles.canvas(project, scale)}>
        {f.intro ? (
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
                        <div style={C.styles.systemText(project)}>{C.systemText(e.text, project)}</div>
                      </div>
                    ) : (
                      <Message key={e.key} p={project} f={f} e={e} isLast={e === f.lastMessage} ms={ms} />
                    )
                  )}
                  {f.typing && (
                    <div style={C.styles.typingRow(project)}>
                      <div style={C.styles.typing(project, f.typing.char)}>•••</div>
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

const ChatVideo: React.FC<Project> = (project) => {
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
        const {totalMs} = C.buildEvents(project);
        const fps = Number(project.fps) || 30;
        return {
          durationInFrames: Math.max(1, Math.ceil((totalMs / 1000) * fps)),
          fps,
          width: Number(project.videoWidth) || 1920,
          height: Number(project.videoHeight) || 1080,
        };
      }}
    />
  </>
);

registerRoot(RemotionRoot);
