import { useState } from 'react';
import { User } from 'lucide-react';
import { PERSONAS, type PersonaId } from '../types/interview';
import priyaPortrait from '../assets/images/interviewer_priya_1794657883782.jpg';
import arjunPortrait from '../assets/images/interviewer_arjun_1794657883401.jpg';
import meeraPortrait from '../assets/images/interviewer_meera_1794657884503.jpg';

export const PERSONA_PORTRAITS: Record<PersonaId, string> = {
  friendly_hr: priyaPortrait,
  strict_tech: arjunPortrait,
  pressure_ceo: meeraPortrait,
};

interface PersonaAvatarProps {
  personaId: PersonaId;
  isSpeaking?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'video';
}

export function PersonaAvatar({
  personaId,
  isSpeaking = false,
  size = 'md',
}: PersonaAvatarProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const persona = PERSONAS[personaId];
  const src = PERSONA_PORTRAITS[personaId];

  if (size === 'video') {
    return (
      <div className="relative w-full h-full overflow-hidden bg-slate-900">
        {!imgFailed ? (
          <img
            src={src}
            alt={`${persona.name}, ${persona.title} interviewer`}
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className={`w-full h-full object-cover object-top transition-transform duration-500 ${
              isSpeaking ? 'interviewer-speaking' : 'interviewer-idle'
            }`}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-slate-800 to-slate-950 text-slate-300 gap-2">
            <User className="w-12 h-12 text-slate-400" />
            <span className="text-sm font-medium">{persona.name}</span>
          </div>
        )}
        <div
          className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/15 to-transparent pointer-events-none"
          aria-hidden="true"
        />
      </div>
    );
  }

  const dimensions =
    size === 'sm' ? 'w-12 h-12' : size === 'lg' ? 'w-20 h-20' : 'w-14 h-14';

  return (
    <div className="inline-flex items-center gap-3 shrink-0">
      <div
        className={`${dimensions} rounded-xl border border-slate-200 bg-slate-100 overflow-hidden relative shrink-0 ${
          isSpeaking ? 'ring-2 ring-blue-600 ring-offset-2' : ''
        }`}
      >
        {!imgFailed ? (
          <img
            src={src}
            alt={`${persona.name}, ${persona.title}`}
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className="w-full h-full object-cover object-top"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-slate-200 text-slate-600">
            <User className="w-5 h-5" />
          </div>
        )}
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
