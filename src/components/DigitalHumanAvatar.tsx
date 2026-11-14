import { useEffect, useMemo, useRef, useState } from 'react';
import { User, Volume2 } from 'lucide-react';
import { PERSONAS, type PersonaId } from '../types/interview';
import { PERSONA_PORTRAITS } from './PersonaAvatar';

type SpeakingTier = 'soft' | 'medium' | 'peak';

interface DigitalHumanAvatarProps {
  personaId: PersonaId;
  isSpeaking: boolean;
  isListening: boolean;
  userMicLevel: number;
  aiAudioLevelRef?: { current: number | null };
  captionText: string;
  spokenCharIndex: number | null;
  competencyLabel: string;
  onRepeatQuestion: () => void;
}

const EQUALIZER_WEIGHTS = [0.42, 0.72, 0.95, 0.64, 1.0, 0.8, 0.55, 0.88, 0.48];

export function DigitalHumanAvatar({
  personaId,
  isSpeaking,
  isListening,
  userMicLevel,
  aiAudioLevelRef,
  captionText,
  spokenCharIndex,
  competencyLabel,
  onRepeatQuestion,
}: DigitalHumanAvatarProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const [aiTier, setAiTier] = useState<SpeakingTier>('medium');

  const barRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const volLabelRef = useRef<HTMLSpanElement | null>(null);
  const impulseRef = useRef(0);

  const persona = PERSONAS[personaId];
  const portraitSrc = PERSONA_PORTRAITS[personaId];

  // Trigger a vocal onset impulse whenever speechSynthesis advances to a new word boundary
  useEffect(() => {
    if (isSpeaking && spokenCharIndex !== null) {
      impulseRef.current = 1.0;
    }
  }, [isSpeaking, spokenCharIndex]);

  // Update equalizer bars & volume text via direct DOM refs (zero React re-renders per frame);
  // uses real AnalyserNode RMS volume when neural TTS is active, or smooth fallback cadence otherwise.
  useEffect(() => {
    if (!isSpeaking) {
      impulseRef.current = 0;
      const level = isListening ? userMicLevel : 0;
      barRefs.current.forEach((bar, idx) => {
        if (!bar) return;
        const scale =
          level > 0.02
            ? Math.min(1, Math.max(0.18, level * EQUALIZER_WEIGHTS[idx] * 1.15))
            : 0.16;
        bar.style.transform = `scaleY(${scale.toFixed(2)})`;
      });
      if (volLabelRef.current) {
        volLabelRef.current.textContent = `Audio ${Math.round(level * 100)}%`;
      }
      return;
    }

    let rafId = 0;
    let lastDrawAt = 0;
    let currentTier: SpeakingTier = 'medium';
    const start = performance.now();

    const tick = (now: number) => {
      if (now - lastDrawAt >= 33) {
        lastDrawAt = now;
        const realLevel = aiAudioLevelRef?.current;
        let level: number;

        if (typeof realLevel === 'number') {
          level = Math.min(1, Math.max(0.08, realLevel));
        } else {
          const t = (now - start) / 1000;
          const baseWave =
            0.38 +
            0.24 * Math.sin(t * 11.5) +
            0.16 * Math.sin(t * 17.3 + 0.8) +
            0.08 * Math.cos(t * 5.2);

          impulseRef.current = Math.max(0, impulseRef.current * 0.88);
          level = Math.min(
            1,
            Math.max(0.14, baseWave * 0.68 + impulseRef.current * 0.42)
          );
        }

        const nextTier: SpeakingTier =
          level >= 0.58 ? 'peak' : level >= 0.24 ? 'medium' : 'soft';

        if (nextTier !== currentTier) {
          currentTier = nextTier;
          setAiTier(nextTier);
        }

        barRefs.current.forEach((bar, idx) => {
          if (!bar) return;
          const scale = Math.min(
            1,
            Math.max(0.16, level * EQUALIZER_WEIGHTS[idx] * 1.18)
          );
          bar.style.transform = `scaleY(${scale.toFixed(2)})`;
        });
        if (volLabelRef.current) {
          volLabelRef.current.textContent = `Audio ${Math.round(level * 100)}%`;
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [aiAudioLevelRef, isSpeaking, isListening, userMicLevel]);

  const { avatarAnimClass, haloAnimClass, haloColorClass, statusLabel } =
    useMemo(() => {
      if (isSpeaking) {
        if (aiTier === 'peak') {
          return {
            avatarAnimClass: 'digital-avatar-speaking-peak',
            haloAnimClass: 'avatar-halo-speaking-peak',
            haloColorClass:
              'border-blue-400/90 shadow-[0_0_28px_rgba(59,130,246,0.55)]',
            statusLabel: `${persona.name} is speaking · High emphasis`,
          };
        }
        if (aiTier === 'medium') {
          return {
            avatarAnimClass: 'digital-avatar-speaking-medium',
            haloAnimClass: 'avatar-halo-speaking-medium',
            haloColorClass:
              'border-blue-400/75 shadow-[0_0_20px_rgba(59,130,246,0.4)]',
            statusLabel: `${persona.name} is speaking`,
          };
        }
        return {
          avatarAnimClass: 'digital-avatar-speaking-soft',
          haloAnimClass: 'avatar-halo-speaking-soft',
          haloColorClass:
            'border-blue-300/60 shadow-[0_0_12px_rgba(59,130,246,0.25)]',
          statusLabel: `${persona.name} is speaking`,
        };
      }

      if (isListening) {
        return {
          avatarAnimClass: 'digital-avatar-listening',
          haloAnimClass: 'avatar-halo-listening',
          haloColorClass:
            userMicLevel >= 0.25
              ? 'border-emerald-400/85 shadow-[0_0_22px_rgba(16,185,129,0.45)]'
              : 'border-emerald-400/50 shadow-[0_0_10px_rgba(16,185,129,0.2)]',
          statusLabel:
            userMicLevel >= 0.2
              ? `${persona.name} is listening · Audio active`
              : `${persona.name} is listening · ${competencyLabel}`,
        };
      }

      return {
        avatarAnimClass: 'digital-avatar-idle',
        haloAnimClass: 'avatar-halo-idle',
        haloColorClass: 'border-white/25',
        statusLabel: `${persona.name} is ready · ${competencyLabel}`,
      };
    }, [
      aiTier,
      competencyLabel,
      isListening,
      isSpeaking,
      persona.name,
      userMicLevel,
    ]);

  const spokenPrefixEnd =
    isSpeaking && spokenCharIndex !== null
      ? Math.min(captionText.length, spokenCharIndex + 18)
      : 0;

  return (
    <div className="relative aspect-[16/10] sm:aspect-[16/9] w-full bg-slate-900 overflow-hidden select-none">
      {/* Stationary Digital Human Portrait Layer (halo & equalizer carry vocal motion cleanly) */}
      {!imgFailed ? (
        <img
          src={portraitSrc}
          alt={`${persona.name}, ${persona.title} digital interviewer`}
          referrerPolicy="no-referrer"
          decoding="async"
          onError={() => setImgFailed(true)}
          className={`w-full h-full object-cover object-top ${avatarAnimClass}`}
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-slate-800 to-slate-950 text-slate-300 gap-2">
          <User className="w-12 h-12 text-slate-400" />
          <span className="text-sm font-medium">{persona.name}</span>
        </div>
      )}

      {/* Subtle Voice-Resonance Studio Lighting Overlay when Speaking */}
      {isSpeaking && (
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none avatar-resonance-active bg-[radial-gradient(circle_at_50%_42%,rgba(59,130,246,0.16),transparent_62%)]"
        />
      )}

      {/* Scrim for high-contrast caption legibility */}
      <div
        className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-black/25 pointer-events-none"
        aria-hidden="true"
      />

      {/* Top Overlay: Persona Identity + Audio-Reactive Avatar Ring + Repeat Button */}
      <div className="absolute top-3 left-3 right-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 px-3 py-1.5 rounded-lg bg-slate-950/75 backdrop-blur-sm text-white text-xs">
          <div className="relative w-6 h-6 flex items-center justify-center shrink-0">
            <span
              aria-hidden="true"
              className={`absolute inset-0 rounded-full border-2 will-change-transform ${haloAnimClass} ${haloColorClass}`}
            />
            <span
              className={`w-2 h-2 rounded-full ${
                isSpeaking
                  ? 'bg-blue-400'
                  : isListening
                  ? 'bg-emerald-400'
                  : 'bg-slate-400'
              }`}
            />
          </div>

          <span className="font-semibold">{persona.name}</span>
          <span className="text-slate-400" aria-hidden="true">
            ·
          </span>
          <span className="text-slate-200">{persona.title}</span>
        </div>

        <button
          type="button"
          onClick={onRepeatQuestion}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-slate-950/75 hover:bg-slate-950/90 backdrop-blur-sm rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Volume2 className="w-3.5 h-3.5 text-blue-400" />
          Repeat question
        </button>
      </div>

      {/* Bottom Overlay: Multi-Band Volume Equalizer + Live Question Caption */}
      <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-5 text-white space-y-2.5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-xs">
            <div className="flex items-center gap-0.5 h-5" aria-hidden="true">
              {EQUALIZER_WEIGHTS.map((_, idx) => (
                <span
                  key={idx}
                  ref={(el) => {
                    barRefs.current[idx] = el;
                  }}
                  className={`w-1 h-5 rounded-sm transition-transform duration-75 will-change-transform ${
                    isSpeaking
                      ? 'bg-blue-400'
                      : isListening
                      ? 'bg-emerald-400'
                      : 'bg-slate-400/60'
                  }`}
                  style={{ transform: 'scaleY(0.16)' }}
                />
              ))}
            </div>
            <span
              className={`font-medium ${
                isSpeaking
                  ? 'text-blue-200'
                  : isListening
                  ? 'text-emerald-200'
                  : 'text-slate-300'
              }`}
            >
              {statusLabel}
            </span>
          </div>

          <span
            ref={volLabelRef}
            className="text-[11px] font-mono tabular-nums text-slate-300"
          >
            Audio 0%
          </span>
        </div>

        <p className="text-base sm:text-lg font-medium leading-snug text-white drop-shadow-sm">
          {isSpeaking && spokenPrefixEnd > 0 ? (
            <>
              <span className="text-blue-200">
                {captionText.slice(0, spokenPrefixEnd)}
              </span>
              <span>{captionText.slice(spokenPrefixEnd)}</span>
            </>
          ) : (
            captionText
          )}
        </p>
      </div>
    </div>
  );
}
