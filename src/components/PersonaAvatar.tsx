import type { PersonaId } from '../types/interview';

interface PersonaAvatarProps {
  personaId: PersonaId;
  isSpeaking?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export function PersonaAvatar({
  personaId,
  isSpeaking = false,
  size = 'md',
}: PersonaAvatarProps) {
  const dimensions =
    size === 'sm' ? 'w-11 h-11' : size === 'lg' ? 'w-20 h-20' : 'w-14 h-14';

  const palette =
    personaId === 'friendly_hr'
      ? {
          bg: 'bg-emerald-50 border-emerald-200',
          skin: '#E0A88A',
          hair: '#1E293B',
          accent: '#059669',
          shirt: '#047857',
        }
      : personaId === 'strict_tech'
      ? {
          bg: 'bg-slate-100 border-slate-300',
          skin: '#D69A7B',
          hair: '#0F172A',
          accent: '#2563EB',
          shirt: '#1E293B',
        }
      : {
          bg: 'bg-amber-50 border-amber-200',
          skin: '#DBA184',
          hair: '#18181B',
          accent: '#D97706',
          shirt: '#312E81',
        };

  return (
    <div className="inline-flex items-center gap-3 shrink-0">
      <div
        className={`${dimensions} rounded-xl border ${palette.bg} flex items-center justify-center overflow-hidden relative shrink-0`}
        aria-hidden="true"
      >
        <svg viewBox="0 0 64 64" className="w-full h-full">
          {/* Shoulders */}
          <path
            d="M12 64 C12 49, 22 44, 32 44 C42 44, 52 49, 52 64 Z"
            fill={palette.shirt}
          />
          {/* Neck */}
          <rect x="27" y="37" width="10" height="9" rx="3" fill={palette.skin} />
          {/* Hair back */}
          {personaId !== 'strict_tech' && (
            <path
              d="M17 28 C17 14, 47 14, 47 28 L49 41 L15 41 Z"
              fill={palette.hair}
            />
          )}
          {/* Head */}
          <ellipse cx="32" cy="27" rx="12" ry="14" fill={palette.skin} />
          {/* Hair top */}
          <path
            d={
              personaId === 'friendly_hr'
                ? 'M19 25 C20 13, 44 12, 45 25 C40 19, 25 19, 19 25 Z'
                : personaId === 'strict_tech'
                ? 'M20 23 C20 12, 44 12, 44 23 C42 18, 22 18, 20 23 Z'
                : 'M19 24 C19 12, 45 12, 45 24 C38 17, 26 20, 19 24 Z'
            }
            fill={palette.hair}
          />
          {/* Glasses for Strict Tech Lead */}
          {personaId === 'strict_tech' && (
            <g stroke="#0F172A" strokeWidth="1.6" fill="none">
              <rect x="23" y="24" width="7" height="5" rx="1.2" />
              <rect x="34" y="24" width="7" height="5" rx="1.2" />
              <line x1="30" y1="26.5" x2="34" y2="26.5" />
            </g>
          )}
          {/* Eyes */}
          <circle cx="26.5" cy="26.5" r="1.3" fill="#0F172A" />
          <circle cx="37.5" cy="26.5" r="1.3" fill="#0F172A" />
          {/* Mouth expression */}
          {personaId === 'friendly_hr' ? (
            <path
              d="M27.5 33.5 Q32 37.5 36.5 33.5"
              stroke="#7C2D12"
              strokeWidth="1.6"
              strokeLinecap="round"
              fill="none"
            />
          ) : personaId === 'strict_tech' ? (
            <line
              x1="28.5"
              y1="34.5"
              x2="35.5"
              y2="34.5"
              stroke="#7C2D12"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          ) : (
            <path
              d="M28 34.5 Q32 33 36 34.5"
              stroke="#7C2D12"
              strokeWidth="1.6"
              strokeLinecap="round"
              fill="none"
            />
          )}
        </svg>
      </div>

      {isSpeaking && (
        <div
          className="flex items-center gap-1 h-6"
          aria-label="Interviewer speaking"
        >
          {[0, 0.15, 0.3, 0.12, 0.24].map((delay, idx) => (
            <span
              key={idx}
              className="w-1 h-5 rounded-sm bg-blue-600 soundwave-bar"
              style={{ animationDelay: `${delay}s` }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
