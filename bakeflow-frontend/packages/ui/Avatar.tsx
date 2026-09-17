import { Image, Text as RNText, View } from 'react-native';

import { cn } from './cn';
import { avatarTones, type AvatarTone } from './tokens';

const TONES = Object.keys(avatarTones) as AvatarTone[];

/** A stable tone for a person, so the same initials keep the same colour on every screen. */
export function toneFor(seed: string): AvatarTone {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return TONES[h % TONES.length] ?? 'e';
}

/** Up to two initials from a display name or email. */
export function initialsOf(name: string): string {
  const words = name.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
  const letters = words.length > 1 ? `${words[0]?.[0] ?? ''}${words.at(-1)?.[0] ?? ''}` : (words[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

const SIZE = {
  sm: { box: 'h-[30px] w-[30px] rounded-[10px]', text: 'text-[11px]' },
  md: { box: 'h-10 w-10 rounded-[13px]', text: 'text-foot' },
  lg: { box: 'h-[54px] w-[54px] rounded-[17px]', text: 'text-title-3' },
} as const;

/** The prototype's initials avatar (`.avatar`); shows a photo in the same shape when `uri` is given. */
export function Avatar({
  name,
  size = 'md',
  tone,
  uri,
  className,
}: {
  name: string;
  size?: keyof typeof SIZE;
  tone?: AvatarTone;
  /** A photo URL (e.g. a signed profile photo URL); initials are shown when absent. */
  uri?: string | null;
  className?: string;
}): React.JSX.Element {
  const t = avatarTones[tone ?? toneFor(name)];
  if (uri) {
    return (
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        className={cn('overflow-hidden bg-cream-deep', SIZE[size].box, className)}
      >
        <Image source={{ uri }} className="h-full w-full" resizeMode="cover" />
      </View>
    );
  }
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className={cn('items-center justify-center', SIZE[size].box, className)}
      style={{ backgroundColor: t.bg }}
    >
      <RNText className={cn('font-bold', SIZE[size].text)} style={{ color: t.ink }}>
        {initialsOf(name)}
      </RNText>
    </View>
  );
}
